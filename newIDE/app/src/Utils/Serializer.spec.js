// @flow
import { unserializeFromJSObject } from './Serializer';

const gd: libGDevelop = global.gd;

// The module under test reads `global.gd` at import time, so the wrapper
// lifecycle is observed with a fake gd — loaded through a fresh module
// registry (the pattern of ByokKeyStorage.spec.js). The real gd is kept for
// the tests above and restored after each fake load.
const realGd: any = global.gd;

/**
 * `unserializeFromJSObject` dispatches between the single-argument
 * `unserializeFrom` (in-place, for projects) and the two-argument form
 * (for elements inside a project). The dispatcher is observed with a fake
 * serializable so the call arity is what gets asserted.
 */
const makeFakeSerializable = () => ({
  unserializeFrom: (jest.fn(): any),
});

describe('unserializeFromJSObject', () => {
  it('uses the single-argument form without a project', () => {
    const serializable = makeFakeSerializable();
    unserializeFromJSObject((serializable: any), { name: 'object' });
    expect(serializable.unserializeFrom).toHaveBeenCalledTimes(1);
    expect(serializable.unserializeFrom.mock.calls[0].length).toBe(1);
  });

  it('uses the two-argument form for an element inside a project', () => {
    const serializable = makeFakeSerializable();
    const project = gd.ProjectHelper.createNewGDJSProject();
    unserializeFromJSObject(
      (serializable: any),
      { name: 'layout' },
      'unserializeFrom',
      project
    );
    expect(serializable.unserializeFrom).toHaveBeenCalledTimes(1);
    expect(serializable.unserializeFrom.mock.calls[0].length).toBe(2);
    project.delete();
  });

  it('never passes the project as both the serializable and the context', () => {
    // The corruption case found during Phase 8 (see ByokFork): the 2-call
    // form with the SAME object in both the serializable and the context
    // slots crashes the WASM, so the guard must route it to the
    // single-argument, in-place form. Identity is what triggers the guard,
    // so one fake plays both roles.
    const serializable = makeFakeSerializable();
    unserializeFromJSObject(
      (serializable: any),
      { name: 'project' },
      'unserializeFrom',
      (serializable: any)
    );
    expect(serializable.unserializeFrom).toHaveBeenCalledTimes(1);
    expect(serializable.unserializeFrom.mock.calls[0].length).toBe(1);
  });
});

/**
 * A SerializerElement (or VectorString) fake recording its `delete()` calls,
 * so a leaked wrapper is observable.
 */
const makeCountingWrapper = () => {
  const wrapper: any = {
    deleteCount: 0,
    delete: () => {
      wrapper.deleteCount += 1;
    },
  };
  return wrapper;
};

/**
 * A serializable fake whose serialize/unserialize methods optionally throw,
 * simulating a C++ side failure while the wrapper is alive.
 */
const makeSerializableThatThrows = (error: ?Error) => ({
  serializeTo: (element: any) => {
    if (error) throw error;
  },
  unserializeFrom: (firstArgument: any, secondArgument: any) => {
    if (error) throw error;
  },
});

type FakeGdOptions = {|
  // What gd.Serializer.toJSON returns (an invalid string makes JSON.parse
  // throw inside the module under test).
  json: string,
  // Errors thrown by the respective gd entry points, when set.
  cleanDefaultFlagsError?: ?Error,
  objectAssetSerializeError?: ?Error,
  resourceUnserializeError?: ?Error,
|};

/**
 * A fake gd exposing only what the Serializer module touches, recording every
 * wrapper it creates so the tests can assert they were all deleted.
 */
const makeFakeGd = (options: FakeGdOptions) => {
  const state = {
    serializerElements: [],
    fromJSObjectElements: [],
    vectorStrings: [],
  };

  const gd: any = {
    SerializerElement: function() {
      const element = makeCountingWrapper();
      state.serializerElements.push(element);
      return element;
    },
    VectorString: function() {
      const vector = makeCountingWrapper();
      vector.toJSArray = () => ['some-resource.png'];
      state.vectorStrings.push(vector);
      return vector;
    },
    Serializer: {
      toJSON: () => options.json,
      fromJSObject: () => {
        const element = makeCountingWrapper();
        state.fromJSObjectElements.push(element);
        return element;
      },
    },
    BehaviorDefaultFlagClearer: {
      serializeObjectWithCleanDefaultBehaviorFlags: (
        object: any,
        element: any
      ) => {
        if (options.cleanDefaultFlagsError)
          throw options.cleanDefaultFlagsError;
      },
    },
    ObjectAssetSerializer: {
      serializeTo: (
        project: any,
        object: any,
        objectFullName: any,
        element: any,
        usedResourceNamesVector: any,
        extensionDependencyCache: any
      ) => {
        if (options.objectAssetSerializeError)
          throw options.objectAssetSerializeError;
      },
    },
    ResourcesContainer: {
      unserializeResourceFrom: (resource: any, element: any) => {
        if (options.resourceUnserializeError)
          throw options.resourceUnserializeError;
      },
    },
  };

  return { gd, state };
};

/**
 * Loads the Serializer module with the given fake gd on `global.gd`: the
 * module captures `global.gd` at import time, so each load needs a fresh
 * module registry. The real gd is restored right after the require.
 */
const loadSerializerModuleWithFakeGd = (fakeGd: any) => {
  global.gd = fakeGd;
  try {
    jest.resetModules();
    return require('./Serializer');
  } finally {
    global.gd = realGd;
  }
};

describe('Serializer wrapper lifecycle (fake gd)', () => {
  it('serializeToJSObject deletes the element on success', () => {
    const { gd, state } = makeFakeGd({ json: '{"ok":true}' });
    const { serializeToJSObject } = loadSerializerModuleWithFakeGd(gd);

    expect(serializeToJSObject(makeSerializableThatThrows(null))).toEqual({
      ok: true,
    });
    expect(state.serializerElements).toHaveLength(1);
    expect(state.serializerElements[0].deleteCount).toBe(1);
  });

  it('serializeToJSObject deletes the element when serializeTo throws', () => {
    const { gd, state } = makeFakeGd({ json: '{"ok":true}' });
    const { serializeToJSObject } = loadSerializerModuleWithFakeGd(gd);
    const serializable = makeSerializableThatThrows(
      new Error('serializeTo failed')
    );

    expect(() => serializeToJSObject(serializable)).toThrow(
      'serializeTo failed'
    );
    expect(state.serializerElements).toHaveLength(1);
    expect(state.serializerElements[0].deleteCount).toBe(1);
  });

  it('serializeToJSObject deletes the element when the JSON cannot be parsed', () => {
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const { gd, state } = makeFakeGd({ json: 'not valid json {' });
    const { serializeToJSObject } = loadSerializerModuleWithFakeGd(gd);

    expect(() =>
      serializeToJSObject(makeSerializableThatThrows(null))
    ).toThrow();
    expect(consoleError).toHaveBeenCalled();
    expect(state.serializerElements).toHaveLength(1);
    expect(state.serializerElements[0].deleteCount).toBe(1);

    consoleError.mockRestore();
  });

  it('serializeObjectWithCleanDefaultBehaviorFlags deletes the element on success', () => {
    const { gd, state } = makeFakeGd({ json: '{"ok":true}' });
    const {
      serializeObjectWithCleanDefaultBehaviorFlags,
    } = loadSerializerModuleWithFakeGd(gd);

    expect(serializeObjectWithCleanDefaultBehaviorFlags(({}: any))).toEqual({
      ok: true,
    });
    expect(state.serializerElements).toHaveLength(1);
    expect(state.serializerElements[0].deleteCount).toBe(1);
  });

  it('serializeObjectWithCleanDefaultBehaviorFlags deletes the element when the flag cleaner throws', () => {
    const { gd, state } = makeFakeGd({
      json: '{"ok":true}',
      cleanDefaultFlagsError: new Error('flag cleaner failed'),
    });
    const {
      serializeObjectWithCleanDefaultBehaviorFlags,
    } = loadSerializerModuleWithFakeGd(gd);

    expect(() =>
      serializeObjectWithCleanDefaultBehaviorFlags(({}: any))
    ).toThrow('flag cleaner failed');
    expect(state.serializerElements).toHaveLength(1);
    expect(state.serializerElements[0].deleteCount).toBe(1);
  });

  it('serializeObjectWithCleanDefaultBehaviorFlags deletes the element when the JSON cannot be parsed', () => {
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const { gd, state } = makeFakeGd({ json: 'not valid json {' });
    const {
      serializeObjectWithCleanDefaultBehaviorFlags,
    } = loadSerializerModuleWithFakeGd(gd);

    expect(() =>
      serializeObjectWithCleanDefaultBehaviorFlags(({}: any))
    ).toThrow();
    expect(consoleError).toHaveBeenCalled();
    expect(state.serializerElements).toHaveLength(1);
    expect(state.serializerElements[0].deleteCount).toBe(1);

    consoleError.mockRestore();
  });

  it('serializeToObjectAsset deletes the element and the resource names vector on success', () => {
    const { gd, state } = makeFakeGd({ json: '{"kind":"objectAsset"}' });
    const { serializeToObjectAsset } = loadSerializerModuleWithFakeGd(gd);
    const usedResourceNames: Array<string> = [];

    expect(
      serializeToObjectAsset(
        ({}: any),
        ({}: any),
        'My object',
        usedResourceNames,
        ({}: any)
      )
    ).toEqual({ kind: 'objectAsset' });
    expect(usedResourceNames).toEqual(['some-resource.png']);
    expect(state.serializerElements).toHaveLength(1);
    expect(state.serializerElements[0].deleteCount).toBe(1);
    expect(state.vectorStrings).toHaveLength(1);
    expect(state.vectorStrings[0].deleteCount).toBe(1);
  });

  it('serializeToObjectAsset deletes the element and the resource names vector when the serializer throws', () => {
    const { gd, state } = makeFakeGd({
      json: '{"kind":"objectAsset"}',
      objectAssetSerializeError: new Error('ObjectAssetSerializer failed'),
    });
    const { serializeToObjectAsset } = loadSerializerModuleWithFakeGd(gd);

    expect(() =>
      serializeToObjectAsset(({}: any), ({}: any), 'My object', [], ({}: any))
    ).toThrow('ObjectAssetSerializer failed');
    expect(state.serializerElements).toHaveLength(1);
    expect(state.serializerElements[0].deleteCount).toBe(1);
    expect(state.vectorStrings).toHaveLength(1);
    expect(state.vectorStrings[0].deleteCount).toBe(1);
  });

  it('serializeToJSON deletes the element on success', () => {
    const { gd, state } = makeFakeGd({ json: '{"ok":true}' });
    const { serializeToJSON } = loadSerializerModuleWithFakeGd(gd);

    expect(serializeToJSON(makeSerializableThatThrows(null))).toBe(
      '{"ok":true}'
    );
    expect(state.serializerElements).toHaveLength(1);
    expect(state.serializerElements[0].deleteCount).toBe(1);
  });

  it('serializeToJSON deletes the element when serializeTo throws', () => {
    const { gd, state } = makeFakeGd({ json: '{"ok":true}' });
    const { serializeToJSON } = loadSerializerModuleWithFakeGd(gd);
    const serializable = makeSerializableThatThrows(
      new Error('serializeTo failed')
    );

    expect(() => serializeToJSON(serializable)).toThrow('serializeTo failed');
    expect(state.serializerElements).toHaveLength(1);
    expect(state.serializerElements[0].deleteCount).toBe(1);
  });

  it('unserializeFromJSObject deletes the element on success', () => {
    const { gd, state } = makeFakeGd({ json: '{"ok":true}' });
    const {
      unserializeFromJSObject: unserialize,
    } = loadSerializerModuleWithFakeGd(gd);

    unserialize(makeSerializableThatThrows(null), { name: 'object' });
    expect(state.fromJSObjectElements).toHaveLength(1);
    expect(state.fromJSObjectElements[0].deleteCount).toBe(1);
  });

  it('unserializeFromJSObject deletes the element when unserializeFrom throws (two-argument form)', () => {
    const { gd, state } = makeFakeGd({ json: '{"ok":true}' });
    const {
      unserializeFromJSObject: unserialize,
    } = loadSerializerModuleWithFakeGd(gd);
    const serializable = makeSerializableThatThrows(
      new Error('unserializeFrom failed')
    );

    expect(() =>
      unserialize(
        serializable,
        { name: 'layout' },
        'unserializeFrom',
        ({
          name: 'project',
        }: any)
      )
    ).toThrow('unserializeFrom failed');
    expect(state.fromJSObjectElements).toHaveLength(1);
    expect(state.fromJSObjectElements[0].deleteCount).toBe(1);
  });

  it('unserializeResourceFromJSObject deletes the element on success', () => {
    const { gd, state } = makeFakeGd({ json: '{"ok":true}' });
    const {
      unserializeResourceFromJSObject: unserializeResource,
    } = loadSerializerModuleWithFakeGd(gd);

    unserializeResource(({}: any), { name: 'resource' });
    expect(state.fromJSObjectElements).toHaveLength(1);
    expect(state.fromJSObjectElements[0].deleteCount).toBe(1);
  });

  it('unserializeResourceFromJSObject deletes the element when the unserializer throws', () => {
    const { gd, state } = makeFakeGd({
      json: '{"ok":true}',
      resourceUnserializeError: new Error('unserializeResourceFrom failed'),
    });
    const {
      unserializeResourceFromJSObject: unserializeResource,
    } = loadSerializerModuleWithFakeGd(gd);

    expect(() => unserializeResource(({}: any), { name: 'resource' })).toThrow(
      'unserializeResourceFrom failed'
    );
    expect(state.fromJSObjectElements).toHaveLength(1);
    expect(state.fromJSObjectElements[0].deleteCount).toBe(1);
  });
});

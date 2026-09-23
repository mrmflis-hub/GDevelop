// @flow
import { unserializeFromJSObject } from './Serializer';

const gd: libGDevelop = global.gd;

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

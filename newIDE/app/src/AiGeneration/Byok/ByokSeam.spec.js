// @flow
const ByokSeam = require('./ByokSeam');
const { DEFAULT_BYOK_SETTINGS } = require('./ByokTypes');

describe('isByokAiRequestId', () => {
  it('recognizes ids prefixed by "byok-"', () => {
    expect(ByokSeam.isByokAiRequestId('byok-abc123')).toBe(true);
    expect(ByokSeam.isByokAiRequestId('regular-server-id')).toBe(false);
    expect(ByokSeam.isByokAiRequestId('')).toBe(false);
    expect(ByokSeam.isByokAiRequestId(null)).toBe(false);
    expect(ByokSeam.isByokAiRequestId(undefined)).toBe(false);
  });
});

describe('shouldUseByokForNewRequest', () => {
  it('is false for the default (disabled) settings', () => {
    expect(
      ByokSeam.shouldUseByokForNewRequest({
        byok: DEFAULT_BYOK_SETTINGS,
      })
    ).toBe(false);
  });

  it('is false when enabled but not fully configured', () => {
    expect(
      ByokSeam.shouldUseByokForNewRequest({
        byok: {
          ...DEFAULT_BYOK_SETTINGS,
          enabled: true,
          endpointUrl: 'https://api.example.com/v1',
          // No model name.
        },
      })
    ).toBe(false);
  });

  it('is true when enabled and fully configured', () => {
    expect(
      ByokSeam.shouldUseByokForNewRequest({
        byok: {
          ...DEFAULT_BYOK_SETTINGS,
          enabled: true,
          endpointUrl: 'https://api.example.com/v1',
          modelName: 'my-model',
        },
      })
    ).toBe(true);
  });

  it('is false for a missing or corrupt byok preference', () => {
    expect(ByokSeam.shouldUseByokForNewRequest({ byok: null })).toBe(false);
    expect(
      ByokSeam.shouldUseByokForNewRequest(({ byok: 'corrupt' }: any))
    ).toBe(false);
  });
});

describe('buildByokChatProps', () => {
  it('returns the exact idle-credits prop bundle', () => {
    expect(ByokSeam.buildByokChatProps()).toEqual({
      quota: null,
      price: null,
      availableCredits: 0,
      isRefreshingLimits: false,
      increaseQuotaOffering: 'none',
    });
  });
});

describe('byokCallRequiresApproval', () => {
  it('requires approval when the registry function is missing (safe default)', () => {
    expect(ByokSeam.byokCallRequiresApproval(null, {})).toBe(true);
  });

  it('does not require approval for a non-modifying function', () => {
    expect(
      ByokSeam.byokCallRequiresApproval({ modifiesProject: false }, {})
    ).toBe(false);
  });

  it('requires approval for a modifying function', () => {
    expect(
      ByokSeam.byokCallRequiresApproval({ modifiesProject: true }, {})
    ).toBe(true);
  });

  it('respects a getModifiesProject override over modifiesProject', () => {
    const editorFunction = {
      modifiesProject: true,
      getModifiesProject: (args: any) => args.shouldModify === true,
    };

    expect(
      ByokSeam.byokCallRequiresApproval(editorFunction, {
        shouldModify: true,
      })
    ).toBe(true);
    expect(
      ByokSeam.byokCallRequiresApproval(editorFunction, {
        shouldModify: false,
      })
    ).toBe(false);
  });
});

describe('createByokEditorFunctionCallExecutor', () => {
  const makeExecutorDeps = (overrides: any = {}) => ({
    processEditorFunctionCalls: (jest.fn(): any),
    project: { name: 'fake-project' },
    i18n: {},
    editorCallbacks: {},
    ensureExtensionInstalled: (jest.fn(): any),
    onSceneEventsModifiedOutsideEditor: (jest.fn(): any),
    onInstancesModifiedOutsideEditor: (jest.fn(): any),
    onObjectsModifiedOutsideEditor: (jest.fn(): any),
    onObjectGroupsModifiedOutsideEditor: (jest.fn(): any),
    onProjectItemRenamedOutsideEditor: (jest.fn(): any),
    onWillDeleteScene: (jest.fn(): any),
    onWillDeleteGameplayTest: (jest.fn(): any),
    onWillDeleteObject: (jest.fn(): any),
    onWillInstallExtension: (jest.fn(): any),
    onExtensionInstalled: (jest.fn(): any),
    ...overrides,
  });

  it('passes the calls to the injected runner with the byok context', async () => {
    const deps = makeExecutorDeps();
    deps.processEditorFunctionCalls.mockResolvedValue({
      results: [],
      createdSceneNames: ['NewScene'],
      createdProject: null,
    });
    const executor = ByokSeam.createByokEditorFunctionCallExecutor(deps);
    const getRelatedAiRequestLastMessages = () => ({ lastUserMessage: null });

    const outcome = await executor(
      [{ name: 'create_scene', arguments: '{}', call_id: 'call-1' }],
      {
        aiRequestId: 'byok-chat-1',
        getRelatedAiRequestLastMessages,
      }
    );

    expect(deps.processEditorFunctionCalls).toHaveBeenCalledTimes(1);
    const runnerOptions = deps.processEditorFunctionCalls.mock.calls[0][0];
    expect(runnerOptions.project).toBe(deps.project);
    expect(runnerOptions.toolOptions).toBe(null);
    expect(runnerOptions.toolsVersion).toBe(null);
    expect(runnerOptions.functionCalls).toEqual([
      { name: 'create_scene', arguments: '{}', call_id: 'call-1' },
    ]);
    expect(runnerOptions.relatedAiRequestId).toBe('byok-chat-1');
    expect(runnerOptions.getRelatedAiRequestLastMessages).toBe(
      getRelatedAiRequestLastMessages
    );
    expect(outcome.createdSceneNames).toEqual(['NewScene']);
  });

  it('coalesces the outside-editor notifications of a batch, flushing once', async () => {
    const deps = makeExecutorDeps();
    deps.processEditorFunctionCalls.mockImplementation(async (options: any) => {
      // Simulate two calls editing the same scene twice.
      options.onInstancesModifiedOutsideEditor({ scene: 'scene-1' });
      options.onInstancesModifiedOutsideEditor({ scene: 'scene-1' });
      options.onSceneEventsModifiedOutsideEditor({
        scene: 'scene-1',
        newOrChangedAiGeneratedEventIds: ['event-1'],
      });
      options.onSceneEventsModifiedOutsideEditor({
        scene: 'scene-1',
        newOrChangedAiGeneratedEventIds: ['event-2'],
      });
      return { results: [], createdSceneNames: [], createdProject: null };
    });
    const executor = ByokSeam.createByokEditorFunctionCallExecutor(deps);

    await executor([], {
      aiRequestId: 'byok-chat-1',
      getRelatedAiRequestLastMessages: () => ({}),
    });

    expect(deps.onInstancesModifiedOutsideEditor).toHaveBeenCalledTimes(1);
    expect(deps.onSceneEventsModifiedOutsideEditor).toHaveBeenCalledTimes(1);
    expect(deps.onSceneEventsModifiedOutsideEditor).toHaveBeenCalledWith({
      scene: 'scene-1',
      newOrChangedAiGeneratedEventIds: new Set(['event-1', 'event-2']),
    });
  });

  it('flushes the accumulated notifications even when the runner throws', async () => {
    const consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const deps = makeExecutorDeps();
    deps.processEditorFunctionCalls.mockImplementation(async (options: any) => {
      options.onInstancesModifiedOutsideEditor({ scene: 'scene-1' });
      throw new Error('runner exploded');
    });
    const executor = ByokSeam.createByokEditorFunctionCallExecutor(deps);

    await expect(
      executor([], {
        aiRequestId: 'byok-chat-1',
        getRelatedAiRequestLastMessages: () => ({}),
      })
    ).rejects.toThrow('runner exploded');
    expect(deps.onInstancesModifiedOutsideEditor).toHaveBeenCalledTimes(1);

    consoleErrorSpy.mockRestore();
  });

  it('provides the excluded v1 dependencies as failures', async () => {
    const deps = makeExecutorDeps();
    deps.processEditorFunctionCalls.mockImplementation(async (options: any) => {
      await expect(options.generateEvents({})).rejects.toThrow(
        'not available in BYOK'
      );
      await expect(options.searchAndInstallAsset({})).rejects.toThrow(
        'not available in BYOK'
      );
      expect(options.getAssetStoreTagForNewObject('Sprite::Object')).toBe(null);
      return { results: [], createdSceneNames: [], createdProject: null };
    });
    const executor = ByokSeam.createByokEditorFunctionCallExecutor(deps);

    await executor([], {
      aiRequestId: 'byok-chat-1',
      getRelatedAiRequestLastMessages: () => ({}),
    });

    expect(deps.processEditorFunctionCalls).toHaveBeenCalledTimes(1);
  });

  it('passes the real ensureExtensionInstalled through', async () => {
    const deps = makeExecutorDeps();
    deps.processEditorFunctionCalls.mockResolvedValue({
      results: [],
      createdSceneNames: [],
      createdProject: null,
    });
    const executor = ByokSeam.createByokEditorFunctionCallExecutor(deps);

    await executor([], {
      aiRequestId: 'byok-chat-1',
      getRelatedAiRequestLastMessages: () => ({}),
    });

    expect(
      deps.processEditorFunctionCalls.mock.calls[0][0].ensureExtensionInstalled
    ).toBe(deps.ensureExtensionInstalled);
  });
});

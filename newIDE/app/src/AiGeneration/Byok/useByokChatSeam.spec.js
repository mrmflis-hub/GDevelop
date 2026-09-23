// @flow
import * as React from 'react';
import { act } from 'react-dom/test-utils';
import reactTestRenderer from 'react-test-renderer';
import { useByokChatSeam } from './useByokChatSeam';
import { sendByokChatCompletionWithRetries } from './ByokClient';
import { saveByokKey } from './ByokKeyStorage';
import { getByokChat, listByokChats } from './ByokChatStore';
import { isByokAiRequestId } from './ByokSeam';
import { useEnsureExtensionInstalled } from '../UseEnsureExtensionInstalled';

jest.mock('./ByokClient', () => ({
  sendByokChatCompletionWithRetries: (jest.fn(): any),
  createByokCancellation: jest.fn(() => ({
    token: { __fakeCancelToken: true },
    cancel: (jest.fn(): any),
  })),
}));

// The real hook consumes the extension-store context through
// useEnsureExtensionInstalled — not under test here (it has its own spec);
// replace it with a stub. The implementation is (re)installed in beforeEach:
// the repo's jest config resets mocks between tests, which would wipe a
// factory-provided implementation.
jest.mock('../UseEnsureExtensionInstalled', () => ({
  useEnsureExtensionInstalled: (jest.fn(): any),
}));

const mockUseEnsureExtensionInstalled: any = useEnsureExtensionInstalled;
const mockSendByokChatCompletion: any = sendByokChatCompletionWithRetries;

// The suite runs in the node environment (like ByokOrchestrator.spec.js —
// the import chain reaches modules that need no DOM), which has no
// localStorage: shim the tiny surface ByokKeyStorage uses. Installed in the
// module body: none of the imported modules touch localStorage at load.
const localStorageShim = (() => {
  const store: Map<string, string> = new Map();
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key) : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
})();
(global: any).localStorage = localStorageShim;

const makeAssistantTextResponse = (text: string) => ({
  choices: [{ message: { role: 'assistant', content: text } }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
});

const makeOptions = (overrides: Object = {}) => ({
  preferencesValues: {},
  project: null,
  fileMetadata: null,
  i18n: {
    _: (descriptor: any) =>
      typeof descriptor === 'string' ? descriptor : 'translated',
  },
  editorCallbacks: {},
  processEditorFunctionCalls: (jest.fn(): any),
  editorFunctions: {},
  editorFunctionsWithoutProject: {},
  onSceneEventsModifiedOutsideEditor: (jest.fn(): any),
  onInstancesModifiedOutsideEditor: (jest.fn(): any),
  onObjectsModifiedOutsideEditor: (jest.fn(): any),
  onObjectGroupsModifiedOutsideEditor: (jest.fn(): any),
  onProjectItemRenamedOutsideEditor: (jest.fn(): any),
  onWillDeleteScene: (jest.fn(async () => {}): any),
  onWillDeleteGameplayTest: (jest.fn(async () => {}): any),
  onWillDeleteObject: (jest.fn(): any),
  onWillInstallExtension: (jest.fn(): any),
  onExtensionInstalled: (jest.fn(): any),
  getIsAutoEditEnabled: () => true,
  requestEditApproval: jest.fn(async () => true),
  triggerUnsavedChanges: (jest.fn(): any),
  onOpenLayout: (jest.fn(): any),
  setSelectedAiRequestId: (jest.fn(): any),
  resetChatUserInputs: (jest.fn(): any),
  getProjectPreviewLauncher: () => null,
  ...overrides,
});

// The seam object is re-created at every render: tests read it through the
// capture (never through a variable captured before an update).
type SeamCapture = { current: Object | null };

const Probe = ({
  options,
  capture,
}: {|
  options: Object,
  capture: SeamCapture,
|}) => {
  capture.current = useByokChatSeam(options);
  return null;
};

const renderSeam = (
  options: Object
): {| renderer: any, getSeam: () => Object |} => {
  const capture: SeamCapture = { current: null };
  const renderer = reactTestRenderer.create(
    <Probe options={options} capture={capture} />
  );
  return { renderer, getSeam: () => capture.current };
};

describe('useByokChatSeam', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseEnsureExtensionInstalled.mockImplementation(() => ({
      ensureExtensionInstalled: (jest.fn(async () => {}): any),
    }));
    mockSendByokChatCompletion.mockReset();
    localStorageShim.clear();
    listByokChats().forEach(chat => {
      const record = getByokChat(chat.id);
      if (record) record.archivedAt = new Date().toISOString();
    });
  });

  it('exposes the BYOK chat selection and store summaries', () => {
    const { getSeam } = renderSeam(makeOptions());
    expect(getSeam().selectedByokChatId).toBe(null);
    expect(getSeam().selectedByokChat).toBe(null);
    expect(Array.isArray(getSeam().byokChatSummaries)).toBe(true);
  });

  it('marks a new chat with the missing-key error when no key is stored', async () => {
    const { getSeam } = renderSeam(makeOptions());
    await act(async () => {
      await getSeam().startByokChat('Make me a game');
    });

    const selectedByokChatId = getSeam().selectedByokChatId;
    expect(selectedByokChatId).not.toBe(null);
    expect(isByokAiRequestId(selectedByokChatId)).toBe(true);
    const chat = getSeam().selectedByokChat;
    expect(chat).not.toBe(null);
    expect(chat.status).toBe('error');
    expect(chat.error && chat.error.code).toBe('byok-missing-key');
    // No orchestrator was ever created: the endpoint was never called.
    expect(mockSendByokChatCompletion).not.toHaveBeenCalled();
  });

  it('resets the chat inputs and the server selection when a chat starts', async () => {
    const resetChatUserInputs = (jest.fn(): any);
    const setSelectedAiRequestId = (jest.fn(): any);
    const { getSeam } = renderSeam(
      makeOptions({ resetChatUserInputs, setSelectedAiRequestId })
    );
    await act(async () => {
      await getSeam().startByokChat('Make me a game');
    });

    expect(setSelectedAiRequestId).toHaveBeenCalledWith(null);
    expect(resetChatUserInputs).toHaveBeenCalledTimes(1);
    expect(resetChatUserInputs.mock.calls[0][0]).toBe(
      getSeam().selectedByokChatId
    );
  });

  it('runs the chat through the orchestrator when a key is stored', async () => {
    await saveByokKey('test-key');
    mockSendByokChatCompletion.mockResolvedValue(
      makeAssistantTextResponse('Hello from BYOK.')
    );
    const { getSeam } = renderSeam(makeOptions());
    await act(async () => {
      await getSeam().startByokChat('Make me a game');
    });

    expect(mockSendByokChatCompletion).toHaveBeenCalledTimes(1);
    const chat = getSeam().selectedByokChat;
    expect(chat.status).toBe('ready');
    const roles = (chat.output || []).map((message: Object) => message.role);
    expect(roles).toEqual(['user', 'assistant']);
    // The chat is listed in the history summaries.
    expect(
      getSeam().byokChatSummaries.some(
        (summary: Object) => summary.id === getSeam().selectedByokChatId
      )
    ).toBe(true);
  });

  it('ignores empty user messages', async () => {
    await saveByokKey('test-key');
    mockSendByokChatCompletion.mockResolvedValue(
      makeAssistantTextResponse('Answer.')
    );
    const { getSeam } = renderSeam(makeOptions());
    await act(async () => {
      await getSeam().startByokChat('Make me a game');
    });
    mockSendByokChatCompletion.mockClear();

    await act(async () => {
      await getSeam().sendByokUserMessage(getSeam().selectedByokChatId, '');
    });
    expect(mockSendByokChatCompletion).not.toHaveBeenCalled();
  });

  it('continues a chat with a user message through the orchestrator', async () => {
    await saveByokKey('test-key');
    mockSendByokChatCompletion.mockResolvedValue(
      makeAssistantTextResponse('Answer.')
    );
    const { getSeam } = renderSeam(makeOptions());
    await act(async () => {
      await getSeam().startByokChat('Make me a game');
    });
    mockSendByokChatCompletion.mockClear();

    await act(async () => {
      await getSeam().sendByokUserMessage(
        getSeam().selectedByokChatId,
        'Now add a coin'
      );
    });
    expect(mockSendByokChatCompletion).toHaveBeenCalledTimes(1);
    const chat = getSeam().selectedByokChat;
    const userMessages = (chat.output || []).filter(
      (message: Object) => message.role === 'user'
    );
    expect(userMessages.length).toBe(2);
  });

  it('suspends BYOK chats locally and leaves other ids alone', async () => {
    await saveByokKey('test-key');
    mockSendByokChatCompletion.mockResolvedValue(
      makeAssistantTextResponse('Answer.')
    );
    const { getSeam } = renderSeam(makeOptions());
    await act(async () => {
      await getSeam().startByokChat('Make me a game');
    });

    await getSeam().suspendAiRequestWithByokSupport('not-a-byok-id');
    expect(getSeam().selectedByokChat.status).toBe('ready');

    getSeam().suspendByokChat(getSeam().selectedByokChatId);
    expect(getSeam().selectedByokChat.status).toBe('suspended');
  });

  it('reads the live project through the project prop', async () => {
    const fakeProject = { name: 'Opened project' };
    const capture: SeamCapture = { current: null };
    const options = makeOptions();
    const renderer = reactTestRenderer.create(
      <Probe options={options} capture={capture} />
    );
    expect((capture.current: any).getByokLiveProject()).toBe(null);

    await act(async () => {
      renderer.update(
        <Probe
          options={makeOptions({ project: fakeProject })}
          capture={capture}
        />
      );
    });
    expect((capture.current: any).getByokLiveProject()).toBe(fakeProject);
    renderer.unmount();
  });
});

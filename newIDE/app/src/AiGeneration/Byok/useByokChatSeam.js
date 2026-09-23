// @flow
import * as React from 'react';
import { type I18n as I18nType } from '@lingui/core';
import { t } from '@lingui/macro';
import {
  type AiRequest,
  getAiRequestSummary,
} from '../../Utils/GDevelopServices/Generation';
import {
  archiveByokChat,
  createByokChat,
  deleteByokOrchestrator,
  getByokChat,
  getByokOrchestrator,
  listByokChats,
  setByokOrchestrator,
  subscribeByokChats,
  updateByokChat,
} from './ByokChatStore';
import {
  createByokOrchestrator,
  type ByokOrchestrator,
} from './ByokOrchestrator';
import { createByokUsageTracker } from './ByokUsageTracker';
import { createByokSubAgentRunner } from './ByokSubAgents';
import { dropByokChatSnapshots } from './ByokFork';
import { loadByokKey, type ByokKeyLoadResult } from './ByokKeyStorage';
import { makeByokProjectNotesIdentifierFromProjectName } from './ByokProjectNotes';
import {
  BYOK_GLOBAL_TURN_BUDGET,
  getByokSettings,
  type ByokSettings,
} from './ByokTypes';
import {
  APPROVED_CALL_IDS_CAPACITY,
  byokCallRequiresApproval,
  createByokEditorFunctionCallExecutor,
  isByokAiRequestId,
} from './ByokSeam';
import { findByNameokExtraTool } from './ByokExtraTools';
import {
  findLargestVisibleSceneCanvas,
  invokeByokPreviewCapture,
} from './ByokRuntimeTools';
import { useEnsureExtensionInstalled } from '../UseEnsureExtensionInstalled';
import { makeSimplifiedProjectBuilder } from '../../EditorFunctions/SimplifiedProject/SimplifiedProject';
import { useStableUpToDateRef } from '../../Utils/UseStableUpToDateCallback';
import EventsFunctionsExtensionsContext from '../../EventsFunctionsExtensionsLoader/EventsFunctionsExtensionsContext';

/**
 * The container's BYOK seam (the D8 refactor, scheduled by `Phase8.md` step
 * 8.0): everything a host component needs to run BYOK chats — selection,
 * history summaries, the executor, the orchestrators and their lifecycle —
 * extracted verbatim from `AskAiEditorContainer`, which now keeps a single
 * hook call. `AskAiStandAloneForm` reuses the same hook (Phase 8 step 8.5),
 * which is what makes the homepage "make me a game" flow a BYOK chat.
 *
 * The hook owns no rendering. Everything host-specific (the chat input ref,
 * the edit-approval row, unsaved-changes, scene opening) arrives as options.
 */

const gd: libGDevelop = global.gd;

// Reducer of the "BYOK chats changed" force-update signal: its state is
// never read, the dispatch only exists to re-render the host when the BYOK
// chat store notifies (the explicit `void` action pins the reducer's action
// type for Flow).
const byokChatsForceUpdateReducer = (count: number, action: void): number =>
  count + 1;

export type ByokChatSeamOptions = {|
  preferencesValues: { +byok?: ?ByokSettings, ... },
  project: ?any,
  fileMetadata: ?{ +fileIdentifier?: ?string, ... },
  i18n: I18nType,
  editorCallbacks: any,
  // The tool runner and the registries, injected (not imported) so the hook
  // stays testable without pulling the whole editor registry.
  processEditorFunctionCalls: (options: any) => Promise<any>,
  editorFunctions: {|
    +[string]: ?{
      +modifiesProject?: ?boolean,
      +getModifiesProject?: ?(args: any) => boolean,
      ...
    },
  |},
  editorFunctionsWithoutProject: {|
    +[string]: ?{
      +modifiesProject?: ?boolean,
      +getModifiesProject?: ?(args: any) => boolean,
      ...
    },
  |},
  // Host callbacks (the same ones useProcessFunctionCalls and the render
  // layer already receive in the container).
  onSceneEventsModifiedOutsideEditor: (changes: any) => void,
  onInstancesModifiedOutsideEditor: (changes: any) => void,
  onObjectsModifiedOutsideEditor: (changes: any) => void,
  onObjectGroupsModifiedOutsideEditor: (changes: any) => void,
  onProjectItemRenamedOutsideEditor: (changes: any) => void,
  onWillDeleteScene: (changes: any) => Promise<void>,
  onWillDeleteGameplayTest: (changes: any) => Promise<void>,
  onWillDeleteObject: (changes: any) => void,
  onWillInstallExtension: (extensionNames: Array<string>) => void,
  onExtensionInstalled: (extensionNames: Array<string>) => void,
  getIsAutoEditEnabled: () => boolean,
  // The label is a React.Node: it renders the same way the hosted flow's
  // edit-approval row does (see EditApprovalRequest in AiGeneration/Utils).
  requestEditApproval: (options: {|
    aiRequestId: string,
    callIds: Array<string>,
    label: React.Node,
  |}) => Promise<boolean>,
  triggerUnsavedChanges: () => void,
  onOpenLayout: (
    sceneName: string,
    options: {|
      openEventsEditor: boolean,
      openSceneEditor: boolean,
      focusWhenOpened:
        | 'scene-or-events-otherwise'
        | 'scene'
        | 'events'
        | 'none',
    |}
  ) => void,
  setSelectedAiRequestId: (aiRequestId: string | null) => void,
  // The host's chat-input ref, wrapped: both chat-start and user-message
  // send reset the input (the same dual resetUserInput('' | chatId) calls
  // the container used to make).
  resetChatUserInputs: (chatId: string) => void,
  // The preview launcher MainFrame registered (perception tools). Absent in
  // hosts without previews (the tools answer with actionable failures).
  getProjectPreviewLauncher: () => ?any,
|};

export type ByokChatSeam = {|
  selectedByokChatId: string | null,
  setSelectedByokChatId: (chatId: string | null) => void,
  selectedByokChat: AiRequest | null,
  byokChatSummaries: Array<any>,
  onArchiveByokChat: (aiRequestId: string) => void,
  startByokChat: (
    userRequest: string,
    options?: {| onChatCreated?: (chatId: string) => void |}
  ) => Promise<void>,
  attachByokOrchestrator: (chat: AiRequest) => Promise<?ByokOrchestrator>,
  sendByokUserMessage: (
    aiRequestId: string,
    userMessage: string
  ) => Promise<void>,
  suspendByokChat: (aiRequestId: string) => void,
  suspendAiRequestWithByokSupport: (aiRequestId: string) => Promise<void>,
  clearApprovedByokEditCallIds: () => void,
  onRetryByokChat: () => Promise<void>,
  getByokLiveProject: () => ?any,
|};

/**
 * Run every BYOK chat of one host component (AskAiEditorContainer, and the
 * standalone form since Phase 8.5).
 */
export const useByokChatSeam = (options: ByokChatSeamOptions): ByokChatSeam => {
  const {
    preferencesValues,
    project,
    fileMetadata,
    i18n,
    editorCallbacks,
    processEditorFunctionCalls,
    editorFunctions,
    editorFunctionsWithoutProject,
    onSceneEventsModifiedOutsideEditor,
    onInstancesModifiedOutsideEditor,
    onObjectsModifiedOutsideEditor,
    onObjectGroupsModifiedOutsideEditor,
    onProjectItemRenamedOutsideEditor,
    onWillDeleteScene,
    onWillDeleteGameplayTest,
    onWillDeleteObject,
    onWillInstallExtension,
    onExtensionInstalled,
    getIsAutoEditEnabled,
    requestEditApproval,
    triggerUnsavedChanges,
    onOpenLayout,
    setSelectedAiRequestId,
    resetChatUserInputs,
    getProjectPreviewLauncher,
  } = options;

  // Selection is tracked locally: a BYOK chat must never enter
  // AiRequestContext, whose loading and polling effects target GDevelop's
  // servers.
  const [selectedByokChatId, setSelectedByokChatId] = React.useState<
    string | null
  >(null);
  // The extension reload hooks of the editor (Phase 8.4 regeneration).
  const eventsFunctionsExtensionsState = React.useContext(
    EventsFunctionsExtensionsContext
  );
  // The count is only read as the dependency of the BYOK history summaries
  // below: the dispatch exists to force a re-render when the BYOK store
  // changes.
  const [byokChatsUpdateCount, forceByokChatsUpdate] = React.useReducer(
    byokChatsForceUpdateReducer,
    0
  );
  React.useEffect(() => subscribeByokChats(forceByokChatsUpdate), [
    forceByokChatsUpdate,
  ]);
  // The orchestrators live in the module-level registry (ByokChatStore):
  // a chat started by the homepage form keeps running when that form
  // unmounts and the Ask AI tab takes over (Phase 8.5).
  // BYOK counterpart of the server flow's approvedEditBatchKeys: once the
  // user approves a modifying call, a retry of the same batch does not
  // re-ask. Cleared when auto-edit is toggled (like the server's).
  const approvedByokEditCallIdsRef = React.useRef<Set<string>>(new Set());
  const clearApprovedByokEditCallIds = React.useCallback(() => {
    approvedByokEditCallIdsRef.current.clear();
  }, []);
  const selectedByokChat = selectedByokChatId
    ? getByokChat(selectedByokChatId)
    : null;

  // The live values the BYOK orchestrators read through getters, so a chat
  // created before a project existed (or before the current one was opened)
  // still sees the current state on every turn: the project prop of the
  // render that created the orchestrator must never be frozen into it.
  const byokProjectRef = useStableUpToDateRef<?any>(project);
  const byokCreatedProjectRef = React.useRef<?any>(null);
  const byokSawProjectPropRef = React.useRef<boolean>(false);
  /**
   * The project the BYOK chats work on: the opened one, or — until the
   * editor re-renders with it — the one a chat just created with
   * initialize_project. Once a project prop existed and then disappeared,
   * the project was closed: the chats are back to "no project".
   */
  const getByokLiveProject = React.useCallback((): ?any => {
    const openedProject = byokProjectRef.current;
    if (openedProject) {
      byokSawProjectPropRef.current = true;
      return openedProject;
    }
    if (byokSawProjectPropRef.current) {
      byokCreatedProjectRef.current = null;
      return null;
    }
    return byokCreatedProjectRef.current;
    // The ref objects are stable (they only carry a changing `current`), so
    // the empty dependency array keeps this callback identity-stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { ensureExtensionInstalled } = useEnsureExtensionInstalled({
    project,
    // The O3 fix: read the project through the live getter, so an extension
    // install right after initialize_project (before React re-renders with
    // the new project prop) already sees the fresh project.
    getProject: getByokLiveProject,
    i18n,
  });

  const executeByokFunctionCalls = React.useMemo(
    () =>
      createByokEditorFunctionCallExecutor({
        processEditorFunctionCalls,
        getProject: getByokLiveProject,
        i18n,
        editorCallbacks,
        ensureExtensionInstalled,
        onSceneEventsModifiedOutsideEditor,
        onInstancesModifiedOutsideEditor,
        onObjectsModifiedOutsideEditor,
        onObjectGroupsModifiedOutsideEditor,
        onProjectItemRenamedOutsideEditor,
        onWillDeleteScene,
        onWillDeleteGameplayTest,
        onWillDeleteObject,
        onWillInstallExtension,
        onExtensionInstalled,
      }),
    [
      getByokLiveProject,
      i18n,
      editorCallbacks,
      ensureExtensionInstalled,
      processEditorFunctionCalls,
      onSceneEventsModifiedOutsideEditor,
      onInstancesModifiedOutsideEditor,
      onObjectsModifiedOutsideEditor,
      onObjectGroupsModifiedOutsideEditor,
      onProjectItemRenamedOutsideEditor,
      onWillDeleteScene,
      onWillDeleteGameplayTest,
      onWillDeleteObject,
      onWillInstallExtension,
      onExtensionInstalled,
    ]
  );

  const suspendByokChat = React.useCallback((aiRequestId: string) => {
    const orchestrator = getByokOrchestrator(aiRequestId);
    if (orchestrator) orchestrator.suspend();
  }, []);

  // The BYOK chats of the session, as history entries — without them, a chat
  // told to "continue working" in the background would keep calling the
  // user's paid endpoint with no way left to watch or stop it.
  const byokChatSummaries = React.useMemo(
    () => listByokChats().map(chat => getAiRequestSummary(chat)),
    // Re-derived whenever the BYOK store notifies (the count is the change
    // signal, not an input of the computation).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [byokChatsUpdateCount]
  );
  const onArchiveByokChat = React.useCallback((aiRequestId: string) => {
    const orchestrator = getByokOrchestrator(aiRequestId);
    if (orchestrator) orchestrator.suspend();
    deleteByokOrchestrator(aiRequestId);
    // The chat closes: its restore-point snapshots go with it (no disk
    // growth — Phase 8.6's cap discipline).
    dropByokChatSnapshots(aiRequestId);
    archiveByokChat(aiRequestId);
  }, []);

  // The chat-facing guidance for a chat that cannot find its API key. The
  // two storage statuses need different lines: 'none' means the user never
  // saved a key, 'unreadable' means one is stored but this computer can no
  // longer decrypt it (e.g. DPAPI after a Windows account change) — telling
  // them to "add a key" would be misleading.
  const getByokMissingKeyError = React.useCallback(
    (storedKey: ByokKeyLoadResult) => {
      if (storedKey.status === 'unreadable') {
        return {
          code: 'byok-unreadable-key',
          message: i18n._(
            t`A BYOK API key is stored, but it cannot be decrypted on this computer anymore. Open Preferences > BYOK, clear the stored key and enter it again, then send your message again.`
          ),
        };
      }
      return {
        code: 'byok-missing-key',
        message: i18n._(
          t`No API key is stored for BYOK. Add one in Preferences > BYOK, then send your message again.`
        ),
      };
    },
    [i18n]
  );

  const createByokOrchestratorForChat = React.useCallback(
    (chat: AiRequest, byokSettings: ByokSettings, apiKey: string) => {
      const usageTracker = createByokUsageTracker();
      // The sub-agents of this chat (Phase 8.1): they share the chat's
      // connection, its usage tracker, and one global model-turn budget
      // with the parent loop, and they build their own read-only executor
      // (the scout's run_script must not be able to modify anything).
      const subAgentRunner = createByokSubAgentRunner({
        connection: {
          baseUrl: byokSettings.endpointUrl,
          apiKey,
        },
        settings: byokSettings,
        hasOpenedProject: () => !!getByokLiveProject(),
        getProject: () => getByokLiveProject(),
        getProjectUserContent: async () => {
          const liveProject = getByokLiveProject();
          if (!liveProject) return null;
          const simplifiedProjectBuilder = makeSimplifiedProjectBuilder(gd);
          return JSON.stringify(
            simplifiedProjectBuilder.getSimplifiedProject(liveProject, {})
          );
        },
        createExecutor: ({ runScriptReadOnly }) =>
          createByokEditorFunctionCallExecutor({
            processEditorFunctionCalls,
            getProject: getByokLiveProject,
            i18n,
            editorCallbacks,
            ensureExtensionInstalled,
            onSceneEventsModifiedOutsideEditor,
            onInstancesModifiedOutsideEditor,
            onObjectsModifiedOutsideEditor,
            onObjectGroupsModifiedOutsideEditor,
            onProjectItemRenamedOutsideEditor,
            onWillDeleteScene,
            onWillDeleteGameplayTest,
            onWillDeleteObject,
            onWillInstallExtension,
            onExtensionInstalled,
            runScriptReadOnly,
          }),
        usageTracker,
        sharedTurnBudget: { remaining: BYOK_GLOBAL_TURN_BUDGET },
      });
      const orchestrator = createByokOrchestrator({
        connection: {
          baseUrl: byokSettings.endpointUrl,
          apiKey,
        },
        settings: byokSettings,
        aiRequest: chat,
        // Everything below is a getter read per turn: the chat must never be
        // frozen on the project (or executor) of the render that created it —
        // a chat that starts without a project and creates one with
        // initialize_project edits it right away.
        hasOpenedProject: () => !!getByokLiveProject(),
        getProject: () => getByokLiveProject(),
        getExecutor: () => executeByokFunctionCalls,
        getProjectUserContent: async () => {
          const liveProject = getByokLiveProject();
          if (!liveProject) return null;
          const simplifiedProjectBuilder = makeSimplifiedProjectBuilder(gd);
          return JSON.stringify(
            simplifiedProjectBuilder.getSimplifiedProject(liveProject, {})
          );
        },
        onAiRequestUpdated: updatedChat => updateByokChat(updatedChat),
        // The extension regeneration hooks (Phase 8.4): the editor
        // context's reload functions, flushed once per batch of extension
        // tool calls so new functions/behaviors/objects become usable.
        reloadEventsFunctionsExtensions: project =>
          eventsFunctionsExtensionsState.reloadProjectEventsFunctionsExtensions(
            project
          ),
        reloadEventsFunctionsExtensionMetadata: (project, extension) =>
          eventsFunctionsExtensionsState.reloadProjectEventsFunctionsExtensionMetadata(
            project,
            extension
          ),
        // The per-project notes (Phase 7) are keyed on the project's file
        // identifier, with a project-name hash as the fallback for projects
        // not saved yet.
        getProjectNotesIdentifier: () => {
          const liveProject = getByokLiveProject();
          if (!liveProject) return null;
          if (fileMetadata && fileMetadata.fileIdentifier) {
            return fileMetadata.fileIdentifier;
          }
          return makeByokProjectNotesIdentifierFromProjectName(
            liveProject.getName()
          );
        },
        doesCallRequireApproval: functionCall => {
          // The BYOK-intercepted tools that do NOT live in the editor
          // registry carry their own modification flag (read-only tools like
          // load_skill must not open the approval row); the ones that also
          // exist in the registry keep their registry-side, sometimes
          // per-arguments decision.
          const extraTool = findByNameokExtraTool(functionCall.name);
          const inRegistry =
            editorFunctions[functionCall.name] ||
            editorFunctionsWithoutProject[functionCall.name];
          if (extraTool && !inRegistry) return extraTool.modifiesProject;
          const editorFunction =
            editorFunctions[functionCall.name] ||
            editorFunctionsWithoutProject[functionCall.name] ||
            null;
          try {
            return byokCallRequiresApproval(
              editorFunction,
              JSON.parse(functionCall.arguments)
            );
          } catch (error) {
            // Unparsable arguments: require approval (safe default).
            return true;
          }
        },
        onRequestEditApproval: async modifyingCalls => {
          if (getIsAutoEditEnabled()) return true;
          const unapprovedCalls = modifyingCalls.filter(
            call => !approvedByokEditCallIdsRef.current.has(call.call_id)
          );
          if (unapprovedCalls.length === 0) return true;
          const accepted = await requestEditApproval({
            aiRequestId: chat.id,
            callIds: unapprovedCalls.map(call => call.call_id),
            label: unapprovedCalls.map(call => call.name).join(', '),
          });
          if (accepted) {
            if (
              approvedByokEditCallIdsRef.current.size >=
              APPROVED_CALL_IDS_CAPACITY
            ) {
              approvedByokEditCallIdsRef.current.clear();
            }
            unapprovedCalls.forEach(call =>
              approvedByokEditCallIdsRef.current.add(call.call_id)
            );
          }
          return accepted;
        },
        usageTracker,
        subAgentRunner,
        onSceneEventsModifiedOutsideEditor,
        // The perception tools' environment hooks (Phase 6): the scene editor
        // canvas of this window, the Electron preview-capture IPC, and the
        // preview launcher MainFrame registered.
        runtimeDeps: {
          captureSceneCanvas: () => {
            const canvas = findLargestVisibleSceneCanvas(
              typeof document !== 'undefined' ? document : null
            );
            if (!canvas) return null;
            return canvas.toDataURL('image/jpeg', 0.7);
          },
          invokePreviewCapture: invokeByokPreviewCapture,
          getPreviewLauncher: getProjectPreviewLauncher,
        },
        onFunctionCallsExecuted: (
          results,
          { createdSceneNames, createdProject }
        ) => {
          // The project a chat just created (initialize_project) is
          // remembered synchronously — the very next round's snapshot and
          // executor must see it, before React re-renders.
          if (createdProject) {
            byokCreatedProjectRef.current = createdProject;
          }
          if (
            results.some(
              result => result.status === 'finished' && result.didModifyProject
            )
          ) {
            triggerUnsavedChanges();
          }
          createdSceneNames.forEach(sceneName => {
            onOpenLayout(sceneName, {
              openEventsEditor: true,
              openSceneEditor: true,
              focusWhenOpened: 'scene',
            });
          });
        },
      });
      setByokOrchestrator(chat.id, orchestrator);
      return orchestrator;
    },
    [
      getByokLiveProject,
      executeByokFunctionCalls,
      getIsAutoEditEnabled,
      requestEditApproval,
      triggerUnsavedChanges,
      onOpenLayout,
      onSceneEventsModifiedOutsideEditor,
      fileMetadata,
      getProjectPreviewLauncher,
      editorFunctions,
      editorFunctionsWithoutProject,
      i18n,
      editorCallbacks,
      ensureExtensionInstalled,
      processEditorFunctionCalls,
      onInstancesModifiedOutsideEditor,
      onObjectsModifiedOutsideEditor,
      onObjectGroupsModifiedOutsideEditor,
      onProjectItemRenamedOutsideEditor,
      onWillDeleteScene,
      onWillDeleteGameplayTest,
      onWillDeleteObject,
      onWillInstallExtension,
      onExtensionInstalled,
      eventsFunctionsExtensionsState,
    ]
  );

  /**
   * Get (or lazily create) the orchestrator of an existing BYOK chat — this
   * is what makes a chat recoverable after the missing-key error (the user
   * saved a key, then retries or sends a message again) and after the host
   * was remounted. Returns null when the chat is still working (a live loop
   * must not get a second orchestrator on the same transcript) or when no
   * key is stored (the chat is then re-marked with the missing-key error).
   */
  const attachByokOrchestrator = React.useCallback(
    async (chat: AiRequest): Promise<?ByokOrchestrator> => {
      const existingOrchestrator = getByokOrchestrator(chat.id);
      if (existingOrchestrator) return existingOrchestrator;
      if (chat.status === 'working') return null;

      const byokSettings = getByokSettings(preferencesValues);
      const storedKey = await loadByokKey();
      if (storedKey.status !== 'ok') {
        chat.status = 'error';
        chat.error = getByokMissingKeyError(storedKey);
        updateByokChat(chat);
        return null;
      }

      return createByokOrchestratorForChat(chat, byokSettings, storedKey.key);
    },
    [preferencesValues, getByokMissingKeyError, createByokOrchestratorForChat]
  );

  const startByokChat = React.useCallback(
    async (
      userRequest: string,
      chatOptions?: {| onChatCreated?: (chatId: string) => void |}
    ) => {
      const byokSettings = getByokSettings(preferencesValues);
      const chat = createByokChat();
      setSelectedAiRequestId(null);
      setSelectedByokChatId(chat.id);
      resetChatUserInputs(chat.id);
      if (chatOptions && chatOptions.onChatCreated) {
        chatOptions.onChatCreated(chat.id);
      }

      const storedKey = await loadByokKey();
      if (storedKey.status !== 'ok') {
        chat.status = 'error';
        chat.error = getByokMissingKeyError(storedKey);
        updateByokChat(chat);
        return;
      }

      const orchestrator = createByokOrchestratorForChat(
        chat,
        byokSettings,
        storedKey.key
      );
      await orchestrator.startNewChat(userRequest);
    },
    [
      preferencesValues,
      getByokMissingKeyError,
      createByokOrchestratorForChat,
      setSelectedAiRequestId,
      resetChatUserInputs,
    ]
  );

  /**
   * Continue a BYOK chat with a user message — the BYOK branch of the
   * host's onSendMessage. The orchestrator can be missing (missing-key
   * error, or the host was remounted): re-attach instead of dropping the
   * message — attach re-marks the chat with the missing-key error when
   * there is still no key, so the user is never left without feedback.
   */
  const sendByokUserMessage = React.useCallback(
    async (aiRequestId: string, userMessage: string) => {
      if (!userMessage) return;

      const chat = getByokChat(aiRequestId);
      if (!chat) return;

      const orchestrator = await attachByokOrchestrator(chat);
      if (!orchestrator) return;

      const sendPromise = orchestrator.sendUserMessage(userMessage);
      // Clear the sent message right away — the loop it starts can run for
      // a while (the server path resets after its single request; ours must
      // not wait for the whole conversation).
      if (aiRequestId === selectedByokChatId) {
        resetChatUserInputs(aiRequestId);
      }
      await sendPromise;
    },
    [attachByokOrchestrator, selectedByokChatId, resetChatUserInputs]
  );

  // Re-run a failed BYOK chat's loop without adding anything to the
  // conversation (the transcript replay is exactly a retry). The
  // orchestrator is re-attached when missing (missing-key error the user
  // just fixed by saving a key, or a host remount) — this is what makes the
  // Retry row work instead of silently no-op'ing.
  const onRetryByokChat = React.useCallback(
    async () => {
      if (!selectedByokChatId) return;
      const chat = getByokChat(selectedByokChatId);
      if (!chat) return;
      const orchestrator = await attachByokOrchestrator(chat);
      if (orchestrator) await orchestrator.retryAfterError();
    },
    [selectedByokChatId, attachByokOrchestrator]
  );

  return {
    selectedByokChatId,
    setSelectedByokChatId,
    selectedByokChat,
    byokChatSummaries,
    onArchiveByokChat,
    startByokChat,
    attachByokOrchestrator,
    sendByokUserMessage,
    suspendByokChat,
    suspendAiRequestWithByokSupport: async (aiRequestId: string) => {
      // BYOK chats are suspended locally (no server request exists for
      // them); server chats are the host's own concern.
      if (!isByokAiRequestId(aiRequestId)) return;
      suspendByokChat(aiRequestId);
    },
    clearApprovedByokEditCallIds,
    onRetryByokChat,
    getByokLiveProject,
  };
};

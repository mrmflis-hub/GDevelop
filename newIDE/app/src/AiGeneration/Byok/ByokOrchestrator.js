// @flow
import {
  type AiRequest,
  type AiRequestMessage,
  type AiRequestMessageAssistantFunctionCall,
} from '../../Utils/GDevelopServices/Generation';
import { type EditorFunctionCallResult } from '../../EditorFunctions';
import {
  getFunctionCallsToProcess,
  getFunctionCallOutputsFromEditorFunctionCallResults,
  getLastMessagesFromAiRequestOutput,
} from '../AiRequestUtils';
import {
  createByokCancellation,
  sendByokChatCompletionWithRetries,
} from './ByokClient';
import {
  classifyByokError,
  describeInvalidRequestForImageContent,
} from './ByokErrors';
import { buildByokSystemPrompt } from './ByokPrompts';
import {
  getByokAdvertisedToolNames,
  getByokDispatchableToolNames,
  getByokToolSchemasForNames,
  toOpenAiToolsFormat,
} from './ByokToolSchema';
import {
  findByNameokExtraTool,
  type ByokExtraToolCollaborators,
} from './ByokExtraTools';
import type { ByokRuntimeToolDeps } from './ByokRuntimeTools';
import {
  BYOK_LOOP_GUARD_CORRECTIVE_MESSAGE,
  createByokLoopGuard,
} from './ByokLoopGuards';
import { listByokSkillMetadata } from './ByokSkills';
import { isByokEngineReferenceAvailable } from './ByokEngineReference';
import { loadByokProjectNotes } from './ByokProjectNotes';
import { makeByokPromptContext } from './Knowledge/ByokKnowledgeSections';
import {
  byokMessagesForTranscriptItem,
  byokResponseToAssistantMessage,
  byokToolResultToFunctionCallOutput,
  getByokSurvivingImageIds,
} from './ByokTranscript';
import { getByokImage, makeDefaultByokImageStore } from './ByokImageContent';
import { type ByokCancellation, type ByokSettings } from './ByokTypes';
import {
  getCachedByokModels,
  resolveContextWindowTokens,
} from './ByokModelsCache';
import {
  contextStatsFromUsage,
  usageFromResponse,
  type ByokUsageTracker,
} from './ByokUsageTracker';

/**
 * The client-side agent loop — the BYOK replacement of GDevelop's
 * server-side orchestrator: send conversation + tool definitions → execute
 * the model's tool calls through the injected executor → feed the results
 * back → repeat until the model answers in plain text (or a guard stops
 * it).
 *
 * Everything is injected (model client, tool executor, approval, project
 * content): the orchestrator imports no React and no editor implementation,
 * which is what makes it unit-testable. The executor and the project
 * content are injected as **getters** and re-read per turn, so a chat that
 * creates its project mid-flight (initialize_project) edits it in the same
 * conversation.
 */

/** Runaway protection: stop after this many model rounds of tool calls. */
export const MAX_BYOK_TOOL_ROUNDS = 20;

/**
 * Runaway protection: stop when the conversation fills this share of the
 * model's context window (the next round would re-send the whole history).
 */
export const MAX_BYOK_CONTEXT_RATIO = 0.9;

/** Safety valve on tool outputs, so one cannot blow up the context. */
export const BYOK_TOOL_OUTPUT_CAP = 20000;

/**
 * How many of the chat's most recent images are re-sent to the model (the
 * eviction rule): old screenshots are the most expensive tool payloads and
 * the least useful — a new capture is one call away.
 */
export const BYOK_IMAGES_TO_KEEP = 2;

/**
 * The plan tool: a permanent failure stub in the editor registry (it is
 * handled server-side upstream), so the orchestrator owns it — see
 * `appendPlanToolOutput`.
 */
export const BYOK_PLAN_TOOL_NAME = 'create_or_update_plan';

/**
 * The error code of the repeated-tool-call-loop guard (the BYOK counterpart
 * of the hosted protection of the same name).
 */
export const BYOK_REPEATED_TOOL_CALL_LOOP_ERROR_CODE =
  'byok-repeated-tool-call-loop';

/**
 * Errors a retry would replay identically (the transcript itself is the
 * problem — only a new chat can continue), so `retryAfterError` refuses
 * them instead of re-sending the oversized history to the endpoint.
 */
const NON_RETRYABLE_BYOK_ERROR_CODES: Set<string> = new Set([
  'byok-context-full',
]);

/** The tool names the loop may actually dispatch to the executor. */
const DISPATCHABLE_TOOL_NAMES: Set<string> = new Set(
  getByokDispatchableToolNames()
);

/**
 * Cap a tool output to BYOK_TOOL_OUTPUT_CAP characters, marking the cut.
 */
export const capToolOutput = (output: string): string => {
  if (output.length <= BYOK_TOOL_OUTPUT_CAP) return output;
  return `${output.slice(0, BYOK_TOOL_OUTPUT_CAP)}\n…[output truncated]`;
};

/**
 * The seam for nested sub-agent loops (a later phase): a sub-agent would be
 * a nested orchestrator conversation with its own message list and a scoped
 * system prompt, its result summarized back into the parent transcript as a
 * `function_call_output`. Returns null in v1 — BYOK runs a single agent and
 * the prompt says so (see ByokPrompts). Do not implement before the tool
 * whitelist re-admits `run_edit_agent` / `run_explorer_agent`.
 */
export const createByokSubAgentRunner = (): null => null;

export type ByokOrchestratorOptions = {|
  connection: {| baseUrl: string, apiKey: string |},
  settings: ByokSettings,
  // The local chat record (from ByokChatStore): the transcript the loop
  // appends to and the UI renders.
  aiRequest: AiRequest,
  // Read live at every turn, so opening or closing a project mid-chat is
  // reflected in the system prompt instead of being frozen at creation.
  hasOpenedProject: () => boolean,
  // The current project, read at call time — the intercepted tools (local
  // event writing) work on the live project, including one created
  // mid-chat by initialize_project.
  getProject: () => any,
  // The tool executor (see createByokEditorFunctionCallExecutor in
  // ByokSeam.js), wrapping processEditorFunctionCalls — read at call time
  // so a project created mid-chat is edited with the fresh executor.
  getExecutor: () =>
    | ((
        functionCalls: Array<{|
          name: string,
          arguments: string,
          call_id: string,
        |}>,
        context: {|
          aiRequestId: string,
          getRelatedAiRequestLastMessages: () => any,
        |}
      ) => Promise<{|
        results: Array<EditorFunctionCallResult>,
        createdSceneNames: Array<string>,
        createdProject: any,
      |}>)
    | null,
  // Builds the simplified project snapshot folded into the user message
  // sent to the model (the local replacement of prepareAiUserContent, which
  // uploads to GDevelop's servers) — also read at call time.
  getProjectUserContent: () => Promise<string | null>,
  onAiRequestUpdated: (aiRequest: AiRequest) => void,
  // Whether a call would modify the project (byokCallRequiresApproval +
  // registry lookup, composed by the container).
  doesCallRequireApproval: (
    functionCall: AiRequestMessageAssistantFunctionCall
  ) => boolean,
  // Pause the loop for the user to approve a batch of modifying calls;
  // false refuses the batch (the chat is then suspended).
  onRequestEditApproval: (
    functionCalls: Array<AiRequestMessageAssistantFunctionCall>
  ) => Promise<boolean>,
  usageTracker: ByokUsageTracker,
  // Called after each executed batch, so the container can flag unsaved
  // changes, open created scenes and remember a created project.
  onFunctionCallsExecuted?: (
    results: Array<EditorFunctionCallResult>,
    meta: {| createdSceneNames: Array<string>, createdProject: any |}
  ) => void,
  // Passed through to the intercepted tools (ByokExtraTools) that edit the
  // events outside the events editor.
  onSceneEventsModifiedOutsideEditor?: (changes: any) => void,
  // The perception tools' environment hooks (screenshots, preview capture
  // IPC, preview launcher). Absent: the perception tools answer with
  // actionable failures instead of crashing. `storeImage` overrides the
  // default image pipeline (tests).
  runtimeDeps?: {|
    captureSceneCanvas: () => ?string,
    invokePreviewCapture: (
      previewId: ?number
    ) => Promise<{| ok: boolean, data?: string, error?: string |}>,
    getPreviewLauncher: () => ?any,
    storeImage?: (dataUrl: string) => Promise<any>,
  |},
  // The storage identifier of the open project's notes (Phase 7.8): null
  // while no project is open. Used both by the update_project_notes tool
  // and to inject the notes into the system prompt.
  getProjectNotesIdentifier?: () => string | null,
|};

export type ByokOrchestrator = {|
  startNewChat: (userRequest: string) => Promise<void>,
  sendUserMessage: (text: string) => Promise<void>,
  suspend: () => void,
  // Re-run the loop after an error without adding anything to the
  // conversation (the transcript replay is exactly a retry).
  retryAfterError: () => Promise<void>,
|};

/**
 * Map the plan tasks from their wire (snake_case) field names to the
 * internal `AiRequestPlanTask` shape the plan UI consumes — keep snake_case
 * on the wire (consistent with every other tool argument), map once here.
 */
const normalizePlanTasks = (tasks: Array<Object>): Array<Object> =>
  tasks.map(task => ({
    ...task,
    dependsOn: Array.isArray(task.depends_on) ? task.depends_on : [],
  }));

/**
 * Create the orchestrator of one BYOK chat.
 */
export const createByokOrchestrator = (
  options: ByokOrchestratorOptions
): ByokOrchestrator => {
  const {
    connection,
    settings,
    aiRequest,
    hasOpenedProject,
    getProject,
    getExecutor,
    getProjectUserContent,
    onAiRequestUpdated,
    doesCallRequireApproval,
    onRequestEditApproval,
    usageTracker,
    onFunctionCallsExecuted,
  } = options;

  let isSuspended = false;
  let isRunning = false;
  let latestProjectContent: string | null = null;
  let activeCancellation: ByokCancellation | null = null;
  const loopGuard = createByokLoopGuard();
  // The image state of the chat: how many recent images are re-sent (the
  // budget guard decrements it under context pressure), and whether images
  // are sent at all (settings, plus the one-way auto degrade).
  let imagesToKeep = BYOK_IMAGES_TO_KEEP;
  let imagesDisabledForChat = false;
  let singleInternalCallCounter = 0;
  const storeImage = makeDefaultByokImageStore();

  // `output` is optional on the AiRequest type: normalize it once, then
  // always read it through getOutput so Flow sees a plain array.
  aiRequest.output = aiRequest.output || [];
  const getOutput = (): Array<AiRequestMessage> => aiRequest.output || [];

  const persistUpdate = (): void => {
    onAiRequestUpdated(aiRequest);
  };

  const markReady = (): void => {
    aiRequest.status = 'ready';
    persistUpdate();
  };

  const markSuspended = (): void => {
    aiRequest.status = 'suspended';
    persistUpdate();
  };

  const markError = (code: string, message: string): void => {
    aiRequest.status = 'error';
    aiRequest.error = { code, message };
    persistUpdate();
  };

  const appendUserMessage = (text: string): void => {
    const userMessage: AiRequestMessage = {
      type: 'message',
      status: 'completed',
      role: 'user',
      content: [{ type: 'user_request', status: 'completed', text }],
    };
    getOutput().push(userMessage);
    aiRequest.status = 'working';
    aiRequest.error = null;
    persistUpdate();
  };

  /**
   * The context window of this chat's model, following the fallback chain
   * of resolveContextWindowTokens: what the server reported → what the user
   * set for this model → the global setting → the default. Re-read every
   * turn so a models fetch made mid-chat is picked up.
   */
  const resolveChatContextWindowTokens = (): number => {
    const cachedModels = getCachedByokModels(connection.baseUrl);
    const modelInfo = cachedModels
      ? cachedModels.find(model => model.id === settings.modelName) || null
      : null;
    return resolveContextWindowTokens(settings, modelInfo, settings.modelName);
  };

  /**
   * The tool names advertised this turn: the default set, plus
   * initialize_project while no project is open (read at turn time, so the
   * same chat transitions the moment its project exists).
   */
  const getAdvertisedToolNames = (): Array<string> =>
    getByokAdvertisedToolNames({ hasOpenedProject: hasOpenedProject() });

  /** Whether image parts are sent to the model at all. */
  const areImagesEnabled = (): boolean =>
    settings.imageSupport !== 'no' && !imagesDisabledForChat;

  /**
   * The system prompt of this turn: the composed knowledge sections with
   * the live context (advertised tools, project notes, skills metadata,
   * custom instructions). Async: the notes and the skills metadata come
   * from async storages (localStorage reads + a possible IPC round-trip for
   * the user skills).
   */
  const buildSystemPrompt = async (): Promise<string> => {
    const notesIdentifier = options.getProjectNotesIdentifier
      ? options.getProjectNotesIdentifier()
      : null;
    const projectNotes = notesIdentifier
      ? await loadByokProjectNotes(notesIdentifier)
      : null;
    const skills = await listByokSkillMetadata();
    return buildByokSystemPrompt({
      toolNames: getAdvertisedToolNames(),
      hasOpenedProject: hasOpenedProject(),
      context: makeByokPromptContext({
        toolNames: getAdvertisedToolNames(),
        hasOpenedProject: hasOpenedProject(),
        skills,
        engineReferenceAvailable: isByokEngineReferenceAvailable(),
        docsAvailable: true,
        projectNotes,
        customInstructions: settings.customInstructions,
      }),
    });
  };

  /**
   * The system prompt + the transcript replayed as OpenAI messages. Tool
   * outputs referencing images emit a following user message with the
   * surviving image parts (the latest `imagesToKeep` of the chat); the
   * latest project snapshot is folded into the last user message that
   * carries plain text (kept out of the transcript itself, so the UI never
   * renders a JSON blob) — the same "fresh state with every message"
   * behavior as the server flow.
   */
  const buildMessagesForModel = async (): Promise<Array<any>> => {
    const transcript = getOutput();
    const transcriptMessages: Array<any> = [];
    for (const item of transcript) {
      transcriptMessages.push(
        ...byokMessagesForTranscriptItem(item, {
          imagesEnabled: areImagesEnabled(),
          survivingImageIds: getByokSurvivingImageIds(transcript, imagesToKeep),
          getImage: getByokImage,
        })
      );
    }
    const messages: Array<any> = [
      {
        role: 'system',
        content: await buildSystemPrompt(),
      },
      ...transcriptMessages,
    ];

    if (!latestProjectContent) return messages;

    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index];
      if (message.role !== 'user') continue;
      // The synthetic image messages (array content) are not the user's
      // message: the snapshot folds into the real one.
      if (Array.isArray(message.content)) continue;

      messages[index] = {
        role: 'user',
        content: `${
          message.content
        }\n\n[Current simplified project snapshot, as JSON — may be slightly stale after your edits]\n${latestProjectContent}`,
      };
      break;
    }
    return messages;
  };

  /** True when any message of the request carries image parts. */
  const doMessagesCarryImages = (messages: Array<any>): boolean => {
    return messages.some(message => {
      if (message.role !== 'user' || !Array.isArray(message.content)) {
        return false;
      }
      return message.content.some(
        (part: any) => part && part.type === 'image_url'
      );
    });
  };

  const callModel = async (): Promise<any> => {
    const messages = await buildMessagesForModel();
    const chatOptions: any = {
      model: settings.modelName,
      messages,
      tools: toOpenAiToolsFormat(
        getByokToolSchemasForNames(getAdvertisedToolNames())
      ),
    };
    if (settings.reasoningEffort !== 'default') {
      chatOptions.reasoningEffort = settings.reasoningEffort;
    }
    if (activeCancellation) {
      chatOptions.cancellation = activeCancellation;
    }

    try {
      return await sendByokChatCompletionWithRetries({
        baseUrl: connection.baseUrl,
        apiKey: connection.apiKey,
        options: chatOptions,
      });
    } catch (error) {
      // The endpoint may not see images at all (a text-only model): in
      // auto mode, degrade the chat to text-only and retry once — the
      // mirror of the reasoning_effort degraded-retry.
      const byokError = classifyByokError(error);
      const shouldDegrade =
        settings.imageSupport === 'auto' &&
        !imagesDisabledForChat &&
        doMessagesCarryImages(messages) &&
        describeInvalidRequestForImageContent(byokError);
      if (!shouldDegrade) throw error;

      imagesDisabledForChat = true;
      console.info(
        'BYOK orchestrator: the endpoint rejected image content — continuing this chat text-only.'
      );
      const degradedOptions: any = {
        ...chatOptions,
        messages: await buildMessagesForModel(),
      };
      return await sendByokChatCompletionWithRetries({
        baseUrl: connection.baseUrl,
        apiKey: connection.apiKey,
        options: degradedOptions,
      });
    }
  };

  const recordAssistantTurn = (response: any): void => {
    getOutput().push(byokResponseToAssistantMessage(response));

    const usage = usageFromResponse(response);
    if (usage) {
      usageTracker.recordTurn(usage);
      aiRequest.contextStats = contextStatsFromUsage(
        usage,
        resolveChatContextWindowTokens()
      );
    }
    persistUpdate();
  };

  const collectPendingToolCalls = (): Array<AiRequestMessageAssistantFunctionCall> => {
    return getFunctionCallsToProcess({
      aiRequest,
      editorFunctionCallResults: null,
    });
  };

  /**
   * True when the last recorded assistant message carries answer text — an
   * answer with neither text nor tool calls cannot move the conversation
   * forward (e.g. a truncated or content-filtered response).
   */
  const hasRecordedAnswerText = (): boolean => {
    const output = getOutput();
    const lastMessage = output.length > 0 ? output[output.length - 1] : null;
    if (!lastMessage || lastMessage.type !== 'message') return false;
    if (lastMessage.role !== 'assistant') return false;
    return lastMessage.content.some(item => item.type === 'output_text');
  };

  /**
   * Record a batch as not executed: one output per call, so the transcript
   * stays a valid OpenAI conversation (an assistant message with tool_calls
   * must be followed by tool messages) and the model can be told what
   * happened when the chat continues.
   */
  const appendNotExecutedToolOutputs = (
    functionCalls: Array<AiRequestMessageAssistantFunctionCall>,
    message: string
  ): void => {
    for (const functionCall of functionCalls) {
      getOutput().push(
        byokToolResultToFunctionCallOutput(
          functionCall.call_id,
          capToolOutput(JSON.stringify({ success: false, message }))
        )
      );
    }
  };

  /**
   * Handle `create_or_update_plan` here instead of the editor executor (its
   * registry implementation always fails — "handled server-side" upstream):
   * echo the tasks back as the `plan` output the chat UI's plan component
   * renders (see getLatestActivePlan in AiRequestUtils.js). Returns true
   * when the call was handled here.
   */
  const appendPlanToolOutput = (
    functionCall: AiRequestMessageAssistantFunctionCall
  ): boolean => {
    if (functionCall.name !== BYOK_PLAN_TOOL_NAME) return false;

    let tasks = null;
    try {
      tasks = JSON.parse(functionCall.arguments).tasks;
    } catch (error) {
      // Invalid JSON: reported as a failure output below.
    }
    const output =
      tasks && Array.isArray(tasks)
        ? { success: true, plan: { tasks: normalizePlanTasks(tasks) } }
        : {
            success: false,
            message: 'Invalid arguments: a "tasks" array is required.',
          };
    getOutput().push(
      byokToolResultToFunctionCallOutput(
        functionCall.call_id,
        capToolOutput(JSON.stringify(output))
      )
    );
    return true;
  };

  /** Parse the arguments of a call, or null when they are not valid JSON. */
  const parseCallArguments = (
    functionCall: AiRequestMessageAssistantFunctionCall
  ): any => {
    try {
      return JSON.parse(functionCall.arguments);
    } catch (error) {
      return null;
    }
  };

  /**
   * The perception tools' collaborators, assembled from the orchestrator's
   * injected hooks: the image pipeline, the single-call executor (built on
   * the same executor as normal batches) and the environment hooks the
   * container provides. Null when the host supplied none — the tools then
   * answer with actionable failures.
   */
  const getExtraToolRuntimeDeps = (): ?ByokRuntimeToolDeps => {
    if (!options.runtimeDeps) return null;
    return {
      getProject,
      captureSceneCanvas: options.runtimeDeps.captureSceneCanvas,
      invokePreviewCapture: options.runtimeDeps.invokePreviewCapture,
      getPreviewLauncher: options.runtimeDeps.getPreviewLauncher,
      storeImage: options.runtimeDeps.storeImage || storeImage,
      executeSingleToolCall: async (name, args) => {
        const executor = getExecutor();
        if (!executor) {
          throw new Error('The editor is not ready to run this tool call.');
        }
        singleInternalCallCounter++;
        const execution = await executor(
          [
            {
              name,
              arguments: JSON.stringify(args),
              call_id: `byok-internal-${singleInternalCallCounter}`,
            },
          ],
          {
            aiRequestId: aiRequest.id,
            getRelatedAiRequestLastMessages: () =>
              getLastMessagesFromAiRequestOutput(getOutput()),
          }
        );
        return execution.results[0];
      },
    };
  };

  /**
   * Run one call through the interception registry (ByokExtraTools) — the
   * tools resolved before the editor registry, e.g. the fully local
   * add_scene_events. The output is appended to the transcript and a
   * result shaped like the editor runner's is returned, so approval
   * gating, unsaved-changes tracking and onFunctionCallsExecuted see the
   * same shape as for registry tools. Returns null when the name is not
   * intercepted.
   */
  const runExtraToolCall = async (
    functionCall: AiRequestMessageAssistantFunctionCall
  ): Promise<EditorFunctionCallResult | null> => {
    const extraTool = findByNameokExtraTool(functionCall.name);
    if (!extraTool) return null;

    const collaborators: ByokExtraToolCollaborators = {
      getProject,
      onSceneEventsModifiedOutsideEditor: changes => {
        if (options.onSceneEventsModifiedOutsideEditor) {
          options.onSceneEventsModifiedOutsideEditor(changes);
        }
      },
      runtimeDeps: getExtraToolRuntimeDeps() || undefined,
      // The docs tools may fetch missing pages online only if the user
      // opted in (offline-first, see ByokDocs.js).
      onlineDocsEnabled: settings.onlineDocsEnabled,
      getProjectNotesIdentifier: () =>
        options.getProjectNotesIdentifier
          ? options.getProjectNotesIdentifier()
          : null,
    };
    const parsedArguments = parseCallArguments(functionCall);
    try {
      const { output, didModifyProject, images } = await extraTool.run(
        parsedArguments || {},
        collaborators
      );
      getOutput().push(
        byokToolResultToFunctionCallOutput(
          functionCall.call_id,
          capToolOutput(JSON.stringify(output)),
          images
        )
      );
      return {
        status: 'finished',
        call_id: functionCall.call_id,
        success: !!output.success,
        output,
        ...(didModifyProject ? { didModifyProject: true } : {}),
      };
    } catch (error) {
      console.error(
        `BYOK orchestrator: intercepted tool "${functionCall.name}" crashed:`,
        error
      );
      const output = {
        success: false,
        message: `The tool execution crashed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
      getOutput().push(
        byokToolResultToFunctionCallOutput(
          functionCall.call_id,
          capToolOutput(JSON.stringify(output))
        )
      );
      return {
        status: 'finished',
        call_id: functionCall.call_id,
        success: false,
        output,
      };
    }
  };

  /**
   * Append the outputs of an executed batch. A result that never finished
   * (status `aborted` or `working`) leaves its call without an output, which
   * would make the transcript protocol-invalid — those calls get a failure
   * output instead, so the conversation can continue.
   */
  const appendExecutedBatchOutputs = (
    results: Array<EditorFunctionCallResult>,
    executedCalls: Array<AiRequestMessageAssistantFunctionCall>
  ): void => {
    const {
      functionCallOutputs,
      hasUnfinishedResult,
    } = getFunctionCallOutputsFromEditorFunctionCallResults(results);
    for (const functionCallOutput of functionCallOutputs) {
      getOutput().push({
        ...functionCallOutput,
        output: capToolOutput(functionCallOutput.output),
      });
    }

    if (!hasUnfinishedResult) return;

    const callIdsWithOutput = new Set(
      results
        .filter(result => result.status === 'finished')
        .map(result => result.call_id)
    );
    const unfinishedCalls = executedCalls.filter(
      call => !callIdsWithOutput.has(call.call_id)
    );
    appendNotExecutedToolOutputs(
      unfinishedCalls,
      'The tool was aborted before finishing. Check the current state with the read tools, then continue.'
    );
  };

  /**
   * Split a batch by the loop guard: 'ok' calls proceed, 'corrective'
   * calls are refused with the corrective message (the model gets one
   * chance to change course), and a 'stop' verdict refuses the call and
   * everything after it.
   */
  const splitBatchByLoopGuard = (
    functionCalls: Array<AiRequestMessageAssistantFunctionCall>
  ): {|
    proceedingCalls: Array<AiRequestMessageAssistantFunctionCall>,
    correctedCalls: Array<AiRequestMessageAssistantFunctionCall>,
    stoppedAtCall: AiRequestMessageAssistantFunctionCall | null,
  |} => {
    const proceedingCalls: Array<AiRequestMessageAssistantFunctionCall> = [];
    const correctedCalls: Array<AiRequestMessageAssistantFunctionCall> = [];
    let stoppedAtCall: AiRequestMessageAssistantFunctionCall | null = null;

    for (const functionCall of functionCalls) {
      if (stoppedAtCall) continue;
      const verdict = loopGuard.checkCall(
        functionCall.name,
        parseCallArguments(functionCall)
      );
      if (verdict === 'stop') {
        stoppedAtCall = functionCall;
        continue;
      }
      if (verdict === 'corrective') {
        correctedCalls.push(functionCall);
        continue;
      }
      proceedingCalls.push(functionCall);
    }
    return { proceedingCalls, correctedCalls, stoppedAtCall };
  };

  /**
   * Execute a batch of tool calls: loop-guard them, ask for the user's
   * approval of the modifying ones, run the batch (plan tool and
   * intercepted tools here, everything else through the editor executor),
   * then append the (capped) outputs to the transcript. Returns false when
   * the loop must stop (edit refused, stuck loop, or the chat was
   * suspended mid-flight).
   */
  const executeToolCalls = async (
    functionCalls: Array<AiRequestMessageAssistantFunctionCall>
  ): Promise<boolean> => {
    // The user may have pressed stop while the model call was in flight: an
    // arrived batch must not execute (nor ask for approval) after a
    // suspension.
    if (isSuspended) {
      appendNotExecutedToolOutputs(
        functionCalls,
        'The assistant was stopped before running this tool call. Send a new message to continue.'
      );
      persistUpdate();
      return false;
    }

    // The whitelist is enforced again at dispatch: some OpenAI-compatible
    // servers do not constrain the model to the advertised tool list, so a
    // hallucinated name must be answered with a refusal, not executed.
    const whitelistedCalls: Array<AiRequestMessageAssistantFunctionCall> = [];
    const rejectedCalls: Array<AiRequestMessageAssistantFunctionCall> = [];
    for (const functionCall of functionCalls) {
      if (DISPATCHABLE_TOOL_NAMES.has(functionCall.name)) {
        whitelistedCalls.push(functionCall);
        continue;
      }
      rejectedCalls.push(functionCall);
    }
    for (const rejectedCall of rejectedCalls) {
      appendNotExecutedToolOutputs(
        [rejectedCall],
        `The tool "${
          rejectedCall.name
        }" is not available in BYOK chats. Only use the tools listed in the system prompt.`
      );
    }
    if (whitelistedCalls.length === 0) {
      // The loop continues so the model is told about the refusals and can
      // correct itself.
      persistUpdate();
      return true;
    }

    // The stuck-loop guard: refuse a third identical call with a
    // corrective message, stop the chat on the fourth.
    const {
      proceedingCalls,
      correctedCalls,
      stoppedAtCall,
    } = splitBatchByLoopGuard(whitelistedCalls);
    if (stoppedAtCall) {
      appendNotExecutedToolOutputs(
        [stoppedAtCall],
        BYOK_LOOP_GUARD_CORRECTIVE_MESSAGE
      );
      markError(
        BYOK_REPEATED_TOOL_CALL_LOOP_ERROR_CODE,
        'The assistant got stuck repeating the same tool call. Send a new message to continue with a different approach.'
      );
      return false;
    }
    for (const correctedCall of correctedCalls) {
      appendNotExecutedToolOutputs(
        [correctedCall],
        BYOK_LOOP_GUARD_CORRECTIVE_MESSAGE
      );
    }
    if (proceedingCalls.length === 0) {
      persistUpdate();
      return true;
    }

    const modifyingCalls = proceedingCalls.filter(doesCallRequireApproval);
    if (modifyingCalls.length > 0) {
      const approved = await onRequestEditApproval(modifyingCalls);
      // The user may have pressed stop while the approval row was open: an
      // approved batch must not run after a suspension either.
      if (isSuspended) {
        appendNotExecutedToolOutputs(
          proceedingCalls,
          'The assistant was stopped before running this tool call. Send a new message to continue.'
        );
        persistUpdate();
        return false;
      }
      if (!approved) {
        appendNotExecutedToolOutputs(
          proceedingCalls,
          'The user refused this edit. Ask them how to proceed before trying again.'
        );
        markSuspended();
        return false;
      }
    }

    // The plan tool is handled by the orchestrator itself; intercepted
    // tools (ByokExtraTools) run here; everything else goes to the editor
    // executor.
    const editorFunctionCalls = [];
    const extraToolCalls = [];
    for (const functionCall of proceedingCalls) {
      if (appendPlanToolOutput(functionCall)) continue;
      if (findByNameokExtraTool(functionCall.name)) {
        extraToolCalls.push(functionCall);
        continue;
      }

      editorFunctionCalls.push(functionCall);
    }

    if (editorFunctionCalls.length === 0 && extraToolCalls.length === 0) {
      persistUpdate();
      return true;
    }

    const executedResults: Array<EditorFunctionCallResult> = [];
    let createdSceneNames: Array<string> = [];
    let createdProject: any = null;

    for (const extraToolCall of extraToolCalls) {
      const result = await runExtraToolCall(extraToolCall);
      if (result) executedResults.push(result);
    }

    // Tool failures are not thrown: a failed editor function becomes a
    // `function_call_output` with success:false and the error text, and the
    // loop continues so the model can correct itself — exactly like the
    // server-side loop. A crash of the executor itself (outside the per-call
    // containment) is contained the same way, so the transcript always ends
    // with an output for every dispatched call.
    if (editorFunctionCalls.length > 0) {
      const executor = getExecutor();
      if (!executor) {
        appendNotExecutedToolOutputs(
          editorFunctionCalls,
          'The editor is not ready to run this tool call. Send a new message to retry.'
        );
      } else {
        try {
          const execution = await executor(
            editorFunctionCalls.map(functionCall => ({
              name: functionCall.name,
              arguments: functionCall.arguments,
              call_id: functionCall.call_id,
            })),
            {
              aiRequestId: aiRequest.id,
              getRelatedAiRequestLastMessages: () =>
                getLastMessagesFromAiRequestOutput(getOutput()),
            }
          );
          appendExecutedBatchOutputs(execution.results, editorFunctionCalls);
          executedResults.push(...execution.results);
          createdSceneNames = execution.createdSceneNames;
          createdProject = execution.createdProject;
        } catch (error) {
          console.error('BYOK orchestrator: tool execution crashed:', error);
          appendNotExecutedToolOutputs(
            editorFunctionCalls,
            `The tool execution crashed: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }
    }

    persistUpdate();

    if (onFunctionCallsExecuted) {
      try {
        onFunctionCallsExecuted(executedResults, {
          createdSceneNames,
          createdProject,
        });
      } catch (error) {
        // The batch ran and its outputs are recorded: a throwing
        // follow-up (e.g. opening a scene) must not corrupt the chat.
        console.error(
          'BYOK orchestrator: onFunctionCallsExecuted callback threw:',
          error
        );
      }
    }

    // A project created mid-chat (initialize_project) becomes the project
    // of the very next round: re-read the snapshot so the model sees what
    // it just created instead of the stale "no project" state.
    if (createdProject) {
      latestProjectContent = await getProjectUserContent();
    }
    return true;
  };

  const runLoop = async (): Promise<void> => {
    // The 'working' status is persisted once per turn start by the caller
    // (appendUserMessage, or retryAfterError which has no user message to
    // append) — persisting it here as well wrote the same state twice on
    // every message.
    // Cancelling this handle aborts the in-flight model request (see
    // suspend): without it, a stopped chat keeps spending the user's tokens
    // until the request times out.
    const cancellation = createByokCancellation();
    activeCancellation = cancellation;

    for (let roundCount = 0; roundCount < MAX_BYOK_TOOL_ROUNDS; roundCount++) {
      if (isSuspended) return;

      const response = await callModel();
      recordAssistantTurn(response);

      const pendingToolCalls = collectPendingToolCalls();
      // A plain-text answer (no tool call) means the model is done. An
      // answer arriving right after a suspension is recorded, but the
      // status the user saw ("suspended") wins.
      if (pendingToolCalls.length === 0) {
        if (isSuspended) return;
        if (!hasRecordedAnswerText()) {
          markError(
            'byok-empty-answer',
            'The model returned an empty answer. Try again, or send a more detailed message.'
          );
          return;
        }
        markReady();
        return;
      }

      // The next round would re-send the whole (longer) history: stop
      // before the context window overflows — unless older images can
      // still be evicted (images must not exhaust the context on their
      // own: text is small, screenshots are the expensive part). The
      // pending batch still executes either way, so the transcript stays
      // protocol-valid.
      const usedPercentage = aiRequest.contextStats
        ? aiRequest.contextStats.usedPercentage
        : 0;
      const isContextFull = usedPercentage >= MAX_BYOK_CONTEXT_RATIO;
      if (isContextFull && imagesToKeep > 0) {
        imagesToKeep--;
        console.info(
          `BYOK orchestrator: context is full — evicting older images (keeping the latest ${imagesToKeep}).`
        );
      } else if (isContextFull) {
        appendNotExecutedToolOutputs(
          pendingToolCalls,
          'The conversation reached the context window limit. The user will start a new chat.'
        );
        markError(
          'byok-context-full',
          'The conversation is close to the context window limit. Start a new chat to continue.'
        );
        return;
      }

      const shouldKeepGoing = await executeToolCalls(pendingToolCalls);
      if (!shouldKeepGoing) return;
    }

    markError(
      'byok-too-many-tool-rounds',
      'The assistant reached the maximum number of tool rounds for one message. Send another message to continue.'
    );
  };

  /**
   * The shared catch of both entries: a cancelled request is the expected
   * rejection of suspend() — the status it set ("suspended") stays, and no
   * endpoint error is shown.
   */
  const handleLoopError = (error: any): void => {
    const byokError = classifyByokError(error);
    if (byokError.kind === 'cancelled') {
      if (!isSuspended) markSuspended();
      return;
    }
    markError(byokError.kind, byokError.message);
  };

  const runWithUserMessage = async (text: string): Promise<void> => {
    if (isRunning) {
      console.info('BYOK orchestrator: a message is already being processed.');
      return;
    }
    isRunning = true;
    isSuspended = false;
    try {
      appendUserMessage(text);
      latestProjectContent = await getProjectUserContent();
      await runLoop();
    } catch (error) {
      handleLoopError(error);
    } finally {
      isRunning = false;
    }
  };

  const retryAfterError = async (): Promise<void> => {
    if (isRunning) return;
    if (aiRequest.status !== 'error') return;
    if (
      aiRequest.error &&
      NON_RETRYABLE_BYOK_ERROR_CODES.has(aiRequest.error.code)
    ) {
      // Retrying would re-send the same oversized transcript and fail
      // identically (while charging the user's endpoint for it).
      return;
    }
    isRunning = true;
    isSuspended = false;
    try {
      // Same single 'working' persist per turn start as a user message: the
      // status was 'error', the transcript is unchanged.
      aiRequest.status = 'working';
      persistUpdate();
      await runLoop();
    } catch (error) {
      handleLoopError(error);
    } finally {
      isRunning = false;
    }
  };

  return {
    startNewChat: (userRequest: string) => runWithUserMessage(userRequest),
    // Same as startNewChat in v1: the transcript (and the fresh project
    // snapshot) carries the conversation across messages.
    sendUserMessage: (text: string) => runWithUserMessage(text),
    suspend: () => {
      isSuspended = true;
      // Abort the in-flight model request (see runLoop).
      if (activeCancellation) activeCancellation.cancel();
      markSuspended();
    },
    retryAfterError,
  };
};

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
import { sendByokChatCompletionWithRetries } from './ByokClient';
import { classifyByokError } from './ByokErrors';
import { buildByokSystemPrompt } from './ByokPrompts';
import {
  BYOK_V1_TOOL_NAMES,
  getByokToolSchemas,
  toOpenAiToolsFormat,
} from './ByokToolSchema';
import {
  assistantMessageToByokMessage,
  byokResponseToAssistantMessage,
} from './ByokTranscript';
import { type ByokSettings } from './ByokTypes';
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
 * which is what makes it unit-testable.
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
  hasOpenedProject: boolean,
  // The tool executor (see createByokEditorFunctionCallExecutor in
  // ByokSeam.js), wrapping processEditorFunctionCalls.
  executeFunctionCalls: (
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
  |}>,
  // Builds the simplified project snapshot folded into the user message
  // sent to the model (the local replacement of prepareAiUserContent, which
  // uploads to GDevelop's servers).
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
  // changes and open created scenes.
  onFunctionCallsExecuted?: (
    results: Array<EditorFunctionCallResult>,
    meta: {| createdSceneNames: Array<string>, createdProject: any |}
  ) => void,
|};

export type ByokOrchestrator = {|
  startNewChat: (userRequest: string) => Promise<void>,
  sendUserMessage: (text: string) => Promise<void>,
  suspend: () => void,
|};

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
    executeFunctionCalls,
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
   * The system prompt + the transcript replayed as OpenAI messages. The
   * latest project snapshot is folded into the last user message (kept out
   * of the transcript itself, so the UI never renders a JSON blob) — the
   * same "fresh state with every message" behavior as the server flow.
   */
  const buildMessagesForModel = (): Array<any> => {
    const messages: Array<any> = [
      {
        role: 'system',
        content: buildByokSystemPrompt({
          toolNames: BYOK_V1_TOOL_NAMES,
          hasOpenedProject,
        }),
      },
      ...getOutput().map(assistantMessageToByokMessage),
    ];

    if (!latestProjectContent) return messages;

    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index];
      if (message.role !== 'user') continue;

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

  const callModel = async (): Promise<any> => {
    const chatOptions: any = {
      model: settings.modelName,
      messages: buildMessagesForModel(),
      tools: toOpenAiToolsFormat(getByokToolSchemas()),
    };
    if (settings.reasoningEffort !== 'default') {
      chatOptions.reasoningEffort = settings.reasoningEffort;
    }

    return await sendByokChatCompletionWithRetries({
      baseUrl: connection.baseUrl,
      apiKey: connection.apiKey,
      options: chatOptions,
    });
  };

  const recordAssistantTurn = (response: any): void => {
    getOutput().push(byokResponseToAssistantMessage(response));

    const usage = usageFromResponse(response);
    if (usage) {
      usageTracker.recordTurn(usage);
      aiRequest.contextStats = contextStatsFromUsage(
        usage,
        settings.contextWindowTokens
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
   * Execute a batch of tool calls: ask for the user's approval of the
   * modifying ones, run the batch, then append the (capped) outputs to the
   * transcript. Returns false when the loop must stop (edit refused).
   */
  const executeToolCalls = async (
    functionCalls: Array<AiRequestMessageAssistantFunctionCall>
  ): Promise<boolean> => {
    const modifyingCalls = functionCalls.filter(doesCallRequireApproval);
    if (modifyingCalls.length > 0) {
      const approved = await onRequestEditApproval(modifyingCalls);
      if (!approved) {
        markSuspended();
        return false;
      }
    }

    const {
      results,
      createdSceneNames,
      createdProject,
    } = await executeFunctionCalls(
      functionCalls.map(functionCall => ({
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

    // Tool failures are not thrown: a failed editor function becomes a
    // `function_call_output` with success:false and the error text, and the
    // loop continues so the model can correct itself — exactly like the
    // server-side loop.
    const {
      functionCallOutputs,
    } = getFunctionCallOutputsFromEditorFunctionCallResults(results);
    for (const functionCallOutput of functionCallOutputs) {
      getOutput().push({
        ...functionCallOutput,
        output: capToolOutput(functionCallOutput.output),
      });
    }
    persistUpdate();

    if (onFunctionCallsExecuted) {
      onFunctionCallsExecuted(results, {
        createdSceneNames,
        createdProject,
      });
    }
    return true;
  };

  const runLoop = async (): Promise<void> => {
    aiRequest.status = 'working';
    persistUpdate();

    for (let roundCount = 0; roundCount < MAX_BYOK_TOOL_ROUNDS; roundCount++) {
      if (isSuspended) return;

      const response = await callModel();
      recordAssistantTurn(response);

      const pendingToolCalls = collectPendingToolCalls();
      // A plain-text answer (no tool call) means the model is done.
      if (pendingToolCalls.length === 0) {
        markReady();
        return;
      }

      // The next round would re-send the whole (longer) history: stop
      // before the context window overflows.
      const usedPercentage = aiRequest.contextStats
        ? aiRequest.contextStats.usedPercentage
        : 0;
      if (usedPercentage >= MAX_BYOK_CONTEXT_RATIO) {
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
      const byokError = classifyByokError(error);
      markError(byokError.kind, byokError.message);
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
      markSuspended();
    },
  };
};

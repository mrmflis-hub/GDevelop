// @flow
import {
  type AiRequest,
  type AiRequestContextStats,
  type AiRequestMessage,
} from '../../Utils/GDevelopServices/Generation';
import {
  type ByokChatCompletionResponse,
  type ByokChatMessage,
  type ByokToolCall,
} from './ByokTypes';

/**
 * Translate between the OpenAI chat-completions messages (what the user's
 * endpoint speaks) and the internal transcript items (`AiRequestMessage`,
 * what the existing chat UI renders and `AiRequestUtils.js` walks).
 * The internal shapes are the ones of `Generation.js`: assistant messages
 * with an `output_text` / `function_call` content array, user messages with
 * a `user_request` content, and standalone `function_call_output` messages
 * for the tool results.
 */

/**
 * Map a chat-completions response to one assistant transcript message. The
 * content array holds an `output_text` item when the model answered with
 * text (skipped when empty), and one `function_call` item per tool call
 * asked by the model.
 */
export const byokResponseToAssistantMessage = (
  response: ByokChatCompletionResponse
): AiRequestMessage => {
  const choice = response.choices[0];
  const message = choice ? choice.message : null;

  const content: Array<any> = [];

  const text =
    message && typeof message.content === 'string' ? message.content : null;
  if (text) {
    content.push({
      type: 'output_text',
      status: 'completed',
      text,
      annotations: [],
    });
  }

  const toolCalls: Array<ByokToolCall> =
    message && message.tool_calls ? message.tool_calls : [];
  for (const toolCall of toolCalls) {
    content.push({
      type: 'function_call',
      status: 'completed',
      call_id: toolCall.id,
      name: toolCall.function.name,
      arguments: toolCall.function.arguments,
    });
  }

  return {
    type: 'message',
    status: 'completed',
    role: 'assistant',
    content,
  };
};

/**
 * Map a tool result (already serialized to a JSON string, like
 * `getFunctionCallOutputsFromEditorFunctionCallResults` does) to the
 * standalone transcript message that carries it.
 */
export const byokToolResultToFunctionCallOutput = (
  callId: string,
  resultJsonString: string
): AiRequestMessage => ({
  type: 'function_call_output',
  call_id: callId,
  output: resultJsonString,
});

/**
 * Map the text typed by the user to the OpenAI message of the request body.
 * (The system prompt of the orchestrator is a separate `system` message,
 * built by the loop in Phase 4 — not folded into the user message.)
 */
export const userRequestToByokMessage = (text: string): ByokChatMessage => ({
  role: 'user',
  content: text,
});

/**
 * Rebuild an OpenAI message out of an internal transcript item, to send the
 * whole conversation back to the endpoint at every turn (our transcript is
 * the single source of truth — no parallel OpenAI array is kept):
 * - a user message becomes a `user` message;
 * - an assistant message becomes an `assistant` message, with its text
 *   and/or its tool calls;
 * - a `function_call_output` becomes a `tool` message carrying the result
 *   of the tool call identified by `tool_call_id`.
 */
export const assistantMessageToByokMessage = (
  aiRequestMessage: AiRequestMessage
): ByokChatMessage => {
  if (aiRequestMessage.type === 'function_call_output') {
    return {
      role: 'tool',
      content: aiRequestMessage.output,
      tool_call_id: aiRequestMessage.call_id,
    };
  }

  if (aiRequestMessage.role === 'user') {
    const text = aiRequestMessage.content
      .filter(item => item.type === 'user_request')
      .map(item => item.text)
      .join(' ');
    return { role: 'user', content: text };
  }

  const contentItems = aiRequestMessage.content;
  const text = contentItems
    .filter(item => item.type === 'output_text')
    .map(item => item.text)
    .join('\n');

  const toolCalls: Array<ByokToolCall> = [];
  for (const item of contentItems) {
    if (item.type !== 'function_call') continue;
    toolCalls.push({
      id: item.call_id,
      type: 'function',
      function: {
        name: item.name,
        arguments: item.arguments,
      },
    });
  }

  const byokMessage: ByokChatMessage = {
    role: 'assistant',
    content: text || null,
  };
  if (toolCalls.length > 0) {
    (byokMessage: any).tool_calls = toolCalls;
  }
  return byokMessage;
};

/**
 * The minimal `AiRequest` a BYOK chat starts from: the same shape the chat
 * UI and `AiRequestUtils.js` consume, with an empty transcript. Phase 4's
 * store builds on this (ids prefixed `byok-`).
 */
export const createByokAiRequestShell = (
  id: string,
  contextStats?: AiRequestContextStats
): AiRequest => {
  const now = new Date().toISOString();
  return {
    id,
    createdAt: now,
    updatedAt: now,
    userId: '',
    status: 'working',
    error: null,
    output: [],
    contextStats: contextStats || null,
  };
};

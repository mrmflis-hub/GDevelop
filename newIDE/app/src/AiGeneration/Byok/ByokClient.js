// @flow
import axios from 'axios';
import { retryIfFailed } from '../../Utils/RetryIfFailed';
import {
  classifyByokError,
  makeByokError,
  redactSecretFromByokError,
  describeInvalidRequestForReasoningEffort,
  isRetryableByokError,
  type ByokError,
} from './ByokErrors';
import {
  type ByokChatCompletionOptions,
  type ByokChatCompletionResponse,
  type ByokConnection,
  type ByokModelInfo,
} from './ByokTypes';

// Tool-heavy turns can legitimately take a while: the default timeout of a
// chat-completions call is generous on purpose.
const CHAT_COMPLETION_DEFAULT_TIMEOUT_MS = 120000;
const MODELS_TIMEOUT_MS = 15000;

// Transient failures (server error, rate limit, network hiccup) are retried
// with a small backoff: 2 additional attempts, 800ms then 1.6s apart.
const RETRY_TIMES = 2;
const RETRY_BACKOFF_INITIAL_DELAY_MS = 800;
const RETRY_BACKOFF_FACTOR = 2;

/**
 * The base URL of the user's endpoint is used as-is: it already includes
 * `/v1` when their provider uses it (https://api.openai.com/v1, most local
 * servers, etc.). Only a trailing slash is trimmed, so both
 * `https://host/v1` and `https://host/v1/` produce the same URLs. The
 * settings tab explains this in its helper text.
 */
export const buildEndpointUrl = (baseUrl: string, path: string): string => {
  const trimmedBaseUrl = baseUrl.replace(/\/+$/, '');
  return `${trimmedBaseUrl}${path}`;
};

/**
 * Build the errors thrown by the client: always classified, and always
 * stripped of the API key, so that no error can ever leak it (it travels in
 * headers only — this redaction is the safety net that keeps that promise).
 */
const makeThrownByokError = (rawError: any, apiKey: string): ByokError => {
  const byokError = classifyByokError(rawError);
  return redactSecretFromByokError(byokError, apiKey);
};

/**
 * The endpoint did not answer with a model list — the base URL is probably
 * not an OpenAI-compatible endpoint.
 */
const makeNoModelListError = (): ByokError => ({
  kind: 'unknown',
  message:
    'The endpoint did not return a model list — check the base URL in the BYOK settings.',
  status: null,
});

/**
 * Fetch the raw entries of the model list exposed by the endpoint
 * (GET /models), validated as a list. This is the shared plumbing of
 * `fetchByokModels` (dumb mapping, used for simple listings) and
 * `refreshByokModels` in `ByokModelsCache.js` (which parses the
 * context-window fields different servers report, so it needs the raw
 * entries).
 */
export const fetchRawByokModels = async ({
  baseUrl,
  apiKey,
}: ByokConnection): Promise<Array<Object>> => {
  let response;
  try {
    // The API key is only sent in the Authorization header, never in the
    // URL, the body, or any error message or log.
    response = await axios.get(buildEndpointUrl(baseUrl, '/models'), {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: MODELS_TIMEOUT_MS,
    });
  } catch (error) {
    throw makeThrownByokError(error, apiKey);
  }

  const data = response ? response.data : null;
  if (!data || !Array.isArray(data)) {
    throw makeNoModelListError();
  }

  return data;
};

/**
 * Fetch the list of models exposed by the endpoint (GET /models). This stays
 * intentionally dumb: it only checks the response is a model list and keeps
 * the ids. The parsing of context-window sizes (when the server reports
 * them) lives in `ByokModelsCache.js`.
 */
export const fetchByokModels = async ({
  baseUrl,
  apiKey,
}: ByokConnection): Promise<Array<ByokModelInfo>> => {
  const rawModels = await fetchRawByokModels({ baseUrl, apiKey });

  const models: Array<ByokModelInfo> = [];
  for (const rawModel of rawModels) {
    if (!rawModel || typeof rawModel !== 'object') continue;
    if (typeof rawModel.id !== 'string') continue;
    models.push({ id: rawModel.id, contextWindowTokens: null });
  }
  return models;
};

/**
 * Send a chat-completions request (non-streaming) to the endpoint, with the
 * optional tool definitions and reasoning effort. Throws a ByokError when
 * anything goes wrong. Most consumers should prefer
 * `sendByokChatCompletionWithRetries`, which adds the retry policy on top.
 */
export const sendByokChatCompletion = async ({
  baseUrl,
  apiKey,
  options,
}: {|
  ...ByokConnection,
  options: ByokChatCompletionOptions,
|}): Promise<ByokChatCompletionResponse> => {
  const body: Object = {
    model: options.model,
    messages: options.messages,
  };
  if (options.tools) {
    body.tools = options.tools;
  }
  // Only send `reasoning_effort` when the user asked for a specific effort:
  // many OpenAI-compatible servers reject unknown parameters.
  if (
    options.reasoningEffort === 'low' ||
    options.reasoningEffort === 'medium' ||
    options.reasoningEffort === 'high'
  ) {
    body.reasoning_effort = options.reasoningEffort;
  }

  let response;
  try {
    // The API key is only sent in the Authorization header, never in the
    // URL, the body, or any error message or log.
    response = await axios.post(
      buildEndpointUrl(baseUrl, '/chat/completions'),
      body,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: options.timeoutMs || CHAT_COMPLETION_DEFAULT_TIMEOUT_MS,
      }
    );
  } catch (error) {
    throw makeThrownByokError(error, apiKey);
  }

  const data = response ? response.data : null;
  if (
    !data ||
    typeof data !== 'object' ||
    !Array.isArray(data.choices) ||
    data.choices.length === 0
  ) {
    throw makeByokError(
      'unknown',
      'The endpoint returned an unexpected chat response.',
      null
    );
  }

  return data;
};

/**
 * Send a chat-completions request with the full retry policy:
 * - a rejection that names `reasoning_effort` is retried once without the
 *   parameter (the endpoint does not support it — degrade instead of fail);
 * - transient failures (server error, rate limit, network, timeout) are
 *   retried with a short backoff;
 * - everything else (authentication, invalid request, etc.) fails right
 *   away, as retrying would fail again identically.
 *
 * The two behaviors are mutually exclusive: a `reasoning_effort` rejection
 * is never retried again, and a transient failure is never retried without
 * the parameter.
 */
export const sendByokChatCompletionWithRetries = async ({
  baseUrl,
  apiKey,
  options,
}: {|
  ...ByokConnection,
  options: ByokChatCompletionOptions,
|}): Promise<ByokChatCompletionResponse> => {
  try {
    return await sendByokChatCompletion({ baseUrl, apiKey, options });
  } catch (rawError) {
    const error = makeThrownByokError(rawError, apiKey);

    if (
      describeInvalidRequestForReasoningEffort(error) &&
      options.reasoningEffort
    ) {
      // Retry once without the reasoning effort: the endpoint does not
      // support the parameter.
      const degradedOptions: ByokChatCompletionOptions = {
        model: options.model,
        messages: options.messages,
      };
      if (options.tools) {
        degradedOptions.tools = options.tools;
      }
      if (options.timeoutMs) {
        degradedOptions.timeoutMs = options.timeoutMs;
      }
      return await sendByokChatCompletion({
        baseUrl,
        apiKey,
        options: degradedOptions,
      });
    }

    if (!isRetryableByokError(error)) {
      throw error;
    }

    return await retryIfFailed(
      {
        times: RETRY_TIMES,
        backoff: {
          initialDelay: RETRY_BACKOFF_INITIAL_DELAY_MS,
          factor: RETRY_BACKOFF_FACTOR,
        },
      },
      () => sendByokChatCompletion({ baseUrl, apiKey, options })
    );
  }
};

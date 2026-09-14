// @flow

/**
 * The reasoning effort to ask from the model. The exact behavior depends on
 * the provider; it is sent as-is with the requests (starting from Phase 2).
 */
export type ByokReasoningEffort = 'default' | 'low' | 'medium' | 'high';

/**
 * The BYOK settings of the user. Note that the API key is intentionally not
 * part of this type: it never enters the preferences blob, it is stored by
 * `ByokKeyStorage` instead.
 *
 * `contextWindowTokens` is the global fallback of the context window, kept
 * from Phase 1. `contextWindowByModel` holds the per-model values (model id
 * → tokens), which take precedence for these models.
 */
export type ByokSettings = {|
  enabled: boolean,
  endpointUrl: string,
  modelName: string,
  reasoningEffort: ByokReasoningEffort,
  contextWindowTokens: number,
  contextWindowByModel: { [string]: number },
|};

export const MIN_CONTEXT_WINDOW_TOKENS = 512;
export const MAX_CONTEXT_WINDOW_TOKENS = 1000000;

export const BYOK_REASONING_EFFORTS: Array<ByokReasoningEffort> = [
  'default',
  'low',
  'medium',
  'high',
];

export const DEFAULT_BYOK_SETTINGS: ByokSettings = {
  enabled: false,
  endpointUrl: '',
  modelName: '',
  reasoningEffort: 'default',
  contextWindowTokens: 8192,
  contextWindowByModel: {},
};

/**
 * A model as reported by the endpoint (GET /models), with the context window
 * size when the server reports one (many OpenAI-compatible servers do; OpenAI
 * itself does not — it is then filled from the user settings or a default).
 */
export type ByokModelInfo = {|
  id: string,
  contextWindowTokens: ?number,
|};

/**
 * One tool call asked by the model, in the exact shape of the OpenAI
 * chat-completions API.
 */
export type ByokToolCall = {|
  id: string,
  type: 'function',
  function: {|
    name: string,
    // A JSON string, not a parsed object: this is the wire format.
    arguments: string,
  |},
|};

/**
 * A message of the OpenAI chat-completions API. This is the contract with
 * the user's endpoint: the internal GDevelop transcript (`AiRequestMessage`)
 * is translated to/from these in `ByokTranscript.js`.
 */
export type ByokChatMessage =
  | {| role: 'system', content: string |}
  | {| role: 'user', content: string |}
  | {|
      role: 'assistant',
      content: string | null,
      tool_calls?: Array<ByokToolCall>,
    |}
  | {| role: 'tool', content: string, tool_call_id: string |};

/**
 * The response of a chat-completions call (non-streaming). Note that `usage`
 * is optional: some proxies omit it.
 */
export type ByokChatCompletionResponse = {|
  choices: Array<{|
    message: {|
      role: 'assistant',
      content: string | null,
      tool_calls?: Array<ByokToolCall>,
    |},
    finish_reason: ?string,
  |}>,
  usage?: {|
    prompt_tokens: number,
    completion_tokens: number,
    total_tokens: number,
  |},
|};

/**
 * The token usage of one chat-completions call, normalized from the
 * snake_case `usage` field of the response.
 */
export type ByokUsage = {|
  promptTokens: number,
  completionTokens: number,
  totalTokens: number,
|};

/**
 * The options of a chat-completions request. `reasoningEffort` is included in
 * the request body only when set (a `'default'` effort from the settings
 * means "do not send the parameter at all").
 */
export type ByokChatCompletionOptions = {|
  model: string,
  messages: Array<ByokChatMessage>,
  tools?: Array<Object>,
  reasoningEffort?: 'low' | 'medium' | 'high',
  timeoutMs?: number,
|};

/**
 * Where to reach the user's endpoint: the base URL (including `/v1` when the
 * provider uses it) and the API key.
 */
export type ByokConnection = {|
  baseUrl: string,
  apiKey: string,
|};

/**
 * True when the given value is one of the documented reasoning efforts. Used
 * to check values read back from localStorage, and to narrow the value of a
 * select field.
 */
export const isByokReasoningEffort = (value: mixed): boolean =>
  BYOK_REASONING_EFFORTS.some(effort => effort === value);

const getBooleanOrDefault = (value: mixed, defaultValue: boolean): boolean => {
  if (typeof value === 'boolean') return value;
  return defaultValue;
};

const getStringOrDefault = (value: mixed, defaultValue: string): string => {
  if (typeof value === 'string') return value;
  return defaultValue;
};

const getNumberOrDefault = (value: mixed, defaultValue: number): number => {
  if (typeof value === 'number') return value;
  return defaultValue;
};

/**
 * Read the per-model context window map, keeping only the entries that are
 * positive finite numbers (the map is read back from localStorage, so every
 * entry is untrusted data). Entries for models are dropped, not defaulted:
 * a missing entry means "use the fallbacks" for this model.
 */
const getContextWindowByModelOrDefault = (
  value: mixed
): { [string]: number } => {
  const contextWindowByModel: { [string]: number } = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return contextWindowByModel;
  }

  const rawMap = value;
  for (const modelId of Object.keys(rawMap)) {
    const tokens = rawMap[modelId];
    if (typeof tokens === 'number' && Number.isFinite(tokens) && tokens > 0) {
      contextWindowByModel[modelId] = tokens;
    }
  }
  return contextWindowByModel;
};

/**
 * Read the BYOK settings from the preferences values, without ever crashing
 * on missing, partial or corrupted settings (they are read back from
 * localStorage, so they must be treated as untrusted data). Fields are merged
 * over the defaults one by one, so that settings saved by an older build
 * (before a new field was added) still work.
 */
export const getByokSettings = (values: {
  +byok: ?ByokSettings,
  ...
}): ByokSettings => {
  const byok = values.byok;
  if (!byok) return DEFAULT_BYOK_SETTINGS;
  if (typeof byok !== 'object') return DEFAULT_BYOK_SETTINGS;

  return {
    enabled: getBooleanOrDefault(byok.enabled, DEFAULT_BYOK_SETTINGS.enabled),
    endpointUrl: getStringOrDefault(
      byok.endpointUrl,
      DEFAULT_BYOK_SETTINGS.endpointUrl
    ),
    modelName: getStringOrDefault(
      byok.modelName,
      DEFAULT_BYOK_SETTINGS.modelName
    ),
    reasoningEffort: isByokReasoningEffort(byok.reasoningEffort)
      ? byok.reasoningEffort
      : DEFAULT_BYOK_SETTINGS.reasoningEffort,
    contextWindowTokens: getNumberOrDefault(
      byok.contextWindowTokens,
      DEFAULT_BYOK_SETTINGS.contextWindowTokens
    ),
    contextWindowByModel: getContextWindowByModelOrDefault(
      byok.contextWindowByModel
    ),
  };
};

/**
 * True when BYOK can actually be used: enabled, with an endpoint URL that
 * looks like an HTTP(S) URL (`http://` is allowed for local servers like
 * Ollama) and a model name.
 */
export const isByokFullyConfigured = (settings: ByokSettings): boolean => {
  if (!settings.enabled) return false;

  const endpointUrl = settings.endpointUrl.trim();
  if (!endpointUrl) return false;
  if (
    !endpointUrl.startsWith('https://') &&
    !endpointUrl.startsWith('http://')
  ) {
    return false;
  }

  if (!settings.modelName.trim()) return false;

  return true;
};

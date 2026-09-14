// @flow
import { fetchRawByokModels } from './ByokClient';
import {
  DEFAULT_BYOK_SETTINGS,
  type ByokConnection,
  type ByokModelInfo,
  type ByokSettings,
} from './ByokTypes';

/**
 * Read the context window from a raw `/models` entry, trying in order the
 * fields that different OpenAI-compatible servers actually use. Returns the
 * first positive number found, or null when the server does not report the
 * context window (OpenAI itself does not).
 */
export const extractContextWindowTokens = (modelEntry: Object): ?number => {
  if (!modelEntry || typeof modelEntry !== 'object') return null;

  // vLLM and some gateways.
  if (
    typeof modelEntry.context_length === 'number' &&
    modelEntry.context_length > 0
  ) {
    return modelEntry.context_length;
  }

  // LM Studio.
  if (
    typeof modelEntry.max_context_length === 'number' &&
    modelEntry.max_context_length > 0
  ) {
    return modelEntry.max_context_length;
  }

  // text-generation-webui, llama.cpp server, some gateways.
  if (
    typeof modelEntry.max_model_len === 'number' &&
    modelEntry.max_model_len > 0
  ) {
    return modelEntry.max_model_len;
  }

  // A few local servers name it like the llama.cpp option.
  if (
    typeof modelEntry.context_size === 'number' &&
    modelEntry.context_size > 0
  ) {
    return modelEntry.context_size;
  }

  // Some gateways nest it in a metadata object.
  const metadata = modelEntry.metadata;
  if (
    metadata &&
    typeof metadata === 'object' &&
    typeof metadata.context_length === 'number' &&
    metadata.context_length > 0
  ) {
    return metadata.context_length;
  }

  return null;
};

/**
 * Normalize the raw entries of a `/models` response: parse the context
 * window when the server reports one, drop the entries without an id, and
 * sort by id ascending (so the settings dropdown is stable).
 */
export const normalizeByokModels = (
  rawModels: Array<Object>
): Array<ByokModelInfo> => {
  const models: Array<ByokModelInfo> = [];
  for (const rawModel of rawModels) {
    if (!rawModel || typeof rawModel !== 'object') continue;
    if (typeof rawModel.id !== 'string') continue;
    models.push({
      id: rawModel.id,
      contextWindowTokens: extractContextWindowTokens(rawModel),
    });
  }

  return models.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
};

// The only mutable module state of the BYOK modules: a per-session read
// cache of the model lists, keyed by base URL. It is safe because it only
// ever holds replaceable copies of what the server answered (a stale entry
// is replaced by the next refresh), and because BYOK settings live in the
// main window only.
const modelsByBaseUrl: Map<string, Array<ByokModelInfo>> = new Map();

/**
 * Remember the model list of an endpoint for this session.
 */
export const cacheByokModels = (
  baseUrl: string,
  models: Array<ByokModelInfo>
): void => {
  modelsByBaseUrl.set(baseUrl, models);
};

/**
 * The model list remembered for an endpoint, or null when it was never
 * fetched (or the app was restarted: the cache is in-memory only).
 */
export const getCachedByokModels = (baseUrl: string): ?Array<ByokModelInfo> => {
  return modelsByBaseUrl.get(baseUrl) || null;
};

/**
 * Fetch, normalize and cache the model list of an endpoint. This is what the
 * settings tab calls from its "Fetch models" button.
 */
export const refreshByokModels = async (
  connection: ByokConnection
): Promise<Array<ByokModelInfo>> => {
  // The raw entries are needed here (rather than `fetchByokModels`) so the
  // context-window fields reported by the server can be parsed below.
  const rawModels = await fetchRawByokModels(connection);
  const models = normalizeByokModels(rawModels);
  cacheByokModels(connection.baseUrl, models);
  return models;
};

/**
 * The context window to use for a model, following the fallback chain:
 * 1. what the server reported for the model (when it reports one),
 * 2. the value the user set for this model,
 * 3. the global value the user set (kept from Phase 1),
 * 4. the default (8192).
 */
export const resolveContextWindowTokens = (
  settings: ByokSettings,
  modelInfo: ?ByokModelInfo,
  modelId: string
): number => {
  if (
    modelInfo &&
    typeof modelInfo.contextWindowTokens === 'number' &&
    modelInfo.contextWindowTokens > 0
  ) {
    return modelInfo.contextWindowTokens;
  }

  const perModelTokens = settings.contextWindowByModel[modelId];
  if (typeof perModelTokens === 'number' && perModelTokens > 0) {
    return perModelTokens;
  }

  if (settings.contextWindowTokens > 0) {
    return settings.contextWindowTokens;
  }

  return DEFAULT_BYOK_SETTINGS.contextWindowTokens;
};

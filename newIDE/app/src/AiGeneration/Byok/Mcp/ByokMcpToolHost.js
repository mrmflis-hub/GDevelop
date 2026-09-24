// @flow

/**
 * The MCP tool host (Phase 10): the module-level rendezvous the BYOK seam
 * registers its executor into and the MCP dispatch runs through — the
 * `setByokOrchestrator` pattern of `ByokChatStore`, applied to tool
 * execution. Owns the serialized call queue (the editor project is shared
 * mutable state), the per-call timeout, the client-cancellation marks, and
 * the activity ring the settings card shows.
 */

import {
  NO_TOOL_HOST_MESSAGE,
  type ByokMcpCallToolResult,
} from './ByokMcpProtocol';
import {
  makeByokMcpErrorResult,
  runByokMcpToolCall,
  type ByokMcpToolCallOutcome,
  type ByokMcpToolMeta,
} from './ByokMcpTools';
import type { EditorFunctionCallResult } from '../../../EditorFunctions';
import type { ByokExtraTool, ByokExtraToolResult } from '../ByokExtraTools';
import type { ByokSettings } from '../ByokTypes';

/** Default per-call timeout. Configurable for the tests. */
export const BYOK_MCP_TOOL_TIMEOUT_MS = 120000;

/** How many activity entries the settings card keeps. */
export const BYOK_MCP_ACTIVITY_CAPACITY = 200;

/** How long a cancellation mark is honored before being pruned. */
const CANCELLATION_MARK_TTL_MS = 10 * 60 * 1000;

/**
 * The editor-side capabilities the seam registers. The `modifiesProject`
 * metadata mirrors what the chat approval decision reads (registry entries
 * sometimes decide per arguments); the extra-tool lookups are injected so
 * this module never imports the registries directly.
 */
export type ByokMcpToolHostBag = {|
  +executeRegistryTool: (
    name: string,
    argsJson: string,
    callId: string
  ) => Promise<EditorFunctionCallResult>,
  +executeExtraTool: (
    name: string,
    args: Object
  ) => Promise<ByokExtraToolResult>,
  +getExtraTool: (name: string) => ?ByokExtraTool,
  +isExtraToolShadowedByRegistry: (name: string) => boolean,
  +editorFunctions: {| +[string]: ?ByokMcpToolMeta |},
  +editorFunctionsWithoutProject: {| +[string]: ?ByokMcpToolMeta |},
  +getProject: () => any,
  +getSettings: () => ByokSettings,
  // The prompts/resources data sources (Phase 12): the skill library and
  // the project notes. Optional so older hosts keep working (the MCP
  // methods then answer with empty lists / -32602).
  +listSkillPrompts?: () => Promise<
    Array<{| name: string, description: string, body: string |}>
  >,
  +readProjectNotes?: () => Promise<string | null>,
|};

export type ByokMcpToolHost = {|
  +id: number,
  +executeRegistryTool: (
    name: string,
    argsJson: string,
    callId: string
  ) => Promise<EditorFunctionCallResult>,
  +executeExtraTool: (
    name: string,
    args: Object
  ) => Promise<ByokExtraToolResult>,
  +getExtraTool: (name: string) => ?ByokExtraTool,
  +isExtraToolShadowedByRegistry: (name: string) => boolean,
  +editorFunctions: {| +[string]: ?ByokMcpToolMeta |},
  +editorFunctionsWithoutProject: {| +[string]: ?ByokMcpToolMeta |},
  +getProject: () => any,
  +getSettings: () => ByokSettings,
  // The prompts/resources data sources (Phase 12), mirrored from the bag.
  +listSkillPrompts?: () => Promise<
    Array<{| name: string, description: string, body: string |}>
  >,
  +readProjectNotes?: () => Promise<string | null>,
|};

export type ByokMcpActivityOutcome =
  | 'completed'
  | 'rejected'
  | 'failed'
  | 'timeout'
  | 'cancelled';

export type ByokMcpActivityEntry = {|
  at: string,
  tool: string,
  argsPreview: string,
  outcome: ByokMcpActivityOutcome,
  didModifyProject: boolean,
  durationMs: number,
|};

// ---- The module-level host registry ----

let currentHost: ?ByokMcpToolHost = null;
let hostCounter = 0;
const hostListeners: Set<() => void> = new Set();

export const makeByokMcpToolHost = (
  bag: ByokMcpToolHostBag
): ByokMcpToolHost => {
  hostCounter += 1;
  return { id: hostCounter, ...bag };
};

export const setByokMcpToolHost = (host: ?ByokMcpToolHost): void => {
  currentHost = host;
  hostListeners.forEach(listener => listener());
};

export const getByokMcpToolHost = (): ?ByokMcpToolHost => currentHost;

/** Notified on every register/unregister (the hook pushes host status to main). */
export const subscribeByokMcpToolHost = (
  listener: () => void
): (() => void) => {
  hostListeners.add(listener);
  return () => {
    hostListeners.delete(listener);
  };
};

// ---- The activity ring ----

const activityRing: Array<ByokMcpActivityEntry> = [];

/** Newest first. */
export const listByokMcpActivity = (): Array<ByokMcpActivityEntry> =>
  activityRing.slice().reverse();

export const clearByokMcpActivity = (): void => {
  activityRing.length = 0;
};

const recordActivity = (entry: ByokMcpActivityEntry): void => {
  activityRing.push(entry);
  if (activityRing.length > BYOK_MCP_ACTIVITY_CAPACITY) {
    activityRing.shift();
  }
};

// ---- The serialized call queue ----

let queueTail: Promise<void> = Promise.resolve();
let callCounter = 0;
const cancelledCallIds: Map<string, number> = new Map();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const queued = queueTail.then(task);
  // The next task runs after this one settles, whatever its outcome.
  queueTail = queued.then(() => {}, () => {});
  return queued;
}

export const cancelByokMcpCall = (requestId: string | number): void => {
  cancelledCallIds.set(String(requestId), Date.now());
};

const pruneCancellationMarks = (): void => {
  const now = Date.now();
  for (const [requestId, markedAt] of cancelledCallIds) {
    if (now - markedAt > CANCELLATION_MARK_TTL_MS) {
      cancelledCallIds.delete(requestId);
    }
  }
};

/**
 * Execute one `tools/call` through the registered host: serialized (one at
 * a time), cancellable (a mark skips a call that has not started yet — an
 * in-flight call cannot be aborted, the same semantics as suspending a
 * chat), timed (the timeout resolves the caller while the queue slot stays
 * occupied until the call settles), and always logged.
 */
export const executeByokMcpToolCall = (
  name: string,
  args: Object,
  options?: {|
    +timeoutMs?: number,
    +requestId?: string | number | null,
  |}
): Promise<ByokMcpCallToolResult> => {
  callCounter += 1;
  const callId = `mcp-${callCounter}`;
  const startedAt = Date.now();
  const argsPreview = makeArgsPreview(args);
  const requestIdKey = readRequestIdKey(options);

  const task = async (): Promise<ByokMcpCallToolResult> => {
    const host = getByokMcpToolHost();
    if (!host) {
      recordActivity(makeEntry(name, argsPreview, startedAt, 'failed', false));
      return makeByokMcpErrorResult(NO_TOOL_HOST_MESSAGE);
    }
    if (requestIdKey !== null) {
      if (cancelledCallIds.has(requestIdKey)) {
        cancelledCallIds.delete(requestIdKey);
        recordActivity(
          makeEntry(name, argsPreview, startedAt, 'cancelled', false)
        );
        return makeByokMcpErrorResult(
          'The tool call was cancelled by the client.'
        );
      }
      pruneCancellationMarks();
    }

    const detailed = await runByokMcpToolCall({ name, args }, callId, host);
    if (requestIdKey !== null) cancelledCallIds.delete(requestIdKey);
    recordActivity(
      makeEntry(
        name,
        argsPreview,
        startedAt,
        detailed.outcome,
        detailed.didModifyProject
      )
    );
    return detailed.result;
  };

  const timeoutMs =
    options && typeof options.timeoutMs === 'number'
      ? options.timeoutMs
      : BYOK_MCP_TOOL_TIMEOUT_MS;
  return withTimeout(enqueue(task), timeoutMs, name, argsPreview, startedAt);
};

const readRequestIdKey = (options?: {|
  +timeoutMs?: number,
  +requestId?: string | number | null,
|}): string | null => {
  if (!options || options.requestId == null) return null;
  return String(options.requestId);
};

const makeArgsPreview = (args: Object): string => {
  try {
    return JSON.stringify(args).slice(0, 200);
  } catch (error) {
    return '(unserializable arguments)';
  }
};

const makeEntry = (
  tool: string,
  argsPreview: string,
  startedAt: number,
  outcome: ByokMcpToolCallOutcome | 'timeout' | 'cancelled',
  didModifyProject: boolean
): ByokMcpActivityEntry => ({
  at: new Date().toISOString(),
  tool,
  argsPreview,
  outcome,
  didModifyProject,
  durationMs: Date.now() - startedAt,
});

/**
 * Race the queued call against the timeout. The caller gets the timeout
 * result while the queue keeps the slot busy until the underlying call
 * settles — serialization is never broken by an early return.
 */
const withTimeout = (
  queued: Promise<ByokMcpCallToolResult>,
  timeoutMs: number,
  name: string,
  argsPreview: string,
  startedAt: number
): Promise<ByokMcpCallToolResult> =>
  new Promise(resolve => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      recordActivity(makeEntry(name, argsPreview, startedAt, 'timeout', false));
      resolve(
        makeByokMcpErrorResult(
          `The tool call timed out after ${timeoutMs} ms. It may still finish in the editor.`
        )
      );
    }, timeoutMs);
    queued.then(
      value => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        recordActivity(
          makeEntry(name, argsPreview, startedAt, 'failed', false)
        );
        resolve(
          makeByokMcpErrorResult(
            `The tool execution crashed: ${
              error instanceof Error ? error.message : String(error)
            }`
          )
        );
      }
    );
  });

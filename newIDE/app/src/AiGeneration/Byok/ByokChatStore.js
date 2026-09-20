// @flow
import type { AiRequest } from '../../Utils/GDevelopServices/Generation';
import { createByokAiRequestShell } from './ByokTranscript';

/**
 * The store of the BYOK chats: `AiRequest`-shaped records with synthetic ids,
 * so the chat UI renders them with zero knowledge that no server exists.
 *
 * The records live in a module-level map — the same spirit as the record of
 * `AiRequestContext`, but strictly local: a BYOK chat must never enter
 * `AiRequestContext`, whose loading and polling effects target GDevelop's
 * servers.
 */

// v1 is session-only on purpose: persisting full transcripts (with their
// embedded tool outputs) to localStorage is a deliberate follow-up — flip
// this flag only when that persistence is implemented and capped.
export const BYOK_CHAT_PERSISTENCE_ENABLED = false;

const byokChats: Map<string, AiRequest> = new Map();
const listeners: Set<() => void> = new Set();

const notifyListeners = (): void => {
  listeners.forEach(listener => listener());
};

// Synthetic ids, prefixed so any code can recognize a BYOK chat without
// knowing the store (see isByokAiRequestId in ByokSeam.js).
const generateByokChatId = (): string =>
  'byok-' +
  Date.now().toString(36) +
  '-' +
  Math.random()
    .toString(36)
    .slice(2, 10);

/**
 * Create an empty BYOK chat record (status "working", empty output) and
 * notify the subscribers.
 */
export const createByokChat = (): AiRequest => {
  const chat = createByokAiRequestShell(generateByokChatId());
  byokChats.set(chat.id, chat);
  notifyListeners();
  return chat;
};

/**
 * Get a BYOK chat by id, or null when it does not exist (or was archived).
 */
export const getByokChat = (id: string): AiRequest | null =>
  byokChats.get(id) || null;

/**
 * Store a new version of a BYOK chat (bumping `updatedAt` — the copy of the
 * output array keeps records independent from the orchestrator's mutations)
 * and notify the subscribers.
 */
export const updateByokChat = (aiRequest: AiRequest): void => {
  if (!byokChats.has(aiRequest.id)) return;

  byokChats.set(aiRequest.id, {
    ...aiRequest,
    output: [...(aiRequest.output || [])],
    updatedAt: new Date().toISOString(),
  });
  notifyListeners();
};

/**
 * The non-archived BYOK chats, oldest first.
 */
export const listByokChats = (): Array<AiRequest> =>
  Array.from(byokChats.values()).filter(chat => !chat.archivedAt);

/**
 * Archive a BYOK chat: it disappears from the list (and from getByokChat),
 * like archiving does for server chats.
 */
export const archiveByokChat = (id: string): void => {
  const chat = byokChats.get(id);
  if (!chat) return;

  byokChats.delete(id);
  notifyListeners();
};

/**
 * Subscribe to any BYOK chat change; returns the unsubscribe function
 * (usable as the cleanup of React.useEffect / useSyncExternalStore).
 */
export const subscribeByokChats = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

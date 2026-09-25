// @flow
import {
  type AiRequest,
  type AiRequestMessage,
} from '../../Utils/GDevelopServices/Generation';
import { restoreByokImage } from './ByokImageContent';

/**
 * The durable chat history (Phase 9.3, owner decision #1 — the contract):
 * chats are saved to human-readable files (Markdown with a YAML front
 * matter block — chosen over pure YAML because the file then renders
 * nicely for a future "open chat file" UX, while the front matter keeps
 * the list data lossless), after every user message, when the AI finishes
 * and on app closure (the store's flush). Transcript images stay
 * id-referenced; their payloads live in per-chat `.images.json` sidecar
 * entries, never inline in the text file.
 *
 * The module owns the file format, the naming convention (first 5 words of
 * the first prompt + the date of the last interaction), the corruption
 * quarantine (a file that fails shape validation moves aside, never blocks
 * the list) and the storage quota (image sidecars of the oldest chats are
 * evicted before any transcript text). The platform backends — Electron
 * files through IPC on desktop, IndexedDB on the web build — are injected.
 */

export const BYOK_CHAT_FILE_SCHEMA = 1;

export type ByokChatFileMeta = {|
  id: string,
  fileName: string,
  name: string,
  createdAt: string,
  updatedAt: string,
  archivedAt: string | null,
  messageCount: number,
|};

/** One file of the storage, as the backends report it. */
export type ByokChatStorageFile = {|
  fileName: string,
  sizeBytes: number,
|};

/**
 * The platform file storage, kept deliberately dumb: named text entries,
 * no structure knowledge. The desktop backend maps it to a folder under
 * the user-data dir (through IPC), the web backend to IndexedDB.
 */
export type ByokChatFilesBackend = {|
  listFiles: () => Promise<Array<ByokChatStorageFile>>,
  readFile: (fileName: string) => Promise<string | null>,
  writeFile: (fileName: string, content: string) => Promise<void>,
  deleteFile: (fileName: string) => Promise<void>,
  moveFile: (fromFileName: string, toFileName: string) => Promise<void>,
  getTotalBytes: () => Promise<number>,
|};

const CHAT_FILE_EXTENSION = '.md';
const IMAGES_FILE_SUFFIX = '.images.json';
const QUARANTINE_PREFIX = 'corrupt-';

// ----------------------------------------------------------------------
// The Markdown codec (pure functions — the heart of the round-trip).
// ----------------------------------------------------------------------

const FRONT_MATTER_FIELDS = [
  'schema',
  'id',
  'name',
  'createdAt',
  'updatedAt',
  'archivedAt',
  'messageCount',
];

const stringifyFrontMatterValue = (value: string | number | null): string =>
  JSON.stringify(value === null ? null : String(value));

/**
 * The chat's display name: the first 5 words of the chat's first prompt +
 * the date of the last interaction (the owner's convention, decision #1).
 */
export const makeByokChatName = (chat: AiRequest): string => {
  const output = chat.output || [];
  let firstPrompt = chat.title || '';
  if (!firstPrompt) {
    for (const message of output) {
      if (message.type !== 'message' || message.role !== 'user') continue;
      const item = message.content.find(
        contentItem => contentItem.type === 'user_request'
      );
      if (item && item.text) {
        firstPrompt = item.text;
        break;
      }
    }
  }
  const firstFiveWords = firstPrompt
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)
    .join(' ');
  const lastInteractionDate = (chat.updatedAt || chat.createdAt || '').slice(
    0,
    10
  );
  const name =
    (firstFiveWords || 'chat') +
    (lastInteractionDate ? `_${lastInteractionDate}` : '');
  return name;
};

/** Make a file-system-safe file name out of a chat name. */
export const makeByokChatFileName = (chatName: string): string => {
  const safeName = chatName
    .replace(/[\\/:*?"<>|#%&{}$!'@+`=\s]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return (safeName || 'chat') + CHAT_FILE_EXTENSION;
};

/**
 * Serialize a chat to its Markdown file: YAML front matter for the list
 * data, then one JSON block per transcript message, each preceded by a
 * readable header line (role + a one-line preview) so the file can be read
 * like a transcript.
 */
export const serializeByokChatToMarkdown = (chat: AiRequest): string => {
  const name = makeByokChatName(chat);
  const messages = chat.output || [];
  const frontMatterLines = [
    '---',
    `schema: ${stringifyFrontMatterValue(BYOK_CHAT_FILE_SCHEMA)}`,
    `id: ${stringifyFrontMatterValue(chat.id)}`,
    `name: ${stringifyFrontMatterValue(name)}`,
    `createdAt: ${stringifyFrontMatterValue(chat.createdAt)}`,
    `updatedAt: ${stringifyFrontMatterValue(chat.updatedAt)}`,
    `archivedAt: ${stringifyFrontMatterValue(chat.archivedAt || null)}`,
    `messageCount: ${stringifyFrontMatterValue(messages.length)}`,
    '---',
    '',
    `# BYOK chat: ${name}`,
    '',
  ];

  const bodyLines: Array<string> = [];
  messages.forEach((message, index) => {
    const role = message.type === 'message' ? message.role : 'tool';
    const preview =
      message.type === 'function_call_output'
        ? message.output.slice(0, 100)
        : message.type === 'message'
        ? message.content
            .map(contentItem => ('text' in contentItem ? contentItem.text : ''))
            .join(' ')
            .slice(0, 100)
        : '';
    bodyLines.push(
      `## message ${index} — ${role}${
        preview ? ` — ${preview.replace(/\n/g, ' ').replace(/`/g, "'")}` : ''
      }`,
      '',
      '```json',
      // Backticks are escaped so a message that QUOTES markdown (e.g. an
      // assistant answer containing a ```json fence) can never break the
      // envelope: JSON.parse turns \u0060 back into a backtick losslessly.
      JSON.stringify(message).replace(/`/g, '\\u0060'),
      '```',
      ''
    );
  });

  return [...frontMatterLines, ...bodyLines].join('\n');
};

/**
 * Parse a Markdown chat file back into an `AiRequest` record, or null when
 * the file is not a well-shaped BYOK chat file (the caller quarantines it).
 * Every transcript message is re-validated minimally: it must be an object
 * with a `type` the transcript knows.
 */
export const parseByokChatFromMarkdown = (content: string): ?AiRequest => {
  if (!content.startsWith('---')) return null;

  const frontMatterEnd = content.indexOf('\n---', 3);
  if (frontMatterEnd === -1) return null;

  const frontMatterText = content.slice(3, frontMatterEnd);
  const body = content.slice(frontMatterEnd + 4);

  const fields: Map<string, string> = new Map();
  for (const line of frontMatterText.split('\n')) {
    const match = /^(\w+): (.*)$/.exec(line.trim());
    if (!match) continue;
    try {
      const parsedValue = JSON.parse(match[2]);
      if (parsedValue === null || typeof parsedValue === 'string') {
        fields.set(match[1], parsedValue);
      }
    } catch (error) {
      return null;
    }
  }

  for (const field of FRONT_MATTER_FIELDS) {
    if (!fields.has(field) && field !== 'archivedAt') return null;
  }

  const id = fields.get('id');
  if (!id) return null;

  const chat: AiRequest = {
    id,
    title: fields.get('name') || null,
    createdAt: fields.get('createdAt') || new Date().toISOString(),
    updatedAt: fields.get('updatedAt') || new Date().toISOString(),
    userId: '',
    status: 'ready',
    mode: 'orchestrator',
    error: null,
    output: [],
    contextStats: null,
    archivedAt: fields.get('archivedAt') || null,
  };

  const messageBlocks = body.split('```json');
  // Every segment after the first starts right after a ```json opener:
  // each of them holds one message followed by its closing fence.
  for (let index = 1; index < messageBlocks.length; index++) {
    const jsonText = messageBlocks[index];
    const closingFence = jsonText.indexOf('```');
    if (closingFence === -1) return null;
    let message: mixed = null;
    try {
      message = JSON.parse(jsonText.slice(0, closingFence));
    } catch (error) {
      return null;
    }
    if (!message || typeof message !== 'object') return null;
    const record: Object = message;
    if (
      record.type !== 'message' &&
      record.type !== 'function_call_output' &&
      record.type !== 'byok_notice'
    ) {
      return null;
    }
    ((chat.output: any): Array<AiRequestMessage>).push(record);
  }

  const declaredMessageCount = Number(fields.get('messageCount'));
  if (
    Number.isFinite(declaredMessageCount) &&
    chat.output &&
    chat.output.length !== declaredMessageCount
  ) {
    return null;
  }

  return chat;
};

// ----------------------------------------------------------------------
// Naming and lookup helpers.
// ----------------------------------------------------------------------

const imagesFileNameForChatId = (chatId: string): string =>
  `${chatId}${IMAGES_FILE_SUFFIX}`;

export const makeByokImagesFileName = imagesFileNameForChatId;

/**
 * Serialize the image sidecar entries of a chat: the payloads the
 * transcript's `images` ids point to. Sidecars are per chat, never inline
 * in the Markdown file.
 */
export const collectByokChatImageEntries = (
  chat: AiRequest,
  // Inexact on purpose: the real store hands back richer image infos.
  getImageById: (
    id: string
  ) => ?{
    dataUrl: string,
    width: number,
    height: number,
    approxTokens: number,
    ...
  }
): {
  [imageId: string]: {|
    dataUrl: string,
    width: number,
    height: number,
    approxTokens: number,
  |},
} => {
  // Built through any: the values come from the image store (any-typed).
  const entries: { [imageId: string]: any } = {};
  const output = chat.output || [];
  for (const message of output) {
    // Both referencing kinds count (tool outputs and the user messages'
    // attached images, Phase 13.3) — anything the transcript points at must
    // survive a reload.
    const images = (message: any).images;
    if (!Array.isArray(images)) continue;
    for (const imageId of images) {
      if (typeof imageId !== 'string' || entries[imageId]) continue;
      const image = getImageById(imageId);
      if (image) entries[imageId] = image;
    }
  }
  return entries;
};

// ----------------------------------------------------------------------
// The file store over a backend.
// ----------------------------------------------------------------------

export type ByokStorageUsage = {|
  totalBytes: number,
  imageBytes: number,
|};

export type ByokQuotaOutcome = {|
  evictedImageChatCount: number,
  evictedChatCount: number,
|};

export type ByokChatFileStore = {|
  /** The saved chats, most recently updated first (metadata only). */
  listChatMetas: () => Promise<Array<ByokChatFileMeta>>,
  /** Load a full chat (and re-register its images). Null when unknown. */
  loadChat: (chatId: string) => Promise<AiRequest | null>,
  /** Write a chat's file + image sidecar; returns the file name used. */
  saveChat: (chat: AiRequest) => Promise<string>,
  /** Archive or unarchive a saved chat. */
  setArchived: (chatId: string, archivedAt: string | null) => Promise<boolean>,
  /** Rename a saved chat (the file moves to the new name). */
  renameChat: (chatId: string, title: string) => Promise<boolean>,
  /** Explicit delete (archive is not delete). */
  deleteChat: (chatId: string) => Promise<boolean>,
  /** Total bytes used, split between transcripts and image sidecars. */
  getStorageUsage: () => Promise<ByokStorageUsage>,
  /**
   * Make the storage fit the cap: image sidecars of the oldest chats are
   * evicted first; whole chats only as the last resort.
   */
  enforceQuota: (capBytes: number) => Promise<ByokQuotaOutcome>,
|};

export const createByokChatFileStore = (
  backend: ByokChatFilesBackend,
  // Inexact on purpose: the real store hands back richer image infos.
  getImageById: (
    id: string
  ) => ?{
    dataUrl: string,
    width: number,
    height: number,
    approxTokens: number,
    ...
  }
): ByokChatFileStore => {
  /** All chat files, parsed; unreadable ones are quarantined and skipped. */
  const listChatFiles = async (): Promise<
    Array<{| fileName: string, chat: AiRequest |}>
  > => {
    const files = await backend.listFiles();
    const chatFiles: Array<{| fileName: string, chat: AiRequest |}> = [];
    for (const file of files) {
      if (!file.fileName.endsWith(CHAT_FILE_EXTENSION)) continue;
      if (file.fileName.startsWith(QUARANTINE_PREFIX)) continue;
      const content = await backend.readFile(file.fileName);
      if (content === null) continue;
      const chat = parseByokChatFromMarkdown(content);
      if (!chat) {
        // Quarantine: move aside, never block the list.
        await backend
          .moveFile(file.fileName, `${QUARANTINE_PREFIX}${file.fileName}`)
          .catch(() => {});
        continue;
      }
      chatFiles.push({ fileName: file.fileName, chat });
    }
    chatFiles.sort((a, b) => (a.chat.updatedAt < b.chat.updatedAt ? 1 : -1));
    return chatFiles;
  };

  const findChatFile = async (
    chatId: string
  ): Promise<{| fileName: string, chat: AiRequest |} | null> => {
    const chatFiles = await listChatFiles();
    return chatFiles.find(entry => entry.chat.id === chatId) || null;
  };

  return {
    listChatMetas: async (): Promise<Array<ByokChatFileMeta>> => {
      const chatFiles = await listChatFiles();
      return chatFiles.map(({ fileName, chat }) => ({
        id: chat.id,
        fileName,
        name: chat.title || makeByokChatName(chat),
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt,
        archivedAt: chat.archivedAt || null,
        messageCount: chat.output ? chat.output.length : 0,
      }));
    },

    loadChat: async (chatId: string): Promise<AiRequest | null> => {
      const chatFile = await findChatFile(chatId);
      if (!chatFile) return null;

      // The image sidecar (best-effort): restore the payloads under their
      // original ids so the transcript references resolve again.
      try {
        const imagesContent = await backend.readFile(
          imagesFileNameForChatId(chatId)
        );
        if (imagesContent) {
          const parsed = JSON.parse(imagesContent);
          if (parsed && typeof parsed === 'object' && parsed.images) {
            for (const imageId of Object.keys(parsed.images)) {
              restoreByokImage(parsed.images[imageId]);
            }
          }
        }
      } catch (error) {
        // Images stay unresolved (placeholder notes at replay); the
        // transcript itself is intact.
      }

      return chatFile.chat;
    },

    saveChat: async (chat: AiRequest): Promise<string> => {
      const chatFile = await findChatFile(chat.id);
      const chatName = makeByokChatName(chat);
      const desiredFileName = makeByokChatFileName(chatName);

      // The name carries the last-interaction date: a saved chat whose
      // name changed is moved to the new file name.
      if (chatFile && chatFile.fileName !== desiredFileName) {
        await backend
          .moveFile(chatFile.fileName, desiredFileName)
          .catch(() => {});
      }

      const content = serializeByokChatToMarkdown(chat);
      const imageEntries = collectByokChatImageEntries(chat, getImageById);
      await backend.writeFile(desiredFileName, content);
      if (Object.keys(imageEntries).length > 0) {
        await backend.writeFile(
          imagesFileNameForChatId(chat.id),
          JSON.stringify({ images: imageEntries })
        );
      }
      return desiredFileName;
    },

    setArchived: async (
      chatId: string,
      archivedAt: string | null
    ): Promise<boolean> => {
      const chatFile = await findChatFile(chatId);
      if (!chatFile) return false;
      const chat = chatFile.chat;
      chat.archivedAt = archivedAt;
      await backend.writeFile(
        chatFile.fileName,
        serializeByokChatToMarkdown(chat)
      );
      return true;
    },

    renameChat: async (chatId: string, title: string): Promise<boolean> => {
      const chatFile = await findChatFile(chatId);
      if (!chatFile) return false;
      const chat = chatFile.chat;
      chat.title = title;
      // The display name drives the file name: after retitling, the chat
      // moves (the first prompt is overridden by the explicit title).
      const desiredFileName = makeByokChatFileName(title);
      if (chatFile.fileName !== desiredFileName) {
        await backend
          .moveFile(chatFile.fileName, desiredFileName)
          .catch(() => {});
      }
      await backend.writeFile(
        desiredFileName,
        serializeByokChatToMarkdown(chat)
      );
      return true;
    },

    deleteChat: async (chatId: string): Promise<boolean> => {
      const chatFile = await findChatFile(chatId);
      if (!chatFile) return false;
      await backend.deleteFile(chatFile.fileName);
      await backend.deleteFile(imagesFileNameForChatId(chatId)).catch(() => {});
      return true;
    },

    getStorageUsage: async () => {
      const files = await backend.listFiles();
      let totalBytes = 0;
      let imageBytes = 0;
      for (const file of files) {
        totalBytes += file.sizeBytes;
        if (file.fileName.endsWith(IMAGES_FILE_SUFFIX)) {
          imageBytes += file.sizeBytes;
        }
      }
      return { totalBytes, imageBytes };
    },

    enforceQuota: async (capBytes: number) => {
      let evictedImageChatCount = 0;
      let evictedChatCount = 0;

      let totalBytes = await backend.getTotalBytes();
      if (totalBytes <= capBytes) {
        return { evictedImageChatCount, evictedChatCount };
      }

      // Oldest chats first (listChatFiles is newest first).
      const chatFiles = (await listChatFiles()).slice().reverse();
      for (const chatFile of chatFiles) {
        if (totalBytes <= capBytes) break;
        const imagesFile = imagesFileNameForChatId(chatFile.chat.id);
        const imagesContent = await backend.readFile(imagesFile);
        if (imagesContent === null) continue;
        const imagesBytes = imagesContent.length;
        await backend.deleteFile(imagesFile);
        totalBytes -= imagesBytes;
        evictedImageChatCount++;
      }

      // Still over with no image left: the oldest whole chats go (the
      // last resort — transcript text is lost only here).
      for (const chatFile of chatFiles) {
        totalBytes = await backend.getTotalBytes();
        if (totalBytes <= capBytes) break;
        await backend.deleteFile(chatFile.fileName);
        await backend
          .deleteFile(imagesFileNameForChatId(chatFile.chat.id))
          .catch(() => {});
        evictedChatCount++;
      }
      totalBytes = await backend.getTotalBytes();

      return { evictedImageChatCount, evictedChatCount };
    },
  };
};

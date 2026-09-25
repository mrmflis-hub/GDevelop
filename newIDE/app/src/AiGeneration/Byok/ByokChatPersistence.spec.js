// @flow
import type { AiRequest } from '../../Utils/GDevelopServices/Generation';
import {
  collectByokChatImageEntries,
  createByokChatFileStore,
  makeByokChatFileName,
  makeByokChatName,
  parseByokChatFromMarkdown,
  serializeByokChatToMarkdown,
} from './ByokChatPersistence';
import { registerByokImage } from './ByokImageContent';

/**
 * The durable history tests run on an in-memory implementation of the
 * backend contract — the exact shape the Electron IPC backend and the
 * IndexedDB backend implement.
 */
const makeMemoryBackend = (): any => {
  const raw: Map<string, string> = new Map();
  return {
    raw,
    listFiles: async () =>
      Array.from(raw.keys()).map((fileName: string) => ({
        fileName,
        sizeBytes: (raw.get(fileName) || '').length,
      })),
    readFile: async (fileName: string) =>
      raw.has(fileName) ? raw.get(fileName) : null,
    writeFile: async (fileName: string, content: string) => {
      raw.set(fileName, content);
    },
    deleteFile: async (fileName: string) => {
      raw.delete(fileName);
    },
    moveFile: async (fromFileName: string, toFileName: string) => {
      const content = raw.get(fromFileName);
      if (content === undefined) return;
      raw.delete(fromFileName);
      raw.set(toFileName, content);
    },
    getTotalBytes: async () =>
      Array.from(raw.values()).reduce(
        (total, content) => total + content.length,
        0
      ),
  };
};

const makeChat = (overrides?: Object): AiRequest => {
  const now = '2026-09-24T10:00:00.000Z';
  return {
    id: 'byok-test-chat',
    createdAt: now,
    updatedAt: now,
    userId: '',
    status: 'ready',
    mode: 'orchestrator',
    error: null,
    output: [
      {
        type: 'message',
        status: 'completed',
        role: 'user',
        content: [
          {
            type: 'user_request',
            status: 'completed',
            text: 'create a forest scene with tall trees',
          },
        ],
      },
      {
        type: 'message',
        status: 'completed',
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            status: 'completed',
            text: 'Scene created.',
            annotations: [],
          },
        ],
      },
    ],
    contextStats: null,
    ...overrides,
  };
};

describe('ByokChatPersistence: the Markdown codec', () => {
  it('round-trips a chat: create → serialize → parse → identical record', () => {
    const chat = makeChat();
    const serialized = serializeByokChatToMarkdown(chat);
    expect(serialized.startsWith('---')).toBe(true);

    const parsed = parseByokChatFromMarkdown(serialized);
    expect(parsed).not.toBe(null);
    expect(parsed && parsed.id).toBe(chat.id);
    expect(parsed && parsed.title).toContain('create a forest scene');
    expect(parsed && parsed.createdAt).toBe(chat.createdAt);
    expect(parsed && parsed.updatedAt).toBe(chat.updatedAt);
    expect(parsed && parsed.archivedAt).toBe(null);
    expect(parsed && parsed.output).toEqual(chat.output);
  });

  it('round-trips notice rows, tool outputs and image references', () => {
    const chat = makeChat({
      output: [
        {
          type: 'message',
          status: 'completed',
          role: 'user',
          content: [
            { type: 'user_request', status: 'completed', text: 'screenshot' },
          ],
        },
        {
          type: 'message',
          status: 'completed',
          role: 'assistant',
          content: [
            {
              type: 'function_call',
              status: 'completed',
              call_id: 'call-1',
              name: 'capture_scene_screenshot',
              arguments: '{}',
            },
          ],
        },
        {
          type: 'function_call_output',
          call_id: 'call-1',
          output: '{"success":true}',
          images: ['img-7'],
        },
        {
          type: 'byok_notice',
          status: 'completed',
          noticeKind: 'context-summarized',
          text: 'Context summarized: 4 message(s) condensed.',
        },
      ],
    });
    const parsed = parseByokChatFromMarkdown(serializeByokChatToMarkdown(chat));
    expect(parsed && parsed.output).toEqual(chat.output);
  });

  it('round-trips a message that quotes markdown fences itself', () => {
    const chat = makeChat({
      output: [
        {
          type: 'message',
          status: 'completed',
          role: 'assistant',
          content: [
            {
              type: 'output_text',
              status: 'completed',
              text: 'Use this:\n```json\n{"tool_calls": []}\n```',
              annotations: [],
            },
          ],
        },
      ],
    });
    const parsed = parseByokChatFromMarkdown(serializeByokChatToMarkdown(chat));
    expect(parsed && parsed.output).toEqual(chat.output);
  });

  it('round-trips an archived chat (archive survives restarts)', () => {
    const chat = makeChat({ archivedAt: '2026-09-25T08:00:00.000Z' });
    const parsed = parseByokChatFromMarkdown(serializeByokChatToMarkdown(chat));
    expect(parsed && parsed.archivedAt).toBe('2026-09-25T08:00:00.000Z');
  });

  it('returns null on garbage, missing front matter or broken messages (quarantine input)', () => {
    expect(parseByokChatFromMarkdown('not a chat file')).toBe(null);
    expect(parseByokChatFromMarkdown('---\nid: "x"\n---\nno body')).toBe(null);
    expect(
      parseByokChatFromMarkdown('---\n"syntax": "error\n---\n```json\n{}\n```')
    ).toBe(null);
    expect(
      parseByokChatFromMarkdown(
        '---\nschema: "1"\nid: "x"\nname: "n"\ncreatedAt: "c"\nupdatedAt: "u"\nmessageCount: 99\n---\n```json\n{"type":"message","role":"user","content":[]}\n```'
      )
    ).toBe(null);
  });

  it('rejects a messageCount mismatch (a truncated file never loads half a chat)', () => {
    const chat = makeChat();
    let serialized = serializeByokChatToMarkdown(chat);
    serialized = serialized.replace('messageCount: "2"', 'messageCount: "5"');
    expect(parseByokChatFromMarkdown(serialized)).toBe(null);
  });
});

describe('ByokChatPersistence: the naming convention', () => {
  it('uses the first 5 words of the first prompt + the last-interaction date', () => {
    const name = makeByokChatName(makeChat());
    // The first 5 words of the first prompt + the last-interaction date.
    expect(name).toBe('create a forest scene with_2026-09-24');
  });

  it('makes a file-system-safe file name', () => {
    expect(makeByokChatFileName('create a forest scene_2026-09-24')).toBe(
      'create-a-forest-scene_2026-09-24.md'
    );
    expect(makeByokChatFileName('a/b\\c:d*e?"f')).not.toMatch(/[/\\:*?"]/);
    expect(makeByokChatFileName('')).toBe('chat.md');
  });
});

describe('ByokChatPersistence: the file store', () => {
  it('saves and lists metas without loading the transcripts (lazy per chat)', async () => {
    const backend = makeMemoryBackend();
    const store = createByokChatFileStore(backend, () => null);
    await store.saveChat(makeChat());

    const metas = await store.listChatMetas();
    expect(metas).toHaveLength(1);
    expect(metas[0].messageCount).toBe(2);
    expect(metas[0].archivedAt).toBe(null);
    // The heavy transcript content never appears twice on disk.
    expect(backend.raw.size).toBe(1);
  });

  it('loads a chat back identically (round-trip through the store)', async () => {
    const backend = makeMemoryBackend();
    const store = createByokChatFileStore(backend, () => null);
    await store.saveChat(makeChat());

    const loaded = await store.loadChat('byok-test-chat');
    expect(loaded).not.toBe(null);
    expect(loaded && loaded.id).toBe('byok-test-chat');
    expect(loaded && loaded.output).toEqual(makeChat().output);
    expect(await store.loadChat('unknown')).toBe(null);
  });

  it('renames the file when the last-interaction date changes the name', async () => {
    const backend = makeMemoryBackend();
    const store = createByokChatFileStore(backend, () => null);
    await store.saveChat(makeChat());
    const firstName = (await store.listChatMetas())[0].fileName;

    const olderChat = makeChat({
      updatedAt: '2026-09-30T09:00:00.000Z',
    });
    await store.saveChat(olderChat);

    const metas = await store.listChatMetas();
    expect(metas).toHaveLength(1);
    expect(metas[0].fileName).not.toBe(firstName);
  });

  it('moves a corrupt file aside and never lets it block the list', async () => {
    const backend = makeMemoryBackend();
    const store = createByokChatFileStore(backend, () => null);
    await backend.writeFile('broken.md', 'total garbage');
    await store.saveChat(makeChat());

    const metas = await store.listChatMetas();
    expect(metas).toHaveLength(1);
    // The corrupt file was quarantined (moved aside, marked corrupt).
    const fileNames = Array.from(backend.raw.keys());
    expect(fileNames.some(fileName => fileName.startsWith('corrupt-'))).toBe(
      true
    );
    // Listing again does not re-include it.
    expect(await store.listChatMetas()).toHaveLength(1);
  });

  it('archives, restores and explicitly deletes saved chats', async () => {
    const backend = makeMemoryBackend();
    const store = createByokChatFileStore(backend, () => null);
    await store.saveChat(makeChat());

    expect(
      await store.setArchived('byok-test-chat', '2026-09-25T00:00:00.000Z')
    ).toBe(true);
    let metas = await store.listChatMetas();
    expect(metas[0].archivedAt).toBe('2026-09-25T00:00:00.000Z');

    expect(await store.setArchived('byok-test-chat', null)).toBe(true);
    metas = await store.listChatMetas();
    expect(metas[0].archivedAt).toBe(null);

    expect(await store.deleteChat('byok-test-chat')).toBe(true);
    expect(await store.listChatMetas()).toHaveLength(0);
    expect(await store.deleteChat('byok-test-chat')).toBe(false);
  });

  it('stores image payloads in a sidecar entry, never inline in the file', async () => {
    const image = registerByokImage({
      dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==',
      width: 64,
      height: 64,
    });
    const chat = makeChat({
      output: [
        {
          type: 'function_call_output',
          call_id: 'call-1',
          output: '{"success":true}',
          images: [image.id],
        },
      ],
    });

    const backend = makeMemoryBackend();
    const store = createByokChatFileStore(backend, () => image);
    await store.saveChat(chat);

    const chatFileContent = Array.from(backend.raw.entries()).find(
      ([fileName]) => fileName.endsWith('.md')
    );
    expect(chatFileContent && chatFileContent[1].includes(image.dataUrl)).toBe(
      false
    );
    const sidecar = Array.from(backend.raw.entries()).find(([fileName]) =>
      fileName.endsWith('.images.json')
    );
    expect(sidecar).toBeTruthy();

    // The loaded chat re-registers the image under its original id.
    const loaded = await store.loadChat('byok-test-chat');
    expect(loaded).not.toBe(null);
  });

  it('collects only the image entries the transcript references', () => {
    const image = registerByokImage({
      dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==',
      width: 64,
      height: 64,
    });
    const chat = makeChat({
      output: [
        {
          type: 'function_call_output',
          call_id: 'call-1',
          output: '{}',
          images: [image.id, 'missing-image-id'],
        },
      ],
    });
    const entries = collectByokChatImageEntries(chat, (id: string) =>
      id === image.id ? (image: any) : null
    );
    expect(Object.keys(entries)).toEqual([image.id]);
  });

  it('collects the images attached to user messages too (Phase 13.3)', () => {
    const toolImage = registerByokImage({
      dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==',
      width: 64,
      height: 64,
    });
    const attachedImage = registerByokImage({
      dataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
      width: 32,
      height: 32,
    });
    const chat = makeChat({
      output: [
        {
          type: 'message',
          status: 'completed',
          role: 'user',
          content: [
            { type: 'user_request', status: 'completed', text: 'See this' },
          ],
          images: [attachedImage.id],
        },
        {
          type: 'function_call_output',
          call_id: 'call-1',
          output: '{}',
          images: [toolImage.id],
        },
      ],
    });
    const registry: any = {
      [toolImage.id]: toolImage,
      [attachedImage.id]: attachedImage,
    };
    const entries = collectByokChatImageEntries(
      chat,
      (id: string) => registry[id] || null
    );
    expect(Object.keys(entries).sort()).toEqual(
      [toolImage.id, attachedImage.id].sort()
    );
  });

  it('enforces the quota: image sidecars of the oldest chats evicted first', async () => {
    const backend = makeMemoryBackend();
    const store = createByokChatFileStore(backend, () => null);

    // Three small chats, each with a fat image sidecar; the newest chat
    // carries the transcript bulk.
    for (let index = 0; index < 3; index++) {
      const chat = makeChat({
        id: `byok-chat-${index}`,
        updatedAt: `2026-09-2${index}T10:00:00.000Z`,
        output: [
          {
            type: 'message',
            status: 'completed',
            role: 'user',
            content: [{ type: 'user_request', status: 'completed', text: 'x' }],
          },
        ],
      });
      await store.saveChat(chat);
      await backend.writeFile(
        `byok-chat-${index}.images.json`,
        JSON.stringify({ images: { [`img-${index}`]: 'x'.repeat(1000) } })
      );
    }

    const usageBefore = await store.getStorageUsage();
    expect(usageBefore.imageBytes).toBeGreaterThan(3000);

    // A cap that fits the transcripts but not all the sidecars.
    const transcriptBytes = usageBefore.totalBytes - usageBefore.imageBytes;
    const {
      evictedImageChatCount,
      evictedChatCount,
    } = await store.enforceQuota(transcriptBytes + 1500);
    expect(evictedImageChatCount).toBeGreaterThanOrEqual(2);
    expect(evictedChatCount).toBe(0);

    // The oldest sidecar went first.
    expect(backend.raw.has('byok-chat-0.images.json')).toBe(false);
    // Every transcript survived ("images before any transcript text").
    const metas = await store.listChatMetas();
    expect(metas).toHaveLength(3);
  });

  it('evicts whole chats only as the last resort (no images left to drop)', async () => {
    const backend = makeMemoryBackend();
    const store = createByokChatFileStore(backend, () => null);
    for (let index = 0; index < 2; index++) {
      await store.saveChat(
        makeChat({
          id: `byok-big-${index}`,
          updatedAt: `2026-09-2${index}T10:00:00.000Z`,
        })
      );
    }
    const usage = await store.getStorageUsage();
    // A cap the newer chat alone satisfies: evicting the oldest chat (the
    // sizes are equal) lands clearly under it, so exactly one chat goes.
    const {
      evictedImageChatCount,
      evictedChatCount,
    } = await store.enforceQuota(Math.floor(usage.totalBytes * 0.75));
    expect(evictedImageChatCount).toBe(0);
    expect(evictedChatCount).toBe(1);
    const remaining = await store.listChatMetas();
    expect(remaining).toHaveLength(1);
    // The OLDEST chat was evicted.
    expect(remaining[0].id).toBe('byok-big-1');
  });
});

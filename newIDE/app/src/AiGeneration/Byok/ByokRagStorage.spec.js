// @flow
import {
  BYOK_RAG_QDRANT_COLLECTION,
  createByokRagInProcessStore,
  createByokRagQdrantFetchTransport,
  createByokRagQdrantStore,
  type ByokRagFilesBackend,
  type ByokRagQdrantTransport,
} from './Rag/ByokRagStorage';
import { serializeByokRagIndex } from './Rag/ByokRagIndex';
import { makeByokHashingEmbedderForTests } from './Rag/ByokRagEmbedder';

const makeMemoryBackend = (): ByokRagFilesBackend & {
  files: Map<string, string>,
} => {
  const files: Map<string, string> = new Map();
  return ({
    files,
    writeFile: async (fileName: string, content: string) => {
      files.set(fileName, content);
    },
    readFile: async (fileName: string) => files.get(fileName) || null,
    deleteFile: async (fileName: string) => {
      files.delete(fileName);
    },
  }: any);
};

const makeTestIndex = async () => {
  const embedder = makeByokHashingEmbedderForTests(16);
  const chunks = [
    {
      id: 'docs:0:0',
      source: 'docs',
      title: 'Timer events',
      tags: ['docs'],
      text: 'Timers count time in seconds.',
    },
    {
      id: 'example:0:0',
      source: 'example',
      title: 'Timer spawn',
      tags: ['example'],
      text: 'if Timer(2, "SpawnTimer"):',
    },
  ];
  const vectors = await embedder.embed(chunks.map(chunk => chunk.text));
  return serializeByokRagIndex({
    manifest: {
      schemaVersion: 1,
      embedderId: 'hashing-test-embedder',
      corpusHash: 'abc123',
      chunkCount: chunks.length,
      backend: 'in-process',
      builtAt: '2026-09-25T00:00:00.000Z',
    },
    chunks,
    vectors,
  });
};

describe('createByokRagInProcessStore (the storage contract: in-process)', () => {
  it('saves, loads and clears an index', async () => {
    const backend = makeMemoryBackend();
    const store = createByokRagInProcessStore(backend);
    expect(store.kind).toBe('in-process');
    expect(await store.loadIndex()).toBe(null);

    const serialized = await makeTestIndex();
    await store.saveIndex(serialized);
    const loaded = await store.loadIndex();
    if (!loaded) throw new Error('expected a loaded index');
    expect(loaded.manifest.corpusHash).toBe('abc123');
    expect(loaded.chunks.length).toBe(2);

    await store.clear();
    expect(await store.loadIndex()).toBe(null);
  });

  it('survives corrupted stored data (loads null, never throws)', async () => {
    const backend = makeMemoryBackend();
    backend.files.set('index.json', '{not json');
    const store = createByokRagInProcessStore(backend);
    await expect(store.loadIndex()).resolves.toBe(null);
  });
});

const makeRecordingTransport = (): {|
  transport: ByokRagQdrantTransport,
  requests: Array<{| method: string, path: string, body?: any |}>,
  respondWith: (handler: (request: any) => any) => void,
|} => {
  const requests: Array<{| method: string, path: string, body?: any |}> = [];
  let handler = (request: any) => ({ result: {} });
  return {
    requests,
    respondWith: nextHandler => {
      handler = nextHandler;
    },
    transport: {
      request: async (method, path, body) => {
        requests.push({ method, path, body });
        return handler({ method, path, body });
      },
    },
  };
};

describe('createByokRagQdrantStore (the storage contract: Qdrant)', () => {
  it('creates the collection then upserts the points with their payloads', async () => {
    const { transport, requests } = makeRecordingTransport();
    const store = createByokRagQdrantStore({ transport });
    expect(store.kind).toBe('qdrant');

    const serialized = await makeTestIndex();
    await store.saveIndex(serialized);

    const putCollection: any = requests.find(
      request =>
        request.method === 'PUT' &&
        request.path === `/collections/${BYOK_RAG_QDRANT_COLLECTION}`
    );
    expect(putCollection).toBeTruthy();
    expect(putCollection.body.vectors.distance).toBe('Cosine');

    const upsert: any = requests.find(
      request =>
        request.method === 'PUT' &&
        request.path.startsWith(
          `/collections/${BYOK_RAG_QDRANT_COLLECTION}/points`
        )
    );
    expect(upsert).toBeTruthy();
    expect(upsert.body.points.length).toBe(2);
    expect(upsert.body.points[0].payload.id).toBe('docs:0:0');
    expect(upsert.body.points[0].vector.length).toBeGreaterThan(0);
    // Qdrant point ids are unsigned integers (the chunk id is in the payload).
    expect(Number.isInteger(upsert.body.points[0].id)).toBe(true);
  });

  it('skips the collection creation when it already exists', async () => {
    const { transport, requests, respondWith } = makeRecordingTransport();
    respondWith(() => ({
      result: {
        config: { params: { vectors: { size: 16, distance: 'Cosine' } } },
      },
    }));
    const store = createByokRagQdrantStore({ transport });
    await store.saveIndex(await makeTestIndex());
    expect(
      requests.some(
        request =>
          request.method === 'PUT' &&
          request.path === `/collections/${BYOK_RAG_QDRANT_COLLECTION}` &&
          request.body !== undefined
      )
    ).toBe(false);
  });

  it('clears by deleting the collection', async () => {
    const { transport, requests } = makeRecordingTransport();
    const store = createByokRagQdrantStore({ transport });
    await store.clear();
    expect(
      requests.some(
        request =>
          request.method === 'DELETE' &&
          request.path === `/collections/${BYOK_RAG_QDRANT_COLLECTION}`
      )
    ).toBe(true);
  });
});

describe('createByokRagQdrantFetchTransport', () => {
  it('speaks REST over the loopback origin and throws on HTTP errors', async () => {
    const calls: Array<any> = [];
    const fetchImpl = jest.fn(async (url: string, options: any) => {
      calls.push({ url, options });
      return { ok: true, status: 200, json: async () => ({ result: true }) };
    });
    const transport = createByokRagQdrantFetchTransport(
      'http://127.0.0.1:6333/',
      (fetchImpl: any)
    );
    const response = await transport.request('GET', '/collections', undefined);
    expect(response).toEqual({ result: true });
    expect(calls[0].url).toBe('http://127.0.0.1:6333/collections');
    expect(calls[0].options.body).toBe(undefined);
    expect(calls[0].options.method).toBe('GET');

    const failing = jest.fn(async () => ({
      ok: false,
      status: 500,
      statusText: 'boom',
    }));
    const failingTransport = createByokRagQdrantFetchTransport(
      'http://127.0.0.1:6333',
      (failing: any)
    );
    await expect(
      failingTransport.request('PUT', '/collections/x', { a: 1 })
    ).rejects.toThrow('500');
  });
});

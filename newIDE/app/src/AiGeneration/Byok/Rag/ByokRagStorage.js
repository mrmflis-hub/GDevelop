// @flow
import { type ByokRagChunk, type ByokRagManifest } from './ByokRagTypes';
import {
  type ByokRagSerializedIndex,
  deserializeByokRagIndex,
} from './ByokRagIndex';
import { validateByokRagBundleEnvelope } from './ByokRagBundle';

/**
 * The RAG index storage (Phase 13.7/13.8): one interface, two
 * implementations — the in-process file index under `<userData>/byok-rag/`
 * (desktop IPC / IndexedDB on web) and a Qdrant collection over loopback
 * REST. Switching backends triggers a rebuild/upload; the manifest records
 * which backend built the index.
 */

/** The minimal byte-level backend the in-process store persists through. */
export type ByokRagFilesBackend = {|
  writeFile: (fileName: string, content: string) => Promise<void>,
  readFile: (fileName: string) => Promise<string | null>,
  deleteFile: (fileName: string) => Promise<void>,
|};

export type ByokRagStoredIndex = {|
  manifest: ByokRagManifest,
  chunks: Array<ByokRagChunk>,
  vectors: Array<Float32Array>,
|};

export type ByokRagStore = {|
  kind: 'in-process' | 'qdrant',
  saveIndex: (index: ByokRagSerializedIndex) => Promise<void>,
  loadIndex: () => Promise<?ByokRagStoredIndex>,
  clear: () => Promise<void>,
|};

/**
 * Import a prebuilt bundle (Phase 14.4, D14-3): validate the envelope
 * (again — the Electron main verified the sha256, this is the defense in
 * depth the untrusted-data rule demands), deserialize the index, persist
 * it through the store exactly like a local build would. Returns the
 * chunk count, or a refusal with the reason — a bad bundle NEVER writes.
 */
export const importByokRagBundleIntoStore = async (
  store: ByokRagStore,
  rawBundle: any
): Promise<
  {| ok: true, chunkCount: number |} | {| ok: false, error: string |}
> => {
  const validation = validateByokRagBundleEnvelope(rawBundle);
  if (!validation.ok) return { ok: false, error: validation.error };
  const bundle = validation.bundle;
  const deserialized = deserializeByokRagIndex(bundle.index);
  if (!deserialized) {
    return {
      ok: false,
      error: 'The bundled index payload is malformed — rebuild locally.',
    };
  }
  if (deserialized.chunks.length === 0) {
    return {
      ok: false,
      error: 'The bundled index is empty — rebuild locally.',
    };
  }
  try {
    await store.saveIndex(bundle.index);
  } catch (error) {
    return {
      ok: false,
      error: `The imported index could not be saved: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
  return { ok: true, chunkCount: deserialized.chunks.length };
};

const INDEX_FILE_NAME = 'index.json';

/** The in-process store: the serialized index in one file. */
export const createByokRagInProcessStore = (
  backend: ByokRagFilesBackend
): ByokRagStore => ({
  kind: 'in-process',
  saveIndex: async index => {
    await backend.writeFile(INDEX_FILE_NAME, JSON.stringify(index));
  },
  loadIndex: async () => {
    const content = await backend.readFile(INDEX_FILE_NAME);
    if (!content) return null;
    try {
      const deserialized = deserializeByokRagIndex(JSON.parse(content));
      if (!deserialized) return null;
      return deserialized;
    } catch (error) {
      return null;
    }
  },
  clear: async () => {
    await backend.deleteFile(INDEX_FILE_NAME);
  },
});

/**
 * The Qdrant store (13.8): the same chunk schema as a Qdrant collection
 * (`gdevelop-byok`), over the loopback REST API. The transport is injected
 * (tests mock it; the real one is browser fetch to 127.0.0.1).
 *
 * Qdrant point ids must be unsigned integers: the chunk's DETERMINISTIC
 * POSITION in the corpus is used directly (a hash of the string id
 * collides at ~0.2% birthday odds for 4k chunks, and a collision silently
 * overwrites one chunk with another via upsert — audit011026 B-RAG-13);
 * the original id travels in the payload.
 */
export const BYOK_RAG_QDRANT_COLLECTION = 'gdevelop-byok';

const chunkIndexToPointId = (chunkIndex: number): number => chunkIndex + 1;

export type ByokRagQdrantTransport = {|
  request: (method: string, path: string, body?: any) => Promise<any>,
|};

export const createByokRagQdrantStore = (options: {|
  transport: ByokRagQdrantTransport,
  collection?: string,
|}): ByokRagStore => {
  const collection = options.collection || BYOK_RAG_QDRANT_COLLECTION;
  const transport = options.transport;

  const ensureCollection = async (dimensions: number) => {
    const response = await transport.request(
      'GET',
      `/collections/${collection}`
    );
    const existingSize =
      response &&
      response.result &&
      response.result.config &&
      response.result.config.params &&
      response.result.config.params.vectors &&
      typeof response.result.config.params.vectors.size === 'number'
        ? response.result.config.params.vectors.size
        : null;
    if (existingSize === dimensions) return;
    if (existingSize !== null) {
      // A collection created with the wrong dimensionality (the historical
      // double-converted base64 math, audit011026 B-RAG-2) rejects every
      // upsert with 400 — forever, because "exists" skipped recreation.
      // Drop it and recreate with the right size.
      await transport.request('DELETE', `/collections/${collection}`);
    }
    await transport.request('PUT', `/collections/${collection}`, {
      vectors: { size: dimensions, distance: 'Cosine' },
    });
  };

  return {
    kind: 'qdrant',
    saveIndex: async index => {
      // atob(...).length is ALREADY the decoded byte count (float32 = 4
      // bytes per dimension) — the historical "* 3 / 4" applied the
      // base64 conversion a second time and created 3/4-sized
      // collections (audit011026 B-RAG-2).
      const dimensions =
        index.vectorsBase64.length > 0
          ? Math.floor(atob(index.vectorsBase64[0]).length / 4)
          : 384;
      await ensureCollection(dimensions);
      const points = index.chunks.map((chunk, chunkIndex) => ({
        id: chunkIndexToPointId(chunkIndex),
        vector: decodeVectorBase64(index.vectorsBase64[chunkIndex]),
        payload: {
          id: chunk.id,
          source: chunk.source,
          title: chunk.title,
          tags: chunk.tags,
          text: chunk.text,
        },
      }));
      // Upsert in batches: Qdrant's default request cap is generous, the
      // corpus is a few thousand points — 256 per request is safe.
      const BATCH = 256;
      for (let start = 0; start < points.length; start += BATCH) {
        // eslint-disable-next-line no-await-in-loop
        await transport.request(
          'PUT',
          `/collections/${collection}/points?wait=true`,
          { points: points.slice(start, start + BATCH) }
        );
      }
    },
    loadIndex: async () => {
      // The Qdrant backend does not reload a local index: the manifest is
      // kept locally (through the injected manifest backend of the host)
      // and the search goes straight to the server. Rebuilding always
      // re-uploads; reading everything back would just move the corpus.
      return null;
    },
    clear: async () => {
      await transport.request('DELETE', `/collections/${collection}`);
    },
  };
};

const decodeVectorBase64 = (text: string): Array<number> => {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return Array.from(new Float32Array(bytes.buffer));
};

/**
 * A loopback transport over fetch: `request` is the single place the
 * Qdrant REST API is spoken.
 */
export const createByokRagQdrantFetchTransport = (
  baseUrl: string,
  fetchImpl: (url: string, options: any) => Promise<any>
): ByokRagQdrantTransport => ({
  request: async (method, path, body) => {
    const response = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(
        `Qdrant ${method} ${path} failed: ${response.status} ${
          response.statusText
        }`
      );
    }
    return response.status === 204 ? null : response.json();
  },
});

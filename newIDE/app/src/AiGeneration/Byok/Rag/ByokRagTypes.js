// @flow

/**
 * The on-device RAG types and settings (Phase 13.7/13.8): the corpus
 * chunks, the index manifest, the embedder catalog and the preferences
 * blob (`byokRag` — kept out of the `byok` settings so the BYOK blob stays
 * stable). Privacy invariant D13-9: embeddings, corpus and vectors stay on
 * the machine; the only network calls are the one-time embedder download
 * (consented) and the optional Qdrant binary download.
 */

/** One retrievable chunk of the corpus. */
export type ByokRagChunk = {|
  /** Stable id: `<source>:<n>` — the model uses it to read neighbors. */
  id: string,
  /** Corpus origin: engine-reference | docs | skill | example | user-docs. */
  source: string,
  /** Human title (the entry name, the page title, the skill name…). */
  title: string,
  /** Kind/tag filter facets (e.g. action, condition, timer, spawn). */
  tags: Array<string>,
  /** The retrievable text. */
  text: string,
|};

/** The manifest of a built index (determinism: same corpus → same hash). */
export type ByokRagManifest = {|
  schemaVersion: number,
  embedderId: string,
  /** A stable hash of the corpus chunks (ids + texts). */
  corpusHash: string,
  chunkCount: number,
  backend: 'in-process' | 'qdrant',
  builtAt: string,
|};

/**
 * A curated embedder of the picker (D13-1): the bundled default is a
 * MiniLM-class ONNX model (≈25 MB, CPU/WASM); the alternatives trade a
 * bigger download for better recall.
 */
export type ByokRagEmbedderInfo = {|
  id: string,
  label: string,
  /** The approximate download size, shown with explicit consent (D13-9). */
  approximateDownloadMegabytes: number,
  dimensions: number,
  languageNote: string,
|};

export const BYOK_RAG_EMBEDDERS: Array<ByokRagEmbedderInfo> = [
  {
    id: 'Xenova/all-MiniLM-L6-v2',
    label: 'MiniLM L6 v2 (bundled default — small and fast)',
    approximateDownloadMegabytes: 25,
    dimensions: 384,
    languageNote: 'English-centric',
  },
  {
    id: 'Xenova/bge-small-en-v1.5',
    label: 'BGE small en v1.5 (better recall, bigger download)',
    approximateDownloadMegabytes: 90,
    dimensions: 384,
    languageNote: 'English',
  },
];

export const BYOK_RAG_DEFAULT_EMBEDDER_ID = 'Xenova/all-MiniLM-L6-v2';

export const getByokRagEmbedderInfo = (id: string): ?ByokRagEmbedderInfo =>
  BYOK_RAG_EMBEDDERS.find(embedder => embedder.id === id) || null;

/** The RAG preferences blob (a top-level `byokRag` preferences key). */
export type ByokRagSettings = {|
  enabled: boolean,
  embedderId: string,
  backend: 'in-process' | 'qdrant',
  /** Opt-in extra corpus: a local documentation folder (desktop). */
  docsFolderPath: string,
  /** The Qdrant loopback origin when the backend is Qdrant. */
  qdrantBaseUrl: string,
|};

export const DEFAULT_BYOK_RAG_SETTINGS: ByokRagSettings = {
  enabled: false,
  embedderId: BYOK_RAG_DEFAULT_EMBEDDER_ID,
  backend: 'in-process',
  docsFolderPath: '',
  qdrantBaseUrl: 'http://127.0.0.1:6333',
};

/**
 * Read the RAG settings defensively (they come back from localStorage as
 * untrusted data): every field is merged over the defaults.
 */
export const getByokRagSettings = (values: {
  +byokRag?: ?ByokRagSettings,
  ...
}): ByokRagSettings => {
  const rag = values.byokRag;
  if (!rag || typeof rag !== 'object') {
    return { ...DEFAULT_BYOK_RAG_SETTINGS };
  }
  return {
    enabled: rag.enabled === true,
    embedderId:
      typeof rag.embedderId === 'string' && rag.embedderId
        ? rag.embedderId
        : DEFAULT_BYOK_RAG_SETTINGS.embedderId,
    backend: rag.backend === 'qdrant' ? 'qdrant' : 'in-process',
    docsFolderPath:
      typeof rag.docsFolderPath === 'string' ? rag.docsFolderPath : '',
    qdrantBaseUrl:
      typeof rag.qdrantBaseUrl === 'string' && rag.qdrantBaseUrl
        ? rag.qdrantBaseUrl
        : DEFAULT_BYOK_RAG_SETTINGS.qdrantBaseUrl,
  };
};

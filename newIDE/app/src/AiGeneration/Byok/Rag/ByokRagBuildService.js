// @flow
import { type ByokRagSettings } from './ByokRagTypes';
import {
  buildByokRagIndex,
  isByokRagIndexUpToDate,
  serializeByokRagIndex,
  type ByokRagIndexProgress,
} from './ByokRagIndex';
import { loadByokRagEmbedder } from './ByokRagEmbedder';
import {
  createByokRagInProcessStore,
  createByokRagQdrantFetchTransport,
  createByokRagQdrantStore,
  type ByokRagStore,
} from './ByokRagStorage';
import { createByokRagFilesBackendForPlatform } from './ByokRagFileBackends';
import { setByokRagRuntime } from './ByokRagSearch';

/**
 * The RAG build/enable service (Phase 13.7/13.8): what the RAG settings
 * tab and the app-start hook drive. Everything heavy (the embedder import,
 * the corpus build) happens HERE, on enable — the app startup and the
 * RAG-off path never import any of it (the lazy-load guarantee).
 */

export type ByokRagBuildProgress = {|
  stage: 'embedding' | 'uploading' | 'done',
  progress: number,
|};

export type ByokRagBuildOutcome =
  | {| ok: true, chunkCount: number |}
  | {| ok: false, error: string |};

/** The store of the settings: in-process files, or Qdrant over loopback. */
const makeStoreForSettings = (settings: ByokRagSettings): ?ByokRagStore => {
  if (settings.backend === 'qdrant') {
    const fetchImpl: any = typeof window !== 'undefined' ? window.fetch : null;
    if (!fetchImpl) return null;
    return createByokRagQdrantStore({
      transport: createByokRagQdrantFetchTransport(
        settings.qdrantBaseUrl,
        fetchImpl
      ),
    });
  }
  const backend = createByokRagFilesBackendForPlatform();
  if (!backend) return null;
  return createByokRagInProcessStore(backend);
};

/**
 * Build (or rebuild) the index of the current settings and install it as
 * the live search runtime. The embedder download happens here (the consent
 * UI ran before — D13-9). A failure is a clean outcome, never a throw: RAG
 * falls back to the lexical search.
 */
export const rebuildByokRagIndex = async (options: {|
  settings: ByokRagSettings,
  onProgress?: (progress: ByokRagBuildProgress) => void,
|}): Promise<ByokRagBuildOutcome> => {
  const { settings } = options;
  const embedderResult = await loadByokRagEmbedder(settings.embedderId);
  if (!embedderResult.ok) {
    return { ok: false, error: embedderResult.error };
  }
  const embedder = embedderResult.embedder;

  const store = makeStoreForSettings(settings);
  if (!store) {
    return {
      ok: false,
      error:
        'The index could not be stored on this platform (no file backend).',
    };
  }

  const index = await buildByokRagIndex({
    embedderId: settings.embedderId,
    embed: embedder.embed,
    docsFolderPath: settings.docsFolderPath || undefined,
    docsFolderReader: settings.docsFolderPath
      ? await makeDocsFolderReader()
      : undefined,
    backend: settings.backend,
    onProgress: (progress: ByokRagIndexProgress) => {
      if (options.onProgress) {
        options.onProgress({
          stage: 'embedding',
          progress: progress.progress,
        });
      }
    },
  });

  if (options.onProgress) {
    options.onProgress({ stage: 'uploading', progress: 1 });
  }
  try {
    await store.saveIndex(serializeByokRagIndex(index));
  } catch (error) {
    return {
      ok: false,
      error: `The index could not be saved: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  setByokRagRuntime({
    settings,
    index,
    embedder,
  });
  if (options.onProgress) {
    options.onProgress({ stage: 'done', progress: 1 });
  }
  return { ok: true, chunkCount: index.chunks.length };
};

/**
 * Load a persisted in-process index (if any, and up to date) into the live
 * runtime — the app-start path when RAG is enabled. Returns null when
 * there is nothing to load (the tab offers a build).
 */
export const loadPersistedByokRagIndex = async (
  settings: ByokRagSettings
): Promise<?{| chunkCount: number |}> => {
  if (settings.backend !== 'in-process') return null;
  const store = makeStoreForSettings(settings);
  if (!store) return null;
  const stored = await store.loadIndex();
  if (!stored) return null;
  if (!isByokRagIndexUpToDate(stored, settings.embedderId)) {
    // A different embedder was used: the vectors are meaningless — rebuild.
    return null;
  }
  const embedderResult = await loadByokRagEmbedder(settings.embedderId);
  if (!embedderResult.ok) return null;
  setByokRagRuntime({
    settings,
    index: stored,
    embedder: embedderResult.embedder,
  });
  return { chunkCount: stored.chunks.length };
};

/** The docs-folder reader of the desktop build (injected in the tests). */
const makeDocsFolderReader = async (): Promise<any> => {
  const optionalRequire = require('../../../Utils/OptionalRequire').default;
  const fs = optionalRequire('fs');
  const path = optionalRequire('path');
  const electron = optionalRequire('electron');
  const remote = electron ? electron.remote : null;
  if (!fs || !path || !remote) {
    return {
      listMarkdownFiles: async () => [],
      readFile: async () => '',
    };
  }
  return {
    listMarkdownFiles: async (folderPath: string) => {
      const walk = (folder: string): Array<string> => {
        try {
          const entries = fs.readdirSync(folder, { withFileTypes: true });
          const files: Array<string> = [];
          for (const entry of entries) {
            const entryPath = path.join(folder, entry.name);
            if (entry.isDirectory()) {
              files.push(...walk(entryPath));
            } else if (entry.name.toLowerCase().endsWith('.md')) {
              files.push(entryPath);
            }
          }
          return files;
        } catch (error) {
          return [];
        }
      };
      return walk(folderPath);
    },
    readFile: async (filePath: string) => fs.readFileSync(filePath, 'utf8'),
  };
};

/** Read the persisted index metadata for the status card (no loading). */
export const readByokRagIndexStatus = async (
  settings: ByokRagSettings
): Promise<?{|
  chunkCount: number,
  corpusHash: string,
  builtAt: string,
  embedderId: string,
|}> => {
  if (settings.backend !== 'in-process') return null;
  const store = makeStoreForSettings(settings);
  if (!store) return null;
  const stored = await store.loadIndex();
  if (!stored) return null;
  return {
    chunkCount: stored.manifest.chunkCount,
    corpusHash: stored.manifest.corpusHash,
    builtAt: stored.manifest.builtAt,
    embedderId: stored.manifest.embedderId,
  };
};

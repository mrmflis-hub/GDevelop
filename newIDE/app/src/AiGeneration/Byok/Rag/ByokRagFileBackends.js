// @flow
import optionalRequire from '../../../Utils/OptionalRequire';
import type { ByokRagFilesBackend } from './ByokRagStorage';

const electron = optionalRequire('electron');
const ipcRenderer = electron ? electron.ipcRenderer : null;

/**
 * The RAG platform backends (Phase 13.7/13.8): the desktop app persists the
 * in-process index through the `byok-rag-*` IPC channels (files under
 * `<userData>/byok-rag/`, see electron-app/app/ByokRagFiles.js); the web
 * build falls back to IndexedDB (same shape as the chat files backend); an
 * environment with neither stays in-memory (the index rebuilds).

 * The Qdrant control IPC (setup/status) bridges live here too — the
 * settings tab is their only consumer.
 */
export const createByokRagIpcFilesBackend = (): ByokRagFilesBackend => {
  if (!ipcRenderer) throw new Error('The desktop IPC is not available.');
  const invoke = async (
    channel: string,
    fileName: string,
    content?: string
  ): Promise<{| ok: boolean, data: ?string, error?: string |}> => {
    // $FlowFixMe[extra-arg] - invoke passes the args through.
    return await ipcRenderer.invoke(channel, fileName, content);
  };
  return {
    writeFile: async (fileName, contentToWrite) => {
      const result = await invoke('byok-rag-write', fileName, contentToWrite);
      if (!result.ok) {
        throw new Error(result.error || 'The RAG index could not be saved.');
      }
    },
    readFile: async fileName => {
      const result = await invoke('byok-rag-read', fileName);
      if (!result.ok) return null;
      return typeof result.data === 'string' ? result.data : null;
    },
    deleteFile: async fileName => {
      const result = await invoke('byok-rag-delete', fileName);
      if (!result.ok) {
        throw new Error(result.error || 'The RAG index could not be deleted.');
      }
    },
  };
};

const BYOK_RAG_IDB_NAME = 'gd-byok-rag-files';
const BYOK_RAG_IDB_STORE = 'files';

const openByokRagIdb = (): Promise<any> =>
  new Promise((resolve, reject) => {
    const idb: any =
      typeof window !== 'undefined' ? (window: any).indexedDB : null;
    if (!idb) {
      reject(new Error('IndexedDB is not available.'));
      return;
    }
    const request = idb.open(BYOK_RAG_IDB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(BYOK_RAG_IDB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error('IndexedDB error'));
  });

export const createByokRagIdbFilesBackend = (): ByokRagFilesBackend => {
  const withStore = async (
    mode: string,
    run: (store: any) => any
  ): Promise<any> => {
    const database: any = await openByokRagIdb();
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(BYOK_RAG_IDB_STORE, mode);
      const request = run(transaction.objectStore(BYOK_RAG_IDB_STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => database.close();
    });
  };
  return {
    writeFile: async (fileName, content) => {
      await withStore('readwrite', store => store.put(content, fileName));
    },
    readFile: async fileName => {
      const content = await withStore('readonly', store => store.get(fileName));
      return typeof content === 'string' ? content : null;
    },
    deleteFile: async fileName => {
      await withStore('readwrite', store => store.delete(fileName));
    },
  };
};

/** The platform picker: desktop IPC → IndexedDB → null (in-memory). */
export const createByokRagFilesBackendForPlatform = (): ?ByokRagFilesBackend => {
  if (ipcRenderer) {
    try {
      return createByokRagIpcFilesBackend();
    } catch (error) {
      return null;
    }
  }
  if (typeof window !== 'undefined' && (window: any).indexedDB) {
    try {
      return createByokRagIdbFilesBackend();
    } catch (error) {
      return null;
    }
  }
  return null;
};

// --- The Qdrant control IPC bridges ----------------------------------------

export type ByokQdrantSetupOutcome = {|
  ok: boolean,
  mode?: 'used-existing' | 'installed',
  baseUrl?: string,
  port?: number,
  stage?: string,
  error?: string,
|};

export const invokeByokQdrantSetup = async (): Promise<ByokQdrantSetupOutcome> => {
  if (!ipcRenderer) {
    return {
      ok: false,
      stage: 'downloading',
      error: 'Qdrant management needs the desktop app.',
    };
  }
  return await ipcRenderer.invoke('byok-qdrant-setup');
};

export type ByokQdrantStatus = {|
  installed: boolean,
  healthy: boolean,
  baseUrl: string | null,
|};

export const invokeByokQdrantStatus = async (): Promise<?ByokQdrantStatus> => {
  if (!ipcRenderer) return null;
  return await ipcRenderer.invoke('byok-qdrant-status');
};

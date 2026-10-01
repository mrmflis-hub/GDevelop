// @flow
import {
  getByokRagSearchDepsAsync,
  resetByokRagPersistedLoadForTests,
  searchByokRagKnowledge,
  setByokRagRuntime,
  setByokRagSettingsProvider,
} from './ByokRagSearch';

// The lazy persisted-index recovery requires the build service: mocked so
// the test observes the call without touching storages.
jest.mock('./ByokRagBuildService', () => ({
  loadPersistedByokRagIndex: jest.fn(),
}));

describe('ByokRagSearch: audit011026 fixes', () => {
  afterEach(() => {
    setByokRagRuntime(null);
    setByokRagSettingsProvider(null);
    resetByokRagPersistedLoadForTests();
  });

  it('B-RAG-1: lazily loads the persisted index when RAG is enabled', async () => {
    const { loadPersistedByokRagIndex } = jest.requireMock(
      './ByokRagBuildService'
    );
    loadPersistedByokRagIndex.mockResolvedValue({ chunkCount: 42 });
    setByokRagSettingsProvider(
      () =>
        ({
          enabled: true,
          backend: 'in-process',
          embedderId: 'x',
          docsFolderPath: '',
          qdrantBaseUrl: '',
        }: any)
    );
    await getByokRagSearchDepsAsync();
    expect(loadPersistedByokRagIndex).toHaveBeenCalled();
  });

  it('B-RAG-1: does not attempt the load when RAG is disabled', async () => {
    const { loadPersistedByokRagIndex } = jest.requireMock(
      './ByokRagBuildService'
    );
    setByokRagSettingsProvider(
      () =>
        ({
          enabled: false,
          backend: 'in-process',
          embedderId: 'x',
          docsFolderPath: '',
          qdrantBaseUrl: '',
        }: any)
    );
    await getByokRagSearchDepsAsync();
    expect(loadPersistedByokRagIndex).not.toHaveBeenCalled();
  });

  it('B-RAG-18: a bare chunk_id neighbor read works without an index (lexical corpus)', async () => {
    const chunks = [
      { id: 'docs:0:0', source: 'docs', title: 'A', text: 'first', tags: [] },
      { id: 'docs:0:1', source: 'docs', title: 'B', text: 'second', tags: [] },
      { id: 'docs:0:2', source: 'docs', title: 'C', text: 'third', tags: [] },
    ];
    const result = await searchByokRagKnowledge({
      query: '',
      nearChunkId: 'docs:0:1',
      deps: { index: null, embedder: null, lexicalChunks: (chunks: any) },
    });
    expect(result.success).toBe(true);
    expect(result.mode).toBe('lexical');
    expect(result.hits.map(hit => hit.chunk.id)).toEqual([
      'docs:0:0',
      'docs:0:1',
      'docs:0:2',
    ]);
  });
});

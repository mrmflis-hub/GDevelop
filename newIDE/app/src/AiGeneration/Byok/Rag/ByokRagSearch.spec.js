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
  it('A1002-RAG-1: answers semantically with NO local index (the Qdrant backend)', async () => {
    // The Qdrant backend keeps no local index, so `index: null` is the
    // production shape after a restart. Before the fix the semantic path
    // required a local index and every Qdrant query silently degraded to
    // lexical while the settings card reported a healthy index.
    const remoteHit = {
      chunk: {
        id: 'docs:3:1',
        source: 'docs',
        title: 'Collision masks',
        text: 'A sprite collision mask.',
        tags: ['docs'],
      },
      score: 0.9,
      match: 'vector',
    };
    const qdrantSearch = jest.fn(async () => [remoteHit]);
    const embedder: any = {
      embed: async () => [new Float32Array([0.1, 0.2, 0.3])],
    };
    const result = await searchByokRagKnowledge({
      query: 'collision masks',
      deps: {
        index: null,
        embedder,
        lexicalChunks: ([
          {
            id: 'docs:0:0',
            source: 'docs',
            title: 'Unrelated',
            text: 'nothing here',
            tags: [],
          },
        ]: any),
        qdrantSearch: (qdrantSearch: any),
      },
    });
    expect(result.success).toBe(true);
    expect(result.mode).not.toBe('lexical');
    expect(qdrantSearch).toHaveBeenCalled();
    expect(result.hits.map(hit => hit.chunk.id)).toContain('docs:3:1');
  });

  it('A1002-RAG-5: a query whose wording differs by one word still returns hits', async () => {
    // RAG is off by default, so lexical is the mode most users are in. An
    // AND-only match returned NOTHING for a paraphrase although the chunk
    // was right there (the tool answered success with zero hits).
    const chunks = [
      {
        id: 'docs:0:0',
        source: 'docs',
        title: 'Sprite animation',
        text: 'Set the animation speed of the sprite.',
        tags: [],
      },
      {
        id: 'docs:0:1',
        source: 'docs',
        title: 'Unrelated',
        text: 'Scenes contain objects.',
        tags: [],
      },
    ];
    const result = await searchByokRagKnowledge({
      // "animations" does not appear; "animation" does.
      query: 'change animations speed',
      deps: { index: null, embedder: null, lexicalChunks: (chunks: any) },
    });
    expect(result.success).toBe(true);
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits[0].chunk.id).toBe('docs:0:0');
  });

  it('A1002-RAG-5: a full match still outranks a partial one', async () => {
    const chunks = [
      {
        id: 'docs:0:0',
        source: 'docs',
        title: 'Scenes',
        text: 'A scene holds objects and events.',
        tags: [],
      },
      {
        id: 'docs:0:1',
        source: 'docs',
        title: 'Sprite animation',
        text: 'Animation is unrelated to scenes.',
        tags: [],
      },
    ];
    const result = await searchByokRagKnowledge({
      query: 'scene objects',
      deps: { index: null, embedder: null, lexicalChunks: (chunks: any) },
    });
    expect(result.hits[0].chunk.id).toBe('docs:0:0');
  });
});

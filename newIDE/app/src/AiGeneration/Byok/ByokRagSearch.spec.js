// @flow
import { buildByokRagIndex } from './Rag/ByokRagIndex';
import { makeByokHashingEmbedderForTests } from './Rag/ByokRagEmbedder';
import {
  getByokRagNeighborChunks,
  searchByokRagChunksLexically,
  searchByokRagKnowledge,
  type ByokRagSearchDeps,
} from './Rag/ByokRagSearch';
import { type ByokRagChunk } from './Rag/ByokRagTypes';

const makeChunks = (): Array<ByokRagChunk> => [
  {
    id: 'docs:0:0',
    source: 'docs',
    title: 'Timer events',
    tags: ['docs', 'timer'],
    text: 'Timers count time in seconds and fire when they reach their value.',
  },
  {
    id: 'docs:0:1',
    source: 'docs',
    title: 'Timer events',
    tags: ['docs', 'timer'],
    text: 'Reset a timer to start it over with ResetTimer.',
  },
  {
    id: 'docs:0:2',
    source: 'docs',
    title: 'Timer events',
    tags: ['docs', 'timer'],
    text: 'The end of the timer page.',
  },
  {
    id: 'example:0:0',
    source: 'example',
    title: 'Spawning on a timer',
    tags: ['example', 'timer', 'spawn'],
    text: 'if Timer(2, "SpawnTimer") and once: Create(Rock, ...)',
  },
  {
    id: 'engine-reference:0:0',
    source: 'engine-reference',
    title: 'PlaySound',
    tags: ['action', 'BuiltinAudio'],
    text: 'action PlaySound (BuiltinAudio) — Play a sound.',
  },
];

describe('searchByokRagChunksLexically (the RAG-off fallback)', () => {
  it('scores title hits above body hits and caps the results', () => {
    const hits = searchByokRagChunksLexically(makeChunks(), 'timer', 3);
    expect(hits.length).toBe(3);
    expect(hits.every(hit => hit.match === 'exact')).toBe(true);
    expect(hits[0].score).toBeGreaterThanOrEqual(hits[1].score);

    expect(searchByokRagChunksLexically(makeChunks(), 'zzz')).toEqual([]);
    expect(searchByokRagChunksLexically(makeChunks(), '  ')).toEqual([]);
  });

  it('requires every term of a multi-word query to hit somewhere', () => {
    const hits = searchByokRagChunksLexically(makeChunks(), 'play sound', 5);
    expect(hits.map(hit => hit.chunk.title)).toContain('PlaySound');
    expect(
      searchByokRagChunksLexically(makeChunks(), 'play zzzword', 5)
    ).toEqual([]);
  });
});

describe('getByokRagNeighborChunks (the read-around-a-hit path)', () => {
  it('returns the surrounding chunks of the same document', () => {
    const neighbors = getByokRagNeighborChunks(makeChunks(), 'docs:0:1', 1);
    expect(neighbors.map(chunk => chunk.id)).toEqual([
      'docs:0:0',
      'docs:0:1',
      'docs:0:2',
    ]);
    // The window never crosses into another document (the anchor itself
    // stays in the result — reading around includes where you are).
    expect(
      getByokRagNeighborChunks(makeChunks(), 'docs:0:0', 2).map(c => c.id)
    ).toEqual(['docs:0:0', 'docs:0:1', 'docs:0:2']);
    expect(
      getByokRagNeighborChunks(makeChunks(), 'example:0:0', 5).map(c => c.id)
    ).toEqual(['example:0:0']);
    expect(getByokRagNeighborChunks(makeChunks(), 'unknown:1:1')).toEqual([]);
  });
});

describe('searchByokRagKnowledge', () => {
  it('answers lexically (RAG off: corpus only, no embedder) with an explicit mode', async () => {
    const result = await searchByokRagKnowledge({
      query: 'timer',
      deps: { index: null, embedder: null, lexicalChunks: makeChunks() },
    });
    expect(result.mode).toBe('lexical');
    expect(result.success).toBe(true);
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.message).toContain('exact-text search');
  });

  it('merges exact and vector hits without duplicates (hybrid mode)', async () => {
    const embedder = makeByokHashingEmbedderForTests(64);
    const chunks = makeChunks();
    const vectors = await embedder.embed(
      chunks.map(chunk => `${chunk.title}\n${chunk.text}`)
    );
    const deps: ByokRagSearchDeps = {
      index: {
        manifest: {
          schemaVersion: 1,
          embedderId: embedder.id,
          corpusHash: 'x',
          chunkCount: chunks.length,
          backend: 'in-process',
          builtAt: new Date().toISOString(),
        },
        chunks,
        vectors,
      },
      embedder,
    };
    const result = await searchByokRagKnowledge({ query: 'timer spawn', deps });
    expect(result.mode).toBe('hybrid');
    const ids = result.hits.map(hit => hit.chunk.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(result.hits.some(hit => hit.match === 'exact')).toBe(true);
  });

  it('filters by kind and tags, and reads around a chunk by id', async () => {
    const embedder = makeByokHashingEmbedderForTests(64);
    const chunks = makeChunks();
    const vectors = await embedder.embed(
      chunks.map(chunk => `${chunk.title}\n${chunk.text}`)
    );
    const deps: ByokRagSearchDeps = {
      index: {
        manifest: {
          schemaVersion: 1,
          embedderId: embedder.id,
          corpusHash: 'x',
          chunkCount: chunks.length,
          backend: 'in-process',
          builtAt: new Date().toISOString(),
        },
        chunks,
        vectors,
      },
      embedder,
    };
    const onlyDocs = await searchByokRagKnowledge({
      query: 'timer',
      kind: 'docs',
      deps,
    });
    expect(onlyDocs.hits.every(hit => hit.chunk.source === 'docs')).toBe(true);

    const neighbors = await searchByokRagKnowledge({
      query: '',
      nearChunkId: 'docs:0:1',
      deps,
    });
    expect(neighbors.success).toBe(true);
    expect(neighbors.hits.map(hit => hit.chunk.id)).toContain('docs:0:0');

    const empty = await searchByokRagKnowledge({ query: '', deps });
    expect(empty.success).toBe(false);
  });
});

describe('the search_knowledge eval set (top-3 hit rate, on-device)', () => {
  const EXPECTED_QUERIES: Array<{|
    query: string,
    expectedSource: string,
    expectedHint?: string,
  |}> = [
    {
      query: 'collision variable increment score',
      expectedSource: 'example',
      expectedHint: 'Collision',
    },
    {
      query: 'timer spawn create objects',
      expectedSource: 'example',
      expectedHint: 'Timer',
    },
    {
      query: 'switch to another scene menu',
      expectedSource: 'example',
      expectedHint: 'Scene',
    },
    {
      query: 'play a sound effect',
      expectedSource: 'engine-reference',
      expectedHint: 'PlaySound',
    },
    {
      query: 'play music',
      expectedSource: 'engine-reference',
      expectedHint: 'PlayMusic',
    },
    { query: 'camera position', expectedSource: 'engine-reference' },
    { query: 'for each child structure variable', expectedSource: 'example' },
    { query: 'repeat loop group events', expectedSource: 'example' },
    { query: 'change animation speed', expectedSource: 'example' },
    { query: 'save system checkpoints storage', expectedSource: 'skill' },
    { query: 'platformer character jump', expectedSource: 'skill' },
    { query: 'physics gravity forces', expectedSource: 'skill' },
    { query: 'expression lerp', expectedSource: 'engine-reference' },
    { query: 'expression clamp values', expectedSource: 'engine-reference' },
    { query: 'asynchronous events', expectedSource: 'docs' },
    { query: 'while events loop', expectedSource: 'docs' },
    { query: 'object picking conditions', expectedSource: 'docs' },
    { query: 'javascript code events', expectedSource: 'docs' },
    { query: 'callback variables', expectedSource: 'docs' },
    { query: 'trigger once shooting space key', expectedSource: 'example' },
    { query: 'time delta frame rate movement', expectedSource: 'example' },
    { query: 'hud score display menus', expectedSource: 'skill' },
    { query: 'puzzle grid game', expectedSource: 'skill' },
    { query: 'top down shooter enemies', expectedSource: 'skill' },
  ];

  it('returns the expected source in the top 3 for at least 70% of the eval queries', async () => {
    const embedder = makeByokHashingEmbedderForTests(128);
    const index = await buildByokRagIndex({
      embedderId: embedder.id,
      embed: embedder.embed,
    });
    const deps: ByokRagSearchDeps = { index, embedder };

    const misses: Array<string> = [];
    for (const expected of EXPECTED_QUERIES) {
      // eslint-disable-next-line no-await-in-loop
      const result = await searchByokRagKnowledge({
        query: expected.query,
        deps,
        limit: 3,
      });
      const isHit = result.hits.some(hit => {
        const sourceMatches = hit.chunk.source === expected.expectedSource;
        const hintMatches =
          !expected.expectedHint ||
          hit.chunk.text.includes(expected.expectedHint) ||
          hit.chunk.title.includes((expected.expectedHint: any));
        return sourceMatches && hintMatches;
      });
      if (!isHit) misses.push(expected.query);
    }
    const hitRate = 1 - misses.length / EXPECTED_QUERIES.length;
    // The hit-rate threshold of the phase: meaningful retrieval quality
    // even with the deterministic test embedder (the real MiniLM does
    // better); a regression below it fails loudly.
    if (hitRate < 0.7) {
      throw new Error(
        `search_knowledge eval hit rate ${(hitRate * 100).toFixed(
          0
        )}% — misses: ${misses.join(' | ')}`
      );
    }
  }, 240000);
});

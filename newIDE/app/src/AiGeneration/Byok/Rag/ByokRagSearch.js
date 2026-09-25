// @flow
import { type ByokRagChunk, type ByokRagSettings } from './ByokRagTypes';
import { type ByokRagIndex, searchByokRagIndex } from './ByokRagIndex';
import { type ByokRagEmbedder } from './ByokRagEmbedder';

/**
 * The `search_knowledge` engine (Phase 13.7): hybrid retrieval over the
 * on-device corpus — tag/exact hits first, vector top-k second — and the
 * neighbor read (the model asks for the chunks around a hit by id). With
 * RAG off (or the embedder unavailable) it degrades to the tag/exact
 * search: grep-like, still fully on-device.
 */

export type ByokRagSearchHit = {|
  chunk: ByokRagChunk,
  score: number,
  /** Where the hit came from: an exact/tag match or the vector search. */
  match: 'exact' | 'vector',
|};

export type ByokRagSearchResult = {|
  success: boolean,
  message: string,
  hits: Array<ByokRagSearchHit>,
  mode: 'hybrid' | 'lexical',
|};

/**
 * The lexical half: substring scoring over the title, the tags and the text
 * (title 100, tags 80, text 40; multi-word queries need every term to hit
 * somewhere). Pure.
 */
export const searchByokRagChunksLexically = (
  chunks: Array<ByokRagChunk>,
  query: string,
  resultLimit: number = 5
): Array<ByokRagSearchHit> => {
  const trimmedQuery = query.trim().toLowerCase();
  if (!trimmedQuery) return [];
  const terms = trimmedQuery.split(/\s+/).filter(Boolean);

  const hits: Array<ByokRagSearchHit> = [];
  for (const chunk of chunks) {
    const title = chunk.title.toLowerCase();
    const text = chunk.text.toLowerCase();
    const tags = chunk.tags.map(tag => tag.toLowerCase()).join(' ');
    // AND semantics: every term must hit somewhere in the chunk — a
    // grep-style fallback must be precise, not recall-oriented.
    let matchedTerms = 0;
    for (const term of terms) {
      if (title.includes(term)) matchedTerms++;
      else if (tags.includes(term)) matchedTerms++;
      else if (text.includes(term)) matchedTerms++;
    }
    if (matchedTerms !== terms.length) continue;
    const score = 40 + (terms.length > 1 ? 20 : 0);
    hits.push({ chunk, score, match: 'exact' });
  }
  hits.sort((a, b) => b.score - a.score || (a.chunk.id < b.chunk.id ? -1 : 1));
  return hits.slice(0, resultLimit);
};

/**
 * The neighbors of a chunk: the chunks with the same source document
 * (id prefix `source:documentIndex:`) within ±window positions — the
 * "read around this hit" path of the tool.
 */
export const getByokRagNeighborChunks = (
  chunks: Array<ByokRagChunk>,
  chunkId: string,
  window: number = 2
): Array<ByokRagChunk> => {
  const position = chunks.findIndex(chunk => chunk.id === chunkId);
  if (position === -1) return [];
  const documentPrefix = chunkId
    .split(':')
    .slice(0, 2)
    .join(':');
  const neighbors: Array<ByokRagChunk> = [];
  for (
    let index = Math.max(0, position - window);
    index <= Math.min(chunks.length - 1, position + window);
    index++
  ) {
    if (chunks[index].id.startsWith(documentPrefix)) {
      neighbors.push(chunks[index]);
    }
  }
  return neighbors;
};

/** Everything the search needs at call time. */
export type ByokRagSearchDeps = {|
  index: ?ByokRagIndex,
  embedder: ?ByokRagEmbedder,
  /** The bare corpus for the lexical (RAG-off) mode — no vectors needed. */
  lexicalChunks?: ?Array<ByokRagChunk>,
  /** The Qdrant vector search when the backend is Qdrant. */
  qdrantSearch?: ?(
    queryVector: Float32Array,
    limit: number
  ) => Promise<Array<ByokRagSearchHit>>,
|};

/**
 * The hybrid search: exact/tag hits first, then the vector top-k (merged,
 * duplicates removed, exact hits kept ahead). Falls back to lexical when
 * there is no embedder or no index (RAG off — the tool still answers).
 */
export const searchByokRagKnowledge = async (options: {|
  query: string,
  tags?: ?Array<string>,
  kind?: ?string,
  nearChunkId?: ?string,
  limit?: number,
  deps: ByokRagSearchDeps,
|}): Promise<ByokRagSearchResult> => {
  const limit = options.limit || 5;
  const index = options.deps.index;

  // The neighbor read needs no query at all.
  const nearChunkId = options.nearChunkId || null;
  if (nearChunkId && index) {
    const neighbors = getByokRagNeighborChunks(index.chunks, nearChunkId);
    return {
      success: true,
      message:
        neighbors.length > 0
          ? `The chunks around "${nearChunkId}".`
          : `No chunk "${nearChunkId}" in the index — search first, then read around a hit.`,
      hits: neighbors.map(chunk => ({ chunk, score: 1, match: 'exact' })),
      mode: 'hybrid',
    };
  }

  const query = (options.query || '').trim();
  if (!query) {
    return {
      success: false,
      message: 'The "query" is required (or a chunk_id to read around).',
      hits: [],
      mode: index ? 'hybrid' : 'lexical',
    };
  }

  const pool = index
    ? index.chunks
    : options.deps.lexicalChunks
    ? options.deps.lexicalChunks
    : [];
  const matchesTagFilter = (chunk: ByokRagChunk): boolean => {
    if (options.kind && chunk.source !== options.kind) return false;
    if (options.tags && options.tags.length > 0) {
      const wanted = options.tags.map(tag => tag.toLowerCase());
      return chunk.tags.some(tag => wanted.includes(tag.toLowerCase()));
    }
    return true;
  };
  const filteredPool = pool.filter(matchesTagFilter);

  const exactHits = searchByokRagChunksLexically(filteredPool, query, limit);

  // RAG off (no index or no embedder): the lexical mode.
  if (!index || !options.deps.embedder) {
    return {
      success: true,
      message:
        'Semantic search is off — this is an exact-text search over the corpus. Enable and build the index in Preferences > RAG for semantic ranking.',
      hits: exactHits,
      mode: 'lexical',
    };
  }

  const queryVector = (await options.deps.embedder.embed([query]))[0];
  const vectorHits: Array<ByokRagSearchHit> = [];

  if (options.deps.qdrantSearch) {
    const remoteHits = await options.deps.qdrantSearch(queryVector, limit * 2);
    vectorHits.push(
      ...remoteHits.filter(hit => matchesTagFilter(hit.chunk)).slice(0, limit)
    );
  } else {
    const indexHits = searchByokRagIndex(index, queryVector, limit * 2);
    for (const hit of indexHits) {
      if (!matchesTagFilter(hit.chunk)) continue;
      vectorHits.push({ chunk: hit.chunk, score: hit.score, match: 'vector' });
      if (vectorHits.length >= limit) break;
    }
  }

  // Merge: exact first, then the vector hits that are not already present.
  const seenIds = new Set(exactHits.map(hit => hit.chunk.id));
  const merged = [...exactHits];
  for (const hit of vectorHits) {
    if (seenIds.has(hit.chunk.id)) continue;
    seenIds.add(hit.chunk.id);
    merged.push(hit);
  }
  return {
    success: true,
    message: `${
      merged.length
    } chunk(s) for "${query}" (exact + semantic). Read around a hit with chunk_id.`,
    hits: merged.slice(0, limit),
    mode: 'hybrid',
  };
};

// --- The runtime holder ------------------------------------------------------
// The loaded index + embedder of this session: built by the RAG settings
// tab, read by the search_knowledge tool. Nothing here is imported at app
// startup — the embedder module is only imported when RAG is enabled.

type ByokRagRuntime = {|
  settings: ByokRagSettings,
  index: ?ByokRagIndex,
  embedder: ?ByokRagEmbedder,
|};

let runtime: ?ByokRagRuntime = null;

/** What the build service installs as the live search runtime. */
export type ByokRagRuntimeInput = {|
  settings?: ByokRagSettings,
  index?: ?ByokRagIndex,
  embedder?: ?ByokRagEmbedder,
|};

/** Install the live search runtime (the build service; the tests). */
export const setByokRagRuntime = (next: ?ByokRagRuntimeInput): void => {
  runtime = next
    ? {
        settings: next.settings || (({}: any): ByokRagSettings),
        index: next.index || null,
        embedder: next.embedder || null,
      }
    : null;
};

/** The deps the search_knowledge tool passes (null runtime → lexical). */
export const getByokRagSearchDeps = (): ByokRagSearchDeps => ({
  index: runtime ? runtime.index : null,
  embedder: runtime ? runtime.embedder : null,
});

let lexicalCorpusCache: ?Array<ByokRagChunk> = null;

/**
 * The corpus without vectors, cached: the lexical (RAG-off) mode of the
 * search_knowledge tool greps this — built once per session, on the first
 * tool call, so the app startup and the RAG-off path never pay for it.
 */
export const ensureByokRagLexicalCorpus = async (): Promise<
  Array<ByokRagChunk>
> => {
  if (lexicalCorpusCache) return lexicalCorpusCache;
  const { buildByokRagCorpus } = require('./ByokRagCorpus');
  lexicalCorpusCache = await buildByokRagCorpus({});
  return lexicalCorpusCache;
};

/** Forget the cached lexical corpus (tests). */
export const resetByokRagLexicalCorpusForTests = (): void => {
  lexicalCorpusCache = null;
};

/**
 * The deps of the search_knowledge tool: the built index when RAG is on,
 * the bare corpus otherwise (the tool always answers, on-device).
 */
export const getByokRagSearchDepsAsync = async (): Promise<ByokRagSearchDeps> => {
  if (runtime && runtime.index) {
    return {
      index: runtime.index,
      embedder: runtime.embedder,
    };
  }
  return {
    index: null,
    embedder: null,
    lexicalChunks: await ensureByokRagLexicalCorpus(),
  };
};

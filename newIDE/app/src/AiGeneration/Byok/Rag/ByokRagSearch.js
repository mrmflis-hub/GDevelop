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
 * The lexical half: AND-semantics over the query terms (every term must
 * hit somewhere), scored by WHERE each term hit — title (3) above tags (2)
 * above body text (1) — and multiplied by the source weight, so a curated
 * chunk whose TITLE names the query outranks a minified-wiki chunk that
 * merely contains all the words in prose. Pure.
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
    let score = 0;
    let matchedAllTerms = true;
    for (const term of terms) {
      if (title.includes(term)) score += 3;
      else if (tags.includes(term)) score += 2;
      else if (text.includes(term)) score += 1;
      else {
        matchedAllTerms = false;
        break;
      }
    }
    if (!matchedAllTerms) continue;
    hits.push({
      chunk,
      score: score * getByokRagSourceWeight(chunk.source),
      match: 'exact',
    });
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
 * The per-source ranking weights of the vector half (Phase 14.2): the
 * whole minified wiki joined the corpus (~1.5k prose chunks), and with the
 * hashing test embedder generic wiki prose started outscoring the exact
 * engine/example/skill chunks the queries were about (long chunks simply
 * overlap more terms). The weights keep every chunk reachable — a genuinely
 * better wiki match still wins — while the curated tiers stay on top for
 * near-equal similarity. The exact/lexical half is unaffected.
 */
export const BYOK_RAG_SOURCE_WEIGHTS: { [string]: number } = {
  'engine-reference': 1.25,
  example: 1.25,
  skill: 1.25,
  docs: 1.1,
  'docs-min': 0.8,
  'docs-min-map': 0.7,
  'user-docs': 1,
};

export const getByokRagSourceWeight = (source: string): number =>
  BYOK_RAG_SOURCE_WEIGHTS[source] || 1;

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

  // A wider candidate pool than the result limit: the source weights below
  // re-rank it, so the pre-weight top-k must not already be all one source.
  const candidateLimit = Math.max(limit * 4, 24);
  let vectorCandidates: Array<ByokRagSearchHit> = [];
  if (options.deps.qdrantSearch) {
    const remoteHits = await options.deps.qdrantSearch(
      queryVector,
      candidateLimit
    );
    vectorCandidates = remoteHits.filter(hit => matchesTagFilter(hit.chunk));
  } else {
    vectorCandidates = searchByokRagIndex(index, queryVector, candidateLimit)
      .filter(hit => matchesTagFilter(hit.chunk))
      .map(hit => ({ chunk: hit.chunk, score: hit.score, match: 'vector' }));
  }
  const vectorHits = vectorCandidates
    .map(hit => ({
      ...hit,
      score: hit.score * getByokRagSourceWeight(hit.chunk.source),
    }))
    .sort((a, b) => b.score - a.score || (a.chunk.id < b.chunk.id ? -1 : 1))
    .slice(0, limit);

  // Merge on the shared scale (both halves are source-weighted now): a
  // title-matching exact hit scores ~3+ per term, a strong vector match
  // ≤ ~1.25, so exact evidence leads without starving the vector half the
  // way the pre-14.2 fixed "exact block first" order did once the whole
  // wiki joined the corpus.
  const merged = [...exactHits, ...vectorHits]
    .filter(
      (hit, position, all) =>
        all.findIndex(other => other.chunk.id === hit.chunk.id) === position
    )
    .sort((a, b) => b.score - a.score || (a.chunk.id < b.chunk.id ? -1 : 1))
    .slice(0, limit);
  return {
    success: true,
    message: `${
      merged.length
    } chunk(s) for "${query}" (exact + semantic). Read around a hit with chunk_id.`,
    hits: merged,
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

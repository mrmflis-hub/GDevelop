// @flow
import {
  BYOK_RAG_CHUNK_OVERLAP_TOKENS,
  BYOK_RAG_CHUNK_TARGET_TOKENS,
  buildByokRagCorpus,
  buildByokRagExampleChunks,
  buildByokRagUserDocsChunks,
  chunkByokRagText,
  type ByokRagDocsFolderReader,
} from './Rag/ByokRagCorpus';

describe('chunkByokRagText (Phase 13.7 chunking)', () => {
  it('returns short texts as a single chunk', () => {
    expect(chunkByokRagText('Short text.')).toEqual(['Short text.']);
    expect(chunkByokRagText('   ')).toEqual([]);
  });

  it('chunks long texts on paragraph boundaries with overlap', () => {
    const paragraphs = [];
    for (let index = 0; index < 30; index++) {
      paragraphs.push(`Paragraph ${index}: ${'x'.repeat(300)}`);
    }
    const chunks = chunkByokRagText(paragraphs.join('\n\n'));
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      // Chunks stay near the target (a hair above it with the overlap).
      expect(chunk.length).toBeLessThanOrEqual(
        (BYOK_RAG_CHUNK_TARGET_TOKENS + BYOK_RAG_CHUNK_OVERLAP_TOKENS) * 4 + 16
      );
    }
    // The overlap carries the tail of the previous chunk.
    expect(chunks[1].slice(0, 20)).toContain('x');
  });

  it('hard-splits paragraphs without sentence boundaries', () => {
    const chunks = chunkByokRagText('y'.repeat(5000));
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].length).toBeLessThanOrEqual(
      BYOK_RAG_CHUNK_TARGET_TOKENS * 4
    );
  });

  it('is deterministic', () => {
    const text = Array.from(
      { length: 20 },
      (_, i) => `P${i}. One. Two. Three.`
    ).join('\n\n');
    expect(chunkByokRagText(text)).toEqual(chunkByokRagText(text));
  });
});

describe('the corpus builders', () => {
  it('builds the engine-reference chunks from the real catalog', () => {
    const {
      buildByokRagEngineReferenceChunks,
    } = require('./Rag/ByokRagCorpus');
    const chunks = buildByokRagEngineReferenceChunks();
    expect(chunks.length).toBeGreaterThan(1000);
    expect(chunks[0].source).toBe('engine-reference');
    expect(chunks.some(chunk => chunk.title === 'PlaySound')).toBe(true);
  });

  it('builds the docs, example and skill chunks', () => {
    const { buildByokRagDocsChunks } = require('./Rag/ByokRagCorpus');
    const docsChunks = buildByokRagDocsChunks();
    expect(docsChunks.length).toBeGreaterThan(10);
    expect(docsChunks.every(chunk => chunk.source === 'docs')).toBe(true);

    const exampleChunks = buildByokRagExampleChunks();
    expect(exampleChunks.length).toBeGreaterThanOrEqual(10);
    expect(exampleChunks.some(chunk => chunk.title.includes('timer'))).toBe(
      true
    );
  });

  it('builds the whole corpus in a stable order', async () => {
    const corpusA = await buildByokRagCorpus({});
    const corpusB = await buildByokRagCorpus({});
    expect(corpusA.length).toBeGreaterThan(1000);
    expect(corpusA.map(chunk => chunk.id)).toEqual(
      corpusB.map(chunk => chunk.id)
    );
    const sources = new Set(corpusA.map(chunk => chunk.source));
    expect(Array.from(sources).sort()).toEqual([
      'docs',
      'engine-reference',
      'example',
      'skill',
    ]);
  });

  it('indexes the opt-in local docs folder through the injected reader', async () => {
    const reader: ByokRagDocsFolderReader = {
      listMarkdownFiles: async () => ['C:/docs/a.md', 'C:/docs/b.md'],
      readFile: async (filePath: string) =>
        filePath.endsWith('a.md') ? 'Doc A content here.' : '',
    };
    const chunks = await buildByokRagUserDocsChunks('C:/docs', reader);
    expect(chunks.length).toBe(1);
    expect(chunks[0].source).toBe('user-docs');
    expect(chunks[0].title).toBe('a.md');

    // An unreadable folder contributes nothing, without throwing.
    const failing: ByokRagDocsFolderReader = {
      listMarkdownFiles: async () => {
        throw new Error('gone');
      },
      readFile: async () => '',
    };
    expect(await buildByokRagUserDocsChunks('C:/gone', failing)).toEqual([]);

    // No folder configured: no chunks, no reader call.
    expect(await buildByokRagUserDocsChunks('', reader)).toEqual([]);
  });
});

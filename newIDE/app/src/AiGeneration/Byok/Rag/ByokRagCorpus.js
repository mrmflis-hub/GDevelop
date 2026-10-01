// @flow
import { getByokEventScriptExamples } from '../ByokEventScriptExamples';
import { getByokSkills } from '../ByokSkills';
import { listByokBundledDocPages, readBundledByokDocPage } from '../ByokDocs';
import {
  listByokMinifiedDocCategories,
  getByokMinifiedDocPagesOfCategory,
  getByokMinifiedDocPages,
} from '../ByokMinifiedDocs';
import { getByokEngineReferenceEntries } from '../ByokEngineReference';
import { type ByokRagChunk } from './ByokRagTypes';

/**
 * The RAG corpus builder (Phase 13.7): the on-device corpora we already
 * bundle — the generated engine reference, the bundled docs pages, the
 * skills, the curated EventScript examples — plus the opt-in local
 * documentation folder (D13-1), chunked by section (~400 tokens, small
 * overlap). Pure over its inputs: the file readers are injected so the
 * tests (and the web build) never touch the disk.
 */

/** The target size of one chunk, in estimated tokens (chars/4). */
export const BYOK_RAG_CHUNK_TARGET_TOKENS = 400;

/** How much of the previous chunk trails into the next one. */
export const BYOK_RAG_CHUNK_OVERLAP_TOKENS = 50;

/**
 * Split a text into overlapping chunks of ~BYOK_RAG_CHUNK_TARGET_TOKENS:
 * on paragraph boundaries when possible, on sentence boundaries otherwise,
 * hard-split as the last resort. Fenced code blocks are atomic units — a
 * blank line or a sentence break inside ``` fences never splits a block
 * across chunks (audit011026 B-RAG-14; the shipped corpora never hit it,
 * the opt-in user-docs folder does). Pure and deterministic.
 */
export const chunkByokRagText = (
  text: string,
  targetTokens: number = BYOK_RAG_CHUNK_TARGET_TOKENS,
  overlapTokens: number = BYOK_RAG_CHUNK_OVERLAP_TOKENS
): Array<string> => {
  const cleanText = text.replace(/\r\n/g, '\n').trim();
  if (!cleanText) return [];

  const targetChars = targetTokens * 4;
  const overlapChars = Math.min(
    overlapTokens * 4,
    Math.max(0, targetChars - 1)
  );
  if (cleanText.length <= targetChars) return [cleanText];

  // The top-level segmentation: a fenced block (``` or ~~~ to its closer)
  // is one segment; the prose between fences is another.
  const splitOnFences = (input: string): Array<string> => {
    const segments: Array<string> = [];
    let currentSegment: Array<string> = [];
    let insideFence = false;
    for (const line of input.split('\n')) {
      const isFenceMarker = /^\s*(```|~~~)/.test(line);
      if (!isFenceMarker) {
        currentSegment.push(line);
        continue;
      }
      if (insideFence) {
        currentSegment.push(line);
        segments.push(currentSegment.join('\n'));
        currentSegment = [];
        insideFence = false;
        continue;
      }
      if (currentSegment.length > 0) {
        segments.push(currentSegment.join('\n'));
      }
      currentSegment = [line];
      insideFence = true;
    }
    if (currentSegment.length > 0) segments.push(currentSegment.join('\n'));
    return segments;
  };

  // Split on paragraphs first; a too-long paragraph falls to sentences,
  // a too-long sentence (or fence) is hard-split.
  const units: Array<string> = [];
  const pushOversized = (piece: string) => {
    for (let start = 0; start < piece.length; start += targetChars) {
      units.push(piece.slice(start, start + targetChars));
    }
  };
  for (const segment of splitOnFences(cleanText)) {
    if (/^\s*(```|~~~)/.test(segment)) {
      // A fenced block keeps its opener and closer together.
      if (segment.length <= targetChars) {
        units.push(segment);
      } else {
        pushOversized(segment);
      }
      continue;
    }
    for (const paragraph of segment.split(/\n{2,}/)) {
      if (paragraph.length <= targetChars) {
        units.push(paragraph);
        continue;
      }
      const sentences = paragraph.split(/(?<=[.!?])\s+/);
      let currentSentence = '';
      for (const sentence of sentences) {
        if (sentence.length > targetChars) {
          if (currentSentence) {
            units.push(currentSentence);
            currentSentence = '';
          }
          pushOversized(sentence);
          continue;
        }
        if ((currentSentence + ' ' + sentence).length > targetChars) {
          units.push(currentSentence);
          currentSentence = sentence;
          continue;
        }
        currentSentence = currentSentence
          ? `${currentSentence} ${sentence}`
          : sentence;
      }
      if (currentSentence) units.push(currentSentence);
    }
  }

  // Pack the units into chunks under the target, with the overlap carried
  // from the tail of the previous chunk.
  const chunks: Array<string> = [];
  let current = '';
  for (const unit of units) {
    if (current && current.length + unit.length + 1 > targetChars) {
      chunks.push(current);
      const tail = current.slice(-overlapChars);
      current = tail ? `${tail} ${unit}` : unit;
      continue;
    }
    current = current ? `${current}\n\n${unit}` : unit;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
};

/** Build the chunks of one document under a stable id prefix. */
const buildChunksForDocument = (
  source: string,
  documentIndex: number | string,
  title: string,
  tags: Array<string>,
  text: string
): Array<ByokRagChunk> =>
  chunkByokRagText(text).map((chunkText, chunkIndex) => ({
    id: `${source}:${documentIndex}:${chunkIndex}`,
    source,
    title,
    tags,
    text: chunkText,
  }));

/**
 * The engine-reference chunks: one entry per chunk (they are short — the
 * name, kind, owner, description and parameters in one text, so a hit
 * carries the exact names).
 */
export const buildByokRagEngineReferenceChunks = (): Array<ByokRagChunk> =>
  getByokEngineReferenceEntries().map((entry, index) => ({
    id: `engine-reference:${index}:0`,
    source: 'engine-reference',
    title: entry.name,
    tags: [entry.kind, entry.owner],
    text: [
      `${entry.kind} ${entry.name} (${entry.owner})`,
      entry.description,
      entry.parameters.length > 0
        ? `Parameters: ${entry.parameters
            .map(parameter => `${parameter.type} ${parameter.description}`)
            .join('; ')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n'),
  }));

/** The bundled docs pages, chunked by section. */
export const buildByokRagDocsChunks = (): Array<ByokRagChunk> =>
  listByokBundledDocPages().flatMap((page, index) => {
    const read = readBundledByokDocPage(page.path);
    const content = read && read.found ? read.content : '';
    if (!content) return [];
    return buildChunksForDocument(
      'docs',
      index,
      page.title || page.path,
      ['docs', page.path],
      `# ${page.title} (${page.path})\n\n${content}`
    );
  });

/** The skills (metadata + body — a hit retrieves the playbook itself). */
export const buildByokRagSkillChunks = async (): Promise<
  Array<ByokRagChunk>
> => {
  const skills = await getByokSkills();
  return skills.flatMap((skill, index) =>
    buildChunksForDocument(
      'skill',
      index,
      skill.name,
      ['skill', ...skill.tools],
      `Skill ${skill.name}: ${skill.description}\n\n${skill.body}`
    )
  );
};

/** The curated EventScript examples (13.6): one chunk each, fully tagged. */
export const buildByokRagExampleChunks = (): Array<ByokRagChunk> =>
  getByokEventScriptExamples().map((example, index) => ({
    id: `example:${index}:0`,
    source: 'example',
    title: example.name,
    tags: ['example', 'eventscript', ...example.tags],
    text: `EventScript example — ${example.name} [${example.tags.join(
      ', '
    )}]\n${example.source}`,
  }));

/**
 * Pack whole LINES into chunks under the target size (one page per line
 * stays one line — the sentence-splitting chunker would mangle a listing).
 * Pure and deterministic; used by the category-map grade.
 */
export const packByokRagLines = (
  lines: Array<string>,
  targetTokens: number = BYOK_RAG_CHUNK_TARGET_TOKENS
): Array<string> => {
  const targetChars = targetTokens * 4;
  const packed: Array<string> = [];
  let current: Array<string> = [];
  let currentChars = 0;
  for (const line of lines) {
    if (current.length > 0 && currentChars + line.length + 1 > targetChars) {
      packed.push(current.join('\n'));
      current = [];
      currentChars = 0;
    }
    current.push(line);
    currentChars += line.length + 1;
  }
  if (current.length > 0) packed.push(current.join('\n'));
  return packed;
};

/**
 * The minified-docs category maps (Phase 14.2, D14-2): one document per
 * top-level wiki category, one line per page (`path — title — summary`) —
 * the browsable index of the whole wiki, no monolithic file. A big
 * category's map is line-packed into several chunks (each self-describing).
 */
export const buildByokRagMinifiedDocsMapChunks = (): Array<ByokRagChunk> =>
  listByokMinifiedDocCategories().flatMap(category => {
    const pages = getByokMinifiedDocPagesOfCategory(category);
    if (pages.length === 0) return [];
    const lines = pages.map(
      page => `${page.path} — ${page.title} — ${page.summary}`
    );
    const header = `Minified docs category map "${category}" (${
      pages.length
    } pages; each line: path — title — summary).`;
    return packByokRagLines(lines).map((packedLines, chunkIndex) => ({
      id: `docs-min-map:${category}:${chunkIndex}`,
      source: 'docs-min-map',
      title: `Minified docs map: ${category}`,
      // 'docs-min' stays the PAGE-chunk tag: a tags:["docs-min"]
      // content search must not drown in the category maps (audit011026
      // B-PROMPT-9).
      tags: ['docs-min-map', 'map', category],
      text: `${header}\n${packedLines}`,
    }));
  });

/**
 * The minified wiki pages themselves (D14-2): the summary + the minified
 * body, chunked by the standard chunker, every chunk carrying the page
 * header (title + path) and the `read_doc_page` pointer for full depth.
 */
export const buildByokRagMinifiedDocsPageChunks = (): Array<ByokRagChunk> =>
  getByokMinifiedDocPages().flatMap(page =>
    chunkByokRagText(page.body).map((chunkText, chunkIndex) => ({
      id: `docs-min:${page.path}:${chunkIndex}`,
      source: 'docs-min',
      title: page.title,
      tags: ['docs-min', page.category, ...page.tags],
      text: [
        `${page.title} (${page.path}) — ${page.summary}`,
        chunkText,
        `Full page: read_doc_page('${page.path}').`,
      ].join('\n\n'),
    }))
  );

/**
 * The shape of the injected reader for the opt-in local docs folder
 * (D13-1): lists the .md files of a folder and reads one. The desktop
 * implementation walks the folder through the RAG file backend; tests
 * inject a map.
 */
export type ByokRagDocsFolderReader = {|
  listMarkdownFiles: (folderPath: string) => Promise<Array<string>>,
  readFile: (filePath: string) => Promise<string>,
|};

/** The opt-in local documentation folder, chunked like the bundled docs. */
export const buildByokRagUserDocsChunks = async (
  folderPath: string,
  reader: ByokRagDocsFolderReader
): Promise<Array<ByokRagChunk>> => {
  if (!folderPath.trim()) return [];
  let files: Array<string> = [];
  try {
    files = await reader.listMarkdownFiles(folderPath);
  } catch (error) {
    // An unreadable folder contributes nothing (the settings UI shows the
    // error; the index builds from the rest).
    return [];
  }
  const chunks: Array<ByokRagChunk> = [];
  for (const file of files) {
    let content = '';
    try {
      content = await reader.readFile(file);
    } catch (error) {
      continue;
    }
    if (!content.trim()) continue;
    const fileName = file.split(/[\\/]/).pop() || file;
    chunks.push(
      ...buildChunksForDocument(
        'user-docs',
        chunks.length,
        fileName,
        ['user-docs'],
        `${fileName}\n\n${content}`
      )
    );
  }
  return chunks;
};

/**
 * The whole corpus, in a stable order: engine reference, docs, examples,
 * skills, the minified-wiki map/page grades (14.2), then the opt-in user
 * docs. Same inputs → same chunks (the index manifest hashes them).
 */
export const buildByokRagCorpus = async (options: {|
  docsFolderPath?: string,
  docsFolderReader?: ByokRagDocsFolderReader,
|}): Promise<Array<ByokRagChunk>> => [
  ...buildByokRagEngineReferenceChunks(),
  ...buildByokRagDocsChunks(),
  ...buildByokRagExampleChunks(),
  ...(await buildByokRagSkillChunks()),
  ...buildByokRagMinifiedDocsMapChunks(),
  ...buildByokRagMinifiedDocsPageChunks(),
  ...(options.docsFolderPath && options.docsFolderReader
    ? await buildByokRagUserDocsChunks(
        options.docsFolderPath,
        options.docsFolderReader
      )
    : []),
];

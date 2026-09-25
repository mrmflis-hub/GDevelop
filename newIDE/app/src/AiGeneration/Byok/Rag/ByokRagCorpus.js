// @flow
import { getByokEventScriptExamples } from '../ByokEventScriptExamples';
import { getByokSkills } from '../ByokSkills';
import { listByokBundledDocPages, readBundledByokDocPage } from '../ByokDocs';
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
 * hard-split as the last resort. Pure and deterministic.
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

  // Split on paragraphs first; a too-long paragraph falls to sentences,
  // a too-long sentence is hard-split.
  const units: Array<string> = [];
  for (const paragraph of cleanText.split(/\n{2,}/)) {
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
        for (let start = 0; start < sentence.length; start += targetChars) {
          units.push(sentence.slice(start, start + targetChars));
        }
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
  documentIndex: number,
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
 * skills, then the opt-in user docs. Same inputs → same chunks (the index
 * manifest hashes them).
 */
export const buildByokRagCorpus = async (options: {|
  docsFolderPath?: string,
  docsFolderReader?: ByokRagDocsFolderReader,
|}): Promise<Array<ByokRagChunk>> => [
  ...buildByokRagEngineReferenceChunks(),
  ...buildByokRagDocsChunks(),
  ...buildByokRagExampleChunks(),
  ...(await buildByokRagSkillChunks()),
  ...(options.docsFolderPath && options.docsFolderReader
    ? await buildByokRagUserDocsChunks(
        options.docsFolderPath,
        options.docsFolderReader
      )
    : []),
];

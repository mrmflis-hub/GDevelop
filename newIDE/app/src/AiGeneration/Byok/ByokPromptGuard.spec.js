// @flow
/**
 * @jest-environment jsdom
 */

// The prompt→registry guard (audit011026, the audit's "biggest gap"):
// every tool-like call token the taught surfaces use must resolve to a
// real DISPATCHABLE tool, a known engine name, or a documented
// prompt-vocabulary/code idiom. The read_doc_page gap (B-PROMPT-1 — a
// tool taught by ~1.5k corpus chunks but never registered) and the
// knowledge-section tool-name typo before it would both have failed here.

// jsdom does not implement matchMedia, which modules of the (lazily
// required) import chain call at load time — polyfill BEFORE the requires.
if (typeof window !== 'undefined' && !(window: any).matchMedia) {
  (window: any).matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

jest.setTimeout(120000);

// JS/std idioms the skills legitimately teach inside run_script snippets.
const GENERIC_CODE_TOKENS = new Set([
  'cos',
  'sin',
  'min',
  'max',
  'abs',
  'sqrt',
  'floor',
  'ceil',
  'round',
  'pow',
  'random',
  'parseInt',
  'parseFloat',
  'setTimeout',
  'setInterval',
  'console',
  'fetch',
  'lerp',
]);

// EventScript cheat-sheet shorthand: instruction names written in their
// human-readable form (the parser accepts any instruction and refills
// parameters from the engine metadata, so these are intentional
// vocabulary, not stale tool names).
const EVENTSCRIPT_SHORTHAND_TOKENS = new Set([
  'Cond',
  'GetX',
  'GetY',
  'SetGlobalNumberVariable',
  'SetSceneNumberVariable',
]);

// Runtime JS-API vocabulary the skills teach (the gdjs runtime object
// model and the gameplay-testing harness helpers) — not engine-reference
// actions/expressions, not tools, legitimately callable from run_script
// and test code.
const RUNTIME_JS_API_TOKENS = new Set([
  'CellWidth',
  'GetAlignment',
  'GetBBText',
  'GetFontFamily',
  'GetFontSize',
  'GetWrappingWidth',
  'NearestEnemyX',
  'assert',
  'get3DRendererObject',
  'getLayer',
  'getPIXIRenderer',
  'getRenderer',
  'getRendererContainer',
  'getRendererObject',
  'getSceneName',
  'getThreeScene',
  'getX',
  'releaseAllInputs',
  'setGameResolutionSize',
  'setKeyPressed',
  'setMousePosition',
  'stepFrames',
  'stepUntil',
  'stepUntilObjectIsStable',
]);

const collectCallTokens = (text: string): Set<string> => {
  const tokens = new Set<string>();
  for (const match of text.matchAll(/[A-Za-z_][A-Za-z0-9_]*\(/g)) {
    tokens.add(match[0].slice(0, -1));
  }
  return tokens;
};

describe('ByokPromptGuard (audit011026: every taught tool token resolves)', () => {
  it('the composed prompts, the skill bodies and the docs-min chunk template', async () => {
    const { buildByokSystemPrompt } = require('./ByokPrompts');
    const {
      makeByokPromptContext,
    } = require('./Knowledge/ByokKnowledgeSections');
    const { getByokDispatchableToolNames } = require('./ByokToolSchema');
    const {
      listByokSkillMetadata,
      findByNameokSkill,
    } = require('./ByokSkills');
    const { buildByokRagCorpus } = require('./Rag/ByokRagCorpus');
    const engineReference = require('./docs/engine-reference.json');

    const dispatchable = new Set(getByokDispatchableToolNames());
    const engineTokens = new Set(
      engineReference.map((entry: any) => entry.name)
    );
    const known = (token: string): boolean =>
      dispatchable.has(token) ||
      engineTokens.has(token) ||
      GENERIC_CODE_TOKENS.has(token) ||
      EVENTSCRIPT_SHORTHAND_TOKENS.has(token) ||
      RUNTIME_JS_API_TOKENS.has(token);

    const surfaces: Array<string> = [];
    for (const hasOpenedProject of [true, false]) {
      const skills = await listByokSkillMetadata();
      surfaces.push(
        buildByokSystemPrompt({
          toolNames: require('./ByokToolSchema').getByokAdvertisedToolNames({
            hasOpenedProject,
          }),
          hasOpenedProject,
          context: makeByokPromptContext({
            toolNames: require('./ByokToolSchema').getByokAdvertisedToolNames({
              hasOpenedProject,
            }),
            hasOpenedProject,
            skills,
            engineReferenceAvailable: true,
            projectNotes: null,
            customInstructions: '',
          }),
        })
      );
    }
    const skillsMetadata = await listByokSkillMetadata();
    for (const skill of skillsMetadata) {
      const full = await findByNameokSkill(skill.name);
      if (full) surfaces.push(full.body);
    }
    // The docs-min chunks carry the drill-down hint template — a sample of
    // the built corpus covers it.
    const corpus = await buildByokRagCorpus({});
    const docsMinSample = corpus
      .filter(chunk => chunk.source === 'docs-min')
      .slice(0, 50)
      .map(chunk => chunk.text)
      .join('\n');
    surfaces.push(docsMinSample);

    const unresolvable: Array<string> = [];
    for (const surface of surfaces) {
      for (const token of collectCallTokens(surface)) {
        if (!known(token)) unresolvable.push(token);
      }
    }
    expect([...new Set(unresolvable)].sort()).toEqual([]);
  });
});

// @flow
/**
 * The Phase 13.5 budget guard: the advertised tool schemas + the composed
 * system prompt together must fit the owner's directive — an 8–10k token
 * target, a 15k hard cap (D13-6). The estimate is the char/4 baseline the
 * composer uses; the exact number is printed in every failure message so a
 * budget blow-up is debuggable in one look.
 */
import { buildByokSystemPrompt } from './ByokPrompts';
import {
  BYOK_TASK_CATALOG,
  makeByokPromptContext,
} from './Knowledge/ByokKnowledgeSections';
import {
  getByokAdvertisedToolNames,
  getByokToolSchemasForNames,
  searchByokToolSchemas,
  toOpenAiToolsFormat,
} from './ByokToolSchema';
import { searchByokEngineReference } from './ByokEngineReference';
import { listByokSkillMetadata } from './ByokSkills';

const BYOK_BUDGET_WARNING_TOKENS = 10000;
const BYOK_BUDGET_HARD_CAP_TOKENS = 15000;

const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

describe('ByokPromptBudget (Phase 13.5)', () => {
  const measureTurn = async (hasOpenedProject: boolean) => {
    const advertisedNames = getByokAdvertisedToolNames({ hasOpenedProject });
    const skills = await listByokSkillMetadata();
    const systemPrompt = buildByokSystemPrompt({
      toolNames: advertisedNames,
      hasOpenedProject,
      context: makeByokPromptContext({
        toolNames: advertisedNames,
        hasOpenedProject,
        skills,
        engineReferenceAvailable: true,
        docsAvailable: true,
        projectNotes: null,
        customInstructions: 'a'.repeat(2000),
      }),
    });
    const toolsJson = JSON.stringify(
      toOpenAiToolsFormat(getByokToolSchemasForNames(advertisedNames))
    );
    return {
      advertisedNames,
      systemPrompt,
      systemPromptTokens: estimateTokens(systemPrompt),
      toolsTokens: estimateTokens(toolsJson),
      totalTokens: estimateTokens(systemPrompt) + estimateTokens(toolsJson),
    };
  };

  it('keeps the advertised tools + system prompt under the 15k hard cap (project open)', async () => {
    const measurement = await measureTurn(true);
    if (measurement.totalTokens > BYOK_BUDGET_WARNING_TOKENS) {
      console.warn(
        `BYOK prompt budget above the 8-10k target: ${
          measurement.totalTokens
        } tokens ` +
          `(prompt ${measurement.systemPromptTokens} + tools ${
            measurement.toolsTokens
          }, ` +
          `${measurement.advertisedNames.length} advertised tools).`
      );
    }
    expect(measurement.totalTokens).toBeLessThanOrEqual(
      BYOK_BUDGET_HARD_CAP_TOKENS
    );
  });

  it('keeps the advertised tools + system prompt under the 15k hard cap (no project)', async () => {
    const measurement = await measureTurn(false);
    expect(measurement.totalTokens).toBeLessThanOrEqual(
      BYOK_BUDGET_HARD_CAP_TOKENS
    );
  });

  it('advertises the core set, not the whole catalog', async () => {
    const measurement = await measureTurn(true);
    // The core list + search_tools: far below the full 63-tool catalog.
    expect(measurement.advertisedNames.length).toBeLessThan(40);
    expect(measurement.advertisedNames).toContain('search_tools');
    expect(measurement.advertisedNames).not.toContain('list_effects');
  });

  it('adds the no-project tools only without a project', () => {
    const withProject = getByokAdvertisedToolNames({ hasOpenedProject: true });
    const withoutProject = getByokAdvertisedToolNames({
      hasOpenedProject: false,
    });
    expect(withProject).not.toContain('initialize_project');
    expect(withoutProject).toContain('initialize_project');
    expect(withoutProject).toContain('get_game_starter_summary');
  });
});

describe('ByokPromptBudget: the task catalog resolves (13.5)', () => {
  it('names only real skills', async () => {
    const skills = await listByokSkillMetadata();
    const skillNames = new Set(skills.map(skill => skill.name));
    const entriesWithSkill = BYOK_TASK_CATALOG.filter(
      entry => !!entry.skillName
    );
    expect(entriesWithSkill.length).toBeGreaterThanOrEqual(10);
    for (const entry of entriesWithSkill) {
      expect(skillNames.has((entry.skillName: any))).toBe(true);
    }
  });

  it('returns tools for every toolQuery of the catalog', () => {
    const entriesWithToolQuery = BYOK_TASK_CATALOG.filter(
      entry => !!entry.toolQuery
    );
    expect(entriesWithToolQuery.length).toBeGreaterThanOrEqual(5);
    for (const entry of entriesWithToolQuery) {
      const matches = searchByokToolSchemas((entry.toolQuery: any));
      expect(matches.length).toBeGreaterThan(0);
    }
  });

  it('returns reference entries for every referenceQuery of the catalog', () => {
    const entriesWithReferenceQuery = BYOK_TASK_CATALOG.filter(
      entry => !!entry.referenceQuery
    );
    expect(entriesWithReferenceQuery.length).toBeGreaterThanOrEqual(3);
    for (const entry of entriesWithReferenceQuery) {
      const result = searchByokEngineReference({
        query: (entry.referenceQuery: any),
      });
      expect(result.available).toBe(true);
      expect(result.entries.length).toBeGreaterThan(0);
    }
  });
});

describe('searchByokToolSchemas (the search_tools engine)', () => {
  it('finds an exact tool name first', () => {
    const matches = searchByokToolSchemas('list_effects');
    expect(matches[0].name).toBe('list_effects');
  });

  it('finds tools by concept keywords', () => {
    const spriteMatches = searchByokToolSchemas('sprite animation');
    expect(spriteMatches.some(schema => schema.name.includes('sprite'))).toBe(
      true
    );
    const storeMatches = searchByokToolSchemas('asset store');
    expect(storeMatches.map(schema => schema.name)).toContain(
      'search_object_asset_store'
    );
  });

  it('returns nothing for a nonsense query, capped results otherwise', () => {
    expect(searchByokToolSchemas('zzzznope')).toEqual([]);
    expect(searchByokToolSchemas('the').length).toBeLessThanOrEqual(10);
    expect(searchByokToolSchemas('')).toEqual([]);
  });
});

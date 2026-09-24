// @flow
import {
  BYOK_NO_PROJECT_TOOL_NAMES,
  BYOK_TOOL_NAMES,
  getByokToolSchemas,
} from './ByokToolSchema';
import {
  BYOK_AGENT_PROMPT_VERSION,
  buildByokSystemPrompt,
} from './ByokPrompts';

describe('ByokPrompts', () => {
  it('has a non-empty prompt version constant', () => {
    expect(BYOK_AGENT_PROMPT_VERSION).not.toBe('');
    expect(typeof BYOK_AGENT_PROMPT_VERSION).toBe('string');
  });

  it('contains every tool name from getByokToolSchemas, keeping prompt and schemas in sync', () => {
    const prompt = buildByokSystemPrompt({
      toolNames: getByokToolSchemas().map(schema => schema.name),
      hasOpenedProject: true,
    });

    for (const schema of getByokToolSchemas()) {
      expect(prompt).toContain(schema.name);
    }
  });

  it('lists the no-project tools when no project is open', () => {
    const prompt = buildByokSystemPrompt({
      toolNames: [...BYOK_TOOL_NAMES, ...BYOK_NO_PROJECT_TOOL_NAMES],
      hasOpenedProject: false,
    });
    expect(prompt).toContain('get_game_starter_summary');
    expect(prompt).toContain('initialize_project');
  });

  it('contains each tool name only in the tool list line, with its summary', () => {
    const prompt = buildByokSystemPrompt({
      toolNames: ['create_scene'],
      hasOpenedProject: true,
    });

    expect(prompt).toContain('- create_scene:');
    // The tools that were not requested are not listed.
    expect(prompt).not.toContain('- describe_instances:');
  });

  it('swaps in the no-project instructions when no project is opened', () => {
    const withProject = buildByokSystemPrompt({
      toolNames: [],
      hasOpenedProject: true,
    });
    const withoutProject = buildByokSystemPrompt({
      toolNames: [],
      hasOpenedProject: false,
    });

    expect(withProject).toContain('inspect before editing');
    expect(withProject).not.toContain('No project is opened');
    expect(withoutProject).toContain('No project is opened');
    expect(withoutProject).not.toContain('inspect before editing');
  });

  it('carries the Phase 8 agents policy (delegation + completion rules + skill pointers)', () => {
    const prompt = buildByokSystemPrompt({
      toolNames: [],
      hasOpenedProject: true,
    });

    expect(prompt).toContain('Agents policy');
    expect(prompt).toContain('main agent');
    expect(prompt).toContain('run_explorer_agent');
    expect(prompt).toContain('run_review_agent');
    expect(prompt).toContain('Never edit inside sub-agents');
    expect(prompt).toContain('completion gate will nudge you once');
    expect(prompt).toContain('build-workflow');
    expect(prompt).toContain('extend-with-js');
    // The v5 single-agent wording is gone.
    expect(prompt).not.toContain('no sub-agents');
  });

  it('teaches the output rules and the plan tool usage', () => {
    const prompt = buildByokSystemPrompt({
      toolNames: [],
      hasOpenedProject: true,
    });

    expect(prompt).toContain('plain text only when the task is done');
    expect(prompt).toContain('never put calls that depend on another call');
    expect(prompt).toContain('create_or_update_plan');
  });
});

describe('ByokPrompts v5 (Phase 7: composer + F2 progress discipline)', () => {
  it('pins the prompt version', () => {
    // Bumped to byok-v8 in Phase 12 (discovery + runtime guidance).
    expect(BYOK_AGENT_PROMPT_VERSION).toBe('byok-v8');
  });

  it('teaches the F2 obligatory to-do list and per-item progress updates', () => {
    const prompt = buildByokSystemPrompt({
      toolNames: BYOK_TOOL_NAMES,
      hasOpenedProject: true,
    });
    expect(prompt).toContain('create_or_update_plan');
    expect(prompt).toContain('one-sentence progress update');
    expect(prompt).toContain('to-do');
  });

  it('stays within the token budget with every knowledge flag on', () => {
    const consoleInfoSpy = jest
      .spyOn(console, 'info')
      .mockImplementation(() => {});
    const prompt = buildByokSystemPrompt({
      toolNames: BYOK_TOOL_NAMES,
      hasOpenedProject: true,
    });
    consoleInfoSpy.mockRestore();

    // The composed prompt is capped by the composer: ~24k characters for the
    // 6k-token budget (the estimate is logged for the desktop QA).
    expect(prompt.length).toBeLessThanOrEqual(26000);
  });

  it('includes the knowledge packs, or their first-line summary when degraded', () => {
    const consoleInfoSpy = jest
      .spyOn(console, 'info')
      .mockImplementation(() => {});
    const prompt = buildByokSystemPrompt({
      toolNames: BYOK_TOOL_NAMES,
      hasOpenedProject: true,
    });
    consoleInfoSpy.mockRestore();

    // Under the budget some degradable packs collapse to their summary —
    // which keeps their first line. These markers survive both cases.
    expect(prompt).toContain('Design first'); // game-design pack
    expect(prompt).toContain('Never compute geometry'); // math/physics pack
    expect(prompt).toContain('Prefer events'); // JS API pack
    expect(prompt).toContain('search_reference'); // engine cheat-sheet
  });

  it('teaches the EventScript operational core', () => {
    const prompt = buildByokSystemPrompt({
      toolNames: BYOK_TOOL_NAMES,
      hasOpenedProject: true,
    });
    expect(prompt).toContain('Writing events (add_scene_events)');
    expect(prompt).toContain('read_events_source');
    expect(prompt).toContain('expected_event_source');
    expect(prompt).toContain('placement relations');
  });

  it('teaches the script-first policy', () => {
    const prompt = buildByokSystemPrompt({
      toolNames: BYOK_TOOL_NAMES,
      hasOpenedProject: true,
    });
    expect(prompt).toContain('Batching work with run_script');
    expect(prompt).toContain('5 or more related operations');
    expect(prompt).toContain(
      'A refused approval means nothing in the script ran'
    );
  });

  it('teaches the look-verify cycle and hybrid grounding', () => {
    const prompt = buildByokSystemPrompt({
      toolNames: BYOK_TOOL_NAMES,
      hasOpenedProject: true,
    });
    expect(prompt).toContain('Look and verify');
    expect(prompt).toContain('capture a screenshot');
    expect(prompt).toContain('never guess from pixels');
    expect(prompt).toContain('paused');
  });

  it('teaches project creation when no project is open', () => {
    const prompt = buildByokSystemPrompt({
      toolNames: BYOK_TOOL_NAMES,
      hasOpenedProject: false,
    });
    // Phase 12: the real starter catalog replaced "plan from memory".
    expect(prompt).toContain('get_game_starter_summary');
    expect(prompt).toContain('never invent one');
    expect(prompt).toContain('initialize_project');
  });
});

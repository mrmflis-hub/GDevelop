// @flow
import { getByokToolSchemas } from './ByokToolSchema';
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

  it('carries the single-agent instruction', () => {
    const prompt = buildByokSystemPrompt({
      toolNames: [],
      hasOpenedProject: true,
    });

    expect(prompt).toContain('single agent');
    expect(prompt).toContain('no sub-agents');
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

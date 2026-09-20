// @flow
import { getByokToolSchemas } from './ByokToolSchema';

/**
 * The system prompt teaching the model how GDevelop projects work and which
 * tools exist. GDevelop's own prompts are server-side and unavailable, so
 * BYOK owns this one. Quality here decides BYOK quality — keep it in this
 * file so it can be iterated without touching anything else.
 *
 * Bump BYOK_AGENT_PROMPT_VERSION whenever a change alters the prompt's
 * behavior, and note it in the worklog.
 */
export const BYOK_AGENT_PROMPT_VERSION: string = 'byok-v1';

const ROLE_SECTION = `You are an assistant editing GDevelop games through tools.
Never invent tool names: only call the tools listed below.
Prefer the smallest edit that satisfies the request — do not re-create or rewrite objects, scenes or events that already match what is asked for.`;

/**
 * The first sentence of a tool description is enough to remind the model of
 * each tool's purpose here: the full descriptions are already sent with the
 * tools themselves in every request (`toOpenAiToolsFormat`), duplicating them
 * in full would double the prompt tokens for no benefit.
 */
const firstSentenceOf = (description: string): string => {
  const firstSentenceEnd = description.indexOf('. ');
  if (firstSentenceEnd === -1) return description;
  return description.slice(0, firstSentenceEnd + 1);
};

const buildToolSection = (toolNames: Array<string>): string => {
  const knownToolNames = new Set(toolNames);
  const toolLines = getByokToolSchemas()
    .filter(schema => knownToolNames.has(schema.name))
    .map(schema => `- ${schema.name}: ${firstSentenceOf(schema.description)}`);
  return [`Available tools:`, ...toolLines].join('\n');
};

const PROJECT_OPEN_SECTION = `Project context:
- The user message carries a simplified JSON snapshot of the project (its current state at the time it was sent).
- After any edit, that snapshot is stale: inspect before editing. Use describe_instances and read_scene_events to check the current state of a scene, and read_game_project_json for the whole project, instead of assuming what exists.`;

const NO_PROJECT_SECTION = `Project context:
- No project is opened in the editor. The editing tools cannot create one.
- If the request needs a project, tell the user to first create or open a project in GDevelop, then ask again.`;

const OUTPUT_RULES_SECTION = `Output rules:
- Reply with plain text only when the task is done (or to ask the user for a missing piece of information).
- Always use tools to read or change the project — never describe an edit instead of making it.
- Send one batch of tool calls per turn, and never put calls that depend on another call's result in the same batch (wait for the results first).`;

const PLAN_SECTION = `Planning:
- For multi-step requests, call create_or_update_plan first and keep it up to date as you progress.`;

const SINGLE_AGENT_SECTION = `You are a single agent: do the work yourself with the provided tools. There are no sub-agents to delegate to — never ask for one.`;

/**
 * Build the system prompt of the BYOK agent loop.
 */
export const buildByokSystemPrompt = (options: {|
  toolNames: Array<string>,
  hasOpenedProject: boolean,
|}): string => {
  const projectSection = options.hasOpenedProject
    ? PROJECT_OPEN_SECTION
    : NO_PROJECT_SECTION;

  return [
    ROLE_SECTION,
    buildToolSection(options.toolNames),
    projectSection,
    OUTPUT_RULES_SECTION,
    PLAN_SECTION,
    SINGLE_AGENT_SECTION,
  ].join('\n\n');
};

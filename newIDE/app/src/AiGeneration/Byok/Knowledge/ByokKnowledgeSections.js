// @flow
import { getByokToolSchemas } from '../ByokToolSchema';

/**
 * The system prompt of the BYOK agent is no longer one hand-written block:
 * it is composed from registered sections under a token budget (Phase 7).
 * Core operational sections (role, tools, project context, output rules,
 * planning) are registered here; the knowledge modules (EventScript pack,
 * game design, math/physics, JS API, engine reference, docs, skills,
 * project notes, custom instructions) register their own sections with a
 * lower priority. When the budget is hit, lower-priority sections degrade
 * to a one-line summary — their full bodies stay reachable via skills and
 * tools (progressive disclosure: context rot is real, recall degrades as
 * tokens grow).
 */

/**
 * The total budget of the composed system prompt, in estimated tokens
 * (~4 characters per token — conservative for English prose).
 */
export const BYOK_SYSTEM_PROMPT_BUDGET_TOKENS = 6000;

/** The characters-per-token estimate used for the budget accounting. */
export const BYOK_CHARS_PER_TOKEN = 4;

/** Metadata of one skill, as shown in the "Available skills" appendix. */
export type ByokSkillMetadata = {|
  name: string,
  description: string,
|};

/** The per-project notes injected after the project context (Phase 7.8). */
export type ByokProjectNotes = {|
  conventions: string,
  inProgress: string,
  decisions: string,
  updatedAt: string,
|};

/**
 * Everything the sections may need to build their text this turn. Built by
 * `makeByokPromptContext` (see the defaults there) and passed through
 * `buildByokSystemPrompt`.
 */
export type ByokPromptContext = {|
  toolNames: Array<string>,
  hasOpenedProject: boolean,
  // Metadata-only skill list (the bodies are fetched by load_skill).
  skills: Array<ByokSkillMetadata>,
  // True when the generated engine reference catalog could be loaded: the
  // engine cheat-sheet section then points to search_reference.
  engineReferenceAvailable: boolean,
  // True when the curated docs subset is available offline.
  docsAvailable: boolean,
  // The project's persisted notes (null when the project has none yet).
  projectNotes: ?ByokProjectNotes,
  // The user's global custom instructions (verbatim, may be empty).
  customInstructions: string,
|};

/**
 * One registered section of the system prompt. `priority` orders the
 * sections (lower runs earlier — the operational core first, knowledge
 * last). `budgetTokens` caps what this section may contribute; a section
 * whose text exceeds its own budget (or the global one) degrades to a
 * one-line summary when `degradable`, and is truncated when not.
 */
export type ByokKnowledgeSection = {|
  id: string,
  title: string,
  priority: number,
  budgetTokens: number,
  degradable: boolean,
  build: (context: ByokPromptContext) => string,
|};

/** Estimate the token size of a text (~4 characters per token). */
export const estimateByokTokens = (text: string): number =>
  Math.ceil(text.length / BYOK_CHARS_PER_TOKEN);

const makeSectionText = (title: string, body: string): string =>
  `${title}:\n${body}`;

const makeSimpleSection = (
  id: string,
  title: string,
  priority: number,
  body: string
): ByokKnowledgeSection => ({
  id,
  title,
  priority,
  budgetTokens: estimateByokTokens(makeSectionText(title, body)),
  degradable: false,
  build: () => makeSectionText(title, body),
});

// --- Core section texts (authored; iterated here and nowhere else) --------

const ROLE_SECTION_TEXT = `You are an assistant editing GDevelop games through tools.
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

const buildToolSectionText = (toolNames: Array<string>): string => {
  const knownToolNames = new Set(toolNames);
  const toolLines = getByokToolSchemas()
    .filter(schema => knownToolNames.has(schema.name))
    .map(schema => `- ${schema.name}: ${firstSentenceOf(schema.description)}`);
  return [`Available tools:`, ...toolLines].join('\n');
};

const PROJECT_OPEN_SECTION_TEXT = `- The user message carries a simplified JSON snapshot of the project (its current state at the time it was sent).
- After any edit, that snapshot is stale: inspect before editing. Use describe_instances and read_scene_events to check the current state of a scene, read_game_project_json for the whole project, and read_events_source before editing events, instead of assuming what exists.`;

const NO_PROJECT_SECTION_TEXT = `- No project is opened in the editor. When the request needs a game: browse the starter templates with get_game_starter_summary (pick a real slug — never invent one), then call initialize_project (empty, or the chosen template slug), and edit the new project with the other tools.`;

const OUTPUT_RULES_SECTION_TEXT = `- Reply with plain text only when the task is done (or to ask the user for a missing piece of information).
- Always use tools to read or change the project — never describe an edit instead of making it.
- Send one batch of tool calls per turn, and never put calls that depend on another call's result in the same batch (wait for the results first).`;

// F2 (owner decision #2, 2026-09-22): non-streaming stays, so the waiting
// experience is the plan plus per-item progress sentences.
const PLANNING_SECTION_TEXT = `- For multi-step requests, call create_or_update_plan first and keep it up to date as you progress. The to-do list is your internal tracking; staying hidden from the user is acceptable.
- Every time you complete a to-do item, send the user a one-sentence progress update together with your next batch of tool calls, before starting the next item.
- A single long answer without a to-do list stays acceptable for simple requests.`;

const AGENTS_SECTION_TEXT = `You are the main agent of this chat: do the edits yourself, with the provided tools.
Delegation policy (Phase 8):
- run_explorer_agent delegates a READ-ONLY scout with a fresh context: use it for broad read-only sweeps (inventory the scenes, find where something is used) that would flood this conversation.
- run_review_agent delegates a fresh-context reviewer: use it to check the finished work against the original request before claiming done on a multi-step build.
- Never edit inside sub-agents: they are read-only by design. All edits happen here, in this conversation.
- There is no edit agent: sequential edits are yours.

Completion rules: claim done ONLY after verifying your work — a screenshot, a booted preview, a green gameplay test, or clean logs AFTER your last edit. The completion gate will nudge you once if you claim done without verification, and your final message carries the verification evidence.

Skills: before building a game from a request, load_skill("build-workflow") and follow its pipeline. When a task needs JavaScript or custom objects/behaviors/functions, load_skill("extend-with-js").`;

const EVENT_SCRIPT_CORE_SECTION_TEXT = `- Read before writing: call read_events_source on the scene and write your batches from what it shows.
- EventScript syntax: one event per indented block — \`if Timer(2, "SpawnTimer") and once:\` (conditions joined with "and", "not" inverts, Or(...), once), \`always:\`, \`else:\`, \`else if ...:\`, \`while Cond():\`, \`repeat 5 times:\`, \`for each Player:\`, \`for each child in Inventory value Item:\`, \`group "Name":\`, \`comment "text"\`. Actions are the indented lines of a block, one call per line: \`Delete(Player)\`, \`await Wait(1)\`, \`SetNumberVariable(Score, =, +1)\`. Quoted strings use double quotes, empty body is \`pass\`.
- Target your edits: use the \`# event-N.M\` ids from read_events_source as placement_target_event_id (e.g. "event-2.1"), with placement relations like insert_at_end, insert_and_replace_event, replace_entire_event_and_sub_events, insert_as_sub_event, delete_event. For replace relations, echo the target's current source in expected_event_source: the edit is refused when the target changed since you read it.`;

const SCRIPT_SECTION_TEXT = `- For 5 or more related operations, or any arithmetic/geometry computation (positions, sizes, counts), write one run_script instead of many tool calls: the script calls the tools as async functions and computes in JavaScript.
- Every tool call inside a script must be awaited, one at a time. A refused approval means nothing in the script ran.`;

const LOOK_VERIFY_SECTION_TEXT = `- After any visual change (instances, scene settings, resources, effects), capture a screenshot (capture_scene_screenshot) before declaring the step done.
- After logic changes (events, behaviors, variables), run a preview (start_preview, then read_preview_logs / get_runtime_errors / inspect_runtime_state) or a gameplay test (run_gameplay_test), and report what you saw.
- Gameplay tests: pass screenshots: "on-failure" (the default advice) so a failing run returns the frame; the executed source is returned on failure — repair it and run again. A "paused" status means the test window was not visible, not a game bug: ask the user to keep the preview visible.
- One preview at a time per chat: stop_preview before starting another.`;

const HYBRID_GROUNDING_SECTION_TEXT = `- Every screenshot comes with a textual state sibling: pair captures with describe_instances / inspect_scene_properties_layers_effects / inspect_runtime_state, and read the outputs.
- When coordinates matter, read them from describe_instances or inspect_runtime_state — never guess from pixels.`;

// Phase 11 authoring reach: the surfaces beyond scenes the agent can now
// read/write, and how they combine. Phase 12 added the discovery stores
// and the runtime steering.
const AUTHORING_REACH_SECTION_TEXT = `- External events (read/add_external_events_source/add_external_events) are reusable event sheets: author them once, then include them from scenes (the "Include external events" event, written as EventScript).
- External layouts (describe/put_external_layout_instances) hold reusable sets of instances — the spawn-point mechanic. Fill one, then spawn it at runtime with "Create objects from external layout".
- Effects: list_effects gives the exact effect_type strings and defaults — never guess an effect type; pick it there and pass its defaults through changed_properties.
- Sprites: describe_sprite_frames first, then change_sprite_frames with typed operations (frames, points, collision masks).
- Real files: import_project_resources brings images/audio/fonts into the project (URL or local path), then reference them by name (set_frame_image, create_or_replace_object…).
- Discovery (Phase 12): search_object_asset_store finds ready-made objects (public/free), search_resource_store finds audio and fonts with direct urls — and create_or_replace_object with search_terms INSTALLS the best asset match by itself.
- Runtime (Phase 12): read_runtime_details, control_runtime and profile_runtime see and steer the preview this chat launched (pause it, dump its state, profile a slow scene). They never touch the project itself.`;

// --- Core sections ---------------------------------------------------------

const buildCoreSections = (): Array<ByokKnowledgeSection> => {
  const roleSection = makeSimpleSection('role', 'Role', 10, ROLE_SECTION_TEXT);

  const toolSection: ByokKnowledgeSection = {
    id: 'tools',
    title: 'Available tools',
    priority: 20,
    // The full advertised list (63 tools with their summaries — Phases 8,
    // 11 and 12's surfaces) must fit: a truncated tool list would hide
    // tools from the model.
    budgetTokens: 2800,
    degradable: false,
    build: context => buildToolSectionText(context.toolNames),
  };

  const projectSection: ByokKnowledgeSection = {
    id: 'project-context',
    title: 'Project context',
    priority: 30,
    budgetTokens: 300,
    degradable: false,
    build: context =>
      context.hasOpenedProject
        ? makeSectionText('Project context', PROJECT_OPEN_SECTION_TEXT)
        : makeSectionText('Project context', NO_PROJECT_SECTION_TEXT),
  };

  const projectNotesSection: ByokKnowledgeSection = {
    id: 'project-notes',
    title: 'Notes about this project',
    priority: 35,
    budgetTokens: 300,
    // The user's accumulated project knowledge must not silently vanish.
    degradable: false,
    build: context => {
      const notes = context.projectNotes;
      if (!notes) return '';
      const noteLines: Array<string> = [];
      if (notes.conventions.trim()) {
        noteLines.push(`Conventions: ${notes.conventions.trim()}`);
      }
      if (notes.inProgress.trim()) {
        noteLines.push(`In progress: ${notes.inProgress.trim()}`);
      }
      if (notes.decisions.trim()) {
        noteLines.push(`Decisions: ${notes.decisions.trim()}`);
      }
      if (noteLines.length === 0) return '';
      return makeSectionText(
        'Notes about this project (maintained by you with update_project_notes)',
        noteLines.join('\n')
      );
    },
  };

  const outputRulesSection = makeSimpleSection(
    'output-rules',
    'Output rules',
    40,
    OUTPUT_RULES_SECTION_TEXT
  );
  const planningSection = makeSimpleSection(
    'planning',
    'Planning and progress',
    50,
    PLANNING_SECTION_TEXT
  );
  const agentsSection = makeSimpleSection(
    'agents',
    'Agents policy',
    60,
    AGENTS_SECTION_TEXT
  );
  const eventScriptCoreSection = makeSimpleSection(
    'eventscript-core',
    'Writing events (add_scene_events)',
    70,
    EVENT_SCRIPT_CORE_SECTION_TEXT
  );
  const scriptSection = makeSimpleSection(
    'script-batching',
    'Batching work with run_script',
    80,
    SCRIPT_SECTION_TEXT
  );
  const lookVerifySection = makeSimpleSection(
    'look-verify',
    'Look and verify',
    90,
    LOOK_VERIFY_SECTION_TEXT
  );
  const groundingSection = makeSimpleSection(
    'hybrid-grounding',
    'Screenshots and state',
    100,
    HYBRID_GROUNDING_SECTION_TEXT
  );
  const authoringReachSection = makeSimpleSection(
    'authoring-reach',
    'Authoring reach: external events, layouts, effects, sprites, files',
    105,
    AUTHORING_REACH_SECTION_TEXT
  );

  const skillsSection: ByokKnowledgeSection = {
    id: 'skills-appendix',
    title: 'Available skills',
    priority: 110,
    budgetTokens: 600,
    // The metadata-only level of the skills system: without it the model
    // cannot know what to load.
    degradable: false,
    build: context => {
      if (context.skills.length === 0) return '';
      const skillLines = context.skills.map(
        skill => `- ${skill.name}: ${skill.description}`
      );
      return [
        'Available skills (load one with the load_skill tool when its topic matters for the task):',
        ...skillLines,
      ].join('\n');
    },
  };

  const customInstructionsSection: ByokKnowledgeSection = {
    id: 'custom-instructions',
    title: "The user's custom instructions",
    priority: 999,
    budgetTokens: 500,
    // The user's own rules are never degraded or dropped.
    degradable: false,
    build: context => {
      const trimmed = context.customInstructions.trim();
      if (!trimmed) return '';
      return makeSectionText(
        "The user's custom instructions (follow them)",
        trimmed
      );
    },
  };

  return [
    roleSection,
    toolSection,
    projectSection,
    projectNotesSection,
    outputRulesSection,
    planningSection,
    agentsSection,
    eventScriptCoreSection,
    scriptSection,
    lookVerifySection,
    groundingSection,
    authoringReachSection,
    skillsSection,
    customInstructionsSection,
  ];
};

// --- Registry --------------------------------------------------------------

const registeredSections: Map<string, ByokKnowledgeSection> = new Map();
let isCoreRegistered = false;

/**
 * Register a section. The core sections are registered once on first use;
 * knowledge modules call this at import time with a priority above the core
 * (>= 200). Registering an id twice is a no-op, so re-imports are safe.
 */
export const registerByokKnowledgeSection = (
  section: ByokKnowledgeSection
): void => {
  if (registeredSections.has(section.id)) return;
  registeredSections.set(section.id, section);
};

/** All registered sections, in priority order (stable, lowest first). */
export const getByokKnowledgeSections = (): Array<ByokKnowledgeSection> => {
  if (!isCoreRegistered) {
    for (const section of buildCoreSections()) {
      registerByokKnowledgeSection(section);
    }
    isCoreRegistered = true;
  }
  return Array.from(registeredSections.values()).sort(
    (a, b) => a.priority - b.priority
  );
};

/** Forget every registered section (tests only). */
export const resetByokKnowledgeSectionsForTests = (): void => {
  registeredSections.clear();
  isCoreRegistered = false;
};

// --- Composer --------------------------------------------------------------

/**
 * The one-line summary a degradable section collapses to when it does not
 * fit: its title and first sentence, with the pointer to the full body.
 */
export const summarizeByokSectionText = (sectionText: string): string => {
  const lines = sectionText.split('\n').filter(line => line.trim());
  const firstLine = lines.length > 0 ? lines[0] : sectionText;
  return `${firstLine}\n(The rest of this section was shortened to save context — its full content is reachable via the skills and tools.)`;
};

/**
 * The budgeted composition: sections in priority order, in full while the
 * (global and per-section) budgets allow, degraded to one-line summaries —
 * or dropped — once they do not. Pure: same inputs, same prompt.
 */
export const composeByokPromptSections = (
  sections: Array<ByokKnowledgeSection>,
  context: ByokPromptContext,
  budgetTokens: number = BYOK_SYSTEM_PROMPT_BUDGET_TOKENS
): {|
  text: string,
  degradedSectionIds: Array<string>,
  droppedSectionIds: Array<string>,
  estimatedTokens: number,
|} => {
  const parts: Array<string> = [];
  const degradedSectionIds: Array<string> = [];
  const droppedSectionIds: Array<string> = [];
  let usedTokens = 0;

  for (const section of sections) {
    const sectionText = section.build(context);
    if (!sectionText.trim()) continue;

    const sectionTokens = estimateByokTokens(sectionText);
    const exceedsOwnBudget = sectionTokens > section.budgetTokens;
    const exceedsGlobalBudget = usedTokens + sectionTokens > budgetTokens;
    const mustDegrade =
      section.degradable && (exceedsOwnBudget || exceedsGlobalBudget);
    const mustTruncate = !section.degradable && exceedsOwnBudget;

    if (mustDegrade) {
      const summaryText = summarizeByokSectionText(sectionText);
      const summaryTokens = estimateByokTokens(summaryText);
      if (usedTokens + summaryTokens <= budgetTokens) {
        parts.push(summaryText);
        usedTokens += summaryTokens;
        degradedSectionIds.push(section.id);
      } else {
        droppedSectionIds.push(section.id);
      }
      continue;
    }

    if (mustTruncate) {
      const maxChars = section.budgetTokens * BYOK_CHARS_PER_TOKEN;
      const truncatedText = `${sectionText.slice(
        0,
        maxChars
      )}\n…[section truncated to fit the context budget]`;
      parts.push(truncatedText);
      usedTokens += estimateByokTokens(truncatedText);
      continue;
    }

    parts.push(sectionText);
    usedTokens += sectionTokens;
  }

  return {
    text: parts.join('\n\n'),
    degradedSectionIds,
    droppedSectionIds,
    estimatedTokens: usedTokens,
  };
};

// --- Context ---------------------------------------------------------------

/**
 * A complete prompt context from partial inputs: every caller that does not
 * care about skills, notes or custom instructions gets the defaults, and the
 * orchestrator only sets what it has.
 */
export const makeByokPromptContext = (options: {|
  toolNames: Array<string>,
  hasOpenedProject: boolean,
  skills?: Array<ByokSkillMetadata>,
  engineReferenceAvailable?: boolean,
  docsAvailable?: boolean,
  projectNotes?: ?ByokProjectNotes,
  customInstructions?: string,
|}): ByokPromptContext => ({
  toolNames: options.toolNames,
  hasOpenedProject: options.hasOpenedProject,
  skills: options.skills || [],
  engineReferenceAvailable: options.engineReferenceAvailable || false,
  docsAvailable: options.docsAvailable || false,
  projectNotes: options.projectNotes || null,
  customInstructions: options.customInstructions || '',
});

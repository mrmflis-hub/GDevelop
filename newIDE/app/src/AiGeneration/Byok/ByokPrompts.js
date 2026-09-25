// @flow
import {
  composeByokPromptSections,
  getByokKnowledgeSections,
  makeByokPromptContext,
  type ByokPromptContext,
} from './Knowledge/ByokKnowledgeSections';
// The knowledge modules register their sections at import time — importing
// them here guarantees the composed prompt is complete no matter which
// entry point loads the prompt first.
import './ByokEngineReference';
import './Knowledge/ByokEventScriptPack';
import './Knowledge/ByokGameDesignPack';
import './Knowledge/ByokMathPhysicsPack';
import './Knowledge/ByokJsApiPack';

/**
 * The system prompt of the BYOK agent loop, composed from the registered
 * knowledge sections under a token budget (see Knowledge/ByokKnowledgeSections).
 * GDevelop's own prompts are server-side and unavailable, so BYOK owns this
 * one. Quality here decides BYOK quality.
 *
 * Bump BYOK_AGENT_PROMPT_VERSION whenever a change alters the prompt's
 * behavior, and note it in the worklog. byok-v9 (Phase 13): the tiered tool
 * advertisement (core list inline, the rest via the search_tools meta-tool),
 * the retrieval map + task catalog, and the pinned EventScript block (13.6).
 * byok-v8 (Phase 12): discovery and runtime — the starter-catalog guidance
 * in the no-project section, the store-search and runtime-steering lines in
 * the authoring-reach section, read_project_notes and the seven new tools
 * in the tool list. byok-v7 (Phase 11): the authoring-reach section
 * (external events & layouts, effects catalog, sprite internals, resource
 * import) and the eight new tools in the tool list. byok-v6 (Phase 8): the
 * single-agent section became the agents policy (scout/reviewer delegation,
 * completion rules, skill pointers). byok-v5 (Phase 7): section composer
 * with a token budget + the F2 progress discipline in the planning section.
 */
export const BYOK_AGENT_PROMPT_VERSION: string = 'byok-v9';

/**
 * Build the system prompt of the BYOK agent loop. The signature keeps the
 * two original options (they win over the context, so the advertised tools
 * always match the schemas sent with the turn); the optional `context`
 * carries the enrichments (skills metadata, knowledge flags, project notes,
 * custom instructions) — absent, the defaults are used.
 */
export const buildByokSystemPrompt = (options: {|
  toolNames: Array<string>,
  hasOpenedProject: boolean,
  context?: ByokPromptContext,
|}): string => {
  const promptContext: ByokPromptContext = options.context
    ? {
        ...options.context,
        toolNames: options.toolNames,
        hasOpenedProject: options.hasOpenedProject,
      }
    : makeByokPromptContext({
        toolNames: options.toolNames,
        hasOpenedProject: options.hasOpenedProject,
      });

  const composition = composeByokPromptSections(
    getByokKnowledgeSections(),
    promptContext
  );
  console.info(
    `BYOK system prompt (${BYOK_AGENT_PROMPT_VERSION}): ~${
      composition.estimatedTokens
    } tokens, ${composition.degradedSectionIds.length} section(s) degraded.`
  );
  return composition.text;
};

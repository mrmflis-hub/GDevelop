// @flow
import {
  byokApplySceneEventBatches,
  type ByokEventBatch,
} from './ByokLocalEventWriter';
import { makeByokRuntimeTools } from './ByokRuntimeTools';
import type { ByokRuntimeToolDeps } from './ByokRuntimeTools';
// Importing the engine reference module also registers its always-on
// cheat-sheet knowledge section.
import { searchByokEngineReference } from './ByokEngineReference';
import { findByNameokSkill, listByokSkillMetadata } from './ByokSkills';
import {
  searchByokDocs,
  readByokDocPage,
  listByokBundledDocPages,
} from './ByokDocs';
import {
  loadByokProjectNotes,
  mergeByokProjectNotes,
  saveByokProjectNotes,
} from './ByokProjectNotes';

/**
 * The BYOK interception registry: tools the orchestrator resolves itself,
 * BEFORE the editor registry lookup — either because the registry
 * implementation would call GDevelop's backend (add_scene_events posts to
 * the event-generation job upstream; the BYOK implementation in
 * ByokLocalEventWriter is fully client-side), because the name only
 * exists as an alias a model may emit out of hosted-agent habit
 * (generate_events), or because the result must be shaped before the model
 * reads it (run_gameplay_test screenshots, Phase 6).
 */

/** Everything an intercepted tool may need from its host. */
export type ByokExtraToolCollaborators = {|
  // The live project, read at call time (a chat can create its project
  // mid-flight — see the getter injection in AskAiEditorContainer).
  getProject: () => any,
  onSceneEventsModifiedOutsideEditor: (changes: any) => void,
  // The perception tools' dependencies (screenshots, previews, the image
  // pipeline, single registry calls) — absent in environments without
  // them, where the tools answer with actionable failures.
  runtimeDeps?: ByokRuntimeToolDeps,
  // The user's "online docs expansion" setting (Phase 7.7): when true,
  // read_doc may fetch pages that are not bundled.
  onlineDocsEnabled?: boolean,
  // The storage identifier of the open project's notes (Phase 7.8): the
  // file identifier of the project, or a name-hash fallback. Null while no
  // project is open.
  getProjectNotesIdentifier?: () => string | null,
|};

export type ByokExtraToolResult = {|
  // The tool output serialized to the model, mirroring the editor runner's
  // `{success, message, …}` shape.
  output: Object,
  // True when the call changed the project (approval gating and unsaved
  // changes rely on it).
  didModifyProject: boolean,
  // The image ids the output references (materialized at replay time —
  // see ByokTranscript).
  images?: Array<string>,
|};

export type ByokExtraTool = {|
  name: string,
  run: (
    args: Object,
    collaborators: ByokExtraToolCollaborators
  ) => Promise<ByokExtraToolResult>,
|};

/**
 * Read the batches argument defensively: it is model-provided JSON, so a
 * wrong shape must degrade into a failure output, never a crash.
 */
const readEventBatches = (args: Object): Array<ByokEventBatch> => {
  if (!Array.isArray(args.event_batches)) return [];
  return args.event_batches.map(batch =>
    batch && typeof batch === 'object' ? batch : {}
  );
};

/**
 * add_scene_events and its hosted alias generate_events: one shared
 * implementation writing the events locally.
 */
const makeLocalEventWritingTool = (name: string): ByokExtraTool => ({
  name,
  run: async (args, collaborators) => {
    const output = byokApplySceneEventBatches({
      project: collaborators.getProject(),
      sceneName: typeof args.scene_name === 'string' ? args.scene_name : '',
      eventBatches: readEventBatches(args),
      onSceneEventsModifiedOutsideEditor:
        collaborators.onSceneEventsModifiedOutsideEditor,
    });
    return { output, didModifyProject: output.success };
  },
});

/**
 * search_reference: query the generated engine reference catalog, so the
 * model can look up the exact name and parameters of any instruction,
 * object, behavior or expression instead of guessing them. Results are
 * compacted (descriptions trimmed, parameters capped) so the 40-entry cap
 * stays well under the tool-output budget.
 */
const compactReferenceEntry = (entry: {
  kind: string,
  owner: string,
  name: string,
  description: string,
  parameters: Array<{| type: string, description: string |}>,
}) => ({
  kind: entry.kind,
  owner: entry.owner,
  name: entry.name,
  description:
    entry.description.length > 200
      ? `${entry.description.slice(0, 200)}…`
      : entry.description,
  parameters: entry.parameters.slice(0, 8).map(parameter => ({
    type: parameter.type,
    description:
      parameter.description.length > 80
        ? `${parameter.description.slice(0, 80)}…`
        : parameter.description,
  })),
});

const readOptionalString = (value: mixed): string | void =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const makeSearchReferenceTool = (): ByokExtraTool => ({
  name: 'search_reference',
  run: async args => {
    const result = searchByokEngineReference({
      query: typeof args.query === 'string' ? args.query : '',
      kind: readOptionalString(args.kind),
      owner: readOptionalString(args.owner),
    });
    if (!result.available) {
      return {
        output: {
          success: false,
          message:
            'The engine reference is not available in this environment. Rely on the read tools to discover what the project supports.',
        },
        didModifyProject: false,
      };
    }
    const lines = [
      result.entries.length === 0
        ? 'No entry matched the query. Try a shorter or more general query.'
        : `${result.totalMatches} match(es), showing ${result.entries.length}:`,
    ];
    if (result.steeringLine) lines.push(result.steeringLine);
    return {
      output: {
        success: true,
        message: lines.join(' '),
        entries: result.entries.map(compactReferenceEntry),
      },
      didModifyProject: false,
    };
  },
});

/**
 * load_skill: the on-demand level of the skills system — the body becomes a
 * tool output, which stays in the conversation (it is never re-loaded per
 * turn). An unknown name lists what is available so the model can correct
 * itself.
 */
const makeLoadSkillTool = (): ByokExtraTool => ({
  name: 'load_skill',
  run: async args => {
    const name = typeof args.name === 'string' ? args.name.trim() : '';
    if (!name) {
      return {
        output: {
          success: false,
          message: 'The "name" of the skill to load is required.',
        },
        didModifyProject: false,
      };
    }
    const skill = await findByNameokSkill(name);
    if (!skill) {
      const skills = await listByokSkillMetadata();
      return {
        output: {
          success: false,
          message: `No skill named "${name}". Available skills: ${skills
            .map(skill => skill.name)
            .join(', ') || '(none)'}.`,
        },
        didModifyProject: false,
      };
    }
    return {
      output: {
        success: true,
        message: `Skill "${
          skill.name
        }" loaded — its instructions stay available for the rest of the conversation.`,
        skill: { name: skill.name, body: skill.body },
      },
      didModifyProject: false,
    };
  },
});

/**
 * search_docs: the bundled documentation subset (see ByokDocs.js), searched
 * as plain substrings. Returns page paths + titles; read_doc reads them.
 */
const makeSearchDocsTool = (): ByokExtraTool => ({
  name: 'search_docs',
  run: async args => {
    const query = typeof args.query === 'string' ? args.query : '';
    const { results, truncated } = searchByokDocs(query);
    const lines = results.map(
      result =>
        `- ${result.path} — ${result.title} (matched in ${result.matchedIn})`
    );
    if (truncated) {
      lines.push(
        `Showing the first ${
          results.length
        } matches — make the query more specific to narrow them.`
      );
    }
    return {
      output: {
        success: true,
        message:
          results.length === 0
            ? 'No documentation page matched. Try a more general query.'
            : `${results.length} page(s) found. Read one with read_doc.`,
        pages: lines,
      },
      didModifyProject: false,
    };
  },
});

/**
 * read_doc: one bundled (or, when the user enabled it, online-cached)
 * documentation page, capped, optionally sliced to one section.
 */
const makeReadDocTool = (): ByokExtraTool => ({
  name: 'read_doc',
  run: async (args, collaborators) => {
    const page = typeof args.page === 'string' ? args.page.trim() : '';
    if (!page) {
      return {
        output: {
          success: false,
          message:
            'The "page" to read is required (a path from search_docs, e.g. "events/index.md").',
        },
        didModifyProject: false,
      };
    }
    const result = await readByokDocPage(page, {
      anchor: readOptionalString(args.anchor),
      onlineEnabled: !!collaborators.onlineDocsEnabled,
    });
    return {
      output: {
        success: result.found,
        message:
          result.origin === 'bundled'
            ? `Read from the bundled docs.`
            : result.origin === 'cache'
            ? 'Read from the local cache of the online docs.'
            : result.content,
        page: result.path,
        title: result.title,
        content: result.content,
        truncated: result.truncated,
        bundledPages: result.found
          ? undefined
          : listByokBundledDocPages().map(p => p.path),
      },
      didModifyProject: false,
    };
  },
});

/**
 * update_project_notes: the model's persistent memory of the project.
 * Merge semantics (absent field = unchanged), capped storage, and an
 * explicit answer when no project is open.
 */
const makeUpdateProjectNotesTool = (): ByokExtraTool => ({
  name: 'update_project_notes',
  run: async (args, collaborators) => {
    const identifier =
      collaborators.getProjectNotesIdentifier &&
      collaborators.getProjectNotesIdentifier();
    if (!identifier) {
      return {
        output: {
          success: false,
          message:
            'No project is open: the notes are written once a project exists (initialize_project creates one).',
        },
        didModifyProject: false,
      };
    }
    const existing = await loadByokProjectNotes(identifier);
    const merged = mergeByokProjectNotes(existing, {
      conventions:
        typeof args.conventions === 'string' ? args.conventions : undefined,
      inProgress:
        typeof args.inProgress === 'string' ? args.inProgress : undefined,
      decisions:
        typeof args.decisions === 'string' ? args.decisions : undefined,
    });
    const saved = await saveByokProjectNotes(identifier, merged);
    if (!saved) {
      return {
        output: {
          success: false,
          message:
            'The notes are too large to save. Shorten them (each field is capped, keep only what future chats must know).',
        },
        didModifyProject: false,
      };
    }
    return {
      output: {
        success: true,
        message:
          'Project notes updated — they will be visible in future chats.',
        notes: merged,
      },
      didModifyProject: false,
    };
  },
});

const BYOK_EXTRA_TOOLS: Array<ByokExtraTool> = [
  makeLocalEventWritingTool('add_scene_events'),
  makeLocalEventWritingTool('generate_events'),
  makeSearchReferenceTool(),
  makeLoadSkillTool(),
  makeSearchDocsTool(),
  makeReadDocTool(),
  makeUpdateProjectNotesTool(),
  ...makeByokRuntimeTools(),
];

/** All the intercepted tools (a fresh read: the list may grow per phase). */
export const getByokExtraTools = (): Array<ByokExtraTool> =>
  BYOK_EXTRA_TOOLS.slice();

/** The intercepted tool of this name, or null when the name is not one. */
export const findByNameokExtraTool = (name: string): ByokExtraTool | null => {
  return BYOK_EXTRA_TOOLS.find(tool => tool.name === name) || null;
};

// @flow
import {
  byokApplySceneEventBatches,
  type ByokEventBatch,
} from './ByokLocalEventWriter';
import { makeByokRuntimeTools } from './ByokRuntimeTools';
import type { ByokRuntimeToolDeps } from './ByokRuntimeTools';

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

const BYOK_EXTRA_TOOLS: Array<ByokExtraTool> = [
  makeLocalEventWritingTool('add_scene_events'),
  makeLocalEventWritingTool('generate_events'),
  ...makeByokRuntimeTools(),
];

/** All the intercepted tools (a fresh read: the list may grow per phase). */
export const getByokExtraTools = (): Array<ByokExtraTool> =>
  BYOK_EXTRA_TOOLS.slice();

/** The intercepted tool of this name, or null when the name is not one. */
export const findByNameokExtraTool = (name: string): ByokExtraTool | null => {
  return BYOK_EXTRA_TOOLS.find(tool => tool.name === name) || null;
};

// @flow
import {
  findByNameokExtraTool,
  getByokExtraTools,
  type ByokExtraToolCollaborators,
} from './ByokExtraTools';
import { BYOK_ONLY_TOOL_NAMES } from './ByokToolSchema';

const gd: libGDevelop = global.gd;

const makeCollaborators = (project: any): ByokExtraToolCollaborators => ({
  getProject: () => project,
  onSceneEventsModifiedOutsideEditor: (jest.fn(): any),
});

describe('getByokExtraTools / findByNameokExtraTool', () => {
  it('registers the local event-writing tools and the Phase 6 perception tools', () => {
    const names = getByokExtraTools().map(tool => tool.name);
    expect(names).toContain('add_scene_events');
    expect(names).toContain('generate_events');
    expect(names).toContain('capture_scene_screenshot');
    expect(names).toContain('capture_preview_screenshot');
    expect(names).toContain('start_preview');
    expect(names).toContain('stop_preview');
    expect(names).toContain('read_preview_logs');
    expect(names).toContain('get_runtime_errors');
    expect(names).toContain('inspect_runtime_state');
    expect(names).toContain('run_gameplay_test');
  });

  it('finds a tool by name and returns null for the others', () => {
    expect(findByNameokExtraTool('add_scene_events')).not.toBeNull();
    expect(findByNameokExtraTool('generate_events')).not.toBeNull();
    expect(findByNameokExtraTool('describe_instances')).toBeNull();
    expect(findByNameokExtraTool('run_script')).toBeNull();
  });
});

describe('add_scene_events interception tool', () => {
  let project: any;

  beforeEach(() => {
    project = gd.ProjectHelper.createNewGDJSProject();
    project.insertNewLayout('TestScene', 0);
  });

  afterEach(() => {
    project.delete();
  });

  const runTool = async (args: Object, collaborators: any) => {
    const tool = findByNameokExtraTool('add_scene_events');
    if (!tool) throw new Error('add_scene_events tool not found');
    return tool.run(args, collaborators);
  };

  it('applies the batches locally and reports a project modification', async () => {
    const collaborators = makeCollaborators(project);
    const result = await runTool(
      {
        scene_name: 'TestScene',
        event_batches: [
          {
            event_script: 'always:\n  Wait(1)',
            placement_relation: 'insert_at_end',
          },
        ],
      },
      collaborators
    );

    expect(result.output.success).toBe(true);
    expect(result.didModifyProject).toBe(true);
    expect(
      collaborators.onSceneEventsModifiedOutsideEditor
    ).toHaveBeenCalledTimes(1);
  });

  it('degrades a wrong argument shape into a failure output, never a crash', async () => {
    const collaborators = makeCollaborators(project);

    const noScene = await runTool({}, collaborators);
    expect(noScene.output.success).toBe(false);

    const noBatches = await runTool({ scene_name: 'TestScene' }, collaborators);
    expect(noBatches.output.success).toBe(false);
    expect(noBatches.didModifyProject).toBe(false);

    const badBatches = await runTool(
      { scene_name: 'TestScene', event_batches: 'not-an-array' },
      collaborators
    );
    expect(badBatches.output.success).toBe(false);
  });

  it('answers generate_events identically (the hosted alias)', async () => {
    const collaborators = makeCollaborators(project);
    const tool = findByNameokExtraTool('generate_events');
    if (!tool) throw new Error('generate_events tool not found');

    const result = await tool.run(
      {
        scene_name: 'TestScene',
        event_batches: [
          {
            event_script: 'always:\n  Wait(3)',
            placement_relation: 'insert_at_end',
          },
        ],
      },
      collaborators
    );

    expect(result.output.success).toBe(true);
    expect(result.didModifyProject).toBe(true);
  });
});

describe('BYOK-only tools are all intercepted', () => {
  it('finds an interception for every BYOK_ONLY_TOOL_NAME', () => {
    // The validator skips the registry check for these names — this is the
    // counterpart guarantee: they exist because ByokExtraTools runs them.
    for (const name of BYOK_ONLY_TOOL_NAMES) {
      expect(findByNameokExtraTool(name)).not.toBeNull();
    }
  });
});

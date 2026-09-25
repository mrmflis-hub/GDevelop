// @flow
import {
  flushByokExtensionRegeneration,
  findByokExtensionUsages,
  getByokExtensionTools,
  isByokExtensionToolShadowedByRegistry,
  resetByokExtensionBatchForTests,
} from './ByokExtensionTools';
import { findByNameokExtraTool } from './ByokExtraTools';
import { getByokDispatchableToolNames } from './ByokToolSchema';

/**
 * The extension authoring tools (Phase 8.4) drive libGD directly — the
 * tests use the real WASM build (the established pattern, see
 * ByokLocalEventWriter.spec.js).
 */
const gd: libGDevelop = global.gd;

const makeCollaborators = (project: any, overrides: Object = {}) => ({
  getProject: () => project,
  onSceneEventsModifiedOutsideEditor: (jest.fn(): any),
  ...overrides,
});

const runTool = async (
  name: string,
  args: Object,
  collaborators: Object
): Promise<any> => {
  const tool = findByNameokExtraTool(name);
  if (!tool) throw new Error(`Tool "${name}" not intercepted.`);
  return tool.run(args, collaborators);
};

describe('ByokExtensionTools: registration and guards', () => {
  it('registers every tool in the interception registry', () => {
    const names = getByokExtensionTools().map(tool => tool.name);
    expect(names).toEqual([
      'create_extension',
      'change_extension_properties',
      'create_custom_object',
      'change_custom_object',
      'create_custom_behavior',
      'change_custom_behavior',
      'create_custom_function',
      'change_custom_function',
      'find_extension_usages',
    ]);
    for (const name of names) {
      expect(findByNameokExtraTool(name)).toBeTruthy();
    }
    // Every tool is dispatchable through the standard whitelist.
    const dispatchable = new Set(getByokDispatchableToolNames());
    for (const name of names) {
      expect(dispatchable.has(name)).toBe(true);
    }
  });

  it('is not shadowed today, and never applies outside the extension tools', () => {
    // The extension tools have no registry entry in master: the guard
    // stays false (our interception runs).
    expect(isByokExtensionToolShadowedByRegistry('create_extension')).toBe(
      false
    );
    // The deliberately-intercepted tools are NOT covered by the guard,
    // even though add_scene_events has a real registry implementation.
    expect(isByokExtensionToolShadowedByRegistry('add_scene_events')).toBe(
      false
    );
    expect(isByokExtensionToolShadowedByRegistry('run_gameplay_test')).toBe(
      false
    );
  });
});

describe('ByokExtensionTools: create → change → regenerate', () => {
  let project: any = null;

  beforeEach(() => {
    resetByokExtensionBatchForTests();
    project = gd.ProjectHelper.createNewGDJSProject();
  });

  afterEach(() => {
    project.delete();
    project = null;
  });

  it('creates an extension, a custom behavior, a custom object and a function', async () => {
    const collaborators = makeCollaborators(project);

    const created = await runTool(
      'create_extension',
      {
        extension_name: 'CoinLogic',
        full_name: 'Coin logic',
        version: '1.0.0',
      },
      collaborators
    );
    expect(created.output.success).toBe(true);
    expect(project.hasEventsFunctionsExtensionNamed('CoinLogic')).toBe(true);
    expect(project.getEventsFunctionsExtension('CoinLogic').getVersion()).toBe(
      '1.0.0'
    );

    const behavior = await runTool(
      'create_custom_behavior',
      {
        extension_name: 'CoinLogic',
        custom_behavior_name: 'Magnet',
        description: 'Attracts coins',
      },
      collaborators
    );
    expect(behavior.output.success).toBe(true);
    expect(behavior.output.behavior_type).toBe('CoinLogic::Magnet');

    const object = await runTool(
      'create_custom_object',
      {
        extension_name: 'CoinLogic',
        custom_object_name: 'Coin',
        default_name: 'Coin',
      },
      collaborators
    );
    expect(object.output.success).toBe(true);
    expect(object.output.object_type).toBe('CoinLogic::Coin');

    // A function with an EventScript body, on the behavior.
    const behaviorFunction = await runTool(
      'create_custom_function',
      {
        extension_name: 'CoinLogic',
        custom_behavior_name: 'Magnet',
        function_name: 'doStepPreEvents',
        function_type: 'Action',
        event_script: 'always:\n  Wait(0.1)',
      },
      collaborators
    );
    expect(behaviorFunction.output.success).toBe(true);

    // A free expression function with typed parameters.
    const expression = await runTool(
      'create_custom_function',
      {
        extension_name: 'CoinLogic',
        function_name: 'CountCoins',
        function_type: 'Expression',
        parameters: [
          { name: 'Multiplier', type: 'expression', description: 'The factor' },
        ],
        event_script: 'always:\n  Wait(0.05)',
      },
      collaborators
    );
    expect(expression.output.success).toBe(true);
    const extension = project.getEventsFunctionsExtension('CoinLogic');
    const eventsFunction = extension
      .getEventsFunctions()
      .getEventsFunction('CountCoins');
    expect(eventsFunction.isExpression()).toBe(true);
    expect(eventsFunction.getParameters().getParametersCount()).toBe(1);

    // The behavior function really carries the parsed events.
    const magnetFunctions = extension
      .getEventsBasedBehaviors()
      .get('Magnet')
      .getEventsFunctions();
    expect(magnetFunctions.hasEventsFunctionNamed('doStepPreEvents')).toBe(
      true
    );
    expect(
      magnetFunctions
        .getEventsFunction('doStepPreEvents')
        .getEvents()
        .getEventsCount()
    ).toBeGreaterThan(0);
  });

  it('changes and renames with project-wide reference updates', async () => {
    const collaborators = makeCollaborators(project);
    await runTool(
      'create_extension',
      { extension_name: 'OldName' },
      collaborators
    );
    await runTool(
      'create_custom_function',
      {
        extension_name: 'OldName',
        function_name: 'DoThing',
        function_type: 'Action',
        event_script: 'always:\n  Wait(0.1)',
      },
      collaborators
    );

    const renamed = await runTool(
      'change_extension_properties',
      { extension_name: 'OldName', new_name: 'New Name' },
      collaborators
    );
    expect(renamed.output.success).toBe(true);
    // The safe name is applied.
    expect(project.hasEventsFunctionsExtensionNamed('New_Name')).toBe(true);
    expect(project.hasEventsFunctionsExtensionNamed('OldName')).toBe(false);
    // The function survived the rename.
    expect(
      project
        .getEventsFunctionsExtension('New_Name')
        .getEventsFunctions()
        .hasEventsFunctionNamed('DoThing')
    ).toBe(true);

    // Function rename through change_custom_function.
    const functionRenamed = await runTool(
      'change_custom_function',
      {
        extension_name: 'New_Name',
        function_name: 'DoThing',
        new_name: 'DoBetterThing',
      },
      collaborators
    );
    expect(functionRenamed.output.success).toBe(true);
    expect(
      project
        .getEventsFunctionsExtension('New_Name')
        .getEventsFunctions()
        .hasEventsFunctionNamed('DoBetterThing')
    ).toBe(true);
  });

  it('regenerates once per batch, full after structural changes, metadata-only otherwise', async () => {
    const reloadAll = jest.fn(async () => {});
    const reloadMetadata = (jest.fn(): any);
    const collaborators = makeCollaborators(project, {
      reloadEventsFunctionsExtensions: reloadAll,
      reloadEventsFunctionsExtensionMetadata: reloadMetadata,
    });

    // Batch 1: a metadata-only change (create_extension).
    await runTool(
      'create_extension',
      { extension_name: 'MetaOnly' },
      collaborators
    );
    await flushByokExtensionRegeneration(project, collaborators);
    expect(reloadAll).not.toHaveBeenCalled();
    expect(reloadMetadata).toHaveBeenCalledTimes(1);

    // Batch 2: a structural change (a function).
    await runTool(
      'create_custom_function',
      {
        extension_name: 'MetaOnly',
        function_name: 'DoThing',
        function_type: 'Action',
      },
      collaborators
    );
    // Several calls in the same batch flush once:
    await runTool(
      'change_custom_function',
      {
        extension_name: 'MetaOnly',
        function_name: 'DoThing',
        changed_settings: [{ property_name: 'description', new_value: 'd' }],
      },
      collaborators
    );
    await flushByokExtensionRegeneration(project, collaborators);
    expect(reloadAll).toHaveBeenCalledTimes(1);
    expect(reloadMetadata).toHaveBeenCalledTimes(1);

    // The call order within a flush: the full reload replaces the
    // metadata reload (never both for the same batch).
    const reloadAllOrder: any = (reloadAll: any);
    const reloadMetadataOrder: any = (reloadMetadata: any);
    expect(reloadAllOrder.mock.invocationCallOrder[0]).toBeGreaterThan(
      reloadMetadataOrder.mock.invocationCallOrder[0]
    );
  });
});

describe('ByokExtensionTools: deletion safety', () => {
  let project: any = null;

  beforeEach(() => {
    resetByokExtensionBatchForTests();
    project = gd.ProjectHelper.createNewGDJSProject();
  });

  afterEach(() => {
    project.delete();
    project = null;
  });

  it('refuses to delete a used custom object, allows it with the override', async () => {
    const collaborators = makeCollaborators(project);
    await runTool(
      'create_extension',
      { extension_name: 'Objects' },
      collaborators
    );
    await runTool(
      'create_custom_object',
      { extension_name: 'Objects', custom_object_name: 'Crate' },
      collaborators
    );

    // Declare an instance of the custom object type in a scene: the type
    // becomes used.
    const layout = project.insertNewLayout('Scene', 0);
    layout.getObjects().insertNewObject(project, 'Objects::Crate', 'Crate', 0);

    const refused = await runTool(
      'change_custom_object',
      {
        extension_name: 'Objects',
        custom_object_name: 'Crate',
        delete_this_custom_object: true,
      },
      collaborators
    );
    expect(refused.output.success).toBe(false);
    expect(refused.output.message).toContain('used in the project');

    const forced = await runTool(
      'change_custom_object',
      {
        extension_name: 'Objects',
        custom_object_name: 'Crate',
        delete_this_custom_object: true,
        delete_even_if_used: true,
      },
      collaborators
    );
    expect(forced.output.success).toBe(true);
    expect(
      project
        .getEventsFunctionsExtension('Objects')
        .getEventsBasedObjects()
        .has('Crate')
    ).toBe(false);
  });

  it('lists the usages of an extension as plain text', async () => {
    const collaborators = makeCollaborators(project);
    await runTool(
      'create_extension',
      { extension_name: 'Used' },
      collaborators
    );
    await runTool(
      'create_custom_object',
      { extension_name: 'Used', custom_object_name: 'Barrel' },
      collaborators
    );

    // Unused for now.
    const empty = await runTool(
      'find_extension_usages',
      { extension_name: 'Used' },
      collaborators
    );
    expect(empty.output.success).toBe(true);
    expect(empty.output.usages).toEqual([]);

    // Use the object type somewhere.
    const layout = project.insertNewLayout('Scene', 0);
    layout.getObjects().insertNewObject(project, 'Used::Barrel', 'Barrel', 0);
    const used = await runTool(
      'find_extension_usages',
      { extension_name: 'Used' },
      collaborators
    );
    expect(used.output.usages.length).toBe(1);
    expect(used.output.usages[0]).toContain('Used::Barrel');

    // The usage list is what blocks the delete.
    const extension = project.getEventsFunctionsExtension('Used');
    expect(findByokExtensionUsages(project, extension).length).toBe(1);
    const refused = await runTool(
      'change_extension_properties',
      { extension_name: 'Used', delete_this_extension: true },
      collaborators
    );
    expect(refused.output.success).toBe(false);
    expect(refused.output.message).toContain('delete_even_if_used');
  });

  it('refuses invalid input instead of crashing', async () => {
    const collaborators = makeCollaborators(project);
    const noName = await runTool('create_extension', {}, collaborators);
    expect(noName.output.success).toBe(false);

    const missing = await runTool(
      'create_custom_function',
      {
        extension_name: 'DoesNotExist',
        function_name: 'F',
        function_type: 'Action',
      },
      collaborators
    );
    expect(missing.output.success).toBe(false);
    expect(missing.output.message).toContain('DoesNotExist');

    await runTool('create_extension', { extension_name: 'X' }, collaborators);
    const badType = await runTool(
      'create_custom_function',
      { extension_name: 'X', function_name: 'F', function_type: 'Wrong' },
      collaborators
    );
    expect(badType.output.success).toBe(false);
    expect(badType.output.message).toContain('function_type');

    const badScript = await runTool(
      'create_custom_function',
      {
        extension_name: 'X',
        function_name: 'F',
        function_type: 'Action',
        // An unparsable EventScript must fail the call, never crash it.
        event_script: 'if ??? not eventscript <<<',
      },
      collaborators
    );
    expect(badScript.output.success).toBe(false);
    expect(badScript.output.message).toContain('not valid');
  });
});

describe('ByokExtensionTools: Phase 11 internals (parameters, children, dependencies)', () => {
  let project: any = null;

  beforeEach(() => {
    resetByokExtensionBatchForTests();
    project = gd.ProjectHelper.createNewGDJSProject();
  });

  afterEach(() => {
    project.delete();
    project = null;
  });

  const makeExtensionWithFunction = async (collaborators: Object) => {
    await runTool(
      'create_extension',
      { extension_name: 'Internals' },
      collaborators
    );
    await runTool(
      'create_custom_function',
      {
        extension_name: 'Internals',
        function_name: 'DoThing',
        function_type: 'Action',
        parameters: [{ name: 'Speed', type: 'expression' }],
      },
      collaborators
    );
  };

  it('adds, moves and removes function parameters', async () => {
    const collaborators = makeCollaborators(project);
    await makeExtensionWithFunction(collaborators);

    const added = await runTool(
      'change_custom_function',
      {
        extension_name: 'Internals',
        function_name: 'DoThing',
        parameters_to_add: [
          { name: 'Label', type: 'string', description: 'A label.' },
          { name: 'Speed', type: 'expression' }, // duplicate: skipped
        ],
      },
      collaborators
    );
    expect(added.output.success).toBe(true);
    expect(added.output.message).toContain('parameters');
    expect(added.output.message).toContain('already exists (skipped)');

    const eventsFunction = project
      .getEventsFunctionsExtension('Internals')
      .getEventsFunctions()
      .getEventsFunction('DoThing');
    const parameters = eventsFunction.getParameters();
    expect(parameters.getParametersCount()).toBe(2);
    expect(parameters.hasParameterNamed('Label')).toBe(true);
    expect(parameters.getParameter('Label').getType()).toBe('string');
    expect(parameters.getParameter('Label').getDescription()).toBe('A label.');

    const moved = await runTool(
      'change_custom_function',
      {
        extension_name: 'Internals',
        function_name: 'DoThing',
        parameters_to_move: [{ name: 'Label', to_index: 0 }],
      },
      collaborators
    );
    expect(moved.output.success).toBe(true);
    expect(parameters.getParameterAt(0).getName()).toBe('Label');

    const removed = await runTool(
      'change_custom_function',
      {
        extension_name: 'Internals',
        function_name: 'DoThing',
        parameters_to_remove: ['Label'],
      },
      collaborators
    );
    expect(removed.output.success).toBe(true);
    expect(parameters.hasParameterNamed('Label')).toBe(false);
    expect(parameters.getParametersCount()).toBe(1);
  });

  it('changes an existing parameter type through the usage refactor', async () => {
    const collaborators = makeCollaborators(project);
    await makeExtensionWithFunction(collaborators);

    // The same hook the extension editor triggers on a type change: the
    // spy proves it is called with the function and the parameter, and
    // that the temporary scoped containers are released afterwards.
    const changeParameterType = jest.spyOn(
      gd.WholeProjectRefactorer,
      'changeParameterType'
    );
    // Count delete() on the wrappers this op creates (the established
    // constructor-replacement pattern, see ByokSpriteTools.spec.js).
    const originalObjectsContainer = gd.ObjectsContainer;
    const containerFunction = originalObjectsContainer.Function;
    let containerDeletes = 0;
    const CountedObjectsContainer = function(): any {
      const instance = new (originalObjectsContainer: any)(containerFunction);
      const originalDelete = instance.delete.bind(instance);
      instance.delete = () => {
        containerDeletes += 1;
        originalDelete();
      };
      return instance;
    };
    (gd: any).ObjectsContainer = CountedObjectsContainer;
    const changed = await runTool(
      'change_custom_function',
      {
        extension_name: 'Internals',
        function_name: 'DoThing',
        parameters_to_add: [{ name: 'Speed', type: 'sceneName' }],
      },
      collaborators
    );
    (gd: any).ObjectsContainer = originalObjectsContainer;
    expect(changed.output.success).toBe(true);
    expect(changed.output.message).toContain(
      'changed the type of "Speed" to sceneName'
    );
    expect(changeParameterType).toHaveBeenCalledTimes(1);
    const calledWith = changeParameterType.mock.calls[0];
    expect(calledWith[0]).toBe(project);
    expect(calledWith[4]).toBe('Speed');
    // The parameter objects container passed to the refactorer is one of
    // the temporary wrappers: it must have been deleted (freed).
    expect(containerDeletes).toBe(1);
    changeParameterType.mockRestore();

    const parameters = project
      .getEventsFunctionsExtension('Internals')
      .getEventsFunctions()
      .getEventsFunction('DoThing')
      .getParameters();
    expect(parameters.getParameter('Speed').getType()).toBe('sceneName');
  });

  it('changes a parameter type inside a custom behavior function', async () => {
    const collaborators = makeCollaborators(project);
    await runTool(
      'create_extension',
      { extension_name: 'Internals' },
      collaborators
    );
    await runTool(
      'create_custom_behavior',
      { extension_name: 'Internals', custom_behavior_name: 'Magnet' },
      collaborators
    );
    await runTool(
      'create_custom_function',
      {
        extension_name: 'Internals',
        custom_behavior_name: 'Magnet',
        function_name: 'DoThing',
        function_type: 'Action',
        parameters: [{ name: 'Force', type: 'expression' }],
      },
      collaborators
    );

    const changed = await runTool(
      'change_custom_function',
      {
        extension_name: 'Internals',
        custom_behavior_name: 'Magnet',
        function_name: 'DoThing',
        parameters_to_add: [{ name: 'Force', type: 'string' }],
      },
      collaborators
    );
    expect(changed.output.success).toBe(true);
    const parameters = project
      .getEventsFunctionsExtension('Internals')
      .getEventsBasedBehaviors()
      .get('Magnet')
      .getEventsFunctions()
      .getEventsFunction('DoThing')
      .getParameters();
    expect(parameters.getParameter('Force').getType()).toBe('string');
  });

  it('adds and removes custom-object children, with the usage guard', async () => {
    const collaborators = makeCollaborators(project);
    await runTool(
      'create_extension',
      { extension_name: 'Internals' },
      collaborators
    );
    await runTool(
      'create_custom_object',
      {
        extension_name: 'Internals',
        custom_object_name: 'Button',
      },
      collaborators
    );

    const added = await runTool(
      'change_custom_object',
      {
        extension_name: 'Internals',
        custom_object_name: 'Button',
        children_to_add: [
          { name: 'Icon', object_type: 'Sprite' },
          { name: 'Icon', object_type: 'Sprite' }, // duplicate: skipped
        ],
      },
      collaborators
    );
    expect(added.output.success).toBe(true);
    const eventsBasedObject = project
      .getEventsFunctionsExtension('Internals')
      .getEventsBasedObjects()
      .get('Button');
    expect(eventsBasedObject.getObjects().hasObjectNamed('Icon')).toBe(true);

    // The usage guard: an event referencing the child blocks the removal.
    const guarded = await runTool(
      'change_custom_object',
      {
        extension_name: 'Internals',
        custom_object_name: 'Button',
        children_to_remove: ['Icon'],
      },
      collaborators
    );
    // The child is not referenced yet: the removal succeeds.
    expect(guarded.output.success).toBe(true);
    expect(eventsBasedObject.getObjects().hasObjectNamed('Icon')).toBe(false);
  });

  it('refuses to remove a child used by the object events', async () => {
    const collaborators = makeCollaborators(project);
    await runTool(
      'create_extension',
      { extension_name: 'Internals' },
      collaborators
    );
    await runTool(
      'create_custom_object',
      { extension_name: 'Internals', custom_object_name: 'Button' },
      collaborators
    );
    await runTool(
      'change_custom_object',
      {
        extension_name: 'Internals',
        custom_object_name: 'Button',
        children_to_add: [{ name: 'Icon', object_type: 'Sprite' }],
      },
      collaborators
    );
    // Reference the child from one of the object's functions (a custom
    // object's logic IS its functions' events), written through the
    // established event_script path.
    const eventsBasedObject = project
      .getEventsFunctionsExtension('Internals')
      .getEventsBasedObjects()
      .get('Button');
    const referenced = await runTool(
      'create_custom_function',
      {
        extension_name: 'Internals',
        custom_object_name: 'Button',
        function_name: 'DoStepPreEvents',
        function_type: 'Action',
        event_script: 'always:\n  Delete(Icon)',
      },
      collaborators
    );
    expect(referenced.output.success).toBe(true);

    const guarded = await runTool(
      'change_custom_object',
      {
        extension_name: 'Internals',
        custom_object_name: 'Button',
        children_to_remove: ['Icon'],
      },
      collaborators
    );
    expect(guarded.output.success).toBe(false);
    expect(guarded.output.message).toContain(
      "used by the custom object's events"
    );
    expect(eventsBasedObject.getObjects().hasObjectNamed('Icon')).toBe(true);
  });

  it('adds a child with initial property values, reporting unknown ones', async () => {
    const collaborators = makeCollaborators(project);
    await runTool(
      'create_extension',
      { extension_name: 'Internals' },
      collaborators
    );
    await runTool(
      'create_custom_object',
      { extension_name: 'Internals', custom_object_name: 'Scoreboard' },
      collaborators
    );
    // Declare a property on the custom object type: children of this type
    // can then receive initial values for it.
    await runTool(
      'change_custom_object',
      {
        extension_name: 'Internals',
        custom_object_name: 'Scoreboard',
        changed_properties: [{ property_name: 'Level', new_value: '1' }],
      },
      collaborators
    );

    const added = await runTool(
      'change_custom_object',
      {
        extension_name: 'Internals',
        custom_object_name: 'Scoreboard',
        children_to_add: [
          {
            name: 'Board',
            object_type: 'Internals::Scoreboard',
            initial_properties: [
              { name: 'Level', value: '3' },
              { name: 'not_a_property', value: 'x' },
            ],
          },
        ],
      },
      collaborators
    );
    expect(added.output.success).toBe(true);
    expect(added.output.message).toContain('added child "Board"');
    // The known property applies; the unknown one is reported, not fatal.
    expect(added.output.message).toContain('not_a_property');

    const eventsBasedObject = project
      .getEventsFunctionsExtension('Internals')
      .getEventsBasedObjects()
      .get('Scoreboard');
    const board = eventsBasedObject.getObjects().getObject('Board');
    const properties = board.getConfiguration().getProperties();
    expect(properties.get('Level').getValue()).toBe('3');
  });

  it('adds and removes extension dependencies, always listing them', async () => {
    const collaborators = makeCollaborators(project);
    await runTool(
      'create_extension',
      { extension_name: 'Internals' },
      collaborators
    );

    const added = await runTool(
      'change_extension_properties',
      {
        extension_name: 'Internals',
        dependencies_to_add: [
          { name: 'cordova-plugin-admob', dependency_type: 'npm' },
        ],
      },
      collaborators
    );
    expect(added.output.success).toBe(true);
    expect(added.output.dependencies).toEqual(['cordova-plugin-admob']);
    const extension = project.getEventsFunctionsExtension('Internals');
    expect(extension.getAllDependencies().size()).toBe(1);
    expect(
      extension
        .getAllDependencies()
        .at(0)
        .getDependencyType()
    ).toBe('npm');

    const removed = await runTool(
      'change_extension_properties',
      {
        extension_name: 'Internals',
        dependencies_to_remove: ['cordova-plugin-admob'],
      },
      collaborators
    );
    expect(removed.output.success).toBe(true);
    expect(removed.output.dependencies).toEqual([]);
    expect(extension.getAllDependencies().size()).toBe(0);
  });
});

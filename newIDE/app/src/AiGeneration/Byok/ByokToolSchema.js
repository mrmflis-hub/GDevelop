// @flow
import {
  editorFunctions,
  editorFunctionsWithoutProject,
} from '../../EditorFunctions';

/**
 * GDevelop's own tool descriptions and argument JSON-schemas live on its
 * servers (the client-side `EditorFunction` type carries none of them), so
 * BYOK owns the schemas of the tools it exposes: they describe exactly the
 * arguments the `launchFunction` implementations read (each schema below was
 * checked against the `SafeExtractor.extract…` calls of its implementation
 * in `EditorFunctions/index.js`). A schema being wrong here can never be
 * broken by an upstream change — but it must be maintained by us.
 */

export type ByokToolSchema = {|
  name: string,
  description: string,
  parameters: {|
    type: 'object',
    properties: Object,
    required: Array<string>,
  |},
|};

// The JSON-schema property types used by the schemas below (and the ones
// the validator accepts). Only string/number/boolean/array/object are
// actually used today; `integer` is allowed for future schemas.
const BYOK_PROPERTY_TYPES: Array<string> = [
  'string',
  'number',
  'boolean',
  'integer',
  'array',
  'object',
];

const stringProperty = (description: string) => ({
  type: 'string',
  description,
});

const numberProperty = (description: string) => ({
  type: 'number',
  description,
});

const booleanProperty = (description: string) => ({
  type: 'boolean',
  description,
});

const arrayProperty = (description: string, items: Object) => ({
  type: 'array',
  description,
  items,
});

const objectProperty = (description: string, properties: Object) => ({
  type: 'object',
  description,
  properties,
});

const enumProperty = (description: string, values: Array<string>) => ({
  type: 'string',
  description,
  enum: values,
});

// The item shape shared by every effect change (object effects and layer
// effects read the same fields through `applyEffectChange`).
const effectChangeProperty = objectProperty('One effect change.', {
  effect_name: stringProperty('Name of the effect to change (or to create).'),
  effect_type: stringProperty(
    'Type of the effect, needed to create an effect that does not exist yet.'
  ),
  new_effect_name: stringProperty(
    'New name of the effect, or the name to give a newly created effect.'
  ),
  new_effect_position: numberProperty(
    'Position of the effect in the list (moves it, or the index where to insert a new one).'
  ),
  delete_this_effect: booleanProperty(
    'Set to true to remove the effect instead of changing it.'
  ),
  changed_properties: arrayProperty(
    'The effect properties to change.',
    objectProperty('One effect property change.', {
      property_name: stringProperty('Name of the effect property.'),
      new_value: stringProperty(
        'New value of the property, as a string (numbers and booleans are parsed).'
      ),
    })
  ),
});

/**
 * The tools exposed to the model by default in BYOK v3 (see
 * REVIEW/phase5-tool-decisions.md for the full admit/exclude table): the
 * read/inspect surface, the edit surface, local event writing and the
 * script agent. Deliberately **excluded**:
 * - `generate_events`: exact upstream alias of `add_scene_events` — not
 *   advertised, but still dispatchable (ByokExtraTools maps it to the same
 *   local implementation).
 * - `create_object`, the legacy aliases (`inspect_object_properties`,
 *   `change_object_property`, `remove_behavior`): covered by their modern
 *   equivalents.
 * - `search_object_asset_store`, `search_resource_store`,
 *   `read_full_docs`, `search_docs`, `run_explorer_agent`, `run_edit_agent`,
 *   `run_tests`, `report_fulfilment_problem`, `get_game_starter_summary`:
 *   server-side stubs (Phase 7/8).
 */ export const BYOK_TOOL_NAMES: Array<string> = [
  'describe_instances',
  'inspect_variables',
  'read_scene_events',
  'read_events_source',
  'read_game_project_json',
  'create_scene',
  'create_or_replace_object',
  'inspect_object_properties_effects',
  'change_object_properties_effects',
  'add_behavior',
  'inspect_behavior_properties',
  'change_behavior_property',
  'inspect_scene_properties_layers_effects',
  'change_scene_properties_layers_effects_groups',
  'inspect_project_properties_resources',
  'change_project_properties_resources',
  'add_or_edit_variable',
  'put_2d_instances',
  'put_3d_instances',
  // Its registry launchFunction is a permanent failure stub ("handled
  // server-side" upstream): ByokOrchestrator (BYOK_PLAN_TOOL_NAME) executes
  // it client-side instead. Do not remove without removing the whitelist
  // entry — and vice versa.
  'create_or_update_plan',
  // Intercepts in ByokExtraTools before the editor registry: the registry
  // implementation of add_scene_events posts to GDevelop's event-generation
  // backend, the BYOK one (ByokLocalEventWriter) is fully client-side.
  'add_scene_events',
  'run_script',
  // Perception (Phase 6): screenshots of the scene editor and of a running
  // preview, preview control and runtime feedback — the capture tools are
  // intercepted (images), the read/control tools wrap the preview session.
  'capture_scene_screenshot',
  'capture_preview_screenshot',
  'start_preview',
  'stop_preview',
  'read_preview_logs',
  'get_runtime_errors',
  'inspect_runtime_state',
  // Gameplay tests (Phase 6): the strongest existing run-&-self-correct
  // loop. run_gameplay_test is intercepted (its screenshots become image
  // parts); change_gameplay_tests goes through the registry as-is.
  'run_gameplay_test',
  'change_gameplay_tests',
  // Engine reference (Phase 7): queries the generated catalog instead of
  // carrying it in the prompt. Intercepted (ByokExtraTools) — there is no
  // upstream editor function for it.
  'search_reference',
  // Skills (Phase 7): progressive disclosure — metadata in the prompt,
  // bodies on demand. Intercepted (ByokExtraTools).
  'load_skill',
  // Docs access (Phase 7): the curated bundled subset, optionally expanded
  // online. Intercepted (ByokExtraTools).
  'search_docs',
  'read_doc',
  // Per-project memory (Phase 7): the agent's own notes, injected at chat
  // start. Intercepted (ByokExtraTools).
  'update_project_notes',
];

/**
 * The tools advertised only while no project is open. With a project open
 * the runner refuses `initialize_project` anyway, so advertising it would
 * waste a slot of the (billed) tool list; without one, it is the entry
 * point of "make me a game from scratch". The name stays dispatchable at
 * all times — only the advertisement is conditional.
 */
export const BYOK_NO_PROJECT_TOOL_NAMES: Array<string> = ['initialize_project'];

/**
 * Every tool name the BYOK loop may dispatch: the default set, the
 * no-project additions, and the unadvertised alias(es) the model may still
 * emit out of hosted-agent habit (generate_events). The orchestrator
 * enforces this set at dispatch time.
 */
export const getByokDispatchableToolNames = (): Array<string> => [
  ...BYOK_TOOL_NAMES,
  ...BYOK_NO_PROJECT_TOOL_NAMES,
  'generate_events',
];

/**
 * The names of the tools sent to the model for a turn: the default set,
 * plus the no-project tools while no project is open (read at turn time,
 * so a chat that creates its project stops advertising initialize_project
 * on the next turn).
 */
export const getByokAdvertisedToolNames = (options: {|
  hasOpenedProject: boolean,
|}): Array<string> => {
  if (options.hasOpenedProject) return BYOK_TOOL_NAMES;
  return [...BYOK_TOOL_NAMES, ...BYOK_NO_PROJECT_TOOL_NAMES];
};

const BYOK_TOOL_SCHEMAS: Array<ByokToolSchema> = [
  {
    name: 'describe_instances',
    description:
      'List the instances placed in a scene, with their object name, position, size, z-order, layer and variables. Inspect the current state of a scene before modifying it, and get the instance `id`s needed by put_2d_instances and add_or_edit_variable.',
    parameters: {
      type: 'object',
      properties: {
        scene_name: stringProperty('Name of the scene to read.'),
        filter_by_object_name: stringProperty(
          'Optional: comma-separated object names. Only instances of these objects are returned.'
        ),
      },
      required: ['scene_name'],
    },
  },
  {
    name: 'inspect_variables',
    description:
      'Read the variables of the game: global variables, scene variables, object or group variables, or the variables of a specific instance. Use a variable path with dots (e.g. "player.stats.hp") to read children of structure variables.',
    parameters: {
      type: 'object',
      properties: {
        variable_scope: enumProperty('Which variables to read.', [
          'global',
          'scene',
          'object',
          'group',
          'instance',
        ]),
        scene_name: stringProperty(
          'Name of the scene (required for the "scene" and "instance" scopes).'
        ),
        object_name: stringProperty(
          'Name of the object or group (required for the "object" and "group" scopes).'
        ),
        instance_id: stringProperty(
          'Id of the instance (required for the "instance" scope). Get ids from describe_instances.'
        ),
        variable_names_or_paths: arrayProperty(
          'Optional: read only these variables (paths with dots for children of structures). All variables are returned when omitted.',
          stringProperty('Name or path of a variable.')
        ),
      },
      required: ['variable_scope'],
    },
  },
  {
    name: 'read_scene_events',
    description:
      'Read the events (the game logic) of a scene, rendered as an indented text tree. Read the existing events before changing them.',
    parameters: {
      type: 'object',
      properties: {
        scene_name: stringProperty('Name of the scene to read.'),
      },
      required: ['scene_name'],
    },
  },
  {
    name: 'read_events_source',
    description:
      'Read the events of a scene as EventScript source — the exact syntax add_scene_events accepts back, with `# event-N.M` ids usable as placement targets. Prefer this over read_scene_events when preparing an edit.',
    parameters: {
      type: 'object',
      properties: {
        scene_name: stringProperty('Name of the scene to read.'),
        event_ids: arrayProperty(
          'Optional: read only these events (e.g. ["event-0", "event-2.1"]). All events are read when omitted.',
          stringProperty('Id of an event, e.g. "event-2.1".')
        ),
        search: stringProperty(
          'Optional: only show the events containing this text.'
        ),
        object_names: arrayProperty(
          'Optional: only show the events involving these objects.',
          stringProperty('Name of an object.')
        ),
        sub_events_depth: numberProperty(
          'Optional: how deep to show sub-events of the selected events.'
        ),
        max_chars: numberProperty(
          'Optional: maximum length of the returned source (default 30000).'
        ),
      },
      required: ['scene_name'],
    },
  },
  {
    name: 'read_game_project_json',
    description:
      'Read the structure of the game project as simplified JSON. Start with the whole project (or a path) to discover the scenes, objects and resources, then read more precisely with a path.',
    parameters: {
      type: 'object',
      properties: {
        path: stringProperty(
          'Optional: path into the project JSON to read (e.g. "layouts.Level 1"). The whole project is returned when omitted.'
        ),
        filter: objectProperty(
          'Optional: for arrays, only return the items matching these field values, as field name → expected value (e.g. { "name": "Player" }).',
          {}
        ),
        maxDepth: numberProperty(
          'Optional: maximum depth of the returned JSON (default 2).'
        ),
        maxStringLength: numberProperty(
          'Optional: maximum length of the returned strings (default 200).'
        ),
        offset: numberProperty(
          'Optional: for arrays, index of the first returned item (default 0).'
        ),
        limit: numberProperty(
          'Optional: for arrays, maximum number of returned items.'
        ),
        countOnly: booleanProperty(
          'Optional: return only the number of items of the array, not the items.'
        ),
      },
      required: [],
    },
  },
  {
    name: 'create_scene',
    description:
      'Create a scene (doing nothing if a scene with this name already exists), optionally with a UI layer and a background color, and optionally set it as the first (startup) scene.',
    parameters: {
      type: 'object',
      properties: {
        scene_name: stringProperty('Name of the scene to create.'),
        include_ui_layer: booleanProperty(
          'Also add a "UI" layer, meant for HUD elements drawn above the game.'
        ),
        background_color: stringProperty(
          'Optional background color of the scene, as a color name or hex string (e.g. "#2a2a2a").'
        ),
        is_first_scene: booleanProperty(
          'Also set the scene as the first (startup) scene of the game.'
        ),
      },
      required: ['scene_name'],
    },
  },
  {
    name: 'create_or_replace_object',
    description:
      'Add an object to a scene (or replace/duplicate an existing object). The object can be created from a type, from a description (searched in the asset store), or as a copy of another object.',
    parameters: {
      type: 'object',
      properties: {
        scene_name: stringProperty('Name of the scene.'),
        object_name: stringProperty('Name of the object to create.'),
        object_type: stringProperty(
          'Type of the object (e.g. "Sprite", "TextObject::Text"). Defaults to the type of the existing object with the same name, when there is one.'
        ),
        target_object_scope: enumProperty(
          'Whether the object should live in the scene or be global (shared by all scenes).',
          ['scene', 'global']
        ),
        replace_existing_object: booleanProperty(
          'Replace an existing object with the same name instead of failing.'
        ),
        duplicated_object_name: stringProperty(
          'Create the object as a copy of this existing object instead of using object_type.'
        ),
        duplicated_object_scene: stringProperty(
          'Scene of the object to duplicate, when different from scene_name.'
        ),
        description: stringProperty(
          'Description of what the object should look like, used to find a suitable asset.'
        ),
        search_terms: stringProperty(
          'Optional search terms to find a suitable asset in the asset store.'
        ),
        asset_id: stringProperty(
          'Id of an asset store asset to use for the object.'
        ),
        two_dimensional_view_kind: stringProperty(
          'Optional: which 2D view of an asset to prefer (e.g. "side view", "top-down").'
        ),
      },
      required: ['scene_name', 'object_name'],
    },
  },
  {
    name: 'inspect_object_properties_effects',
    description:
      'Read the properties, behaviors and effects of an object. Inspect before changing an object.',
    parameters: {
      type: 'object',
      properties: {
        scene_name: stringProperty('Name of the scene.'),
        object_name: stringProperty(
          'Name of the object to inspect (searched in the scene, then in the global objects).'
        ),
      },
      required: ['scene_name', 'object_name'],
    },
  },
  {
    name: 'change_object_properties_effects',
    description:
      'Change the properties or effects of an object, rename it, or delete it (delete_this_object).',
    parameters: {
      type: 'object',
      properties: {
        scene_name: stringProperty('Name of the scene.'),
        object_name: stringProperty(
          'Name of the object to change (searched in the scene, then in the global objects).'
        ),
        changed_properties: arrayProperty(
          'The object properties to change. Use "name" as property_name to rename the object. Instance attributes (position, angle, ...) belong to put_2d_instances / put_3d_instances instead.',
          objectProperty('One property change.', {
            property_name: stringProperty('Name of the property.'),
            new_value: stringProperty(
              'New value of the property, as a string (numbers and booleans are parsed).'
            ),
          })
        ),
        changed_effects: arrayProperty(
          'The effect changes to apply to the object.',
          effectChangeProperty
        ),
        delete_this_object: booleanProperty(
          'Set to true to delete the object instead of changing it.'
        ),
      },
      required: ['scene_name', 'object_name'],
    },
  },
  {
    name: 'add_behavior',
    description:
      'Add a behavior to an object (or to every object of a group). The extension providing the behavior is installed automatically when needed.',
    parameters: {
      type: 'object',
      properties: {
        scene_name: stringProperty('Name of the scene.'),
        object_name: stringProperty(
          'Name of the object (or group) to add the behavior to.'
        ),
        behavior_type: stringProperty(
          'Type of the behavior (e.g. "PlatformerObject::PlatformerObject" for a behavior from an extension, "Draggable" for a base behavior).'
        ),
        behavior_name: stringProperty(
          'Optional custom name of the behavior. Defaults to the standard name of the behavior type.'
        ),
      },
      required: ['scene_name', 'object_name', 'behavior_type'],
    },
  },
  {
    name: 'inspect_behavior_properties',
    description:
      'Read the properties of a behavior on an object (or group), or the shared data of an extension behavior. Inspect before changing a behavior.',
    parameters: {
      type: 'object',
      properties: {
        scene_name: stringProperty('Name of the scene.'),
        object_name: stringProperty(
          'Name of the object (or group) owning the behavior.'
        ),
        behavior_name: stringProperty('Name of the behavior to inspect.'),
      },
      required: ['scene_name', 'object_name', 'behavior_name'],
    },
  },
  {
    name: 'change_behavior_property',
    description:
      'Change properties of a behavior on an object (or on every object of a group), or remove the behavior with delete_this_behavior.',
    parameters: {
      type: 'object',
      properties: {
        scene_name: stringProperty('Name of the scene.'),
        object_name: stringProperty(
          'Name of the object (or group) owning the behavior.'
        ),
        behavior_name: stringProperty('Name of the behavior.'),
        delete_this_behavior: booleanProperty(
          'Set to true to remove the behavior instead of changing properties.'
        ),
        changed_properties: arrayProperty(
          'The properties to change. Provide at least one change, or delete_this_behavior.',
          objectProperty('A property change.', {
            property_name: stringProperty('Name of the property.'),
            new_value: stringProperty(
              'New value of the property, as a string (numbers and booleans are parsed).'
            ),
          })
        ),
      },
      required: ['scene_name', 'object_name', 'behavior_name'],
    },
  },
  {
    name: 'inspect_scene_properties_layers_effects',
    description:
      'Read the properties, layers and effects of a scene. Inspect a scene before changing it.',
    parameters: {
      type: 'object',
      properties: {
        scene_name: stringProperty('Name of the scene to inspect.'),
      },
      required: ['scene_name'],
    },
  },
  {
    name: 'change_scene_properties_layers_effects_groups',
    description:
      'Change the properties, layers, layer effects and object groups of a scene, or delete the scene (delete_this_scene).',
    parameters: {
      type: 'object',
      properties: {
        scene_name: stringProperty('Name of the scene to change.'),
        delete_this_scene: booleanProperty(
          'Set to true to delete the whole scene instead of changing it.'
        ),
        changed_properties: arrayProperty(
          'The scene settings to change (e.g. name, backgroundColor, gameResolutionWidth, gameResolutionHeight, gameOrientation, gameScaleMode, isFirstScene, stopSoundsOnStartup).',
          objectProperty('One scene property change.', {
            property_name: stringProperty('Name of the scene property.'),
            new_value: stringProperty(
              'New value of the property, as a string (numbers and booleans are parsed).'
            ),
          })
        ),
        changed_layers: arrayProperty(
          'The layer changes to apply: create, rename, reorder, show/hide or delete layers.',
          objectProperty('One layer change.', {
            layer_name: stringProperty(
              'Name of the layer (the empty string is the base layer).'
            ),
            new_layer_name: stringProperty('New name of the layer.'),
            new_layer_position: numberProperty(
              'Position of the layer in the list (moves it, or the index where to insert a new one).'
            ),
            delete_this_layer: booleanProperty(
              'Set to true to delete the layer (the base layer cannot be deleted).'
            ),
            move_instances_to_layer: stringProperty(
              'When deleting the layer, move its instances to this layer instead.'
            ),
            new_visibility: booleanProperty('Visibility of the layer.'),
          })
        ),
        changed_layer_effects: arrayProperty(
          'The effect changes to apply to a layer.',
          objectProperty(
            'The effect changes of one layer (same shape as object effect changes), starting with its layer_name.',
            {
              layer_name: stringProperty('Name of the layer.'),
              ...effectChangeProperty.properties,
            }
          )
        ),
        changed_groups: arrayProperty(
          'The object group changes to apply: create, rename, fill or delete groups of objects.',
          objectProperty('One group change.', {
            group_name: stringProperty('Name of the group.'),
            delete_this_group: booleanProperty(
              'Set to true to delete the group.'
            ),
            objects_to_add: arrayProperty(
              'Names of the objects to add to the group.',
              stringProperty('Name of an object.')
            ),
            objects_to_remove: arrayProperty(
              'Names of the objects to remove from the group.',
              stringProperty('Name of an object.')
            ),
            new_group_name: stringProperty('New name of the group.'),
          })
        ),
      },
      required: ['scene_name'],
    },
  },
  {
    name: 'inspect_project_properties_resources',
    description:
      'Read the properties of the project (name, resolution, orientation, ...) and its resources. Inspect the project before changing it.',
    parameters: {
      type: 'object',
      properties: {
        filter_by_resource_name: stringProperty(
          'Optional: only list the resources whose name contains this text (case-insensitive).'
        ),
        list_all_resources: booleanProperty(
          'Optional: list up to 200 resources instead of only the summary.'
        ),
      },
      required: [],
    },
  },
  {
    name: 'change_project_properties_resources',
    description:
      'Change the properties of the project (name, resolution, orientation, scale mode, first scene, ...) or rename/delete its resources. Provide at least one change.',
    parameters: {
      type: 'object',
      properties: {
        changed_properties: arrayProperty(
          'The project properties to change.',
          objectProperty('One project property change.', {
            property_name: stringProperty(
              'Name of the property (e.g. name, version, author, orientation, windowWidth, windowHeight, scaleMode, sizeOnStartupMode, adaptGameResolutionAtRuntime, pixelsRounding, antialiasingMode, minimumFPS, maximumFPS, firstLayout).'
            ),
            new_value: stringProperty(
              'New value of the property, as a string (numbers and booleans are parsed).'
            ),
          })
        ),
        changed_resources: arrayProperty(
          'The resource changes to apply: rename or delete resources.',
          objectProperty('One resource change.', {
            resource_name: stringProperty('Name of the resource to change.'),
            new_resource_name: stringProperty(
              'New name of the resource (skipped when only deleting).'
            ),
            delete_this_resource: booleanProperty(
              'Set to true to delete the resource (refused while it is still used).'
            ),
          })
        ),
      },
      required: [],
    },
  },
  {
    name: 'add_or_edit_variable',
    description:
      'Create, change or delete variables, in the global scope, of a scene, of an object/group, or of an instance. A variable path with dots (e.g. "player.stats.hp") addresses children of structure variables.',
    parameters: {
      type: 'object',
      properties: {
        variable_scope: enumProperty('Which variables to change.', [
          'global',
          'scene',
          'object',
          'group',
          'instance',
        ]),
        variables: arrayProperty(
          'The operations to apply, in order.',
          objectProperty('One variable operation.', {
            variable_name_or_path: stringProperty(
              'Name or path of the variable.'
            ),
            value: stringProperty(
              'New value of the variable, as a string (numbers and booleans are parsed). Not needed when deleting.'
            ),
            variable_type: enumProperty(
              'Type of the variable, when creating it. Inferred from the value when omitted.',
              ['number', 'string', 'boolean', 'structure', 'array']
            ),
            delete_this_variable: booleanProperty(
              'Set to true to delete the variable instead of setting its value.'
            ),
          })
        ),
        scene_name: stringProperty(
          'Name of the scene (required for the "scene" and "instance" scopes).'
        ),
        object_name: stringProperty(
          'Name of the object or group (required for the "object" and "group" scopes).'
        ),
        instance_id: stringProperty(
          'Id of the instance (required for the "instance" scope). Get ids from describe_instances.'
        ),
      },
      required: ['variable_scope', 'variables'],
    },
  },
  {
    name: 'put_2d_instances',
    description:
      'Place, move, transform or erase instances of 2D objects in a scene, using a brush: "point" places at a position, "line" between two positions, "grid" in a rectangle with rows and columns, "random_in_circle" inside a radius, "erase" removes, "none" only moves or transforms existing instances identified by their ids.',
    parameters: {
      type: 'object',
      properties: {
        scene_name: stringProperty('Name of the scene.'),
        layer_name: stringProperty(
          'Name of the layer. Use the empty string for the base layer.'
        ),
        brush_kind: enumProperty('The brush to use.', [
          'point',
          'line',
          'grid',
          'random_in_circle',
          'erase',
          'none',
        ]),
        object_name: stringProperty(
          'Name of the object to place (or of the objects to erase/modify).'
        ),
        brush_position: stringProperty(
          'Position of the brush, as "x,y" in pixels. Required when creating instances (point/line/grid/random_in_circle brushes); only the "none" and "erase" brushes working on existing instances may omit it.'
        ),
        brush_end_position: stringProperty(
          'End position, as "x,y" (required for the "line" and "grid" brushes).'
        ),
        brush_size: numberProperty(
          'Radius in pixels (used by the "erase" and "random_in_circle" brushes).'
        ),
        existing_instance_ids: stringProperty(
          'Comma-separated ids of instances to move/erase/transform (from describe_instances).'
        ),
        new_instances_count: numberProperty(
          'Number of instances to create. Defaults to 1 when creating without existing_instance_ids; omitted or 0 with existing_instance_ids only moves/transforms them.'
        ),
        row_count: numberProperty('Rows of the grid ("grid" brush).'),
        column_count: numberProperty('Columns of the grid ("grid" brush).'),
        instances_z_order: numberProperty('Z-order of the instances.'),
        instances_size: stringProperty(
          'Custom size of the instances, as "width,height" in pixels.'
        ),
        instances_rotation: numberProperty(
          'Rotation angle of the instances, in degrees.'
        ),
        instances_opacity: numberProperty(
          'Opacity of the instances, from 0 (transparent) to 255 (opaque).'
        ),
        instances_hidden: booleanProperty('Set to true to hide the instances.'),
      },
      required: ['scene_name', 'layer_name', 'brush_kind'],
    },
  },
  {
    name: 'put_3d_instances',
    description:
      'Place, move, transform or erase instances of 3D objects in a 3D layer of a scene, using a brush: "point" places at a position, "line" between two positions, "random_in_sphere" inside a radius, "erase" removes, "none" only moves or transforms existing instances identified by their ids.',
    parameters: {
      type: 'object',
      properties: {
        scene_name: stringProperty('Name of the scene.'),
        layer_name: stringProperty(
          'Name of the 3D layer. Use the empty string for the base layer.'
        ),
        brush_kind: enumProperty('The brush to use.', [
          'point',
          'line',
          'random_in_sphere',
          'erase',
          'none',
        ]),
        object_name: stringProperty(
          'Name of the 3D object to place (or of the objects to erase/modify).'
        ),
        brush_position: stringProperty(
          'Position of the brush, as "x,y,z" in pixels. Required when creating instances; only the "none" and "erase" brushes working on existing instances may omit it.'
        ),
        brush_end_position: stringProperty(
          'End position, as "x,y,z" (required for the "line" brush).'
        ),
        brush_size: numberProperty(
          'Radius in pixels (used by the "erase" and "random_in_sphere" brushes).'
        ),
        existing_instance_ids: stringProperty(
          'Comma-separated ids of instances to move/erase/transform (from describe_instances).'
        ),
        new_instances_count: numberProperty(
          'Number of instances to create. Defaults to 1 when creating without existing_instance_ids; omitted or 0 with existing_instance_ids only moves/transforms them.'
        ),
        instances_size: stringProperty(
          'Custom size of the instances, as "width,height,depth" in pixels.'
        ),
        instances_rotation: stringProperty(
          'Rotation of the instances, as "rotationX,rotationY,rotationZ" in degrees.'
        ),
        instances_hidden: booleanProperty('Set to true to hide the instances.'),
      },
      required: ['scene_name', 'layer_name', 'brush_kind'],
    },
  },
  {
    name: 'add_scene_events',
    description:
      'Write the events (the game logic) of a scene: each batch is EventScript source placed with an operation (insert_at_end, insert_and_replace_event, replace_entire_event_and_sub_events, replace_event_but_keep_existing_sub_events, insert_before_event, insert_after_event, insert_as_sub_event, delete_event). Runs fully locally — read_events_source first, then anchor the edits.',
    parameters: {
      type: 'object',
      properties: {
        scene_name: stringProperty('Name of the scene to edit.'),
        event_batches: arrayProperty(
          'The batches to apply, in order. Each batch carries EventScript source (the same syntax read_events_source returns) and a placement.',
          objectProperty('One batch of events to write.', {
            event_script: stringProperty(
              'The events to write, as EventScript source (statements like `if Timer(2, "T") and once:` with indented actions). Not needed for delete_event.'
            ),
            placement_relation: enumProperty('How to place the batch.', [
              'insert_at_end',
              'insert_and_replace_event',
              'replace_entire_event_and_sub_events',
              'replace_event_but_keep_existing_sub_events',
              'insert_before_event',
              'insert_after_event',
              'insert_as_sub_event',
              'delete_event',
            ]),
            placement_target_event_id: stringProperty(
              'Target of the placement: an event id from read_events_source (e.g. "event-2.1") or a group name. Not needed for insert_at_end.'
            ),
            placement_expected_parent_event_id: stringProperty(
              'For insert_as_sub_event: the event that will own the new sub-events (defaults to the target).'
            ),
            expected_event_source: stringProperty(
              'Safety anchor for replace operations: the current source of the target event (as read). The edit is refused when it no longer matches.'
            ),
          })
        ),
      },
      required: ['scene_name', 'event_batches'],
    },
  },
  {
    name: 'run_script',
    description:
      'Run one JavaScript script that calls the other tools as async functions (e.g. `const created = await create_scene({ scene_name: "Level 2" });`), batching many operations or computations into a single call. Every call in the script must be awaited, and a refused approval means nothing in the script ran.',
    parameters: {
      type: 'object',
      properties: {
        js_code: stringProperty(
          'The JavaScript to run. Call the tools by their name, passing the arguments as a JS object (e.g. `await add_or_edit_variable({ variable_scope: "global", variables: [...] });`).'
        ),
        title: stringProperty('Optional short title, shown to the user.'),
      },
      required: ['js_code'],
    },
  },
  {
    name: 'capture_scene_screenshot',
    description:
      'Capture a screenshot of the currently open scene editor canvas. Look at the scene after visual edits instead of assuming them.',
    parameters: {
      type: 'object',
      properties: {
        scene_name: stringProperty(
          'Optional: the scene you want to see. Only the editor canvas that is currently open can be captured — the output says when it may be another scene.'
        ),
        layer_name: stringProperty(
          'Optional: the layer of interest (informational — the whole canvas is captured).'
        ),
      },
      required: [],
    },
  },
  {
    name: 'capture_preview_screenshot',
    description:
      'Capture a screenshot of a running preview window (the game as it plays). Pair it with read_preview_logs and inspect_runtime_state for the machine-readable state.',
    parameters: {
      type: 'object',
      properties: {
        preview_id: numberProperty(
          'Optional: the window id of the preview to capture. The most recently opened preview is captured when omitted.'
        ),
      },
      required: [],
    },
  },
  {
    name: 'start_preview',
    description:
      'Start a preview of the game (on its first scene, or the given one) and keep it running for the chat. One preview at a time.',
    parameters: {
      type: 'object',
      properties: {
        scene_name: stringProperty(
          'Optional: the scene to preview. The first scene of the game is used when omitted.'
        ),
      },
      required: [],
    },
  },
  {
    name: 'stop_preview',
    description: 'Stop the preview started by this chat.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'read_preview_logs',
    description:
      'Read the console logs of the running preview (e.g. the console.log calls of the game).',
    parameters: {
      type: 'object',
      properties: {
        since_index: numberProperty(
          'Optional: only return the logs after this index (read_preview_logs returned them last time).'
        ),
        level: stringProperty(
          'Optional: only return this level (log, warn or error).'
        ),
      },
      required: [],
    },
  },
  {
    name: 'get_runtime_errors',
    description:
      'Read the errors and crashes of the running preview since the last call.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'inspect_runtime_state',
    description:
      'Read the live state of the running game: the instances of each scene (names and positions) and the scene/global variables. Read coordinates here, never guess them from pixels.',
    parameters: {
      type: 'object',
      properties: {
        scene_name: stringProperty(
          'Optional: only read this scene (all scenes are returned when omitted).'
        ),
        variable_paths: arrayProperty(
          'Optional: only read these variable paths.',
          stringProperty('A variable path.')
        ),
      },
      required: [],
    },
  },
  {
    name: 'run_gameplay_test',
    description:
      'Create (or update) and run one gameplay test in a live preview: assertions on the game state, with console logs, final state and screenshots returned — the strongest verify-and-self-correct loop. The executed source is returned on failure so it can be repaired.',
    parameters: {
      type: 'object',
      properties: {
        scope: objectProperty('Where the test lives.', {
          type: enumProperty('The kind of scope.', ['project', 'extension']),
          extension_name: stringProperty(
            'The extension name (required for the "extension" scope).'
          ),
        }),
        test_name: stringProperty('Name of the gameplay test.'),
        source: stringProperty(
          'The JavaScript source of the test (see the gameplay test API: stepFrames, simulateInput, assert...). When omitted, the stored test with this name is run.'
        ),
        persist: booleanProperty(
          'Save the source as the stored test (default true). Set false for a temporary probe — nothing is saved, no approval is needed.'
        ),
        timeout_ms: numberProperty(
          'Optional timeout in milliseconds (1000-120000).'
        ),
        screenshots: enumProperty('When to capture screenshots.', [
          'on-failure',
          'off',
        ]),
        description: stringProperty(
          'Optional description, saved with a persisted test.'
        ),
      },
      required: ['scope', 'test_name'],
    },
  },
  {
    name: 'change_gameplay_tests',
    description:
      'Delete, rename or reorder the gameplay tests of the project, or change their description (never their source — run_gameplay_test does that).',
    parameters: {
      type: 'object',
      properties: {
        scope: objectProperty('Where the tests live.', {
          type: enumProperty('The kind of scope.', ['project', 'extension']),
          extension_name: stringProperty(
            'The extension name (required for the "extension" scope).'
          ),
        }),
        changes: arrayProperty(
          'The changes to apply, in order.',
          objectProperty('One test change.', {
            test_name: stringProperty('Name of the test to change.'),
            delete_this_test: booleanProperty(
              'Set to true to delete the test.'
            ),
            changed_properties: arrayProperty(
              'The properties to change (name, description or index).',
              objectProperty('One property change.', {
                property_name: stringProperty(
                  'The property to change (name, description or index).'
                ),
                new_value: stringProperty(
                  'The new value, as a string (numbers are parsed).'
                ),
              })
            ),
          })
        ),
      },
      required: ['scope', 'changes'],
    },
  },
  {
    name: 'create_or_update_plan',
    description:
      'Create or update the plan of a multi-step task, shown to the user. Send the full list of tasks each time; update the status of the tasks as the work progresses.',
    parameters: {
      type: 'object',
      properties: {
        tasks: arrayProperty(
          'The tasks of the plan, in execution order. Send the complete plan each time.',
          objectProperty('One task of the plan.', {
            id: stringProperty('Short stable id of the task (e.g. "task-1").'),
            title: stringProperty('Short title of the task.'),
            description: stringProperty(
              'What exactly will be done in this task.'
            ),
            status: enumProperty('Status of the task.', [
              'pending',
              'in_progress',
              'done',
              'voided',
            ]),
            depends_on: arrayProperty(
              'Ids of the tasks that must be done before this one.',
              stringProperty('Id of a task.')
            ),
          })
        ),
      },
      required: ['tasks'],
    },
  },
  {
    name: 'initialize_project',
    description:
      'Create a new, empty GDevelop project (or one from a template) and open it in the editor — the entry point when no project is open. Only usable while no project is open.',
    parameters: {
      type: 'object',
      properties: {
        project_name: stringProperty('Name of the project to create.'),
        template_slug: stringProperty(
          'Slug of a template to start from (as in the "Games examples" library), or "" / "none" / "empty" for an empty project.'
        ),
        also_read_existing_events: booleanProperty(
          'Also return the existing events of the created project (e.g. of a template) as text.'
        ),
      },
      required: ['project_name', 'template_slug'],
    },
  },
  {
    name: 'search_reference',
    description:
      'Search the engine reference: every object, behavior, action, condition, expression and effect that exists in GDevelop, with their exact names and parameters. Use it instead of guessing an instruction or parameter name.',
    parameters: {
      type: 'object',
      properties: {
        query: stringProperty(
          'What to look for: a name or a topic (e.g. "lerp", "platformer jump", "gravity"). Empty lists everything of the requested kind.'
        ),
        kind: enumProperty('Restrict the search to one kind of entry.', [
          'object',
          'behavior',
          'action',
          'condition',
          'expression',
          'effect',
        ]),
        owner: stringProperty(
          'Restrict the search to one extension (e.g. "Physics2", "Tween", "BuiltinAudio").'
        ),
      },
      required: ['query'],
    },
  },
  {
    name: 'load_skill',
    description:
      'Load the full playbook of one skill from the "Available skills" list: its instructions stay available for the rest of the conversation. Load a skill when its topic matters for the current task (a platformer to build, a save system to add…).',
    parameters: {
      type: 'object',
      properties: {
        name: stringProperty(
          'Name of the skill to load, exactly as listed in "Available skills".'
        ),
      },
      required: ['name'],
    },
  },
  {
    name: 'search_docs',
    description:
      'Search the official GDevelop documentation bundled with the app (events, expressions, object picking, JS code…): page titles and what matched. Follow up with read_doc to read a page.',
    parameters: {
      type: 'object',
      properties: {
        query: stringProperty(
          'What to look for (e.g. "object picking", "for each", "variables").'
        ),
      },
      required: ['query'],
    },
  },
  {
    name: 'read_doc',
    description:
      'Read one documentation page (a path returned by search_docs, e.g. "events/object-picking/index.md"). Returns its Markdown, capped; pass an anchor to read only one section.',
    parameters: {
      type: 'object',
      properties: {
        page: stringProperty('Path of the page to read (from search_docs).'),
        anchor: stringProperty(
          'Optional: read only the section whose heading contains this text.'
        ),
      },
      required: ['page'],
    },
  },
  {
    name: 'update_project_notes',
    description:
      'Update your persistent notes about this project (shown to you at the start of every chat about it): the project conventions to follow, what is currently in progress, and the design/technical decisions taken. Send only the fields you want to replace.',
    parameters: {
      type: 'object',
      properties: {
        conventions: stringProperty(
          'The conventions of the project (naming, structure, style). Replace the whole list.'
        ),
        inProgress: stringProperty(
          'What is currently in progress or left unfinished.'
        ),
        decisions: stringProperty(
          'The design and technical decisions taken, so they stay consistent.'
        ),
      },
      required: [],
    },
  },
];

/**
 * The schemas of the tools exposed to the model in BYOK v3.
 */
export const getByokToolSchemas = (): Array<ByokToolSchema> => {
  return BYOK_TOOL_SCHEMAS;
};

/**
 * The schemas of a subset of tools, by name — what the orchestrator sends
 * as the `tools` array of a turn (the advertised set, which can differ per
 * turn, e.g. without initialize_project while a project is open).
 */
export const getByokToolSchemasForNames = (
  names: Array<string>
): Array<ByokToolSchema> => {
  const knownNames = new Set(names);
  return BYOK_TOOL_SCHEMAS.filter(schema => knownNames.has(schema.name));
};

/**
 * Format the schemas as the `tools` array of the OpenAI chat-completions
 * API.
 */
export const toOpenAiToolsFormat = (
  schemas: Array<ByokToolSchema>
): Array<Object> => {
  return schemas.map(schema => ({
    type: 'function',
    function: {
      name: schema.name,
      description: schema.description,
      parameters: schema.parameters,
    },
  }));
};

const collectPropertyTypeProblems = (
  properties: Object,
  problemPrefix: string,
  problems: Array<string>
): void => {
  for (const propertyName of Object.keys(properties)) {
    const property = properties[propertyName];
    if (!property || typeof property !== 'object') {
      problems.push(
        `${problemPrefix}.${propertyName} is not a property definition.`
      );
      continue;
    }
    if (!BYOK_PROPERTY_TYPES.includes(property.type)) {
      problems.push(
        `${problemPrefix}.${propertyName} has an unknown property type: ${String(
          property.type
        )}.`
      );
    }

    if (property.type === 'array' && property.items) {
      collectPropertyTypeProblems(
        // An array `items` is a single property definition: reuse the same
        // check by wrapping it under a synthetic name.
        { items: property.items },
        `${problemPrefix}.${propertyName}`,
        problems
      );
    }
    if (property.type === 'object' && property.properties) {
      collectPropertyTypeProblems(
        property.properties,
        `${problemPrefix}.${propertyName}`,
        problems
      );
    }
  }
};

/**
 * The tools implemented BY BYOK ITSELF (in ByokExtraTools/ByokRuntimeTools)
 * rather than by the editor registry — screenshots, preview control and
 * runtime reads have no upstream EditorFunction. The validator skips the
 * registry-membership check for them; a dedicated test asserts each is
 * actually intercepted (see ByokExtraTools.spec.js).
 */
export const BYOK_ONLY_TOOL_NAMES: Array<string> = [
  'capture_scene_screenshot',
  'capture_preview_screenshot',
  'start_preview',
  'stop_preview',
  'read_preview_logs',
  'get_runtime_errors',
  'inspect_runtime_state',
  'search_reference',
  'load_skill',
  'search_docs',
  'read_doc',
  'update_project_notes',
];

const BYOK_ONLY_TOOL_NAMES_SET: Set<string> = new Set(BYOK_ONLY_TOOL_NAMES);

const collectSchemaProblems = (
  schema: ByokToolSchema,
  registry: Object,
  problems: Array<string>
): void => {
  if (!registry[schema.name] && !BYOK_ONLY_TOOL_NAMES_SET.has(schema.name)) {
    problems.push(
      `Tool "${schema.name}" is not in the editorFunctions registry.`
    );
  }
  if (!schema.description) {
    problems.push(`Tool "${schema.name}" has no description.`);
  }
  collectPropertyTypeProblems(
    schema.parameters.properties,
    `Tool "${schema.name}"`,
    problems
  );
};

/**
 * The full registry the schemas are checked against: the with-project
 * registry plus the without-project one (`initialize_project` only exists
 * there).
 */
// Merged through any: the two registries' launchFunction signatures are
// deliberately incompatible (with/without project), the lookup here only
// reads membership.
const FULL_EDITOR_FUNCTIONS_REGISTRY: any = {};
for (const toolName of Object.keys(editorFunctions)) {
  FULL_EDITOR_FUNCTIONS_REGISTRY[toolName] = (editorFunctions: any)[toolName];
}
for (const toolName of Object.keys(editorFunctionsWithoutProject)) {
  FULL_EDITOR_FUNCTIONS_REGISTRY[
    toolName
  ] = (editorFunctionsWithoutProject: any)[toolName];
}

/**
 * Check that the whitelist and its schemas stay in sync: every whitelisted
 * name (default set, no-project set) must exist in the editor registry and
 * have a schema with described, typed properties, and the default set must
 * stay within the tool-count cap (each advertised schema is billed as input
 * tokens on every turn). The test suite fails when this returns problems,
 * so an upstream tool rename is caught here instead of at runtime. The
 * registry and the schema list are injectable so the tests can exercise
 * the failure branches with synthetic inputs.
 */
export const validateByokToolSchemas = (
  registry: Object = FULL_EDITOR_FUNCTIONS_REGISTRY,
  schemas: Array<ByokToolSchema> = BYOK_TOOL_SCHEMAS
): Array<string> => {
  const problems: Array<string> = [];

  const schemaNames = schemas.map(schema => schema.name);
  const whitelistedNames = [...BYOK_TOOL_NAMES, ...BYOK_NO_PROJECT_TOOL_NAMES];
  if (schemaNames.length !== whitelistedNames.length) {
    problems.push(
      'Some tools of the whitelist have no schema (or the opposite).'
    );
  }
  for (const toolName of whitelistedNames) {
    if (!schemaNames.includes(toolName)) {
      problems.push(`Whitelisted tool "${toolName}" has no schema.`);
    }
  }
  // The cap grew with Phase 6 (perception + gameplay tests, 9 tools) and
  // Phase 7 (search_reference + load_skill): the roadmap's tool-count
  // guidance yields to the phase-mandated surface — the descriptions stay
  // concise, and the skills system (7.6) is the mechanism to scope
  // per-task tool subsets later.
  if (BYOK_TOOL_NAMES.length > 36) {
    problems.push(
      `The default tool set has ${
        BYOK_TOOL_NAMES.length
      } tools — the cap is 36.`
    );
  }

  for (const schema of schemas) {
    collectSchemaProblems(schema, registry, problems);
  }

  return problems;
};

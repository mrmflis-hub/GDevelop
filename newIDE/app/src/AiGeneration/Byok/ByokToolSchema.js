// @flow
import { editorFunctions } from '../../EditorFunctions';

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

/**
 * The tools exposed to the model in BYOK v1: the read/inspect tools and the
 * simplest write tools. Deliberately **excluded** for now (decisions for a
 * later phase, after the tool loop has proven itself):
 * - `run_script`, `run_edit_agent`, `run_explorer_agent`: the script
 *   sandbox and the sub-agents (BYOK v1 runs a single agent).
 * - `generate_events`: it calls GDevelop's event-generation backend.
 * - `search_object_asset_store`, `search_resource_store`: they call
 *   GDevelop's store APIs with a GDevelop account.
 * - `run_gameplay_test`, `change_gameplay_tests`, `run_tests`: gameplay
 *   test tooling, gated on later phases.
 */
export const BYOK_V1_TOOL_NAMES: Array<string> = [
  'describe_instances',
  'inspect_variables',
  'read_scene_events',
  'read_game_project_json',
  'read_full_docs',
  'search_docs',
  'create_scene',
  'create_or_replace_object',
  'add_behavior',
  'change_behavior_property',
  'add_or_edit_variable',
  'put_2d_instances',
  'add_scene_events',
  'create_or_update_plan',
];

const BYOK_V1_TOOL_SCHEMAS: Array<ByokToolSchema> = [
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
      'Read the events (the game logic) of a scene, rendered as text. Read the existing events before changing them.',
    parameters: {
      type: 'object',
      properties: {
        scene_name: stringProperty('Name of the scene to read.'),
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
    name: 'read_full_docs',
    description:
      'Read the documentation of GDevelop extensions (behaviors, objects). With BYOK, this call answers that the documentation is not available and the existing knowledge must be used instead.',
    parameters: {
      type: 'object',
      properties: {
        extension_names: stringProperty(
          'Comma-separated names of the extensions to document (e.g. "Platformer, Anchors").'
        ),
      },
      required: [],
    },
  },
  {
    name: 'search_docs',
    description:
      'Search the GDevelop documentation for a topic. With BYOK, this call answers that the documentation is not available and the existing knowledge must be used instead.',
    parameters: {
      type: 'object',
      properties: {
        search_query: stringProperty('The topic to search for.'),
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
          'Position of the brush, as "x,y" in pixels (the scene center when omitted).'
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
          'Number of instances to create (1 when omitted). 0 to only move existing instances.'
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
    name: 'add_scene_events',
    description:
      'Add events (the game logic) to a scene, from a description of what should happen (and optionally a ready-to-use event script). The events are generated and checked by GDevelop, then inserted in the scene.',
    parameters: {
      type: 'object',
      properties: {
        scene_name: stringProperty('Name of the scene.'),
        extension_names_list: stringProperty(
          'Comma-separated names of the extensions used by the new events (e.g. "Platformer, FontStyle").'
        ),
        events_description: stringProperty(
          'Description of the events to generate. Required unless event_batches is provided.'
        ),
        event_batches: arrayProperty(
          'Optional: several batches of events, each with its own placement in the scene. Each batch needs an events_description or an event_script.',
          objectProperty('One batch of events.', {
            events_description: stringProperty(
              'Description of the events of this batch.'
            ),
            event_script: stringProperty(
              'Optional GDevelop event script of this batch, when the exact events are already known.'
            ),
            placement_relation: enumProperty(
              'Where to insert the events of this batch.',
              [
                'append',
                'insert_before',
                'insert_after',
                'replace_event_but_keep_existing_sub_events',
                'replace_entire_event_and_sub_events',
                'delete',
              ]
            ),
            placement_target_event_id: stringProperty(
              'Id (or group name) of the existing event targeted by the placement relation.'
            ),
            placement_expected_parent_event_id: stringProperty(
              'Id of the expected parent event, when the target is a sub-event.'
            ),
            placement_rationale: stringProperty(
              'Short explanation of why this placement was chosen.'
            ),
            expected_event_source: stringProperty(
              'For the "replace..." placements: the current source of the replaced event, proving it was read before being replaced.'
            ),
          })
        ),
        objects_list: stringProperty(
          'Comma-separated names of the objects used by the new events.'
        ),
        estimated_complexity: numberProperty(
          'Optional: rough number of events expected (helps sizing the generation).'
        ),
        placement_hint: stringProperty(
          'Optional general hint about where to insert the events.'
        ),
      },
      required: ['scene_name', 'extension_names_list'],
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
];

/**
 * The schemas of the tools exposed to the model in BYOK v1.
 */
export const getByokToolSchemas = (): Array<ByokToolSchema> => {
  return BYOK_V1_TOOL_SCHEMAS;
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

const collectSchemaProblems = (
  schema: ByokToolSchema,
  problems: Array<string>
): void => {
  if (!editorFunctions[schema.name]) {
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
 * Check that the whitelist and its schemas stay in sync with GDevelop's
 * tool registry: every whitelisted name must exist in the registry, every
 * schema must be described, and every property must use a known type. The
 * test suite fails when this returns problems, so an upstream tool rename
 * is caught here instead of at runtime.
 */
export const validateByokToolSchemas = (): Array<string> => {
  const problems: Array<string> = [];

  const schemaNames = BYOK_V1_TOOL_SCHEMAS.map(schema => schema.name);
  if (schemaNames.length !== BYOK_V1_TOOL_NAMES.length) {
    problems.push(
      'Some tools of the whitelist have no schema (or the opposite).'
    );
  }
  for (const toolName of BYOK_V1_TOOL_NAMES) {
    if (!schemaNames.includes(toolName)) {
      problems.push(`Whitelisted tool "${toolName}" has no schema.`);
    }
  }

  for (const schema of BYOK_V1_TOOL_SCHEMAS) {
    collectSchemaProblems(schema, problems);
  }

  return problems;
};

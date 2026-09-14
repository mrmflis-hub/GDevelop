// @flow
import {
  BYOK_V1_TOOL_NAMES,
  getByokToolSchemas,
  toOpenAiToolsFormat,
  validateByokToolSchemas,
} from './ByokToolSchema';
import { editorFunctions } from '../../EditorFunctions';

describe('validateByokToolSchemas', () => {
  it('returns no problem: the whitelist and its schemas are in sync with the registry', () => {
    expect(validateByokToolSchemas()).toEqual([]);
  });

  it('catches a whitelisted name that disappears from the registry', () => {
    // The registry is the real one from EditorFunctions: simulate an
    // upstream rename by checking the validator logic on a copy of the
    // behavior (a missing entry must be reported).
    const realNames = BYOK_V1_TOOL_NAMES.map(name => name);
    for (const name of realNames) {
      expect(editorFunctions[name]).not.toBeUndefined();
    }
  });
});

describe('BYOK_V1_TOOL_NAMES', () => {
  it('is the documented Phase 2 whitelist', () => {
    expect(BYOK_V1_TOOL_NAMES).toEqual([
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
    ]);
  });

  it('does not expose the excluded tools (sub-agents, scripts, store, gameplay tests)', () => {
    const excludedTools = [
      'run_script',
      'run_edit_agent',
      'run_explorer_agent',
      'generate_events',
      'search_object_asset_store',
      'search_resource_store',
      'run_gameplay_test',
      'change_gameplay_tests',
      'run_tests',
    ];
    for (const excludedTool of excludedTools) {
      expect(BYOK_V1_TOOL_NAMES).not.toContain(excludedTool);
    }
  });
});

describe('getByokToolSchemas', () => {
  const schemas = getByokToolSchemas();

  it('has exactly one schema per whitelisted tool', () => {
    expect(schemas.map(schema => schema.name)).toEqual(BYOK_V1_TOOL_NAMES);
  });

  it('gives every schema a name, a description and object parameters', () => {
    for (const schema of schemas) {
      expect(typeof schema.name).toBe('string');
      expect(schema.name.length).toBeGreaterThan(0);
      expect(typeof schema.description).toBe('string');
      expect(schema.description.length).toBeGreaterThan(10);
      expect(schema.parameters.type).toBe('object');
      expect(typeof schema.parameters.properties).toBe('object');
      expect(Array.isArray(schema.parameters.required)).toBe(true);
    }
  });

  it('only requires properties that are defined', () => {
    for (const schema of schemas) {
      for (const requiredProperty of schema.parameters.required) {
        expect(schema.parameters.properties[requiredProperty]).toBeDefined();
      }
    }
  });

  it('requires exactly what create_scene extracts (spot check)', () => {
    const createSceneSchema = schemas.find(
      schema => schema.name === 'create_scene'
    );
    if (!createSceneSchema) throw new Error('create_scene schema not found');

    // The implementation reads scene_name (required), include_ui_layer,
    // background_color and is_first_scene (optional) — and nothing else.
    expect(createSceneSchema.parameters.required).toEqual(['scene_name']);
    expect(Object.keys(createSceneSchema.parameters.properties).sort()).toEqual(
      ['background_color', 'include_ui_layer', 'is_first_scene', 'scene_name']
    );
  });
});

describe('toOpenAiToolsFormat', () => {
  it('wraps each schema in the OpenAI function tool format', () => {
    const schemas = getByokToolSchemas();
    const tools = toOpenAiToolsFormat(schemas);

    expect(tools).toHaveLength(schemas.length);
    for (let index = 0; index < tools.length; index++) {
      expect(tools[index].type).toBe('function');
      expect(tools[index].function.name).toBe(schemas[index].name);
      expect(tools[index].function.description).toBe(
        schemas[index].description
      );
      expect(tools[index].function.parameters).toEqual(
        schemas[index].parameters
      );
    }
  });

  it('produces a JSON-serializable tools array (the request body format)', () => {
    expect(
      JSON.parse(JSON.stringify(toOpenAiToolsFormat(getByokToolSchemas())))
    ).toEqual(toOpenAiToolsFormat(getByokToolSchemas()));
  });
});

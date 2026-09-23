// @flow

/**
 * The MCP tool-surface mapping (Phase 10): pure helpers with no transport
 * and no editor imports beyond the snapshot builder. Converts the BYOK tool
 * schemas to MCP descriptors, decides the read-only gate from the same
 * `modifiesProject` metadata the chat approval row uses, and maps tool
 * results to MCP content — reproducing exactly the serialization the chat
 * loop sends back to a model (`{ success, ...output }` for registry tools,
 * the raw output object for BYOK-only extras).
 *
 * Dispatch (extra-tool interception, the plan echo, the host crash
 * containment) and the activity log live in `ByokMcpToolHost.js`, which
 * calls into this module.
 */

import {
  getByokAdvertisedToolNames,
  getByokToolSchemasForNames,
} from '../ByokToolSchema';
import { getByokImage } from '../ByokImageContent';
import { BYOK_PLAN_TOOL_NAME } from '../ByokOrchestrator';
import { makeSimplifiedProjectBuilder } from '../../../EditorFunctions/SimplifiedProject/SimplifiedProject';
import type { EditorFunctionCallResult } from '../../../EditorFunctions';
import type { ByokExtraToolResult } from '../ByokExtraTools';
import type {
  ByokMcpCallToolResult,
  ByokMcpContentPart,
  ByokMcpToolDescriptor,
} from './ByokMcpProtocol';
import type { ByokMcpToolHost } from './ByokMcpToolHost';
import type { ByokMcpAccessMode } from '../ByokTypes';

/** The one MCP-native tool: the snapshot the BYOK system prompt folds in. */
export const BYOK_MCP_GET_PROJECT_OVERVIEW_TOOL_NAME: string =
  'get_project_overview';

/**
 * One deliberate divergence from the chat loop, decided in the Phase 10
 * design: MCP clients manage their own context, and the read tools benefit
 * from the room — so the cap is 200 000 chars, not the chat's 20 000.
 */
export const BYOK_MCP_OUTPUT_CAP = 200000;

/**
 * The structural metadata the read-only gate reads. Inexact on purpose: it
 * accepts the editor registries' richer (inexact) entries structurally.
 */
export type ByokMcpToolMeta = {
  +modifiesProject?: ?boolean,
  +getModifiesProject?: ?(args: any) => boolean,
  ...
};

const OVERVIEW_TOOL_DESCRIPTION =
  'Get a simplified JSON snapshot of the project currently open in GDevelop ' +
  '(properties, objects, groups, variables, layers, resources, instance ' +
  'counts — no events, no binaries). Read events and precise details with ' +
  'the other tools.';

export const BYOK_MCP_READ_ONLY_REJECTION_MESSAGE: string =
  'This tool was blocked because the GDevelop MCP server is in read-only ' +
  'mode. Ask the user to switch it to "Read & write" in Preferences > BYOK ' +
  '> MCP server, then retry.';

/**
 * `tools/list` content: exactly what a BYOK chat advertises at this moment
 * (the schemas are already JSON Schema — passed through verbatim), plus the
 * one MCP-native overview tool. Computed per call: a project may open
 * mid-session.
 */
export const makeByokMcpToolDescriptors = (options: {|
  +hasOpenedProject: boolean,
|}): Array<ByokMcpToolDescriptor> => {
  const names = getByokAdvertisedToolNames({
    hasOpenedProject: options.hasOpenedProject,
  });
  const descriptors: Array<ByokMcpToolDescriptor> = getByokToolSchemasForNames(
    names
  ).map(schema => ({
    name: schema.name,
    description: schema.description,
    inputSchema: (schema.parameters: Object),
  }));
  descriptors.push({
    name: BYOK_MCP_GET_PROJECT_OVERVIEW_TOOL_NAME,
    description: OVERVIEW_TOOL_DESCRIPTION,
    inputSchema: { type: 'object', properties: {}, required: [] },
  });
  return descriptors;
};

/**
 * The read-only gate: reject exactly what the chat approval row would hold
 * (an unknown tool cannot be checked here and is refused as unknown before
 * the gate — see ByokMcpToolHost).
 */
export const byokMcpCallIsAllowed = (
  toolMeta: ?ByokMcpToolMeta,
  args: any,
  accessMode: ByokMcpAccessMode
): boolean => {
  if (accessMode === 'read-write') return true;
  if (!toolMeta) return true;
  if (toolMeta.getModifiesProject) return !toolMeta.getModifiesProject(args);
  return toolMeta.modifiesProject !== true;
};

/** Cap a tool output, marking the cut (the chat loop's capToolOutput, wider). */
export const capByokMcpOutput = (output: string): string => {
  if (output.length <= BYOK_MCP_OUTPUT_CAP) return output;
  return `${output.slice(
    0,
    BYOK_MCP_OUTPUT_CAP
  )}\n[truncated by the GDevelop MCP server]`;
};

export const makeByokMcpTextResult = (text: string): ByokMcpCallToolResult => ({
  content: [{ type: 'text', text }],
});

export const makeByokMcpErrorResult = (
  message: string
): ByokMcpCallToolResult => ({
  content: [{ type: 'text', text: message }],
  isError: true,
});

/**
 * Registry-tool result → MCP content. Mirrors
 * `getFunctionCallOutputsFromEditorFunctionCallResults`: the serialized
 * object is `{ success, ...output }` — and calls that never finished get
 * the same synthetic failure output the orchestrator appends.
 */
export const mapEditorFunctionCallResultToMcpContent = (
  result: EditorFunctionCallResult
): ByokMcpCallToolResult => {
  if (result.status !== 'finished') {
    return makeByokMcpErrorResult(
      'The tool was aborted before finishing. Check the current state with the read tools, then continue.'
    );
  }
  const outputObject = isPlainObject(result.output) ? result.output : {};
  const text = capByokMcpOutput(
    JSON.stringify({ success: result.success, ...outputObject })
  );
  return {
    content: [{ type: 'text', text }],
    ...(result.success ? {} : { isError: true }),
  };
};

/**
 * BYOK-only extra-tool result → MCP content. The raw output object already
 * carries `success` (serialized verbatim, like the chat loop does); the
 * referenced image ids are materialized into MCP image content parts so
 * they survive outside the IDE.
 */
export const mapByokExtraToolResultToMcpContent = (
  result: ByokExtraToolResult
): ByokMcpCallToolResult => {
  const outputObject = isPlainObject(result.output) ? result.output : {};
  const text = capByokMcpOutput(JSON.stringify(outputObject));
  const content: Array<ByokMcpContentPart> = [{ type: 'text', text }];
  const images = result.images || [];
  for (const imageId of images) {
    const image = getByokImage(imageId);
    if (!image) continue;
    const part = makeByokMcpImagePart(image.dataUrl);
    if (part) content.push(part);
  }
  const succeeded = outputObject.success === true;
  return {
    content,
    ...(succeeded ? {} : { isError: true }),
  };
};

/** `data:image/png;base64,…` → an MCP image content part (or null). */
export const parseByokImageDataUrl = (
  dataUrl: string
): ?{| data: string, mimeType: string |} => {
  const match = /^data:([^;,]+);base64,([\s\S]+)$/.exec(dataUrl);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
};

const makeByokMcpImagePart = (dataUrl: string): ?ByokMcpContentPart => {
  const parsed = parseByokImageDataUrl(dataUrl);
  if (!parsed) return null;
  return { type: 'image', data: parsed.data, mimeType: parsed.mimeType };
};

/**
 * The plan tool echo (the orchestrator's `appendPlanToolOutput`, minus the
 * transcript): there is no chat UI to render a plan in over MCP, so the
 * normalized plan travels back as text the external agent can read.
 */
export const buildByokMcpPlanToolResult = (
  args: Object
): ByokMcpCallToolResult => {
  const tasks = Array.isArray(args.tasks) ? args.tasks : null;
  if (!tasks) {
    return makeByokMcpErrorResult(
      'Invalid arguments: a "tasks" array is required.'
    );
  }
  const normalizedTasks = tasks.map(task => ({
    ...(isPlainObject(task) ? task : {}),
    dependsOn:
      isPlainObject(task) && Array.isArray(task.depends_on)
        ? task.depends_on
        : [],
  }));
  return makeByokMcpTextResult(
    JSON.stringify({ success: true, plan: { tasks: normalizedTasks } })
  );
};

/**
 * The MCP-native overview tool: the SimplifiedProject snapshot (the exact
 * shape the BYOK system prompt folds into messages), or the explicit
 * no-project answer so the agent knows `initialize_project` is the move.
 * The builder maker is injectable so tests need no libGD project.
 */
export const buildByokMcpProjectOverviewResult = (
  project: any,
  builderMaker?: (
    gd: any
  ) => {|
    getSimplifiedProject: (project: any, options: Object) => any,
  |}
): ByokMcpCallToolResult => {
  if (!project) {
    return makeByokMcpTextResult('{"hasOpenProject": false}');
  }
  const makeBuilder = builderMaker || makeSimplifiedProjectBuilder;
  const snapshot = makeBuilder(global.gd).getSimplifiedProject(project, {});
  const snapshotObject =
    typeof snapshot === 'string' ? safeJsonParse(snapshot) : snapshot;
  if (!isPlainObject(snapshotObject)) {
    return makeByokMcpErrorResult(
      'The project snapshot could not be built in the GDevelop editor.'
    );
  }
  return makeByokMcpTextResult(
    capByokMcpOutput(
      JSON.stringify({
        hasOpenProject: true,
        simplifiedProject: snapshotObject,
      })
    )
  );
};

/**
 * The outcome of one `tools/call` beyond its MCP content: what the host
 * queue needs for the activity log (business failures are still completed
 * executions; 'rejected' is a read-only gate refusal; 'failed' is a crash
 * or an unknown tool).
 */
export type ByokMcpToolCallOutcome = 'completed' | 'rejected' | 'failed';

export type ByokMcpDetailedToolCallResult = {|
  result: ByokMcpCallToolResult,
  didModifyProject: boolean,
  outcome: ByokMcpToolCallOutcome,
|};

/** The full `tools/call` path: gate, dispatch, map. Called by the host queue. */
export const runByokMcpToolCall = async (
  params: {| +name: string, +args: Object |},
  callId: string,
  host: ByokMcpToolHost
): Promise<ByokMcpDetailedToolCallResult> => {
  if (params.name === BYOK_MCP_GET_PROJECT_OVERVIEW_TOOL_NAME) {
    return {
      result: buildByokMcpProjectOverviewResult(host.getProject()),
      didModifyProject: false,
      outcome: 'completed',
    };
  }
  if (params.name === BYOK_PLAN_TOOL_NAME) {
    return {
      result: buildByokMcpPlanToolResult(params.args),
      didModifyProject: false,
      outcome: 'completed',
    };
  }

  const accessMode = host.getSettings().mcpServer.accessMode;
  const toolMeta = findToolMeta(params.name, host);
  if (!toolMeta) {
    return {
      result: makeByokMcpErrorResult(`Unknown tool: ${params.name}`),
      didModifyProject: false,
      outcome: 'failed',
    };
  }
  if (!byokMcpCallIsAllowed(toolMeta.meta, params.args, accessMode)) {
    return {
      result: makeByokMcpErrorResult(BYOK_MCP_READ_ONLY_REJECTION_MESSAGE),
      didModifyProject: false,
      outcome: 'rejected',
    };
  }

  try {
    if (toolMeta.source === 'extra') {
      const extraResult = await host.executeExtraTool(params.name, params.args);
      return {
        result: mapByokExtraToolResultToMcpContent(extraResult),
        didModifyProject: extraResult.didModifyProject === true,
        outcome: 'completed',
      };
    }
    const registryResult = await host.executeRegistryTool(
      params.name,
      JSON.stringify(params.args),
      callId
    );
    return {
      result: mapEditorFunctionCallResultToMcpContent(registryResult),
      didModifyProject: registryResult.didModifyProject === true,
      outcome: 'completed',
    };
  } catch (error) {
    return {
      result: makeByokMcpErrorResult(
        `The tool execution crashed: ${
          error instanceof Error ? error.message : String(error)
        }`
      ),
      didModifyProject: false,
      outcome: 'failed',
    };
  }
};

type ToolMetaSource = 'extra' | 'registry';

const findToolMeta = (
  name: string,
  host: ByokMcpToolHost
): ?{| meta: ByokMcpToolMeta, source: ToolMetaSource |} => {
  const extraTool = host.getExtraTool(name);
  if (extraTool && !host.isExtraToolShadowedByRegistry(name)) {
    return {
      meta: { modifiesProject: extraTool.modifiesProject },
      source: 'extra',
    };
  }
  const editorFunction =
    host.editorFunctions[name] || host.editorFunctionsWithoutProject[name];
  if (editorFunction) {
    return { meta: editorFunction, source: 'registry' };
  }
  return null;
};

const isPlainObject = (value: any): boolean =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const safeJsonParse = (text: string): any => {
  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
};

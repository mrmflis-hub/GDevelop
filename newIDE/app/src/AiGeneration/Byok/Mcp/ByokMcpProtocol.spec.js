// @flow
import {
  BYOK_MCP_ERROR_INVALID_PARAMS,
  BYOK_MCP_ERROR_INVALID_REQUEST,
  BYOK_MCP_ERROR_METHOD_NOT_FOUND,
  BYOK_MCP_ERROR_PARSE_ERROR,
  BYOK_MCP_PROTOCOL_VERSION,
  handleByokMcpMessage,
  parseByokMcpRawMessage,
} from './ByokMcpProtocol';

/**
 * The handlers are fakes: the protocol core must be testable with no
 * editor, no transport and no host — only this contract.
 */
const makeHandlers = (overrides?: Object) => ({
  listTools: (jest.fn(): any).mockReturnValue([
    { name: 'read_scene_events', description: 'Read events.', inputSchema: {} },
  ]),
  callTool: (jest.fn(): any).mockResolvedValue({
    content: [{ type: 'text', text: '{"success":true}' }],
  }),
  cancel: (jest.fn(): any),
  getAppVersion: (jest.fn(): any).mockReturnValue('5.6.282'),
  ...overrides,
});

describe('parseByokMcpRawMessage', () => {
  it('parses a valid JSON message', () => {
    const parsed = parseByokMcpRawMessage(
      '{"jsonrpc":"2.0","id":1,"method":"ping"}'
    );
    expect(parsed).toEqual({
      ok: true,
      message: { jsonrpc: '2.0', id: 1, method: 'ping' },
    });
  });

  it('reports a parse error for invalid JSON', () => {
    const parsed = parseByokMcpRawMessage('{not json');
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.errorCode).toBe(BYOK_MCP_ERROR_PARSE_ERROR);
    }
  });
});

describe('handleByokMcpMessage — initialize', () => {
  it('echoes a supported protocol version and describes the server', async () => {
    const handlers = makeHandlers();
    const outcome = await handleByokMcpMessage(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: BYOK_MCP_PROTOCOL_VERSION },
      },
      handlers
    );
    expect(outcome.kind).toBe('response');
    if (outcome.kind !== 'response') return;
    expect(outcome.response).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: BYOK_MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: {
          name: 'gdevelop',
          title: 'GDevelop',
          version: '5.6.282',
        },
      },
    });
  });

  it('answers with its own version when the client asks for an unknown one', async () => {
    const outcome = await handleByokMcpMessage(
      {
        jsonrpc: '2.0',
        id: 'a',
        method: 'initialize',
        params: { protocolVersion: '1999-01-01' },
      },
      makeHandlers()
    );
    if (outcome.kind !== 'response') return;
    expect(outcome.response.result.protocolVersion).toBe(
      BYOK_MCP_PROTOCOL_VERSION
    );
  });
});

describe('handleByokMcpMessage — tools', () => {
  it('returns the descriptors of the injected listTools', async () => {
    const handlers = makeHandlers();
    const outcome = await handleByokMcpMessage(
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      handlers
    );
    if (outcome.kind !== 'response') return;
    expect(outcome.response.result).toEqual({
      tools: handlers.listTools(),
    });
  });

  it('dispatches tools/call with parsed arguments', async () => {
    const handlers = makeHandlers();
    const outcome = await handleByokMcpMessage(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'read_scene_events', arguments: { sceneName: 'Menu' } },
      },
      handlers
    );
    expect(handlers.callTool).toHaveBeenCalledWith(
      { name: 'read_scene_events', args: { sceneName: 'Menu' } },
      3
    );
    if (outcome.kind !== 'response') return;
    expect(outcome.response.result).toEqual({
      content: [{ type: 'text', text: '{"success":true}' }],
    });
  });

  it('accepts arguments serialized as a JSON string', async () => {
    const handlers = makeHandlers();
    await handleByokMcpMessage(
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'read_scene_events',
          arguments: '{"sceneName":"Menu"}',
        },
      },
      handlers
    );
    expect(handlers.callTool).toHaveBeenCalledWith(
      { name: 'read_scene_events', args: { sceneName: 'Menu' } },
      4
    );
  });

  it('rejects tools/call without a tool name with -32602', async () => {
    const outcome = await handleByokMcpMessage(
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: {} },
      makeHandlers()
    );
    if (outcome.kind !== 'response') return;
    expect(outcome.response.error.code).toBe(BYOK_MCP_ERROR_INVALID_PARAMS);
  });
});

describe('handleByokMcpMessage — ping and notifications', () => {
  it('answers ping with an empty result', async () => {
    const outcome = await handleByokMcpMessage(
      { jsonrpc: '2.0', id: 6, method: 'ping' },
      makeHandlers()
    );
    expect(outcome).toEqual({
      kind: 'response',
      response: { jsonrpc: '2.0', id: 6, result: {} },
    });
  });

  it('accepts notifications/initialized without a response', async () => {
    const outcome = await handleByokMcpMessage(
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      makeHandlers()
    );
    expect(outcome).toEqual({ kind: 'notification' });
  });

  it('forwards notifications/cancelled to the cancel handler', async () => {
    const handlers = makeHandlers();
    const outcome = await handleByokMcpMessage(
      {
        jsonrpc: '2.0',
        method: 'notifications/cancelled',
        params: { requestId: 7, reason: 'user' },
      },
      handlers
    );
    expect(outcome).toEqual({ kind: 'notification' });
    expect(handlers.cancel).toHaveBeenCalledWith(7, 'user');
  });

  it('ignores unknown notifications but errors unknown requests', async () => {
    const notificationOutcome = await handleByokMcpMessage(
      { jsonrpc: '2.0', method: 'resources/list' },
      makeHandlers()
    );
    expect(notificationOutcome).toEqual({ kind: 'notification' });

    const requestOutcome = await handleByokMcpMessage(
      { jsonrpc: '2.0', id: 8, method: 'resources/list' },
      makeHandlers()
    );
    if (requestOutcome.kind !== 'response') return;
    expect(requestOutcome.response.error.code).toBe(
      BYOK_MCP_ERROR_METHOD_NOT_FOUND
    );
  });
});

describe('handleByokMcpMessage — malformed input', () => {
  it('rejects a non-object message with -32600', async () => {
    const outcome = await handleByokMcpMessage([1, 2], makeHandlers());
    if (outcome.kind !== 'response') return;
    expect(outcome.response.error.code).toBe(BYOK_MCP_ERROR_INVALID_REQUEST);
  });

  it('rejects a message without a method, but only when it has an id', async () => {
    const withId = await handleByokMcpMessage(
      { jsonrpc: '2.0', id: 9 },
      makeHandlers()
    );
    if (withId.kind !== 'response') return;
    expect(withId.response.error.code).toBe(BYOK_MCP_ERROR_INVALID_REQUEST);

    const withoutId = await handleByokMcpMessage(
      { jsonrpc: '2.0' },
      makeHandlers()
    );
    expect(withoutId).toEqual({ kind: 'notification' });
  });
});

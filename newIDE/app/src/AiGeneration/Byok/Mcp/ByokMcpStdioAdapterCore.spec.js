// This suite intentionally runs without the Flow marker: it tests the
// plain-CommonJS adapter core (which requires the Node 'path' module,
// invisible to Flow), so it runs as plain JavaScript like the module it
// tests.
const path = require('path');
const core = require('./ByokMcpStdioAdapterCore');

// path.join uses the host's separators (the tests may run on Windows while
// asserting darwin/linux layouts), so expectations are built with it too.
describe('resolveDefaultDiscoveryPath', () => {
  it('uses the per-user app-data folder on Windows', () => {
    expect(core.resolveDefaultDiscoveryPath('win32', 'C:/Users/dev')).toBe(
      path.join(
        'C:/Users/dev',
        'AppData',
        'Roaming',
        'GDevelop',
        core.DISCOVERY_FILE_NAME
      )
    );
  });

  it('uses the per-user application support folder on macOS', () => {
    expect(core.resolveDefaultDiscoveryPath('darwin', '/Users/dev')).toBe(
      path.join(
        '/Users/dev',
        'Library',
        'Application Support',
        'GDevelop',
        core.DISCOVERY_FILE_NAME
      )
    );
  });

  it('uses the config folder elsewhere', () => {
    expect(core.resolveDefaultDiscoveryPath('linux', '/home/dev')).toBe(
      path.join('/home/dev', '.config', 'GDevelop', core.DISCOVERY_FILE_NAME)
    );
  });
});

describe('parseCliArgs', () => {
  it('parses the documented flags', () => {
    expect(
      core.parseCliArgs([
        '--url',
        'http://127.0.0.1:1/mcp',
        '--port',
        '42',
        '--token',
        'abc',
        '--file',
        'd.json',
      ])
    ).toEqual({
      help: false,
      url: 'http://127.0.0.1:1/mcp',
      port: 42,
      token: 'abc',
      file: 'd.json',
    });
  });

  it('recognizes help and ignores unknown flags', () => {
    expect(core.parseCliArgs(['-h'])).toEqual({
      help: true,
      url: null,
      port: null,
      token: null,
      file: null,
    });
    expect(core.parseCliArgs(['--unknown', 'x', '--token', 't']).token).toBe(
      't'
    );
  });

  it('ignores a flag missing its value', () => {
    expect(core.parseCliArgs(['--token']).token).toBe(null);
  });
});

describe('parseDiscoveryFileText', () => {
  it('parses a well-shaped discovery file', () => {
    expect(
      core.parseDiscoveryFileText(
        '{"port":51234,"token":"hex","pid":99,"protocolVersion":"2026-07-28"}'
      )
    ).toEqual({ port: 51234, token: 'hex', protocolVersion: '2026-07-28' });
  });

  it('rejects missing, malformed or out-of-range content', () => {
    expect(core.parseDiscoveryFileText(null)).toBe(null);
    expect(core.parseDiscoveryFileText('{broken')).toBe(null);
    expect(core.parseDiscoveryFileText('{"token":"hex"}')).toBe(null);
    expect(core.parseDiscoveryFileText('{"port":70000,"token":"hex"}')).toBe(
      null
    );
    expect(core.parseDiscoveryFileText('{"port":51234}')).toBe(null);
    expect(core.parseDiscoveryFileText('{"port":51234,"token":""}')).toBe(null);
  });

  it('tolerates a missing protocol version', () => {
    expect(core.parseDiscoveryFileText('{"port":1,"token":"t"}')).toEqual({
      port: 1,
      token: 't',
      protocolVersion: null,
    });
  });
});

describe('resolveEndpoint', () => {
  const discoveryReader = () => '{"port":1111,"token":"disco-token","pid":1}';

  it('lets fully-provided flags bypass the discovery file', () => {
    expect(
      core.resolveEndpoint(
        { url: 'http://127.0.0.1:9/mcp', token: 'flag' },
        () => discoveryReader()
      )
    ).toEqual({ url: 'http://127.0.0.1:9/mcp', token: 'flag' });
  });

  it('fills what flags leave out from the discovery file', () => {
    expect(
      core.resolveEndpoint({ port: 2222, token: null }, discoveryReader)
    ).toEqual({ url: 'http://127.0.0.1:2222/mcp', token: 'disco-token' });
    expect(
      core.resolveEndpoint({ url: null, token: 'flag-token' }, discoveryReader)
    ).toEqual({ url: 'http://127.0.0.1:1111/mcp', token: 'flag-token' });
  });

  it('answers null when neither flags nor discovery file suffice', () => {
    expect(core.resolveEndpoint({ url: null, token: null }, () => null)).toBe(
      null
    );
    expect(
      core.resolveEndpoint({ url: null, token: null }, () => '{broken}')
    ).toBe(null);
  });
});

describe('response helpers', () => {
  it('builds JSON-RPC error responses with a null id for parse errors', () => {
    expect(core.buildErrorResponseText(null, -32700, 'Parse error.')).toBe(
      '{"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"Parse error."}}'
    );
    expect(core.buildErrorResponseText(7, -32002, 'unreachable')).toBe(
      '{"jsonrpc":"2.0","id":7,"error":{"code":-32002,"message":"unreachable"}}'
    );
  });

  it('relays a response body only for id-bearing requests', () => {
    expect(core.shouldRelayResponseBody({ id: 1 }, '{}')).toBe(true);
    expect(core.shouldRelayResponseBody({ id: 1 }, '')).toBe(false);
    expect(core.shouldRelayResponseBody({ id: null }, '{}')).toBe(false);
    expect(core.shouldRelayResponseBody({ id: undefined }, '{}')).toBe(false);
    expect(core.shouldRelayResponseBody(null, '{}')).toBe(false);
  });
});

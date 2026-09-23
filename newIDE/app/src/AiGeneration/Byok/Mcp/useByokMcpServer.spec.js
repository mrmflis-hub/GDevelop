/**
 * @jest-environment jsdom
 */
// @flow
import * as React from 'react';
import { act } from 'react-dom/test-utils';
import reactTestRenderer from 'react-test-renderer';

// jsdom does not implement matchMedia, which PreferencesContext.js (in the
// hook's import graph through the ByokMcpServerHost component) calls at
// module load. Polyfill it BEFORE anything that transitively requires it —
// hence the require() calls below instead of static imports.
if (!(window: any).matchMedia) {
  (window: any).matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  });
}

// The Electron module is mocked so the hook can be exercised in the desktop
// (ipcRenderer present) and web (optionalRequire returns null) modes. The
// hook resolves Electron lazily per render, so tests just flip this
// variable — no module-registry resets needed. A plain closure, not a
// jest.fn: the Jest config resets mock implementations between tests, and
// only a closure is immune.
const mockIpcInvoke = (jest.fn(): any);
const mockIpcOn = (jest.fn(): any);
const mockIpcSend = (jest.fn(): any);
const mockIpcRemoveListener = (jest.fn(): any);
let mockElectronModule: any = null;

jest.mock('../../../Utils/OptionalRequire', () => ({
  __esModule: true,
  default: () => mockElectronModule,
}));

const { ByokMcpServerHost, useByokMcpServer } = require('./useByokMcpServer');
const {
  makeByokMcpToolHost,
  setByokMcpToolHost,
  getByokMcpToolHost,
} = require('./ByokMcpToolHost');

const makeIpcRenderer = () => ({
  invoke: mockIpcInvoke,
  on: mockIpcOn,
  send: mockIpcSend,
  removeListener: mockIpcRemoveListener,
});

const flushMicrotasks = async (): Promise<void> => {
  await new Promise(resolve => setTimeout(resolve, 0));
  await new Promise(resolve => setTimeout(resolve, 0));
};

type Capture = { current: any };
type ProbeProps = {| enabled: boolean, capture: Capture |};

const Probe = ({ enabled, capture }: ProbeProps) => {
  capture.current = useByokMcpServer(enabled);
  return null;
};

const renderHookAt = (enabled: boolean) => {
  const capture: Capture = { current: null };
  let renderer: any = null;
  act(() => {
    renderer = reactTestRenderer.create(
      <Probe enabled={enabled} capture={capture} />
    );
  });
  return {
    renderer,
    capture,
    rerender: (nextEnabled: boolean) => {
      act(() => {
        renderer.update(<Probe enabled={nextEnabled} capture={capture} />);
      });
    },
  };
};

beforeEach(() => {
  jest.clearAllMocks();
  setByokMcpToolHost(null);
});

describe('useByokMcpServer — web build', () => {
  it('is inert without Electron: no IPC, inert status', async () => {
    mockElectronModule = null;
    const { capture } = renderHookAt(true);
    await act(async () => {
      await flushMicrotasks();
    });
    expect(capture.current).toEqual({
      running: null,
      endpointUrl: null,
      discoveryPath: null,
      error: null,
      hostReady: false,
    });
    expect(mockIpcInvoke).not.toHaveBeenCalled();
    expect(mockIpcSend).not.toHaveBeenCalled();
    expect(mockIpcOn).not.toHaveBeenCalled();
  });
});

describe('useByokMcpServer — desktop', () => {
  it('pushes the enabled state to main and reflects the running endpoint', async () => {
    mockElectronModule = { ipcRenderer: makeIpcRenderer() };
    mockIpcInvoke.mockResolvedValue({
      ok: true,
      running: true,
      port: 51234,
      discoveryPath: 'C:/fake/gdevelop-mcp-endpoint.json',
    });

    const hooked = renderHookAt(true);
    await act(async () => {
      await flushMicrotasks();
    });
    expect(mockIpcInvoke).toHaveBeenCalledWith('byok-mcp-set-enabled', {
      enabled: true,
    });
    expect(hooked.capture.current.running).toBe(true);
    expect(hooked.capture.current.endpointUrl).toBe(
      'http://127.0.0.1:51234/mcp'
    );
    expect(hooked.capture.current.discoveryPath).toBe(
      'C:/fake/gdevelop-mcp-endpoint.json'
    );

    // A stopped server has no endpoint URL.
    mockIpcInvoke.mockResolvedValue({ ok: true, running: false, port: null });
    await act(async () => {
      hooked.rerender(false);
      await flushMicrotasks();
    });
    expect(mockIpcInvoke).toHaveBeenLastCalledWith('byok-mcp-set-enabled', {
      enabled: false,
    });
    expect(hooked.capture.current.running).toBe(false);
    expect(hooked.capture.current.endpointUrl).toBeNull();
  });

  it('surfaces a start refusal (another instance owns the endpoint)', async () => {
    mockElectronModule = { ipcRenderer: makeIpcRenderer() };
    mockIpcInvoke.mockResolvedValue({
      ok: false,
      error:
        'Another running GDevelop instance owns the GDevelop MCP endpoint.',
    });
    const { capture } = renderHookAt(true);
    await act(async () => {
      await flushMicrotasks();
    });
    expect(capture.current.running).toBe(false);
    expect(capture.current.error).toContain('Another running GDevelop');
  });

  it('surfaces a rejected IPC call', async () => {
    mockElectronModule = { ipcRenderer: makeIpcRenderer() };
    mockIpcInvoke.mockRejectedValue(new Error('no handler'));
    const { capture } = renderHookAt(true);
    await act(async () => {
      await flushMicrotasks();
    });
    expect(capture.current.running).toBe(false);
    expect(capture.current.error).toContain('could not be applied');
  });

  it('announces tool-host readiness and follows its changes', async () => {
    mockElectronModule = { ipcRenderer: makeIpcRenderer() };
    mockIpcInvoke.mockResolvedValue({ ok: true, running: false });
    renderHookAt(false);
    await act(async () => {
      await flushMicrotasks();
    });
    expect(mockIpcSend).toHaveBeenCalledWith('byok-mcp-host-status', {
      ready: false,
    });

    const host = makeByokMcpToolHost(
      ({
        executeRegistryTool: jest.fn(),
        executeExtraTool: jest.fn(),
        getExtraTool: () => null,
        isExtraToolShadowedByRegistry: () => false,
        editorFunctions: {},
        editorFunctionsWithoutProject: {},
        getProject: () => null,
        getSettings: () => ({
          mcpServer: { enabled: false, accessMode: 'read-write' },
        }),
      }: any)
    );
    await act(async () => {
      setByokMcpToolHost(host);
      await flushMicrotasks();
    });
    expect(mockIpcSend).toHaveBeenCalledWith('byok-mcp-host-status', {
      ready: true,
    });

    await act(async () => {
      setByokMcpToolHost(null);
      await flushMicrotasks();
    });
    expect(mockIpcSend).toHaveBeenLastCalledWith('byok-mcp-host-status', {
      ready: false,
    });
  });

  it('answers forwarded requests through the protocol core', async () => {
    mockElectronModule = { ipcRenderer: makeIpcRenderer() };
    mockIpcInvoke.mockResolvedValue({ ok: true, running: false });
    renderHookAt(false);
    await act(async () => {
      await flushMicrotasks();
    });

    const requestListener = mockIpcOn.mock.calls.find(
      call => call[0] === 'byok-mcp-request'
    );
    if (!requestListener) throw new Error('The request listener was not set');
    const listener = requestListener[1];

    // tools/list works even without a registered host (static schemas).
    await act(async () => {
      listener(null, {
        requestId: 1,
        rawMessage: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
        }),
      });
      await flushMicrotasks();
    });
    const listReply = mockIpcSend.mock.calls.find(
      call => call[0] === 'byok-mcp-response' && call[1].requestId === 1
    );
    if (!listReply) throw new Error('The tools/list reply was not sent');
    expect(listReply[1].response.result.tools.length).toBeGreaterThan(0);

    // A tools/call with no host is a tool-level error result, not a crash.
    await act(async () => {
      listener(null, {
        requestId: 2,
        rawMessage: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'read_scene_events', arguments: {} },
        }),
      });
      await flushMicrotasks();
    });
    const callReply = mockIpcSend.mock.calls.find(
      call => call[0] === 'byok-mcp-response' && call[1].requestId === 2
    );
    if (!callReply) throw new Error('The tools/call reply was not sent');
    expect(callReply[1].response.result.isError).toBe(true);
    expect(getByokMcpToolHost()).toBeNull();

    // Garbage is answered with the parse error; notifications are answered
    // with a null response main ignores.
    await act(async () => {
      listener(null, { requestId: 3, rawMessage: '{broken' });
      await flushMicrotasks();
      listener(null, {
        requestId: 4,
        rawMessage: JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/initialized',
        }),
      });
      await flushMicrotasks();
    });
    const parseReply = mockIpcSend.mock.calls.find(
      call => call[0] === 'byok-mcp-response' && call[1].requestId === 3
    );
    if (!parseReply) throw new Error('The parse-error reply was not sent');
    expect(parseReply[1].response.error.code).toBe(-32700);
    const notificationReply = mockIpcSend.mock.calls.find(
      call => call[0] === 'byok-mcp-response' && call[1].requestId === 4
    );
    if (!notificationReply)
      throw new Error('The notification ack was not sent');
    expect(notificationReply[1].response).toBeNull();
  });

  it('unsubscribes from the request channel on unmount', async () => {
    mockElectronModule = { ipcRenderer: makeIpcRenderer() };
    mockIpcInvoke.mockResolvedValue({ ok: true, running: false });
    const { renderer } = renderHookAt(false);
    await act(async () => {
      await flushMicrotasks();
    });
    act(() => {
      renderer.unmount();
    });
    expect(mockIpcRemoveListener).toHaveBeenCalledWith(
      'byok-mcp-request',
      expect.any(Function)
    );
  });
});

describe('ByokMcpServerHost', () => {
  it('renders nothing while driving the hook', async () => {
    mockElectronModule = null;
    const PreferencesContext = require('../../../MainFrame/Preferences/PreferencesContext')
      .default;
    let renderer: any = null;
    await act(async () => {
      renderer = reactTestRenderer.create(
        <PreferencesContext.Provider
          value={({ values: {}, setMultipleValues: jest.fn() }: any)}
        >
          <ByokMcpServerHost />
        </PreferencesContext.Provider>
      );
    });
    expect(renderer.toJSON()).toBeNull();
  });
});

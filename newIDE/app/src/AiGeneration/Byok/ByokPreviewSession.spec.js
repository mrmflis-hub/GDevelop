// @flow
import {
  BYOK_PREVIEW_LOG_BUFFER_SIZE,
  createByokPreviewSession,
  reduceByokRuntimeDump,
  type ByokPreviewLauncher,
} from './ByokPreviewSession';

// A fake debugger server recording subscriptions — the lifecycle contract
// (start subscribes, stop unsubscribes, no dangling listeners).
const makeFakeDebuggerServer = () => {
  const registeredCallbacks: Array<any> = [];
  return {
    registeredCallbacks,
    registerCallbacks: (callbacks: any) => {
      registeredCallbacks.push(callbacks);
      return () => {
        const index = registeredCallbacks.indexOf(callbacks);
        if (index !== -1) registeredCallbacks.splice(index, 1);
      };
    },
    sendMessageWithResponse: (jest.fn(): any),
  };
};

const makeFakeLauncher = (debuggerServer: any): ByokPreviewLauncher => ({
  launchPreview: (jest.fn(): any).mockResolvedValue(undefined),
  closePreview: jest.fn(),
  getPreviewDebuggerServer: () => debuggerServer,
});

const emitLog = (debuggerServer: any, payload: Object) => {
  for (const callbacks of debuggerServer.registeredCallbacks) {
    callbacks.onHandleParsedMessage({
      id: 'fake-preview',
      parsedMessage: { command: 'console.log', payload },
    });
  }
};

const emitCrash = (debuggerServer: any, error: string) => {
  for (const callbacks of debuggerServer.registeredCallbacks) {
    callbacks.onHandleParsedMessage({
      id: 'fake-preview',
      parsedMessage: {
        command: 'game.crashed',
        payload: { error },
      },
    });
  }
};

describe('createByokPreviewSession', () => {
  it('starts a preview, subscribes before launching, and stops cleanly', async () => {
    const debuggerServer = makeFakeDebuggerServer();
    const launcher = makeFakeLauncher(debuggerServer);
    const session = createByokPreviewSession({
      getPreviewLauncher: () => launcher,
      getProject: () => ({ getFirstLayout: () => 'Scene 1' }),
    });

    const startResult = await session.start({});
    expect(startResult.success).toBe(true);
    expect(debuggerServer.registeredCallbacks.length).toBe(1);
    expect(launcher.launchPreview).toHaveBeenCalledTimes(1);
    expect(session.isRunning()).toBe(true);

    const stopResult = session.stop();
    expect(stopResult.success).toBe(true);
    expect(debuggerServer.registeredCallbacks.length).toBe(0);
    expect(launcher.closePreview).toHaveBeenCalledTimes(1);
    expect(session.isRunning()).toBe(false);
  });

  it('refuses a second preview while one runs, and stopping twice fails', async () => {
    const debuggerServer = makeFakeDebuggerServer();
    const session = createByokPreviewSession({
      getPreviewLauncher: () => makeFakeLauncher(debuggerServer),
      getProject: () => ({ getFirstLayout: () => 'Scene 1' }),
    });

    await session.start({});
    const secondStart = await session.start({});
    expect(secondStart.success).toBe(false);
    expect(secondStart.message).toContain('already running');

    session.stop();
    const secondStop = session.stop();
    expect(secondStop.success).toBe(false);
  });

  it('fails actionably without a launcher or debugger server', async () => {
    const noLauncher = createByokPreviewSession({
      getPreviewLauncher: () => null,
      getProject: () => null,
    });
    const noLauncherResult = await noLauncher.start({});
    expect(noLauncherResult.success).toBe(false);
    expect(noLauncherResult.message).toContain('No preview launcher');

    const noDebugger = createByokPreviewSession({
      getPreviewLauncher: () => ({
        launchPreview: async () => {},
        getPreviewDebuggerServer: () => null,
      }),
      getProject: () => null,
    });
    const noDebuggerResult = await noDebugger.start({});
    expect(noDebuggerResult.success).toBe(false);
    expect(noDebuggerResult.message).toContain('debugger server');
  });

  it('buffers console logs, skips library warnings, and slices by index/level', async () => {
    const debuggerServer = makeFakeDebuggerServer();
    const session = createByokPreviewSession({
      getPreviewLauncher: () => makeFakeLauncher(debuggerServer),
      getProject: () => ({ getFirstLayout: () => 'Scene 1' }),
    });
    await session.start({});

    emitLog(debuggerServer, { message: 'hello', type: 'log', timestamp: 1 });
    emitLog(debuggerServer, {
      message: 'Electron Security Warning (bad)',
      type: 'warning',
      group: 'JavaScript',
      timestamp: 2,
    });
    emitLog(debuggerServer, { message: 'boom', type: 'error', timestamp: 3 });

    expect(session.getLogs({})).toHaveLength(2);
    expect(session.getLogs({ sinceIndex: 1 })).toHaveLength(1);
    expect(
      session.getLogs({ level: 'error' }).map(entry => entry.text)
    ).toEqual(['boom']);
  });

  it('caps the log ring buffer', async () => {
    const debuggerServer = makeFakeDebuggerServer();
    const session = createByokPreviewSession({
      getPreviewLauncher: () => makeFakeLauncher(debuggerServer),
      getProject: () => ({ getFirstLayout: () => 'Scene 1' }),
    });
    await session.start({});

    for (let index = 0; index < BYOK_PREVIEW_LOG_BUFFER_SIZE + 50; index++) {
      emitLog(debuggerServer, { message: `log ${index}`, type: 'log' });
    }
    expect(session.getLogs({}).length).toBe(BYOK_PREVIEW_LOG_BUFFER_SIZE);
  });

  it('captures crashes and error-level logs as new errors, consumed once', async () => {
    const debuggerServer = makeFakeDebuggerServer();
    const session = createByokPreviewSession({
      getPreviewLauncher: () => makeFakeLauncher(debuggerServer),
      getProject: () => ({ getFirstLayout: () => 'Scene 1' }),
    });
    await session.start({});

    emitLog(debuggerServer, { message: 'soft failure', type: 'error' });
    emitCrash(debuggerServer, 'TypeError: x is not a function');

    const errors = session.getNewErrors();
    expect(errors).toHaveLength(2);
    expect(errors[1]).toContain('TypeError');
    // Consumed on read.
    expect(session.getNewErrors()).toHaveLength(0);
  });

  it('reads the runtime state through a refresh round-trip', async () => {
    const debuggerServer = makeFakeDebuggerServer();
    (debuggerServer.sendMessageWithResponse: any).mockResolvedValue({
      command: 'dump',
      payload: {
        _variables: { Score: 10 },
        _sceneStack: {
          _stack: [
            {
              _name: 'Level 1',
              _instances: {
                items: {
                  Player: [{ name: 'Player', x: 123, y: 45, zOrder: 0 }],
                },
              },
              _variables: { Health: 5 },
            },
          ],
        },
      },
    });
    const session = createByokPreviewSession({
      getPreviewLauncher: () => makeFakeLauncher(debuggerServer),
      getProject: () => ({ getFirstLayout: () => 'Scene 1' }),
    });
    await session.start({});

    const result = await session.inspectState();
    expect(result.success).toBe(true);
    const state = result.state;
    if (!state) throw new Error('expected a state');
    expect(state.scenes[0].name).toBe('Level 1');
    expect(state.scenes[0].instances.Player[0].x).toBe(123);
    expect(state.scenes[0].variables).toEqual({ Health: 5 });
    expect(state.globalVariables).toEqual({ Score: 10 });
  });

  it('refuses state reads without a running preview, and reports crashes', async () => {
    const debuggerServer = makeFakeDebuggerServer();
    const session = createByokPreviewSession({
      getPreviewLauncher: () => makeFakeLauncher(debuggerServer),
      getProject: () => ({ getFirstLayout: () => 'Scene 1' }),
    });

    const idle = await session.inspectState();
    expect(idle.success).toBe(false);

    await session.start({});
    emitCrash(debuggerServer, 'TypeError: crashed');
    const crashed = await session.inspectState();
    expect(crashed.success).toBe(false);
    expect(crashed.message).toContain('crashed');
  });
});

describe('reduceByokRuntimeDump', () => {
  it('reduces a defensive empty object to an empty state', () => {
    expect(reduceByokRuntimeDump(null)).toEqual({ scenes: [] });
    expect(reduceByokRuntimeDump({})).toEqual({
      scenes: [],
      globalVariables: {},
    });
  });
});

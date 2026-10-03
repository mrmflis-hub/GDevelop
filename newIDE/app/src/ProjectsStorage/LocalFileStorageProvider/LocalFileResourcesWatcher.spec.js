// @flow

/**
 * The project-folder watcher's subscription contract, pinned at the IPC
 * boundary (the mocked `optionalRequire`): multiple consumers may listen on
 * the `project-file-changed` channel at the same time, and one consumer
 * unsubscribing must remove ONLY its own listener — this is the regression
 * spec for the game-code auto-reloader, which subscribes next to the
 * resource watcher instead of replacing it.
 */

import optionalRequire from '../../Utils/OptionalRequire';
import { setupResourcesWatcher } from './LocalFileResourcesWatcher';

jest.mock('../../Utils/OptionalRequire');

// $FlowFixMe[cannot-resolve-module] - a Node builtin, used by this spec only.
const nodePath = require('path');

type ChangedHandler = (event: any, changedPath: string) => void;

const mockFn = (fn: Function): JestMockFn<any, any> => fn;

const registeredHandlers: Map<string, Array<ChangedHandler>> = new Map();

const fireProjectFileChanged = (changedPath: string) => {
  const handlers = registeredHandlers.get('project-file-changed') || [];
  for (const handler of handlers.slice()) {
    handler({}, changedPath);
  }
};

const countListeners = (): number =>
  (registeredHandlers.get('project-file-changed') || []).length;

describe('setupResourcesWatcher', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    registeredHandlers.clear();
    // The shared optionalRequire mock ships `invoke` only; this spec needs
    // the subscription half of the ipcRenderer too. A tiny in-spec event
    // registry keeps the assertions on real listener bookkeeping instead of
    // on the mock being called.
    const mockIpcRenderer = optionalRequire.mockElectron.ipcRenderer;
    // $FlowFixMe[cannot-write]
    mockIpcRenderer.on = jest.fn((channel: string, handler: ChangedHandler) => {
      const handlers = registeredHandlers.get(channel) || [];
      handlers.push(handler);
      registeredHandlers.set(channel, handlers);
    });
    // $FlowFixMe[cannot-write]
    mockIpcRenderer.removeListener = jest.fn(
      (channel: string, handler: ChangedHandler) => {
        const handlers = registeredHandlers.get(channel) || [];
        const handlerIndex = handlers.indexOf(handler);
        if (handlerIndex !== -1) handlers.splice(handlerIndex, 1);
      }
    );
    // $FlowFixMe[cannot-write]
    mockIpcRenderer.removeAllListeners = jest.fn((channel: string) => {
      registeredHandlers.set(channel, []);
    });
    // $FlowFixMe[cannot-write]
    mockIpcRenderer.invoke = jest.fn(() => Promise.resolve(4321));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const flushDebounce = async () => {
    jest.advanceTimersByTime(250);
    // The disable invoke rides on a promise: let its microtasks settle.
    await Promise.resolve();
    await Promise.resolve();
  };

  it('delivers a forward-slash, project-relative identifier per file', async () => {
    const callback = mockFn(jest.fn());
    if (!setupResourcesWatcher) throw new Error('Expected a watcher setup.');
    setupResourcesWatcher({
      fileIdentifier: nodePath.join('work', 'game.json'),
      callback,
    });

    fireProjectFileChanged(nodePath.join('work', 'MyGameCode', 'spawn.js'));
    await flushDebounce();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith({
      identifier: 'MyGameCode/spawn.js',
    });
  });

  it('keeps another consumer listener alive when one subscriber unsubscribes', async () => {
    const resourcesCallback = mockFn(jest.fn());
    const gameCodeCallback = mockFn(jest.fn());
    if (!setupResourcesWatcher) throw new Error('Expected a watcher setup.');
    const unsubscribeResources = setupResourcesWatcher({
      fileIdentifier: nodePath.join('work', 'game.json'),
      callback: resourcesCallback,
    });
    const unsubscribeGameCode = setupResourcesWatcher({
      fileIdentifier: nodePath.join('work', 'game.json'),
      callback: gameCodeCallback,
    });
    expect(countListeners()).toBe(2);

    unsubscribeResources();
    expect(countListeners()).toBe(1);

    fireProjectFileChanged(nodePath.join('work', 'resources', 'hero.png'));
    await flushDebounce();

    // The remaining consumer still sees the events; the one that
    // unsubscribed does not.
    expect(gameCodeCallback).toHaveBeenCalledTimes(1);
    expect(resourcesCallback).not.toHaveBeenCalled();
    // Unsubscribing still tears down the subscriber's own OS-level watcher
    // registration, exactly as before the multi-consumer fix.
    expect(
      optionalRequire.mockElectron.ipcRenderer.invoke
    ).toHaveBeenCalledWith('local-filesystem-watcher-disable', 4321);
    const disableCallsAfterFirstUnsubscribe = optionalRequire.mockElectron.ipcRenderer.invoke.mock.calls.filter(
      call => call[0] === 'local-filesystem-watcher-disable'
    ).length;

    unsubscribeGameCode();
    expect(countListeners()).toBe(0);
    await flushDebounce();
    expect(
      optionalRequire.mockElectron.ipcRenderer.invoke.mock.calls.filter(
        call => call[0] === 'local-filesystem-watcher-disable'
      )
    ).toHaveLength(disableCallsAfterFirstUnsubscribe + 1);
  });

  it('stops delivering events to a subscriber after its unsubscribe', async () => {
    const callback = mockFn(jest.fn());
    if (!setupResourcesWatcher) throw new Error('Expected a watcher setup.');
    const unsubscribe = setupResourcesWatcher({
      fileIdentifier: nodePath.join('work', 'game.json'),
      callback,
    });

    unsubscribe();
    fireProjectFileChanged(nodePath.join('work', 'MyGameCode', 'main.js'));
    await flushDebounce();

    expect(callback).not.toHaveBeenCalled();
  });

  it('still debounces per file (a burst for one file fires once)', async () => {
    const callback = mockFn(jest.fn());
    if (!setupResourcesWatcher) throw new Error('Expected a watcher setup.');
    setupResourcesWatcher({
      fileIdentifier: nodePath.join('work', 'game.json'),
      callback,
    });

    fireProjectFileChanged(nodePath.join('work', 'MyGameCode', 'main.js'));
    jest.advanceTimersByTime(100);
    fireProjectFileChanged(nodePath.join('work', 'MyGameCode', 'main.js'));
    await flushDebounce();

    expect(callback).toHaveBeenCalledTimes(1);
  });
});

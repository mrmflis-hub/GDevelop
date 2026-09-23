// @flow

/**
 * The preview lifecycle of the BYOK perception phase: one programmatic
 * preview the agent can start, read (console logs, crashes, live state) and
 * stop — built entirely on the existing machinery (the preview launcher
 * MainFrame registers for gameplay tests, and the debugger WebSocket
 * server it exposes). No engine or launcher change is involved.
 */

/** How many console entries are kept (the ring buffer size). */
export const BYOK_PREVIEW_LOG_BUFFER_SIZE = 200;

export type ByokPreviewLogEntry = {|
  level: string,
  text: string,
  tick: number,
|};

export type ByokPreviewCrash = {|
  text: string,
  tick: number,
|};

/** The subset of the preview launcher the session needs. */
export type ByokPreviewLauncher = {|
  launchPreview: (options: Object) => Promise<any>,
  closePreview?: () => void,
  getPreviewDebuggerServer: () => any,
|};

export type ByokPreviewSession = {|
  start: (options: {| sceneName?: string |}) => Promise<{|
    success: boolean,
    message: string,
  |}>,
  stop: () => {| success: boolean, message: string |},
  getLogs: (options: {|
    sinceIndex?: number,
    level?: string,
  |}) => Array<ByokPreviewLogEntry>,
  getNewErrors: () => Array<string>,
  inspectState: () => Promise<{|
    success: boolean,
    message?: string,
    state?: Object,
  |}>,
  isRunning: () => boolean,
  // Whether the running game crashed (and the crash was not cleared by a
  // new start) — read by the completion gate's "no crashed previews
  // pending" check.
  hasCrashed: () => boolean,
|};

/**
 * True for the library warnings every preview emits (the IDE's own filter
 * — see isUnavoidableLibraryWarning in Debugger/index.js; inlined here so
 * this module does not import the whole Debugger UI).
 */
const isUnavoidableLibraryWarning = (log: {|
  group: string,
  message: string,
|}): boolean => {
  if (log.group !== 'JavaScript') return false;
  return (
    log.message.includes('Electron Security Warning') ||
    log.message.includes(
      'https://firebase.google.com/docs/storage/web/start'
    ) ||
    log.message.includes('A ping to firebase could not be made automatically')
  );
};

/**
 * Reduce the `dump` payload of a debugger `refresh` response (the
 * serialized live game) to a compact per-scene summary the model can read:
 * instance names with positions, and the scene variables. Everything is
 * read defensively — the payload is produced by the runtime's
 * circular-safe serializer, whose exact fields evolve with the engine.
 */
export const reduceByokRuntimeDump = (dump: any): Object => {
  const scenes: Array<Object> = [];
  if (!dump || typeof dump !== 'object') return { scenes };

  const sceneStack =
    dump._sceneStack && Array.isArray(dump._sceneStack._stack)
      ? dump._sceneStack._stack
      : [];
  for (const scene of sceneStack) {
    if (!scene || typeof scene !== 'object') continue;
    const instances: { [objectName: string]: Array<Object> } = {};
    const items: any =
      scene._instances &&
      scene._instances.items &&
      typeof scene._instances.items === 'object'
        ? scene._instances.items
        : {};
    for (const objectName of Object.keys(items)) {
      const objectInstances = Array.isArray(items[objectName])
        ? items[objectName]
        : [];
      instances[objectName] = objectInstances.map(instance => ({
        name: typeof instance.name === 'string' ? instance.name : objectName,
        x: typeof instance.x === 'number' ? instance.x : null,
        y: typeof instance.y === 'number' ? instance.y : null,
        zOrder: typeof instance.zOrder === 'number' ? instance.zOrder : null,
      }));
    }
    scenes.push({
      name: typeof scene._name === 'string' ? scene._name : '(unnamed scene)',
      instances,
      variables: scene._variables || {},
    });
  }

  return {
    scenes,
    globalVariables: dump._variables || {},
  };
};

/**
 * Create the BYOK preview session. `getPreviewLauncher` and `getProject`
 * are injected (in the app they resolve the launcher MainFrame registered
 * for gameplay tests, and the live project); tests inject fakes.
 */
export const createByokPreviewSession = (options: {|
  getPreviewLauncher: () => ?ByokPreviewLauncher,
  getProject: () => any,
|}): ByokPreviewSession => {
  let isRunning = false;
  let unregisterCallbacks: ?() => void = null;
  let closePreview: ?() => void = null;
  let logBuffer: Array<ByokPreviewLogEntry> = [];
  let newErrors: Array<string> = [];
  let crash: ?ByokPreviewCrash = null;

  const handleParsedMessage = (parsedMessage: any): void => {
    if (!parsedMessage || typeof parsedMessage !== 'object') return;
    const command = parsedMessage.command;
    const payload = parsedMessage.payload;

    if (command === 'console.log' && payload && typeof payload === 'object') {
      const log = {
        group: typeof payload.group === 'string' ? payload.group : '',
        message: typeof payload.message === 'string' ? payload.message : '',
      };
      if (isUnavoidableLibraryWarning(log)) return;
      const entry: ByokPreviewLogEntry = {
        level:
          typeof payload.type === 'string' && payload.type
            ? payload.type
            : 'log',
        text: log.message,
        tick: typeof payload.timestamp === 'number' ? payload.timestamp : 0,
      };
      logBuffer.push(entry);
      if (entry.level === 'error') newErrors.push(entry.text);
      if (logBuffer.length > BYOK_PREVIEW_LOG_BUFFER_SIZE) {
        logBuffer = logBuffer.slice(-BYOK_PREVIEW_LOG_BUFFER_SIZE);
      }
      return;
    }

    if (command === 'game.crashed') {
      crash = {
        text:
          payload && typeof payload.error === 'string'
            ? payload.error
            : JSON.stringify(payload || {}),
        tick: Date.now(),
      };
      newErrors.push(crash.text);
    }
  };

  return {
    start: async ({ sceneName }) => {
      if (isRunning) {
        return {
          success: false,
          message:
            'A preview started by this chat is already running — stop_preview it first.',
        };
      }
      const previewLauncher = options.getPreviewLauncher();
      if (!previewLauncher) {
        return {
          success: false,
          message:
            'No preview launcher is available (the editor did not register one).',
        };
      }
      const debuggerServer = previewLauncher.getPreviewDebuggerServer();
      if (
        !debuggerServer ||
        typeof debuggerServer.registerCallbacks !== 'function'
      ) {
        return {
          success: false,
          message: 'The preview debugger server is not available.',
        };
      }

      const project = options.getProject();
      logBuffer = [];
      newErrors = [];
      crash = null;
      // Subscribe before launching, so no early log or crash is missed.
      unregisterCallbacks = debuggerServer.registerCallbacks({
        onHandleParsedMessage: ({ parsedMessage }) =>
          handleParsedMessage(parsedMessage),
      });
      try {
        await previewLauncher.launchPreview({
          project,
          sceneName: sceneName || project.getFirstLayout(),
          externalLayoutName: null,
          networkPreview: false,
          hotReload: false,
          shouldReloadProjectData: true,
          shouldReloadLibraries: true,
          shouldGenerateScenesCode: true,
          numberOfWindows: 1,
          fullLoadingScreen: false,
        });
      } catch (error) {
        if (unregisterCallbacks) unregisterCallbacks();
        unregisterCallbacks = null;
        return {
          success: false,
          message: `The preview could not be started: ${
            error instanceof Error ? error.message : String(error)
          }`,
        };
      }
      closePreview = previewLauncher.closePreview || null;
      isRunning = true;
      return {
        success: true,
        message: sceneName
          ? `Preview started on scene "${sceneName}".`
          : 'Preview started on the first scene.',
      };
    },

    stop: () => {
      if (!isRunning) {
        return { success: false, message: 'No preview is running.' };
      }
      if (closePreview) {
        try {
          closePreview();
        } catch (error) {
          // Closing is best-effort: the window may already be gone.
        }
      }
      if (unregisterCallbacks) unregisterCallbacks();
      unregisterCallbacks = null;
      isRunning = false;
      return { success: true, message: 'Preview stopped.' };
    },

    getLogs: ({ sinceIndex, level }) => {
      const fromIndex =
        typeof sinceIndex === 'number' && sinceIndex >= 0 ? sinceIndex : 0;
      return logBuffer
        .slice(fromIndex)
        .filter(entry => !level || entry.level === level);
    },

    getNewErrors: () => {
      const errors = newErrors.slice();
      newErrors = [];
      return errors;
    },

    inspectState: async () => {
      const previewLauncher = options.getPreviewLauncher();
      const debuggerServer = previewLauncher
        ? previewLauncher.getPreviewDebuggerServer()
        : null;
      if (!isRunning || !debuggerServer) {
        return {
          success: false,
          message: 'No preview is running — start_preview first.',
        };
      }
      if (
        typeof debuggerServer.sendMessageWithResponse !== 'function' ||
        crash
      ) {
        return {
          success: false,
          message: crash
            ? `The game crashed: ${crash.text}`
            : 'The debugger of this preview does not answer.',
        };
      }
      try {
        const response = await debuggerServer.sendMessageWithResponse({
          command: 'refresh',
        });
        return {
          success: true,
          state: reduceByokRuntimeDump(
            response && response.payload ? response.payload : null
          ),
        };
      } catch (error) {
        return {
          success: false,
          message: `The runtime state could not be read: ${
            error instanceof Error ? error.message : String(error)
          }`,
        };
      }
    },

    isRunning: () => isRunning,
    hasCrashed: () => !!crash,
  };
};

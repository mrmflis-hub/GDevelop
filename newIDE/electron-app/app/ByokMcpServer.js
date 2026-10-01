const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { BrowserWindow } = require('electron');

// BYOK MCP server (desktop side): exposes the IDE tool registry to external
// MCP clients (Claude Code, ZCode). The renderer owns the tools — it answers
// tool calls over the `byok-mcp-request` / `byok-mcp-response` IPC pair,
// while this module owns the loopback HTTP endpoint they talk to.
//
// Wiring:
//   MCP client stdio
//     -> stdio adapter (newIDE/app/scripts/gdevelop-mcp-stdio.js)
//     -> POST http://127.0.0.1:<port>/mcp (Bearer token)
//     -> this module
//     -> `byok-mcp-request` to one ready renderer (focused window first)
//     -> `byok-mcp-response` back
//     -> HTTP response.
//
// IPC channels registered here:
//   byok-mcp-set-enabled   (renderer -> main, invoke) start/stop the endpoint
//   byok-mcp-status        (renderer -> main, invoke) current state
//   byok-mcp-host-status   (renderer -> main) announce the tool host readiness
//   byok-mcp-request       (main -> renderer) a forwarded JSON-RPC message
//   byok-mcp-response      (renderer -> main) the JSON-RPC response object
//
// The adapter finds the endpoint through the discovery file
// (`gdevelop-mcp-endpoint.json` in userData: port, token, pid). The endpoint
// is loopback-only, requires the Bearer token and a matching Host header
// (DNS-rebinding guard), and never sets CORS headers: only the local adapter
// is meant to reach it, no web page must be able to.
//
// Like the sibling BYOK modules, every handler answers with a value (never
// an exception) so a broken state cannot take the main process down.

const DISCOVERY_FILE_NAME = 'gdevelop-mcp-endpoint.json';
const MCP_PROTOCOL_VERSION = '2026-07-28';
const MAX_BODY_BYTES = 1024 * 1024;
// The renderer's own tool timeout is 120 s, so the tool's error usually
// wins the race against this forward timeout.
const FORWARD_TIMEOUT_MS = 150000;
const PARSE_ERROR_CODE = -32700;
const INVALID_REQUEST_CODE = -32600;
const FORWARD_TIMEOUT_CODE = -32000;
const NO_TOOL_HOST_CODE = -32001;
const HOST_UNAVAILABLE_MESSAGE =
  'No GDevelop tool host is available — open the Ask AI panel in the project window, then retry.';
const TOOL_TIMEOUT_MESSAGE = 'The tool call timed out in the GDevelop editor.';
const FOREIGN_OWNER_MESSAGE =
  'Another running GDevelop instance owns the GDevelop MCP endpoint. Close it (or its MCP server) and try again.';

// HTTP endpoint state: null while the endpoint is disabled.
let serverState = null;
// Renderers that announced a ready tool host. Kept apart from serverState
// on purpose: readiness outlives an enable/disable cycle, as the Ask AI
// panel does not re-announce when the endpoint is toggled.
const readySenders = new Set();
// Monotonic across server cycles (audit011026 B-MCP-8): a counter reset
// per cycle let a late renderer response from the previous cycle answer
// the new cycle's same-numbered request.
let forwardCounter = 0;
// Senders that already carry the destroyed hook (audit011026 B-MCP-7).
const sendersWithDestroyedHook = new WeakSet();

const getDiscoveryFilePath = app =>
  path.join(app.getPath('userData'), DISCOVERY_FILE_NAME);

const buildErrorBody = (id, code, message) => ({
  jsonrpc: '2.0',
  id: id === undefined ? null : id,
  error: { code, message },
});

const respondJson = (res, statusCode, body) => {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
};

const respondEmpty = (res, statusCode) => {
  res.statusCode = statusCode;
  res.end();
};

const isAuthorizedRequest = (req, state) => {
  if (req.headers.host !== `127.0.0.1:${state.port}`) return false;
  // Timing-safe compare (audit011026 B-MCP-5): a plain !== leaks length
  // and early-exit timing of the token.
  const header =
    typeof req.headers.authorization === 'string'
      ? req.headers.authorization
      : '';
  const expected = `Bearer ${state.token}`;
  const headerBuffer = Buffer.from(header, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  if (headerBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(headerBuffer, expectedBuffer);
};

const pruneDestroyedSenders = () => {
  for (const sender of readySenders) {
    if (sender.isDestroyed()) readySenders.delete(sender);
  }
};

/**
 * A ready renderer to forward to: a focused window wins, otherwise the one
 * that became ready last (a Set keeps insertion order).
 */
const pickReadySender = () => {
  pruneDestroyedSenders();
  if (readySenders.size === 0) return null;
  for (const sender of readySenders) {
    const window = BrowserWindow.fromWebContents(sender);
    if (window && window.isFocused()) return sender;
  }
  const senders = Array.from(readySenders);
  return senders[senders.length - 1];
};

const respondForwardTimeout = (state, internalId) => {
  const pending = state.pending.get(internalId);
  if (!pending) return;
  state.pending.delete(internalId);
  respondJson(
    pending.res,
    200,
    buildErrorBody(
      pending.jsonRpcId,
      FORWARD_TIMEOUT_CODE,
      TOOL_TIMEOUT_MESSAGE
    )
  );
};

const forwardToRenderer = (state, parsedMessage, rawMessage, res) => {
  const sender = pickReadySender();
  if (!sender) {
    respondJson(
      res,
      200,
      buildErrorBody(
        parsedMessage.id,
        NO_TOOL_HOST_CODE,
        HOST_UNAVAILABLE_MESSAGE
      )
    );
    return;
  }
  forwardCounter += 1;
  const internalId = forwardCounter;
  const timer = setTimeout(() => {
    respondForwardTimeout(state, internalId);
  }, FORWARD_TIMEOUT_MS);
  state.pending.set(internalId, {
    res,
    timer,
    jsonRpcId: parsedMessage.id,
  });
  sender.send('byok-mcp-request', { requestId: internalId, rawMessage });
};

const handlePostMessage = (state, rawBody, res) => {
  let parsedMessage = null;
  try {
    parsedMessage = JSON.parse(rawBody);
  } catch (error) {
    respondJson(
      res,
      400,
      buildErrorBody(null, PARSE_ERROR_CODE, 'Parse error.')
    );
    return;
  }
  if (
    !parsedMessage ||
    typeof parsedMessage !== 'object' ||
    Array.isArray(parsedMessage)
  ) {
    respondJson(
      res,
      400,
      buildErrorBody(null, INVALID_REQUEST_CODE, 'Invalid Request.')
    );
    return;
  }
  if (parsedMessage.id === null || parsedMessage.id === undefined) {
    // A notification: no response is expected. The side-effecting ones
    // still reach the renderer — `notifications/cancelled` is the client's
    // cancellation of an in-flight call, and the protocol core implements
    // a real handler for it; swallowing it here left tool calls running
    // and the serialized queue blocked (audit011026 B-MCP-1). Fire and
    // forget: requestId -1 can never collide with the monotonic forward
    // ids, and the renderer never responds to a notification anyway.
    const sender = pickReadySender();
    if (sender) {
      sender.send('byok-mcp-request', { requestId: -1, rawMessage });
    }
    respondEmpty(res, 202);
    return;
  }
  forwardToRenderer(state, parsedMessage, rawBody, res);
};

const readBodyWithCap = (req, res, onBodyRead) => {
  const chunks = [];
  let totalBytes = 0;
  let rejected = false;
  req.on('data', chunk => {
    if (rejected) return;
    totalBytes += chunk.length;
    if (totalBytes > MAX_BODY_BYTES) {
      rejected = true;
      // The 413 must actually reach the client: destroying the request
      // synchronously right after res.end() almost always cut the response
      // before it left the socket, and the adapter reported the endpoint
      // as unreachable instead of "too large" (audit011026 B-MCP-10).
      res.statusCode = 413;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Connection', 'close');
      res.end(
        JSON.stringify(
          buildErrorBody(
            null,
            INVALID_REQUEST_CODE,
            'The request body exceeds the 1 MB cap.'
          )
        )
      );
      req.removeAllListeners('data');
      req.on('data', () => {
        // Drain the rest of the oversized body; the connection closes with
        // the response above.
      });
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (rejected) return;
    onBodyRead(Buffer.concat(chunks).toString('utf8'));
  });
  req.on('error', () => {
    // The client went away mid-body: there is nothing left to answer.
  });
};

const handleHttpRequest = (req, res) => {
  const state = serverState;
  if (!state) {
    // A keep-alive connection from before the endpoint was disabled. The
    // same 403 as a wrong token (audit011026 B-MCP-5): an unauthenticated
    // local process must not learn whether the endpoint is enabled.
    respondEmpty(res, 403);
    return;
  }
  if (!isAuthorizedRequest(req, state)) {
    respondEmpty(res, 403);
    return;
  }
  if (req.method === 'POST' && req.url === '/mcp') {
    readBodyWithCap(req, res, rawBody =>
      handlePostMessage(state, rawBody, res)
    );
    return;
  }
  if (req.method === 'GET' && req.url === '/health') {
    respondJson(res, 200, {
      ok: true,
      pid: process.pid,
      port: state.port,
      protocolVersion: MCP_PROTOCOL_VERSION,
    });
    return;
  }
  if (req.url === '/mcp') {
    // Deliberately no SSE stream: the adapter proxies one-shot POSTs only.
    respondEmpty(res, 405);
    return;
  }
  respondEmpty(res, 404);
};

const listenOnLoopback = server =>
  new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

/**
 * Verify that the discovery file's endpoint really answers as this app's
 * MCP server (with its token). Windows aggressively reuses pids: after a
 * crash, the file's dead pid can belong to an unrelated long-lived
 * process, which must not block the endpoint forever (audit011026
 * B-MCP-4).
 */
const isDiscoveryEndpointAlive = (port, token) =>
  new Promise(resolve => {
    const request = http.get(
      `http://127.0.0.1:${port}/health`,
      { headers: { Authorization: `Bearer ${token}` } },
      response => {
        response.resume();
        resolve(response.statusCode === 200);
      }
    );
    request.on('error', () => resolve(false));
    request.setTimeout(2000, () => {
      request.destroy();
      resolve(false);
    });
  });

/**
 * The pid of another, still-running GDevelop that owns the endpoint, or
 * null when there is no discovery file, it is unreadable, or its owner is
 * gone (a stale file this instance may take over).
 */
const findForeignOwnerPid = async discoveryFilePath => {
  let discovery = null;
  try {
    discovery = JSON.parse(fs.readFileSync(discoveryFilePath, 'utf8'));
  } catch (error) {
    return null;
  }
  const pid = discovery ? discovery.pid : null;
  if (typeof pid !== 'number' || pid === process.pid) return null;
  try {
    process.kill(pid, 0); // Signal 0: a liveness probe, nothing is sent.
  } catch (error) {
    return null;
  }
  const port = discovery ? discovery.port : null;
  const token = discovery ? discovery.token : null;
  if (typeof port !== 'number' || typeof token !== 'string') return null;
  const endpointAlive = await isDiscoveryEndpointAlive(port, token);
  if (!endpointAlive) {
    // The pid is alive but the endpoint is not ours/an endpoint: pid
    // reuse — the file is stale, this instance takes over.
    return null;
  }
  return pid;
};

const startServer = async (app, discoveryFilePath) => {
  const token = crypto.randomBytes(32).toString('hex');
  const server = http.createServer(handleHttpRequest);
  try {
    await listenOnLoopback(server);
  } catch (error) {
    return { ok: false, error: String(error) };
  }
  const port = server.address().port;
  const discovery = {
    port,
    token,
    pid: process.pid,
    protocolVersion: MCP_PROTOCOL_VERSION,
    startedAt: new Date().toISOString(),
  };
  try {
    // 0600 (audit011026 B-MCP-6): the file carries the bearer token — on
    // multi-user POSIX hosts the default mode made it readable by every
    // local user.
    fs.writeFileSync(discoveryFilePath, JSON.stringify(discovery, null, 2), {
      mode: 0o600,
    });
    fs.chmodSync(discoveryFilePath, 0o600);
  } catch (error) {
    server.close();
    return { ok: false, error: String(error) };
  }
  server.on('error', error => {
    console.error('GDevelop MCP server error:', error);
    ensureStopped(app);
  });
  serverState = {
    server,
    port,
    token,
    pending: new Map(),
  };
  return { ok: true, port };
};

const ensureStopped = app => {
  if (!serverState) return { ok: true, running: false, port: null };
  const state = serverState;
  serverState = null;
  for (const pending of state.pending.values()) {
    clearTimeout(pending.timer);
    respondJson(
      pending.res,
      200,
      buildErrorBody(
        pending.jsonRpcId,
        NO_TOOL_HOST_CODE,
        HOST_UNAVAILABLE_MESSAGE
      )
    );
  }
  state.pending.clear();
  state.server.close();
  try {
    fs.unlinkSync(getDiscoveryFilePath(app));
  } catch (error) {
    // Best effort: a missing or locked file must not block the shutdown.
  }
  return { ok: true, running: false, port: null };
};

const ensureStarted = async app => {
  if (serverState) return { ok: true, running: true, port: serverState.port };
  const discoveryFilePath = getDiscoveryFilePath(app);
  const foreignOwnerPid = await findForeignOwnerPid(discoveryFilePath);
  if (foreignOwnerPid !== null) {
    return { ok: false, error: FOREIGN_OWNER_MESSAGE };
  }
  const startResult = await startServer(app, discoveryFilePath);
  if (!startResult.ok) return startResult;
  return { ok: true, running: true, port: startResult.port };
};

const registerByokMcpServer = (ipcMain, app) => {
  ipcMain.handle('byok-mcp-set-enabled', async (event, payload) => {
    const enabled = Boolean(payload && payload.enabled);
    if (enabled) return ensureStarted(app);
    return ensureStopped(app);
  });
  ipcMain.handle('byok-mcp-status', () => ({
    ok: true,
    running: Boolean(serverState),
    port: serverState ? serverState.port : null,
    protocolVersion: MCP_PROTOCOL_VERSION,
    discoveryPath: getDiscoveryFilePath(app),
  }));
  ipcMain.on('byok-mcp-host-status', (event, payload) => {
    const sender = event.sender;
    const isReady = Boolean(payload && payload.ready);
    if (!isReady) {
      readySenders.delete(sender);
      return;
    }
    if (sender.isDestroyed()) return;
    readySenders.add(sender);
    // The destroyed hook is attached ONCE per sender (audit011026
    // B-MCP-7): the announcement fires on every Ask AI panel toggle, and
    // piling 'destroyed' listeners past 11 triggered MaxListeners warnings.
    if (!sendersWithDestroyedHook.has(sender)) {
      sendersWithDestroyedHook.add(sender);
      sender.once('destroyed', () => {
        readySenders.delete(sender);
      });
    }
  });
  ipcMain.on('byok-mcp-response', (event, payload) => {
    const state = serverState;
    if (!state) return;
    if (!payload || typeof payload.requestId !== 'number') return;
    const pending = state.pending.get(payload.requestId);
    if (!pending) return; // Unknown id, or the timeout already answered.
    state.pending.delete(payload.requestId);
    clearTimeout(pending.timer);
    respondJson(pending.res, 200, payload.response);
  });
  app.on('before-quit', () => {
    ensureStopped(app);
  });
};

module.exports = { registerByokMcpServer };

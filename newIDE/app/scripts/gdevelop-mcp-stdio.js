const fs = require('fs');
const os = require('os');
const readline = require('readline');
const core = require('../src/AiGeneration/Byok/Mcp/ByokMcpStdioAdapterCore');

// Stdio adapter for the GDevelop MCP endpoint: the piece an MCP client
// (Claude Code, ZCode) spawns. It speaks newline-delimited JSON-RPC 2.0 on
// stdin/stdout and proxies every message, VERBATIM, to the loopback HTTP
// endpoint owned by the GDevelop main process (electron-app/app/
// ByokMcpServer.js):
//
//   MCP client stdio -> this script -> POST http://127.0.0.1:<port>/mcp
//                                    -> GDevelop renderer tool host
//
// The endpoint address comes from the --url/--port/--token flags or, for
// whatever the flags leave out, from the discovery file GDevelop writes
// while its MCP server is enabled (gdevelop-mcp-endpoint.json in the
// per-user app data folder). Flags always win over the discovery file.
//
// All the decidable logic lives in ByokMcpStdioAdapterCore.js (shared with
// its unit tests); this script only performs side effects: reading the
// discovery file, POSTing, and the stdin/stdout pump.
//
// stdout purity: protocol messages ONLY. Every diagnostic — usage, warnings,
// connection failures — goes to stderr.

const FETCH_TIMEOUT_MS = 180000;
const RETRY_DELAY_MS = 1000;

// The endpoint currently in use ({ url, token }), re-read from disk after
// a failure (GDevelop restarts rotate the token).
let cachedEndpoint = null;

const writeOut = text => {
  process.stdout.write(`${text}\n`);
};

const writeErr = text => {
  process.stderr.write(`${text}\n`);
};

const printUsage = () => {
  writeOut(
    [
      'Usage: node gdevelop-mcp-stdio.js [options]',
      '',
      'Bridges an MCP client (stdin/stdout, newline-delimited JSON-RPC 2.0)',
      'to the GDevelop IDE MCP endpoint over loopback HTTP.',
      '',
      'Options:',
      '  --url <url>     Full endpoint URL, e.g. http://127.0.0.1:54321/mcp',
      '  --port <n>      Shorthand for http://127.0.0.1:<n>/mcp',
      '  --token <hex>   Bearer token of the GDevelop MCP endpoint',
      '  --file <path>   Discovery file to read (overrides the default location)',
      '  -h, --help      Show this help and exit',
      '',
      'Whatever the flags do not provide is read from the discovery file that',
      'GDevelop writes while its MCP server is enabled. Flags always win',
      'over the discovery file.',
      '',
      'stdout carries protocol messages only; diagnostics go to stderr.',
      '',
    ].join('\n')
  );
};

const readDiscoveryFileText = filePath => {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    return null;
  }
};

/**
 * The endpoint to use: flags first, the discovery file for whatever they
 * leave out. With forceReload the discovery file is read again (the flags
 * are kept) — used after a failure, as a restart rotates the token.
 */
const resolveEndpoint = (cliArgs, forceReload) => {
  if (cachedEndpoint && !forceReload) return cachedEndpoint;
  const resolved = core.resolveEndpoint(cliArgs, () =>
    readDiscoveryFileText(
      cliArgs.file ||
        core.resolveDefaultDiscoveryPath(process.platform, os.homedir())
    )
  );
  if (resolved) cachedEndpoint = resolved;
  return resolved;
};

/**
 * POST one raw JSON-RPC line. Answers { ok: true, body } for any HTTP
 * response worth relaying (the JSON-RPC errors travel in the body), and
 * { ok: false } for a transport failure or a rejected token.
 */
const postJsonRpcLine = async (endpoint, rawLine) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${endpoint.token}`,
      },
      body: rawLine,
      signal: controller.signal,
    });
    if (response.status === 401 || response.status === 403) {
      return { ok: false };
    }
    const body = await response.text();
    return { ok: true, body };
  } catch (error) {
    return { ok: false };
  } finally {
    clearTimeout(timeout);
  }
};

const wait = milliseconds =>
  new Promise(resolve => {
    setTimeout(resolve, milliseconds);
  });

const respondEndpointUnavailable = parsedMessage => {
  // Notifications carry no id and get no response: stay silent.
  if (
    !parsedMessage ||
    parsedMessage.id === null ||
    parsedMessage.id === undefined
  ) {
    return;
  }
  writeOut(
    core.buildErrorResponseText(
      parsedMessage.id,
      core.ENDPOINT_ERROR_CODE,
      core.ENDPOINT_ERROR_MESSAGE
    )
  );
};

const handleMessageLine = async (cliArgs, rawLine) => {
  const line = rawLine.trim();
  if (!line) return;
  let parsedMessage = null;
  try {
    parsedMessage = JSON.parse(line);
  } catch (error) {
    writeOut(
      core.buildErrorResponseText(null, core.PARSE_ERROR_CODE, 'Parse error.')
    );
    return;
  }
  let endpoint = resolveEndpoint(cliArgs, false);
  if (!endpoint) {
    // GDevelop may not be running yet: stay alive, a later call can succeed.
    respondEndpointUnavailable(parsedMessage);
    return;
  }
  let result = await postJsonRpcLine(endpoint, line);
  if (result.ok) {
    if (core.shouldRelayResponseBody(parsedMessage, result.body)) {
      writeOut(result.body);
    }
    return;
  }
  // The IDE may be starting up or restarting (rotated token): give it a
  // second, re-read the discovery file and retry exactly once.
  cachedEndpoint = null;
  await wait(RETRY_DELAY_MS);
  endpoint = resolveEndpoint(cliArgs, true);
  if (!endpoint) {
    respondEndpointUnavailable(parsedMessage);
    return;
  }
  result = await postJsonRpcLine(endpoint, line);
  if (!result.ok) {
    respondEndpointUnavailable(parsedMessage);
    return;
  }
  if (core.shouldRelayResponseBody(parsedMessage, result.body)) {
    writeOut(result.body);
  }
};

const main = () => {
  const cliArgs = core.parseCliArgs(process.argv.slice(2));
  if (cliArgs.help) {
    printUsage();
    return;
  }
  if (typeof fetch !== 'function') {
    writeErr(
      'gdevelop-mcp-stdio.js needs Node 18 or newer (it relies on the global fetch API).'
    );
    process.exitCode = 1;
    return;
  }
  const lineReader = readline.createInterface({
    input: process.stdin,
    terminal: false,
  });
  lineReader.on('line', rawLine => {
    handleMessageLine(cliArgs, rawLine).catch(error => {
      writeErr(`Unexpected failure while proxying a message: ${String(error)}`);
    });
  });
  lineReader.on('close', () => {
    process.exit(0);
  });
};

process.on('SIGINT', () => {
  process.exit(0);
});
process.on('SIGTERM', () => {
  process.exit(0);
});

main();

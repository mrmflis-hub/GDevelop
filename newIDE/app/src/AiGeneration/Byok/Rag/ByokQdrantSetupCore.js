/**
 * The Qdrant permanent-indexing setup core (Phase 13.8, D13-1): the pure
 * state machine behind the "Set up permanent indexing with Qdrant" button.
 * Plain-CJS on purpose (the ByokMcpStdioAdapterCore pattern): required by
 * the Electron main (electron-app/app/ByokQdrant.js) and by the Jest
 * suite — never by the Flow-checked renderer app. The lifecycle mirrors
 * the MCP server: spawn -> health check -> ready; the child is killed on
 * quit; loopback only (D13-9).
 */

const getByokQdrantPlatform = (processPlatform, processArch) => {
  if (processPlatform === 'win32' && processArch === 'x64') {
    return 'windows-x64';
  }
  if (processPlatform === 'linux' && processArch === 'x64') {
    return 'linux-x64';
  }
  if (processPlatform === 'darwin' && processArch === 'x64') {
    return 'macos-x64';
  }
  return null;
};

/**
 * The official Qdrant release artifact of a platform (GitHub releases; the
 * QA machine already runs qdrant-x86_64-pc-windows-msvc, so the artifact
 * shape is known).
 */
const getByokQdrantReleaseInfo = platform => {
  switch (platform) {
    case 'windows-x64':
      return {
        artifactName: 'qdrant-x86_64-pc-windows-msvc.zip',
        archiveKind: 'zip',
      };
    case 'linux-x64':
      return {
        artifactName: 'qdrant-x86_64-unknown-linux-gnu.tar.gz',
        archiveKind: 'tar.gz',
      };
    case 'macos-x64':
      return {
        artifactName: 'qdrant-x86_64-apple-darwin.tar.gz',
        archiveKind: 'tar.gz',
      };
    default:
      return null;
  }
};

const BYOK_QDRANT_DOWNLOAD_URL_BASE =
  'https://github.com/qdrant/qdrant/releases/latest/download';

/** The loopback-only config file content of the managed instance. */
const buildByokQdrantConfigYaml = port =>
  [
    '# Managed by GDevelop (BYOK RAG) - loopback only, no external interface.',
    'service:',
    '  host: 127.0.0.1',
    `  http_port: ${port}`,
    'storage:',
    '  storage_path: qdrant-storage',
  ].join('\n');

const BYOK_QDRANT_ENDPOINT_FILE_NAME = 'gdevelop-qdrant-endpoint.json';

/** The standard paths of a managed install under a root folder. */
const makeByokQdrantPaths = (rootFolder, platform) => ({
  installFolder: rootFolder,
  binaryPath: `${rootFolder}/${
    platform === 'windows-x64' ? 'qdrant.exe' : 'qdrant'
  }`,
  configPath: `${rootFolder}/gdevelop-qdrant.yaml`,
  archivePath: `${rootFolder}/qdrant-release-archive`,
  endpointFilePath: `${rootFolder}/${BYOK_QDRANT_ENDPOINT_FILE_NAME}`,
});

const readByokQdrantEndpoint = async (deps, endpointFilePath) => {
  try {
    const content = await deps.readTextFile(endpointFilePath);
    if (!content) return null;
    const parsed = JSON.parse(content);
    if (typeof parsed.port !== 'number') return null;
    return {
      port: parsed.port,
      pid: typeof parsed.pid === 'number' ? parsed.pid : 0,
      startedAt: String(parsed.startedAt || ''),
    };
  } catch (error) {
    return null;
  }
};

/** Poll the health endpoint for up to ~15 s (the binary boots fast). */
const waitForByokQdrantHealth = async (
  deps,
  baseUrl,
  timeoutMs = 15000,
  pollIntervalMs = 500
) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    // eslint-disable-next-line no-await-in-loop
    if (await deps.isHealthy(baseUrl)) return true;
    // eslint-disable-next-line no-await-in-loop
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }
  return false;
};

/**
 * Run the whole setup, idempotently:
 * 1. a healthy existing instance (any port we know of, or the default) is
 *    used as-is ("use existing instance" - no download at all);
 * 2. an already-installed binary is only (re)configured and started;
 * 3. otherwise the release is downloaded (the consent UI ran before this)
 *    and extracted, then configured and started.
 * Every step can fail cleanly: the outcome names the stage, the caller
 * falls back to the in-process index with the error message.
 */
const runByokQdrantSetup = async options => {
  const paths = options.paths;
  const deps = options.deps;
  const report = options.onStage || (() => {});
  const healthCheckTimeoutMs = options.healthCheckTimeoutMs || 15000;

  // 1. An already-healthy instance wins: never install over one.
  report('checking-existing');
  const endpoint = await readByokQdrantEndpoint(deps, paths.endpointFilePath);
  const existingUrls = [
    endpoint ? `http://127.0.0.1:${endpoint.port}` : null,
    options.defaultBaseUrl,
  ].filter(Boolean);
  for (const baseUrl of existingUrls) {
    // eslint-disable-next-line no-await-in-loop
    if (await deps.isHealthy(baseUrl)) {
      return { ok: true, mode: 'used-existing', baseUrl };
    }
  }

  // 2. Download + extract when the binary is missing (consent ran first).
  if (!deps.binaryExists(paths.binaryPath)) {
    const release = getByokQdrantReleaseInfo(options.platform);
    if (!release) {
      return {
        ok: false,
        stage: 'downloading',
        error: `No Qdrant release is known for platform "${options.platform}".`,
      };
    }
    try {
      report('downloading');
      await deps.downloadArchive(
        `${BYOK_QDRANT_DOWNLOAD_URL_BASE}/${release.artifactName}`,
        paths.archivePath
      );
      report('extracting');
      await deps.extractArchive(
        paths.archivePath,
        paths.installFolder,
        release.archiveKind
      );
      await deps.deleteFile(paths.archivePath);
    } catch (error) {
      return {
        ok: false,
        stage: 'downloading',
        error: `The Qdrant download or extraction failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
    if (!deps.binaryExists(paths.binaryPath)) {
      return {
        ok: false,
        stage: 'extracting',
        error:
          'The downloaded archive did not contain the expected Qdrant binary.',
      };
    }
  }

  // 3. Configure, start, health-check.
  try {
    report('configuring');
    const port = await deps.getAvailablePort();
    await deps.writeTextFile(paths.configPath, buildByokQdrantConfigYaml(port));
    report('starting');
    const pid = await deps.spawnQdrant(paths.binaryPath, paths.configPath);
    await deps.writeTextFile(
      paths.endpointFilePath,
      JSON.stringify({
        port,
        pid,
        startedAt: new Date().toISOString(),
      })
    );
    report('health-check');
    const baseUrl = `http://127.0.0.1:${port}`;
    const isUp = await waitForByokQdrantHealth(
      deps,
      baseUrl,
      healthCheckTimeoutMs
    );
    if (!isUp) {
      return {
        ok: false,
        stage: 'health-check',
        error: 'Qdrant started but did not answer its health check in time.',
      };
    }
    report('ready');
    return { ok: true, mode: 'installed', baseUrl, port };
  } catch (error) {
    return {
      ok: false,
      stage: 'starting',
      error: `Qdrant could not be started: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
};

module.exports = {
  BYOK_QDRANT_DOWNLOAD_URL_BASE,
  BYOK_QDRANT_ENDPOINT_FILE_NAME,
  buildByokQdrantConfigYaml,
  getByokQdrantPlatform,
  getByokQdrantReleaseInfo,
  makeByokQdrantPaths,
  runByokQdrantSetup,
  waitForByokQdrantHealth,
};

// @flow
/* eslint-disable no-restricted-globals */
const {
  BYOK_QDRANT_ENDPOINT_FILE_NAME,
  buildByokQdrantConfigYaml,
  getByokQdrantPlatform,
  getByokQdrantReleaseInfo,
  makeByokQdrantPaths,
  runByokQdrantSetup,
  waitForByokQdrantHealth,
} = require('./Rag/ByokQdrantSetupCore');

const makeDeps = (overrides: Object = {}) => ({
  isHealthy: async () => false,
  downloadArchive: jest.fn(async () => {}),
  extractArchive: jest.fn(async () => {}),
  binaryExists: jest.fn(() => false),
  writeTextFile: jest.fn(async () => {}),
  readTextFile: jest.fn(async () => null),
  spawnQdrant: jest.fn(async () => 4242),
  getAvailablePort: jest.fn(async () => 7333),
  deleteFile: jest.fn(async () => {}),
  ...overrides,
});

const makePaths = () =>
  makeByokQdrantPaths('C:/Users/Test/AppData/GDevelop 5/qdrant');

describe('getByokQdrantPlatform / getByokQdrantReleaseInfo', () => {
  it('maps the known platforms to their release artifacts', () => {
    expect(getByokQdrantPlatform('win32', 'x64')).toBe('windows-x64');
    expect(getByokQdrantPlatform('linux', 'x64')).toBe('linux-x64');
    expect(getByokQdrantPlatform('darwin', 'x64')).toBe('macos-x64');
    expect(getByokQdrantPlatform('win32', 'arm64')).toBe(null);

    expect(getByokQdrantReleaseInfo('windows-x64').artifactName).toBe(
      'qdrant-x86_64-pc-windows-msvc.zip'
    );
    expect(getByokQdrantReleaseInfo('linux-x64').archiveKind).toBe('tar.gz');
    expect(getByokQdrantReleaseInfo('unknown')).toBe(null);
  });
});

describe('buildByokQdrantConfigYaml', () => {
  it('binds Qdrant to loopback on the given port', () => {
    const config = buildByokQdrantConfigYaml(7333);
    expect(config).toContain('host: 127.0.0.1');
    expect(config).toContain('http_port: 7333');
    expect(config).not.toContain('0.0.0.0');
  });
});

describe('runByokQdrantSetup', () => {
  it('uses a healthy existing instance instead of installing', async () => {
    const deps = makeDeps({ isHealthy: async () => true });
    const outcome = await runByokQdrantSetup({
      platform: 'windows-x64',
      paths: makePaths(),
      deps,
      defaultBaseUrl: 'http://127.0.0.1:6333',
    });
    expect(outcome).toEqual({
      ok: true,
      mode: 'used-existing',
      baseUrl: 'http://127.0.0.1:6333',
    });
    expect(deps.downloadArchive).not.toHaveBeenCalled();
  });

  it('honors the discovery file port before the default URL', async () => {
    const deps = makeDeps({
      readTextFile: async () =>
        JSON.stringify({ port: 7100, pid: 1, startedAt: 'x' }),
      isHealthy: async baseUrl => baseUrl === 'http://127.0.0.1:7100',
    });
    const outcome = await runByokQdrantSetup({
      platform: 'windows-x64',
      paths: makePaths(),
      deps,
      defaultBaseUrl: 'http://127.0.0.1:6333',
    });
    expect(outcome.mode).toBe('used-existing');
    expect(outcome.baseUrl).toBe('http://127.0.0.1:7100');
  });

  it('downloads, extracts, configures, spawns and health-checks a fresh install', async () => {
    const stages: Array<string> = [];
    let healthyAfterStart = false;
    let binaryPresent = false;
    const deps = makeDeps({
      isHealthy: async () => healthyAfterStart,
      binaryExists: () => binaryPresent,
      extractArchive: jest.fn(async () => {
        binaryPresent = true;
      }),
      spawnQdrant: jest.fn(async () => {
        healthyAfterStart = true;
        return 99;
      }),
    });
    const paths = makePaths();
    const outcome = await runByokQdrantSetup({
      platform: 'windows-x64',
      paths,
      deps,
      defaultBaseUrl: 'http://127.0.0.1:6333',
      onStage: stage => stages.push(stage),
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.mode).toBe('installed');
      expect(outcome.port).toBe(7333);
      expect(outcome.baseUrl).toBe('http://127.0.0.1:7333');
    }
    expect(deps.downloadArchive).toHaveBeenCalledWith(
      expect.stringContaining('qdrant-x86_64-pc-windows-msvc.zip'),
      paths.archivePath
    );
    expect(deps.extractArchive).toHaveBeenCalledWith(
      paths.archivePath,
      paths.installFolder,
      'zip'
    );
    expect(deps.deleteFile).toHaveBeenCalledWith(paths.archivePath);
    expect(deps.spawnQdrant).toHaveBeenCalledWith(
      paths.binaryPath,
      paths.configPath
    );
    expect(deps.writeTextFile).toHaveBeenCalledWith(
      paths.endpointFilePath,
      expect.stringContaining('"port":7333')
    );
    expect(stages[0]).toBe('checking-existing');
    expect(stages[stages.length - 1]).toBe('ready');
  });

  it('skips the download when the binary is already installed (idempotency)', async () => {
    let healthyAfterStart = false;
    const deps = makeDeps({
      binaryExists: () => true,
      isHealthy: async () => healthyAfterStart,
      spawnQdrant: jest.fn(async () => {
        healthyAfterStart = true;
        return 7;
      }),
    });
    const outcome = await runByokQdrantSetup({
      platform: 'windows-x64',
      paths: makePaths(),
      deps,
      defaultBaseUrl: 'http://127.0.0.1:6333',
    });
    expect(outcome.ok).toBe(true);
    expect(deps.downloadArchive).not.toHaveBeenCalled();
    expect(deps.extractArchive).not.toHaveBeenCalled();
  });

  it('fails cleanly on a download error (the fallback path)', async () => {
    const deps = makeDeps({
      downloadArchive: jest.fn(async () => {
        throw new Error('offline');
      }),
    });
    const outcome = await runByokQdrantSetup({
      platform: 'windows-x64',
      paths: makePaths(),
      deps,
      defaultBaseUrl: 'http://127.0.0.1:6333',
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.stage).toBe('downloading');
      expect(outcome.error).toContain('offline');
    }
  });

  it('fails cleanly when the health check never passes', async () => {
    const deps = makeDeps({
      isHealthy: async () => false,
      binaryExists: () => true,
    });
    const outcome = await runByokQdrantSetup({
      platform: 'windows-x64',
      paths: makePaths(),
      deps,
      defaultBaseUrl: 'http://127.0.0.1:6333',
      healthCheckTimeoutMs: 50,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.stage).toBe('health-check');
  });
});

describe('waitForByokQdrantHealth', () => {
  it('stops polling once healthy and respects the timeout', async () => {
    const deps = makeDeps();
    expect(await waitForByokQdrantHealth(deps, 'http://x', 10, 1)).toBe(false);
    let calls = 0;
    const turningHealthy = makeDeps({
      isHealthy: async () => {
        calls += 1;
        return calls >= 2;
      },
    });
    expect(
      await waitForByokQdrantHealth(turningHealthy, 'http://x', 1000, 1)
    ).toBe(true);
    expect(calls).toBe(2);
  });
});

describe('makeByokQdrantPaths', () => {
  it('builds the standard install paths', () => {
    const paths = makeByokQdrantPaths('C:/root/qdrant', 'windows-x64');
    expect(paths.binaryPath).toContain('qdrant.exe');
    expect(paths.configPath).toContain('gdevelop-qdrant.yaml');
    expect(paths.endpointFilePath).toContain(BYOK_QDRANT_ENDPOINT_FILE_NAME);
  });
});

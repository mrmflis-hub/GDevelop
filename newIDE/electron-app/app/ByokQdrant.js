const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const net = require('net');
const childProcess = require('child_process');
const core = require('../../app/src/AiGeneration/Byok/Rag/ByokQdrantSetupCore');

// The managed Qdrant instance (Phase 13.8, D13-1): the "Set up permanent
// indexing with Qdrant" button installs the official binary under
// `<userData>/qdrant/` and this module starts it with every app launch
// (loopback only), health-checks it, and kills it on quit — the same
// lifecycle pattern as the MCP server. The pure setup state machine lives
// renderer-side (ByokQdrantSetupCore, Jest-tested); this wrapper only
// provides the real file/process/network operations. RAG never hard-depends
// on Qdrant: a failing setup falls back to the in-process index with the
// error message.

const BYOK_QDRANT_FOLDER = 'qdrant';
const DEFAULT_QDRANT_BASE_URL = 'http://127.0.0.1:6333';

let qdrantChild = null;
let lastKnownBaseUrl = null;

const getQdrantFolder = userDataPath =>
  path.join(userDataPath, BYOK_QDRANT_FOLDER);

const isHealthy = baseUrl =>
  new Promise(resolve => {
    const request = http.get(`${baseUrl}/healthz`, response => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.on('error', () => resolve(false));
    request.setTimeout(3000, () => {
      request.destroy();
      resolve(false);
    });
  });

const downloadArchive = (url, destinationPath) =>
  new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destinationPath);
    https
      .get(url, response => {
        if (
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          // GitHub release downloads redirect.
          downloadArchive(response.headers.location, destinationPath).then(
            resolve,
            reject
          );
          return;
        }
        if (response.statusCode !== 200) {
          file.close();
          fs.unlinkSync(destinationPath);
          reject(new Error(`Download failed: HTTP ${response.statusCode}`));
          return;
        }
        response.pipe(file);
        file.on('finish', () => {
          file.close(() => resolve());
        });
        file.on('error', reject);
      })
      .on('error', error => {
        file.close();
        reject(error);
      });
  });

// Windows 10+ ships bsdtar (handles zip); macOS bsdtar handles zip too;
// Linux GNU tar handles the .tar.gz release directly.
const extractArchive = (archivePath, destinationFolder, kind) =>
  new Promise((resolve, reject) => {
    const command =
      kind === 'zip'
        ? `tar -xf "${archivePath}" -C "${destinationFolder}"`
        : `tar -xzf "${archivePath}" -C "${destinationFolder}"`;
    childProcess.exec(
      command,
      { cwd: destinationFolder },
      (error, stdout, stderr) => {
        if (error) reject(new Error(`${command} failed: ${stderr || error}`));
        else resolve();
      }
    );
  });

const getAvailablePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });

const makeSetupDeps = () => ({
  isHealthy,
  downloadArchive,
  extractArchive,
  binaryExists: binaryPath => {
    try {
      return fs.existsSync(binaryPath);
    } catch (error) {
      return false;
    }
  },
  writeTextFile: async (filePath, content) => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
  },
  readTextFile: async filePath => {
    try {
      return fs.readFileSync(filePath, 'utf8');
    } catch (error) {
      return null;
    }
  },
  spawnQdrant: async (binaryPath, configPath) => {
    fs.mkdirSync(path.dirname(binaryPath), { recursive: true });
    const child = childProcess.spawn(
      binaryPath,
      [`--config-path`, configPath],
      {
        cwd: path.dirname(configPath),
        stdio: 'ignore',
        windowsHide: true,
      }
    );
    child.on('error', () => {});
    qdrantChild = child;
    return child.pid;
  },
  getAvailablePort,
  deleteFile: async filePath => {
    try {
      fs.unlinkSync(filePath);
    } catch (error) {
      // Best-effort cleanup.
    }
  },
});

const runSetup = async app => {
  const userDataPath = app.getPath('userData');
  const platform = core.getByokQdrantPlatform(process.platform, process.arch);
  if (!platform) {
    return {
      ok: false,
      stage: 'downloading',
      error: `Qdrant is not available for this platform (${process.platform}/${
        process.arch
      }).`,
    };
  }
  const paths = core.makeByokQdrantPaths(
    getQdrantFolder(userDataPath),
    core.getByokQdrantPlatform(process.platform, process.arch)
  );
  fs.mkdirSync(paths.installFolder, { recursive: true });
  return core.runByokQdrantSetup({
    platform,
    paths,
    deps: makeSetupDeps(),
    defaultBaseUrl: DEFAULT_QDRANT_BASE_URL,
  });
};

/**
 * Start the managed Qdrant with the app when it is already installed (the
 * permanent-indexing lifecycle): spawn + health-check only — never a
 * download, never an error into the app when absent (RAG quietly falls
 * back to the in-process index).
 */
const ensureStarted = async app => {
  try {
    const userDataPath = app.getPath('userData');
    const platform = core.getByokQdrantPlatform(process.platform, process.arch);
    if (!platform) return;
    const paths = core.makeByokQdrantPaths(
      getQdrantFolder(userDataPath),
      platform
    );
    if (!require('fs').existsSync(paths.binaryPath)) return;
    // Already healthy (e.g. a previous instance or a manual install)?
    const outcome = await core.runByokQdrantSetup({
      platform,
      paths,
      deps: makeSetupDeps(),
      defaultBaseUrl: DEFAULT_QDRANT_BASE_URL,
    });
    if (outcome.ok) lastKnownBaseUrl = outcome.baseUrl;
  } catch (error) {
    // Autostart is best-effort: the RAG tab's setup button reports errors.
  }
};

const registerByokQdrant = (ipcMain, app) => {
  ipcMain.handle('byok-qdrant-setup', async () => {
    const outcome = await runSetup(app);
    if (outcome.ok) lastKnownBaseUrl = outcome.baseUrl;
    return outcome;
  });
  ipcMain.handle('byok-qdrant-status', async () => {
    if (lastKnownBaseUrl) {
      return {
        installed: true,
        healthy: await isHealthy(lastKnownBaseUrl),
        baseUrl: lastKnownBaseUrl,
      };
    }
    const userDataPath = app.getPath('userData');
    const paths = core.makeByokQdrantPaths(
      getQdrantFolder(userDataPath),
      core.getByokQdrantPlatform(process.platform, process.arch)
    );
    const installed = await Promise.resolve(
      require('fs').existsSync(paths.binaryPath)
    );
    return {
      installed,
      healthy: false,
      baseUrl: null,
    };
  });
  // Stop the managed child on quit (the app-start autostart is a status
  // check + spawn by this same module when the RAG tab enables it).
  app.on('before-quit', () => {
    if (qdrantChild) {
      try {
        qdrantChild.kill();
      } catch (error) {
        // Already gone.
      }
      qdrantChild = null;
    }
  });
};

module.exports = {
  BYOK_QDRANT_FOLDER,
  DEFAULT_QDRANT_BASE_URL,
  ensureStarted,
  registerByokQdrant,
};

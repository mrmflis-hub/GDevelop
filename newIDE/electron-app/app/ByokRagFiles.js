const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

// BYOK RAG index files (Phase 13.7/13.8): the desktop side of the RAG
// storage. The in-process index lives as one JSON file (base64 vectors) in
// `<userData>/byok-rag/`. Same discipline as ByokChatFiles: this module
// only moves bytes, every handler answers with a value (never throws).
//
// Phase 14.4 (D14-3/D14-7(a)) adds the prebuilt-bundle channels: the
// release listing and the verified download. The bundle is the app's own
// index JSON plus a manifest; the sha256 is verified HERE (node crypto)
// before the renderer ever sees the payload — the renderer re-validates
// the envelope shape and the corpus compatibility in its own tested code
// (ByokRagBundle.js). URLs come from the renderer's tested constants; the
// downloads are opt-in (a consent dialog ran first).

const BYOK_RAG_FOLDER = 'byok-rag';

/** Download-bundle payloads are JSON indexes — cap them far above real. */
const BYOK_RAG_BUNDLE_MAX_BYTES = 200 * 1024 * 1024;

const getByokRagFolder = userDataPath =>
  path.join(userDataPath, BYOK_RAG_FOLDER);

const isSafeRagFileName = fileName => {
  const backslash = String.fromCharCode(92);
  if (typeof fileName !== 'string' || !fileName) return false;
  if (fileName.startsWith('.')) return false;
  if (fileName.includes('/') || fileName.includes(backslash)) return false;
  if (fileName.includes('..')) return false;
  if (fileName !== fileName.trim()) return false;
  return true;
};

const writeByokRagFile = (userDataPath, fileName, content) => {
  try {
    if (!isSafeRagFileName(fileName)) {
      return { ok: false, error: 'Invalid RAG file name.' };
    }
    const ragFolder = getByokRagFolder(userDataPath);
    fs.mkdirSync(ragFolder, { recursive: true });
    fs.writeFileSync(path.join(ragFolder, fileName), content, 'utf8');
    return { ok: true, data: null };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
};

const readByokRagFile = (userDataPath, fileName) => {
  try {
    if (!isSafeRagFileName(fileName)) {
      return { ok: false, error: 'Invalid RAG file name.' };
    }
    const filePath = path.join(getByokRagFolder(userDataPath), fileName);
    if (!fs.existsSync(filePath)) return { ok: true, data: null };
    return { ok: true, data: fs.readFileSync(filePath, 'utf8') };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
};

const deleteByokRagFile = (userDataPath, fileName) => {
  try {
    if (!isSafeRagFileName(fileName)) {
      return { ok: false, error: 'Invalid RAG file name.' };
    }
    const filePath = path.join(getByokRagFolder(userDataPath), fileName);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return { ok: true, data: null };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
};

const fetchTextWithRedirects = (url, maxBytes, userAgent) =>
  new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': userAgent } }, response => {
        if (
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          // GitHub API and release-asset URLs redirect.
          fetchTextWithRedirects(
            response.headers.location,
            maxBytes,
            userAgent
          ).then(resolve, reject);
          return;
        }
        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`HTTP ${response.statusCode} for ${url}`));
          return;
        }
        const chunks = [];
        let received = 0;
        response.on('data', chunk => {
          received += chunk.length;
          if (received > maxBytes) {
            response.destroy();
            reject(new Error('The download exceeded the size cap.'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () =>
          resolve(Buffer.concat(chunks).toString('utf8'))
        );
        response.on('error', reject);
      })
      .on('error', reject);
  });

/** The newest GitHub releases (the renderer distills the bundle one). */
const fetchByokRagBundleReleases = async apiUrl => {
  const text = await fetchTextWithRedirects(
    apiUrl,
    5 * 1024 * 1024,
    'GDevelop-BYOK-RAG'
  );
  return JSON.parse(text);
};

/**
 * Download a bundle asset and verify its integrity hash: the sha256 of
 * the canonical JSON of `bundle.index` (the exact re-stringification the
 * builder hashed — JSON.parse preserves key order).
 */
const downloadVerifiedByokRagBundle = async downloadUrl => {
  const text = await fetchTextWithRedirects(
    downloadUrl,
    BYOK_RAG_BUNDLE_MAX_BYTES,
    'GDevelop-BYOK-RAG'
  );
  const parsed = JSON.parse(text);
  if (
    !parsed ||
    !parsed.integrity ||
    typeof parsed.integrity.indexSha256 !== 'string' ||
    !parsed.index
  ) {
    throw new Error('The downloaded file is not a RAG bundle.');
  }
  const actualHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(parsed.index), 'utf8')
    .digest('hex');
  if (actualHash !== parsed.integrity.indexSha256) {
    throw new Error(
      'The bundle integrity check failed (sha256 mismatch) — the download was corrupted or tampered with.'
    );
  }
  return parsed;
};

const registerByokRagFileHandlers = (ipcMain, app) => {
  ipcMain.handle('byok-rag-write', (event, fileName, content) =>
    writeByokRagFile(app.getPath('userData'), fileName, content)
  );
  ipcMain.handle('byok-rag-read', (event, fileName) =>
    readByokRagFile(app.getPath('userData'), fileName)
  );
  ipcMain.handle('byok-rag-delete', (event, fileName) =>
    deleteByokRagFile(app.getPath('userData'), fileName)
  );
  ipcMain.handle('byok-rag-bundle-info', async (event, apiUrl) => {
    try {
      return { ok: true, releases: await fetchByokRagBundleReleases(apiUrl) };
    } catch (error) {
      return {
        ok: false,
        error: `The prebuilt-index release listing is unreachable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  });
  ipcMain.handle('byok-rag-bundle-download', async (event, downloadUrl) => {
    try {
      return {
        ok: true,
        bundle: await downloadVerifiedByokRagBundle(downloadUrl),
      };
    } catch (error) {
      return {
        ok: false,
        error: `The prebuilt index download failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  });
};

module.exports = {
  BYOK_RAG_FOLDER,
  registerByokRagFileHandlers,
  isSafeRagFileName,
};

const fs = require('fs');
const path = require('path');

// BYOK RAG index files (Phase 13.7/13.8): the desktop side of the RAG
// storage. The in-process index lives as one JSON file (base64 vectors) in
// `<userData>/byok-rag/`. Same discipline as ByokChatFiles: this module
// only moves bytes, every handler answers with a value (never throws).

const BYOK_RAG_FOLDER = 'byok-rag';

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
};

module.exports = {
  BYOK_RAG_FOLDER,
  registerByokRagFileHandlers,
  isSafeRagFileName,
};

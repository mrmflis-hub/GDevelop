// @flow
import optionalRequire from '../../Utils/OptionalRequire';

// The API key is stored in localStorage, but never in plaintext:
// - On the desktop app, it is encrypted by the operating system through the
//   main process (Electron safeStorage — DPAPI on Windows), which is the only
//   side able to decrypt it. Stored as `{ version: 3, value }`.
// - On the web build, it is only obfuscated: base64(xor(key, pepper)). This is
//   **obfuscation, not encryption** — a determined reader of localStorage
//   (with this file open in front of them) can recover the key. It only makes
//   casual reading of the storage impossible. Stored as `{ version: 2, value }`.
// The interface below is final: the storage internals changed in Phase 3
// without the UI or the interface ever changing.
const BYOK_KEY_STORAGE_ITEM = 'gd-byok-key';

// Renderer-safe Electron access: null on the web build (see Utils/Window.js
// and PreferencesProvider.js for the pattern).
const electron = optionalRequire('electron');
const ipcRenderer = electron ? electron.ipcRenderer : null;

// The result shape returned by the main-process safeStorage handlers
// (see electron-app/app/ByokSafeStorage.js): errors travel as values,
// never as IPC exceptions.
type ByokSafeStorageResult =
  | {| ok: true, data: string |}
  | {| ok: false, error: string |};

// Arbitrary constant bytes, fixed forever: values obfuscated by an older
// build of the app must stay readable by newer builds.
const PEPPER_BYTES: Array<number> = [
  0x37,
  0xd4,
  0x9a,
  0x51,
  0xc8,
  0x0f,
  0xe3,
  0x66,
  0xb2,
  0x19,
  0x7c,
  0xa5,
  0x40,
  0x8b,
  0xf1,
  0x2e,
];

/**
 * Turn a text into its list of UTF-8 bytes, without needing TextEncoder
 * (encodeURIComponent escapes every character outside the unreserved set as
 * UTF-8 percent-escapes, which we can read out).
 */
const textToUtf8Bytes = (text: string): Array<number> => {
  const escaped = encodeURIComponent(text);
  const bytes: Array<number> = [];
  for (let index = 0; index < escaped.length; index++) {
    const character = escaped[index];
    if (character !== '%') {
      bytes.push(escaped.charCodeAt(index));
      continue;
    }

    bytes.push(parseInt(escaped.substr(index + 1, 2), 16));
    index += 2;
  }
  return bytes;
};

/**
 * The inverse of `textToUtf8Bytes`. Returns null when the bytes are not
 * valid UTF-8.
 */
const utf8BytesToText = (bytes: Array<number>): ?string => {
  let escaped = '';
  for (const byte of bytes) {
    // `%` is itself an escape character for decodeURIComponent: a literal
    // 0x25 byte must be escaped as `%25`, or any key containing `%` is
    // silently corrupted (or rejected as an invalid escape) on read.
    if (byte === 0x25) {
      escaped += '%25';
      continue;
    }
    if (byte < 0x80) {
      escaped += String.fromCharCode(byte);
      continue;
    }
    escaped += `%${byte.toString(16)}`;
  }

  try {
    return decodeURIComponent(escaped);
  } catch (error) {
    return null;
  }
};

/**
 * Obfuscate a key: xor its UTF-8 bytes with the pepper, then encode in
 * base64 so everything stored in localStorage stays printable. Deterministic
 * on purpose (same input → same output), exported for tests.
 */
export const obfuscate = (text: string): string => {
  const bytes = textToUtf8Bytes(text);
  let binary = '';
  for (let index = 0; index < bytes.length; index++) {
    const byte = bytes[index] ^ PEPPER_BYTES[index % PEPPER_BYTES.length];
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
};

/**
 * The inverse of `obfuscate`. Returns null when the value was corrupted
 * (not valid base64, or not valid UTF-8 once de-xored). Exported for tests.
 */
export const deobfuscate = (obfuscated: string): ?string => {
  let binary;
  try {
    binary = atob(obfuscated);
  } catch (error) {
    return null;
  }

  const bytes: Array<number> = [];
  for (let index = 0; index < binary.length; index++) {
    bytes.push(
      binary.charCodeAt(index) ^ PEPPER_BYTES[index % PEPPER_BYTES.length]
    );
  }
  return utf8BytesToText(bytes);
};

/**
 * Encrypt a key for storage: on desktop, by the operating system through the
 * main process (version 3); on the web build, with the Phase 2 obfuscation
 * (version 2). Returns null when the desktop encryption fails.
 */
const encryptSecret = async (
  plainText: string
): Promise<?{| version: number, value: string |}> => {
  if (!ipcRenderer) {
    return { version: 2, value: obfuscate(plainText) };
  }

  try {
    const result: ByokSafeStorageResult = await ipcRenderer.invoke(
      'byok-encrypt',
      plainText
    );
    if (result && result.ok) {
      return { version: 3, value: result.data };
    }
    console.error('Unable to encrypt the BYOK API key:', result);
  } catch (error) {
    console.error('Unable to encrypt the BYOK API key:', error);
  }
  return null;
};

/**
 * Decrypt a stored key payload according to the version that produced it.
 * Returns null when the value cannot be recovered (the caller then reports
 * "no key stored"). Version 1 (Phase 1 plaintext) is handled by the caller,
 * which migrates it on read. The payload comes from localStorage: it is
 * untrusted, so every field is narrowed before use.
 */
const decryptSecret = async (payload: mixed): Promise<?string> => {
  if (!payload || typeof payload !== 'object') return null;
  const record: Object = payload;
  // Version 3: OS-encrypted ciphertext, only the main process can decrypt.
  if (record.version === 3 && typeof record.value === 'string') {
    if (!ipcRenderer) return null;
    try {
      const result: ByokSafeStorageResult = await ipcRenderer.invoke(
        'byok-decrypt',
        record.value
      );
      if (result && result.ok) {
        return result.data;
      }
      console.error('Unable to decrypt the BYOK API key:', result);
      return null;
    } catch (error) {
      console.error('Unable to decrypt the BYOK API key:', error);
      return null;
    }
  }

  // Version 2: the web-build obfuscation, undone renderer-side.
  if (record.version === 2 && typeof record.value === 'string') {
    return deobfuscate(record.value);
  }

  return null;
};

/**
 * All writes (and the migrations triggered by reads) go through this chain,
 * so they apply in the order they were started — a migration that read an
 * old value cannot land after a newer user save and resurrect the old key.
 */
let storageWriteChain: Promise<void> = Promise.resolve();

const enqueueStorageWrite = <T>(write: () => Promise<T>): Promise<T> => {
  const chained = storageWriteChain.then(write);
  storageWriteChain = chained.then(() => {}, () => {});
  return chained;
};

/**
 * Save the BYOK API key (encrypted on desktop, obfuscated on web). An empty
 * key clears the entry rather than storing an empty string. Resolves to false
 * when nothing could be written (storage unavailable, quota exceeded), so
 * callers can tell the user instead of silently losing the key.
 */
const performSaveByokKey = async (key: string): Promise<boolean> => {
  if (!key) {
    return await performClearByokKey();
  }

  try {
    const secret = await encryptSecret(key);
    if (!secret) {
      // Desktop: the OS encryption failed (already logged). Keep the key in
      // the obfuscated form rather than losing it — the settings tab's
      // status row keeps telling the user which storage is in use.
      localStorage.setItem(
        BYOK_KEY_STORAGE_ITEM,
        JSON.stringify({ version: 2, value: obfuscate(key) })
      );
      return true;
    }

    localStorage.setItem(BYOK_KEY_STORAGE_ITEM, JSON.stringify(secret));
    return true;
  } catch (error) {
    console.error('Unable to store the BYOK API key:', error);
    return false;
  }
};

export const saveByokKey = (key: string): Promise<boolean> =>
  enqueueStorageWrite(() => performSaveByokKey(key));

/** The raw stored entry, or null when the storage cannot be read. */
const getStoredSerializedKey = (): ?string => {
  try {
    return localStorage.getItem(BYOK_KEY_STORAGE_ITEM);
  } catch (error) {
    console.error('Unable to read the BYOK API key storage:', error);
    return null;
  }
};

/**
 * Load the BYOK API key, or null when no key is stored. A corrupted value is
 * reported as "no key stored", never thrown to the caller. Older formats are
 * migrated on read, so they disappear as soon as the key is read once.
 */
export const loadByokKey = async (): Promise<?string> => {
  try {
    const serializedKey = localStorage.getItem(BYOK_KEY_STORAGE_ITEM);
    if (!serializedKey) return null;

    const parsedKey = JSON.parse(serializedKey);
    if (!parsedKey || typeof parsedKey !== 'object') return null;

    // Version 1 (Phase 1): the key was stored in plaintext under `key`.
    // Migrate it to the current format right away, replacing the plaintext —
    // but only if the entry has not been replaced by a newer save while the
    // (async) read was in flight, or the migration would resurrect the old
    // key over the new one.
    if (typeof parsedKey.key === 'string' && parsedKey.key) {
      await enqueueStorageWrite(async () => {
        if (getStoredSerializedKey() !== serializedKey) return;
        await performSaveByokKey(parsedKey.key);
      });
      return parsedKey.key;
    }

    const key = await decryptSecret(parsedKey);
    if (!key) return null;

    // A version 2 (obfuscated) entry read on the desktop app is re-saved as
    // version 3, so the OS encryption replaces the weaker form; on the web
    // build this branch is never taken. Same concurrency guard as above.
    if (parsedKey.version === 2 && ipcRenderer) {
      await enqueueStorageWrite(async () => {
        if (getStoredSerializedKey() !== serializedKey) return;
        await performSaveByokKey(key);
      });
    }

    return key;
  } catch (error) {
    console.error('Unable to read the BYOK API key:', error);
    return null;
  }
};

/**
 * Remove the stored BYOK API key, if any. Resolves to false when the entry
 * could not be removed.
 */
const performClearByokKey = async (): Promise<boolean> => {
  try {
    localStorage.removeItem(BYOK_KEY_STORAGE_ITEM);
    return true;
  } catch (error) {
    console.error('Unable to remove the BYOK API key:', error);
    return false;
  }
};

export const clearByokKey = (): Promise<boolean> =>
  enqueueStorageWrite(performClearByokKey);

/**
 * True when the key can be stored encrypted by the platform: the desktop app
 * delegates to the main process (Electron safeStorage); the web build has no
 * such facility and keeps returning false.
 */
export const isByokKeyEncryptionAvailable = async (): Promise<boolean> => {
  if (!ipcRenderer) return false;

  try {
    return await ipcRenderer.invoke('byok-encryption-available');
  } catch (error) {
    console.error('Unable to check BYOK key encryption availability:', error);
    return false;
  }
};

/**
 * The status of the key storage, displayed in the BYOK settings tab. Reports
 * the format the key is *actually* stored in — not just what the platform
 * could do — so a desktop fallback to obfuscation (a failed encryption) is
 * shown for what it is.
 */
export const getByokKeyStorageInfo = async (): Promise<{|
  encrypted: boolean,
  obfuscated: boolean,
|}> => {
  let storedVersion = 0;
  const serializedKey = getStoredSerializedKey();
  if (serializedKey) {
    try {
      const parsedKey = JSON.parse(serializedKey);
      if (
        parsedKey &&
        typeof parsedKey === 'object' &&
        typeof parsedKey.version === 'number'
      ) {
        storedVersion = parsedKey.version;
      }
    } catch (error) {
      // A corrupted entry counts as "nothing readable stored".
    }
  }

  const canEncrypt = await isByokKeyEncryptionAvailable();
  const encrypted = canEncrypt && storedVersion === 3;
  return { encrypted, obfuscated: storedVersion > 0 && !encrypted };
};

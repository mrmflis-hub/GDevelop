// @flow

// The key is stored as base64(xor(key, pepper)). This is **obfuscation, not
// encryption**: a determined reader of localStorage (with this file open in
// front of them) can recover the key. It only makes casual reading of the
// storage impossible. Real encryption arrives on desktop in Phase 3, with
// Electron safeStorage.
// The interface below is final: Phase 3 swaps the internals of these
// functions without the UI or the interface ever changing again.
const BYOK_KEY_STORAGE_ITEM = 'gd-byok-key';

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
 * Save the BYOK API key (obfuscated). An empty key clears the entry rather
 * than storing an empty string.
 */
export const saveByokKey = async (key: string): Promise<void> => {
  if (!key) {
    await clearByokKey();
    return;
  }

  try {
    // Store as a versioned object so a future format change (e.g. the
    // Phase 3 desktop encryption) is a migration, not a break.
    localStorage.setItem(
      BYOK_KEY_STORAGE_ITEM,
      JSON.stringify({ version: 2, value: obfuscate(key) })
    );
  } catch (error) {
    console.error('Unable to store the BYOK API key:', error);
  }
};

/**
 * Load the BYOK API key, or null when no key is stored. A corrupted value is
 * reported as "no key stored", never thrown to the caller. An entry written
 * by Phase 1 (plaintext, version-less) is read and re-saved as v2, so the
 * plaintext copy disappears as soon as the key is read once.
 */
export const loadByokKey = async (): Promise<?string> => {
  try {
    const serializedKey = localStorage.getItem(BYOK_KEY_STORAGE_ITEM);
    if (!serializedKey) return null;

    const parsedKey = JSON.parse(serializedKey);
    if (!parsedKey || typeof parsedKey !== 'object') return null;

    if (parsedKey.version === 2 && typeof parsedKey.value === 'string') {
      return deobfuscate(parsedKey.value);
    }

    // Version 1 (Phase 1): the key was stored in plaintext under `key`.
    // Migrate it to v2 right away, replacing the plaintext entry.
    if (typeof parsedKey.key === 'string' && parsedKey.key) {
      await saveByokKey(parsedKey.key);
      return parsedKey.key;
    }

    return null;
  } catch (error) {
    console.error('Unable to read the BYOK API key:', error);
    return null;
  }
};

/**
 * Remove the stored BYOK API key, if any.
 */
export const clearByokKey = async (): Promise<void> => {
  try {
    localStorage.removeItem(BYOK_KEY_STORAGE_ITEM);
  } catch (error) {
    console.error('Unable to remove the BYOK API key:', error);
  }
};

/**
 * True when the key is stored encrypted by the platform. Still false while
 * the key is only obfuscated in localStorage; Phase 3 returns true on
 * desktop builds using Electron safeStorage.
 */
export const isByokKeyEncryptionAvailable = async (): Promise<boolean> => {
  return false;
};

/**
 * The status of the key storage, displayed in the BYOK settings tab. On the
 * web build (and until Phase 3), the key is stored obfuscated — not
 * encrypted.
 */
export const getByokKeyStorageInfo = async (): Promise<{|
  encrypted: boolean,
  obfuscated: boolean,
|}> => {
  const encrypted = await isByokKeyEncryptionAvailable();
  return { encrypted, obfuscated: !encrypted };
};

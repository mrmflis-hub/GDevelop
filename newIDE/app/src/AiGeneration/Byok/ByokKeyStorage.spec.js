/**
 * @jest-environment jsdom
 */
// @flow
import {
  saveByokKey,
  loadByokKey,
  clearByokKey,
  isByokKeyEncryptionAvailable,
  getByokKeyStorageInfo,
  obfuscate,
  deobfuscate,
} from './ByokKeyStorage';

const BYOK_KEY_STORAGE_ITEM = 'gd-byok-key';

describe('ByokKeyStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('saves then loads the same key', async () => {
    await saveByokKey('sk-test-1234567890');
    expect(await loadByokKey()).toBe('sk-test-1234567890');
  });

  it('loads and round-trips keys with non-ASCII characters', async () => {
    await saveByokKey('clé-privée-🔑');
    expect(await loadByokKey()).toBe('clé-privée-🔑');
  });

  it('stores the key obfuscated: the stored value is not the plaintext key', async () => {
    await saveByokKey('sk-test-1234567890');

    const storedValue = localStorage.getItem(BYOK_KEY_STORAGE_ITEM) || '';
    expect(storedValue).not.toContain('sk-test-1234567890');
    expect(JSON.parse(storedValue).version).toBe(2);
    expect(typeof JSON.parse(storedValue).value).toBe('string');
    expect(JSON.parse(storedValue).value).not.toContain('sk-test');
  });

  it('loads null when no key is stored', async () => {
    expect(await loadByokKey()).toBe(null);
  });

  it('clears the entry, then loads null', async () => {
    await saveByokKey('sk-test-1234567890');
    await clearByokKey();
    expect(localStorage.getItem(BYOK_KEY_STORAGE_ITEM)).toBe(null);
    expect(await loadByokKey()).toBe(null);
  });

  it('treats saving an empty string as clearing the entry', async () => {
    await saveByokKey('sk-test-1234567890');
    await saveByokKey('');
    expect(localStorage.getItem(BYOK_KEY_STORAGE_ITEM)).toBe(null);
    expect(await loadByokKey()).toBe(null);
  });

  it('reads a version 1 (plaintext) entry and migrates it to version 2', async () => {
    localStorage.setItem(
      BYOK_KEY_STORAGE_ITEM,
      JSON.stringify({ key: 'sk-old-plaintext-key' })
    );

    expect(await loadByokKey()).toBe('sk-old-plaintext-key');

    const storedValue = JSON.parse(
      localStorage.getItem(BYOK_KEY_STORAGE_ITEM) || 'null'
    );
    expect(storedValue.version).toBe(2);
    expect(JSON.stringify(storedValue)).not.toContain('sk-old-plaintext-key');
    expect(await loadByokKey()).toBe('sk-old-plaintext-key');
  });

  it('loads null instead of throwing on a corrupted (non-JSON) stored value', async () => {
    localStorage.setItem(BYOK_KEY_STORAGE_ITEM, '{not json at all');
    expect(await loadByokKey()).toBe(null);
  });

  it('loads null on a stored value that is not the expected object', async () => {
    localStorage.setItem(BYOK_KEY_STORAGE_ITEM, JSON.stringify('a string'));
    expect(await loadByokKey()).toBe(null);
  });

  it('loads null on a corrupted v2 value (invalid base64)', async () => {
    localStorage.setItem(
      BYOK_KEY_STORAGE_ITEM,
      JSON.stringify({ version: 2, value: 'not base64!!!' })
    );
    expect(await loadByokKey()).toBe(null);
  });

  it('loads null on a v2 entry without a value', async () => {
    localStorage.setItem(BYOK_KEY_STORAGE_ITEM, JSON.stringify({ version: 2 }));
    expect(await loadByokKey()).toBe(null);
  });

  it('reports encryption as not available in Phase 2 (obfuscated storage)', async () => {
    expect(await isByokKeyEncryptionAvailable()).toBe(false);
  });

  it('reports the storage info as obfuscated and not encrypted', async () => {
    expect(await getByokKeyStorageInfo()).toEqual({
      encrypted: false,
      obfuscated: true,
    });
  });
});

describe('obfuscate / deobfuscate', () => {
  it('round-trips a key', () => {
    expect(deobfuscate(obfuscate('sk-test-1234567890'))).toBe(
      'sk-test-1234567890'
    );
    expect(deobfuscate(obfuscate(''))).toBe('');
    expect(deobfuscate(obfuscate('clé-privée-🔑'))).toBe('clé-privée-🔑');
  });

  it('is deterministic: the same input gives the same output', () => {
    expect(obfuscate('sk-test-1234567890')).toBe(
      obfuscate('sk-test-1234567890')
    );
  });

  it('produces an output different from the input', () => {
    expect(obfuscate('sk-test-1234567890')).not.toBe('sk-test-1234567890');
  });

  it('returns null when deobfuscating a value that was never obfuscated', () => {
    expect(deobfuscate('sk-test-1234567890')).toBe(null);
  });
});

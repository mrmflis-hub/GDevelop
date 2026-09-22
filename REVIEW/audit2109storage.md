# Audit 2026-09-21 — agent: storage

## Files assigned

1. `newIDE\app\src\AiGeneration\Byok\ByokKeyStorage.js`
2. `newIDE\app\src\AiGeneration\Byok\ByokKeyStorage.spec.js`
3. `newIDE\app\src\AiGeneration\Byok\ByokUsageTracker.js`
4. `newIDE\app\src\AiGeneration\Byok\ByokUsageTracker.spec.js`
5. `newIDE\electron-app\app\ByokSafeStorage.js`
6. `newIDE\electron-app\app\main.js` (BYOK block only, lines 49–53 and 463–471)

## Issues found

### [B] Obfuscation round-trip silently corrupts or loses any key containing `%`

- Affected: `newIDE\app\src\AiGeneration\Byok\ByokKeyStorage.js`, `utf8BytesToText` (lines 74–89, specifically the `byte < 0x80` literal branch at lines 77–79 feeding `decodeURIComponent` at lines 84–87); consumed by `deobfuscate` (lines 110–125).
- Explanation: bytes below `0x80` are appended as literal characters to the string later passed to `decodeURIComponent`. The byte `0x25` (`%`) is below `0x80`, so any key containing `%` becomes percent-escape syntax. Verified by replicating the exact functions in node:
  - `"key%25"` round-trips to `"key%"` — a **different key**, silently.
  - `"abc%41def"` round-trips to `"abcAdef"` — silent corruption (`%41` decodes to `A`).
  - `"a%2zb"` (a `%` followed by a non-hex/mixed pair) throws `URIError` inside `decodeURIComponent`, is caught, and returns `null` → `loadByokKey` reports "no key stored".
  On the desktop build this is worsened by the v2→v3 migration (`ByokKeyStorage.js:243-245`): the silently corrupted value is re-saved encrypted, destroying the original key permanently. Trigger surface: the web build always stores v2 (`ByokKeyStorage.js:135-137`), and the desktop fallback path stores v2 whenever `byok-encrypt` fails (`ByokKeyStorage.js:199-209`). Keys containing `%` are uncommon (most providers issue base62-ish keys) but exist among generic OpenAI-compatible gateways — which is exactly what BYOK targets.
- Proposed solution: in `utf8BytesToText`, percent-escape byte `0x25` itself (`if (byte === 0x25) { escaped += '%25'; continue; }` before the `< 0x80` branch). Keep the deterministic obfuscation untouched; the change is decode-side only, and older stored values (produced without `%` in the key) decode identically.
- Tests to write (`ByokKeyStorage.spec.js`, in the `obfuscate / deobfuscate` describe and the web describe): round-trip `''`-adjacent edge cases `'a%b'`, `'%'`, `'%25'`, `'%41'`, `'trailing%'`, and a full save→load with a `%`-containing key asserting the exact same string comes back and is what gets sent to the endpoint. All of these fail today (wrong string or `null`).

### [B] Per-model and server-reported context windows never reach the context bar or the runaway guard

- Affected: consumer wiring of `newIDE\app\src\AiGeneration\Byok\ByokUsageTracker.js` `contextStatsFromUsage` (lines 36–48): its only production caller `ByokOrchestrator.js:259-263` passes `settings.contextWindowTokens` (the global fallback, line 261). `resolveContextWindowTokens` (`newIDE\app\src\AiGeneration\Byok\ByokModelsCache.js:133-156`, documented fallback chain: server-reported → per-model → global → default) has **zero production callers** (grep across `newIDE\app\src`: only `ByokModelsCache.spec.js`). The per-model rows the settings tab maintains (`ByokSettingsTab.js:219-247`) and the server-reported windows therefore have no effect anywhere outside the tab display.
- Explanation: `aiRequest.contextStats.usedPercentage` drives both the chat UI's context bar and the loop's runaway-protection stop (`ByokOrchestrator.js:436-439`, `MAX_BYOK_CONTEXT_RATIO = 0.9` at line 52). With the global default of 8192 (`ByokTypes.js:42`), a user chatting with a 128k-context model hits the 0.9 guard at ~7.4k tokens and the loop stops early — visibly wrong behavior for any model whose real window differs from the global fallback. Phase2.md:282-285 specified the resolve chain precisely so it could be used; the wiring was never done.
- Proposed solution: in `ByokOrchestrator.js` `recordAssistantTurn`, replace `settings.contextWindowTokens` with `resolveContextWindowTokens(settings, modelInfo, settings.modelName)`, where `modelInfo` comes from `getCachedByokModels(settings.endpointUrl)` looked up once at orchestrator creation (it is an in-memory cache, `ByokModelsCache.js:107-109`).
- Tests to write (`ByokOrchestrator.spec.js`): a chat using a model with a per-model context window of e.g. 100 tokens gets `contextStats.usedPercentage` computed against 100 (currently computed against the global 8192 → fails); same for a server-reported window via a seeded models cache; existing global-fallback behavior kept when no per-model value exists.

### [C] Storage-status row can claim OS-encryption while the stored key is only obfuscated

- Affected: `newIDE\app\src\AiGeneration\Byok\ByokKeyStorage.js` — silent v2 downgrade in `saveByokKey` (lines 199-209) and capability-only reporting in `getByokKeyStorageInfo` (lines 285-291, which just forwards `isByokKeyEncryptionAvailable`, lines 270-279); rendered by `ByokSettingsTab.js:118-131` + `getKeyStorageStatusText` (lines 50-69).
- Explanation: when `byok-encrypt` fails on desktop (transient DPAPI/safeStorage failure while `isEncryptionAvailable()` still returns `true`), the key is silently stored as obfuscated v2 with only a `console.error` (lines 147, 199-208), but the status row keeps showing "Your API key is encrypted by your operating system…" (`ByokSettingsTab.js:56-61`) because it reflects platform capability, not the actually stored format. Phase 3's stated goal is "Honest UI" (`REVIEW\Phase3.md:19-21`). The v2→v3 migration on next read (lines 243-245) self-heals only if encryption then succeeds; if DPAPI is persistently broken, the misrepresentation persists.
- Proposed solution: make `getByokKeyStorageInfo` read the stored entry's `version` (it already parses the payload in `loadByokKey`-style guarded code): report `encrypted: availability && storedVersion === 3`, `obfuscated: hasStoredEntry && !encrypted`. Keep it a pure read.
- Tests to write (`ByokKeyStorage.spec.js`, desktop describe): save with a failing `byok-encrypt` mock, then `getByokKeyStorageInfo()` must return `{ encrypted: false, obfuscated: true }` even though `byok-encryption-available` answers `true` (currently returns `{ encrypted: true, obfuscated: false }` → fails).

### [D] `saveByokKey` swallows every failure, so callers report success for a key that was never persisted

- Affected: `newIDE\app\src\AiGeneration\Byok\ByokKeyStorage.js` `saveByokKey` (lines 192-215): all paths end in `console.error` + normal return; the function resolves `void` whether or not anything was written. Consumer `ByokSettingsTab.js:298-300` then runs `setHasStoredKey(!!apiKey)` unconditionally.
- Explanation: on a localStorage quota error (line 212-214) or a storage-disabled browser, the write fails silently; the settings tab immediately shows the key as stored (status row appears), and the key is gone on next launch. Styleguide 5.4 (`styleguide.md:124-127`) wants errors surfaced at the UI boundary; the current interface cannot express failure.
- Proposed solution: have `saveByokKey` return `Promise<boolean>` (true when an entry was written or cleared) and let the tab show an inline error when false. Signature-compatible with existing `await` call sites.
- Tests to write: mock `localStorage.setItem` to throw; assert `saveByokKey` resolves `false` (currently `undefined`/success-shaped) and that the entry was not written.

### [D] Migration writes can race a concurrent user save and resurrect an older key

- Affected: `newIDE\app\src\AiGeneration\Byok\ByokKeyStorage.js` `loadByokKey` — v1 migration at lines 232-235 and v2→v3 re-save at lines 243-245, both writing after `await` gaps; concurrent writer `ByokSettingsTab.js:298-300` (onBlur save).
- Explanation: a `loadByokKey` that read an old value can complete its migration `saveByokKey(oldKey)` after the user's newer `saveByokKey(newKey)` finished, overwriting the new key with the old one. All the loads in the app (`ByokSettingsTab.js:121-122`, `AskAiEditorContainer.js:637`, plus `onFetchModels`/`onTestConnection` at `ByokSettingsTab.js:150,177`) make the window real, though narrow (the v2 path only exists right after a web→desktop transition or an encryption-failure fallback). Concurrent `loadByokKey` calls also each trigger their own migration write.
- Proposed solution: guard the migration write — re-read the item immediately before writing and skip if it changed since the initial read; or serialize all module operations through a promise chain.
- Tests to write: interleaving test — start `loadByokKey()` on a v2 entry, run `saveByokKey('new')` before resolving the mocked decrypt invoke, then assert the stored value decrypts to `'new'` (currently ends as the old key → fails).

### [D] `any` parameter in `decryptSecret` violates the no-`any` rule for untrusted data

- Affected: `newIDE\app\src\AiGeneration\Byok\ByokKeyStorage.js:160` — `const decryptSecret = async (payload: any): Promise<?string>`. Same untyped access at lines 227-232 (`JSON.parse` result used as `parsedKey.key`, `parsedKey.version`).
- Explanation: styleguide 5.1 (`styleguide.md:87-88`) bans `any` in new code, and this is exactly the boundary where it matters: the value comes from localStorage (untrusted). The sibling module shows the sanctioned pattern — `getByokSettings` narrows a `mixed` value field-by-field (`ByokTypes.js:191-220`). With `any`, Flow checks nothing here (e.g. `payload.version === '3'` typos would pass).
- Proposed solution: type the parameter as `mixed` and narrow (`typeof payload.version === 'number'`, etc.), or define a small parsed-shape type and validate into it.
- Tests to write: existing corruption tests already cover behavior; add a stored `{ version: 3, value: 42 }` (non-string value) case asserting `loadByokKey` returns null — already handled at runtime by the `typeof` checks, this pins the narrowing.

### [D] `main.js:465` exceeds Prettier's print width — electron-app's own `check-format` would flag it

- Affected: `newIDE\electron-app\app\main.js:465` — `ipcMain.handle('byok-encryption-available', () => isByokEncryptionAvailable());` measures 81 characters; `.prettierrc` (`newIDE\electron-app\.prettierrc`) does not override `printWidth`, so the default 80 applies, and `newIDE\electron-app\package.json` defines its own `check-format` script.
- Explanation: the AGENTS-mandated four checks run from `newIDE\app` and do not cover `electron-app`, so this slips through the usual gate, but anyone running `npm run check-format` in `newIDE\electron-app` gets a diff on `main.js`. The neighboring handlers (lines 466-471) are already wrapped correctly.
- Proposed solution: wrap like the encrypt handler: `ipcMain.handle('byok-encryption-available', () =>\n    isByokEncryptionAvailable()\n  );`
- Tests to write: none (formatting; covered by `check-format` once run from `newIDE\electron-app`).

### [D] Missing tests: IPC rejection paths, `%` keys, and v3-on-web

- Affected: `newIDE\app\src\AiGeneration\Byok\ByokKeyStorage.spec.js`.
- Explanation: uncovered branches in `ByokKeyStorage.js`:
  - `ipcRenderer.invoke('byok-encrypt')` **rejecting** (catch at lines 148-151) — should fall back to v2 without throwing;
  - `invoke('byok-decrypt')` rejecting (catch at lines 174-177) — should resolve `null`;
  - `invoke('byok-encryption-available')` rejecting (catch at lines 275-278) — should resolve `false`;
  - a `{ version: 3 }` entry on the web build (no `ipcRenderer`) — early `return null` at line 163;
  - round-trips of `%`-containing keys (see the first B finding).
- Proposed solution: add the five cases above; each is a few lines against the existing `mockIpcRendererInvoke`.
- Tests to write: as listed — each fails today only where behavior is genuinely absent-wrong (`%` cases); the rejection cases pass but pin currently-untested catch paths.

### [D] Spec state `fakeDecryptedKey` is never reset between tests

- Affected: `newIDE\app\src\AiGeneration\Byok\ByokKeyStorage.spec.js:26` (module-level `let`), desktop `beforeEach` (lines 186-198) resets the mock but not the variable; the test at line 246 sets it to `null` and it stays `null` into every later desktop test.
- Explanation: currently harmless (later tests re-save or override the implementation), but the suite is order-dependent: any future test inserted after line 251 that decrypts without saving first would unexpectedly get `{ ok: false }`. Also a tiny style nit: `string | null` instead of the maybe-syntax `?string` (styleguide 5.1, `styleguide.md:89`).
- Proposed solution: `fakeDecryptedKey = null;` in both `beforeEach` blocks (or at the top of `setSuccessfulIpcHandlers`).
- Tests to write: none new; this hardens the existing suite.

### [E] `getTotals` / `ByokUsageTotals` have no production consumer (intentional per Phase 4 backlog)

- Affected: `newIDE\app\src\AiGeneration\Byok\ByokUsageTracker.js:50-60, 80-86`; grep shows only spec callers (`ByokUsageTracker.spec.js:89,103`, a stub in `ByokOrchestrator.spec.js:71`).
- Explanation: the "exact prompt/completion token row" that would read it is a deferred nice-to-have (`REVIEW\Phase4.md:425-426`: "`ByokUsageTracker.getTotals` already provides the data"). Keeping the tested seam is a documented decision, not dead code to remove — recorded here for the consolidating auditor.
- Proposed solution: none now; wire or remove when the backlog item is taken.

### [E] `loadByokKey` conflates "no key stored" with "key present but undecryptable"

- Affected: `newIDE\app\src\AiGeneration\Byok\ByokKeyStorage.js:237-238, 247` (both `null` returns); consumer `AskAiEditorContainer.js:638-647` renders "No API key is stored for BYOK…" for both.
- Explanation: after a DPAPI failure or ciphertext corruption, the user is told to re-enter the key even though an entry exists — mildly misleading guidance (the entry also stays on disk, retrying and logging on every load). Acceptable degradation per Phase 1's "corrupted value is reported as no key stored" contract (`REVIEW\Phase1.md` step 1.3), so info-level.
- Proposed solution (optional): return a distinguishing shape (`{| status: 'none' | 'unreadable' | 'ok', key?: string |}`) and let the container word the error accordingly.
- Tests to write: none required if left as is.

### [E] v1 migration can leave the plaintext entry on disk if the re-save fails

- Affected: `newIDE\app\src\AiGeneration\Byok\ByokKeyStorage.js:232-235` — `saveByokKey` swallows its own failure (see the D finding above), so a failed migration leaves `{ key: <plaintext> }` in localStorage with no signal.
- Explanation: narrow window (quota/full storage during migration), and the plaintext was already there before the read; the migration retries on every subsequent load.
- Proposed solution: have the migration clear the entry only after confirming the new write succeeded (ties into the `saveByokKey` boolean return).
- Tests to write: with a failing `setItem`, assert the v1 entry is not silently considered migrated.

## Checks that passed

- IPC channel names match exactly on both sides, each registered once: renderer invokes `'byok-encrypt'` (`ByokKeyStorage.js:141`), `'byok-decrypt'` (`:166`), `'byok-encryption-available'` (`:274`); main registers the same three (`main.js:465, 466, 469`); no other `byok-*` channels exist anywhere in `electron-app\app` or `app\src` (grep).
- Result shapes match: renderer's `ByokSafeStorageResult` (`ByokKeyStorage.js:24-26`, exact object types) equals `ByokSafeStorage.js` outputs `{ ok: true, data } | { ok: false, error }` (lines 22-29 and 36-45); availability returns a plain boolean (`main.js:465` → `ByokSafeStorage.js:7-14`) consumed as boolean (`ByokKeyStorage.js:270-279`).
- The main-process block follows the neighboring pattern exactly: `ipcMain.handle` (like `install-cli-in-path`, `main.js:457-461`), registered inside `app.on('ready')` with the other handlers, 7 lines total (within Phase3.md's ≤ 10-line budget, AC at `Phase3.md:244`), errors as values never IPC exceptions, `require` grouped with the other local requires (`main.js:49-53`).
- `ByokSafeStorage.js` is trivially thin as the no-test-runner contract demands (`Phase3.md:55-63`): three pure try/catch wrappers around `safeStorage`, no state, no logic.
- SafeStorage-unavailable path (Linux without keyring): `isByokEncryptionAvailable` try/catch → `false` (`ByokSafeStorage.js:7-14`), renderer then keeps/creates obfuscated v2 and the status row shows the honest obfuscation text — matches `Phase3.md` intent.
- The API key never appears in any `console.*` call, error message, or log: all eight `console.error` sites log only error/result objects (`ByokKeyStorage.js:147,149,172,175,213,249,261,276`); `ByokSafeStorage.js` never logs at all and states so (lines 3-4) — complies with styleguide 5.4 (`styleguide.md:128-129`). The only network use of the key is outside these files (endpoint calls).
- Web build never touches Electron: `optionalRequire('electron')` returns `null` in a browser (`Utils/OptionalRequire.js:32-33`); asserted by the spec (`ByokKeyStorage.spec.js:159-164`).
- Corruption paths all resolve `null` without throwing: non-JSON (`ByokKeyStorage.js:227` + catch at 248-251), non-object (`:228`), invalid base64 (`deobfuscate` catch, `:113-116`), v2 without value (`:181-183`), decrypt `ok: false` (`:169-173`) — each has a spec test (`spec :136-157`, `:239-251`).
- Interface stability since Phase 1 as Phase 3 requires (`Phase3.md:246`): all five Phase-1 exports present with unchanged signatures (`saveByokKey`, `loadByokKey`, `clearByokKey`, `isByokKeyEncryptionAvailable`, `getByokKeyStorageInfo`; `getByokKeyStorageInfo` gained a field but kept `encrypted`).
- Every exported function in both renderer modules has co-located tests, including the exported-for-test `obfuscate`/`deobfuscate` (`spec :322-354`); `AiRequestContextStats` output matches `Generation.js:125-131` (`totalTokens` + `usedPercentage`) and the spec pins the exact key set (`ByokUsageTracker.spec.js:80-84`).
- Style: no nested ifs or nested loops in any assigned renderer file (guard clauses and `continue` throughout); `// @flow` first line everywhere it applies; localStorage key `gd-byok-key` follows the `gd-` prefix convention (styleguide 5.2); no user-facing strings in these modules, so no `<Trans>` needed.
- `usageFromResponse` validates all three snake_case fields before normalizing (`ByokUsageTracker.js:14-18`), matching the optional-`usage` reality of proxies; the orchestrator consumes it guarded (`ByokOrchestrator.js:256-263`), and a `null` usage simply leaves `contextStats` untouched (Phase2.md:362-364 intent).

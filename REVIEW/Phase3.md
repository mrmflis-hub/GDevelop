# Phase 3 — Electron Desktop Integration

**Status:** planned · **Depends on:** Phase 2 (all ACs green) ·
**Read first:** [report.md](report.md) sections 3.3, 4, 7 · [styleguide.md](styleguide.md) · [agents.md](agents.md)

---

## 1. Introduction — what this phase delivers

Desktop is the primary target (this is a Windows 11 machine and GDevelop's main
distribution is the desktop app). Phase 3 makes BYOK first-class there:

1. **OS-level key encryption.** The API key stops being merely obfuscated and
   is encrypted with Electron's `safeStorage` API — on Windows that is **DPAPI**,
   i.e. the key is bound to the user's Windows account. Ciphertext is still kept
   in the renderer's localStorage, but only the main process can decrypt it.
2. **The renderer ↔ main bridge** for that encryption, following the exact IPC
   patterns the app already uses.
3. **Honest UI.** The BYOK tab's storage-status row says "encrypted by Windows /
   your OS" on desktop and keeps the obfuscation warning on web.
4. **Desktop verification pass.** Renderer-to-arbitrary-host networking is
   confirmed working in the desktop build (the app disables web security, so no
   CORS), and the whole flow is verified in a packaged build, not just `npm start`.

The web build keeps working exactly as Phase 2 left it — same interface,
weaker storage, clearly labeled.

### Existing files that play a role

| File | Role in this phase | What we do to it |
|---|---|---|
| `newIDE\electron-app\app\main.js` | Electron main process; all IPC handlers are registered in one region (lines ~443–620; e.g. `ipcMain.handle('install-cli-in-path', …)` at line 452) | **Modify**: one small block registering two handlers |
| `newIDE\app\src\AiGeneration\Byok\ByokKeyStorage.js` | Phase 2's obfuscated storage | **Modify**: prefer the IPC path when Electron is present; localStorage otherwise |
| `newIDE\app\src\AiGeneration\Byok\ByokSettingsTab.js` | Storage-status row | **Modify**: renders the new status |
| `newIDE\app\src\Utils\OptionalRequire.js` | The sanctioned way to touch Electron from renderer code (`optionalRequire('electron')` — web-safe) | **Read only** |
| `newIDE\app\src\Utils\LocalFileDownloader.js` + `newIDE\electron-app\app\LocalFileDownloader.js` | The canonical `ipcRenderer.invoke` ↔ `ipcMain.handle` round-trip pair (download flow) | **Read only** — copy the shapes |
| `newIDE\electron-app\app\main.js:174-187` | `webPreferences` with `webSecurity: false` — why desktop networking "just works" | **Read only** |

### New tech stack?

One API, already available: **Electron `safeStorage`** (Electron 32.3.3 —
`newIDE\electron-app\package.json:26`). No new npm dependencies, no native
modules, no keytar.

### New files created in this phase

```
newIDE\electron-app\app\ByokSafeStorage.js     tiny main-process helper (thin by design)
```

Modified: `newIDE\electron-app\app\main.js`,
`newIDE\app\src\AiGeneration\Byok\ByokKeyStorage.js` (+ spec),
`newIDE\app\src\AiGeneration\Byok\ByokSettingsTab.js` (+ spec).

> **Testing reality on the main process (read this before planning tests):**
> `newIDE\electron-app` has **no Jest setup** — only the renderer app
> (`newIDE\app`) runs tests. Therefore the rule for this phase is: *keep the
> main-process code so thin that there is nothing to unit-test* (two handlers
> that call `safeStorage` and wrap the result), move every decision into
> renderer-side, tested code, and verify the main process with the manual
> checklist in step 3.5. This is recorded in the worklog as a deliberate
> trade-off, consistent with the "every function has a test" rule: the
> renderer-side logic is tested; the two-line handlers are manually verified.

---

## 2. Steps

### Step 3.1 — Main-process helper (`ByokSafeStorage.js`)

**Goal:** one tiny module in the main process that owns everything
`safeStorage`-related, so `main.js` stays a two-line registration.

**How to implement:**

1. Create `newIDE\electron-app\app\ByokSafeStorage.js` (plain Node/CommonJS
   like the rest of that folder — check how `LocalFileDownloader.js` exports).
2. Export three functions, each a few lines, each with guard clauses:
   - `isByokEncryptionAvailable(): boolean` — `safeStorage.isEncryptionAvailable()`,
     wrapped in try/catch returning `false` (some Linux builds lack a keyring;
     on Windows this is effectively always true).
   - `encryptByokSecret(plainText: string): {| ok: true, data: string |} | {| ok: false, error: string |}` —
     `safeStorage.encryptString(plainText)` → `Buffer`, returned as base64.
     Returns the failure shape instead of throwing (errors crossing IPC as
     exceptions are painful to shape; result objects are the app's style — see
     how preview handlers return values).
   - `decryptByokSecret(base64Cipher: string): same result shape` — inverse.
3. No logging of plaintext, ever. One comment stating it.
4. Require `electron` at the top the same way `main.js`/`LocalFileDownloader.js`
   do (`require('electron')` is correct **inside the main process** — the
   `optionalRequire` rule is for renderer code only; do not confuse them).

**Files created:** `newIDE\electron-app\app\ByokSafeStorage.js`
**Files modified:** none
**Tests to write:** none here (no test runner exists in `electron-app` — the
trade-off is documented above; behavior is covered by step 3.5's checklist and
the renderer-side tests in 3.2).
**Depends on:** nothing.

---

### Step 3.2 — Register the IPC handlers in `main.js`

**Goal:** two handlers next to the existing ones, indistinguishable in style
from their neighbors.

**How to implement:**

1. Open `newIDE\electron-app\app\main.js`. Find the `ipcMain.handle('install-cli-in-path', …)`
   registration (line ~452) — our block goes right after it, inside the same
   handler-registration region.
2. Add the require at the top of the file with the other local requires:
   `const { encryptByokSecret, decryptByokSecret, isByokEncryptionAvailable } = require('./ByokSafeStorage');`
3. Register exactly two handlers:
   ```js
   ipcMain.handle('byok-encryption-available', () => isByokEncryptionAvailable());
   ipcMain.handle('byok-encrypt', (_event, plainText) => encryptByokSecret(String(plainText)));
   ipcMain.handle('byok-decrypt', (_event, cipherText) => decryptByokSecret(String(cipherText)));
   ```
4. Stop. No validation framework, no options object, no extra abstraction —
   the renderer owns policy. If the block feels like it needs more than ~10
   lines, the design drifted; re-read step 3.1.

**Files created:** none
**Files modified:** `newIDE\electron-app\app\main.js`
**Tests to write:** none (see the trade-off note in the introduction).
**Depends on:** Step 3.1.

---

### Step 3.3 — Renderer bridge upgrade (`ByokKeyStorage.js`)

**Goal:** on desktop the key is encrypted by the OS; on web everything still
works as in Phase 2. Same interface, third implementation.

**How to implement:**

1. Open `Byok\ByokKeyStorage.js`. Add at the top (renderer-safe):
   ```js
   const electron = optionalRequire('electron');
   const ipcRenderer = electron ? electron.ipcRenderer : null;
   ```
   following `Utils\Window.js` / `PreferencesProvider.js:37-38`.
2. Implement the internal helpers with plain early-returns:
   - `encryptSecret(plainText)` → if `ipcRenderer` → `await
     ipcRenderer.invoke('byok-encrypt', plainText)` and unwrap the result shape
     (return `null` + `console.error` on `ok: false`); else → the Phase 2
     obfuscation path.
   - `decryptSecret(payload)` → inverse, with a version field in the stored
     object telling you which path produced it:
     `{ version: 3, value }` (safeStorage) vs `{ version: 2, value }`
     (obfuscated) vs `{ version: 1 }` (Phase 1 plaintext, migrate on read —
     already built in Phase 2).
3. Rewire the four public functions to use the helpers. **Do not change their
   signatures** — the settings tab and Phase 4 code must not know any of this
   happened.
4. `isByokKeyEncryptionAvailable()` becomes: `ipcRenderer` present →
   `invoke('byok-encryption-available')`; else `false`. On desktop this now
   returns `true`.
5. Migration on read: decrypting a v2 payload on desktop works without the main
   process (it is our obfuscation, renderer-side) — decrypt, re-save as v3.
   One branch, commented.

**Files created:** none
**Files modified:** `Byok\ByokKeyStorage.js`, `Byok\ByokKeyStorage.spec.js`
**Tests:** mock `optionalRequire`/`ipcRenderer.invoke` (jest.mock) —
desktop path: save calls `byok-encrypt`, load calls `byok-decrypt`, failure
result shape → `null` + no throw; web path unchanged (Phase 2 tests still pass
— this is the regression proof); v2 entry loaded on a mocked-desktop
environment migrates to v3; `isByokKeyEncryptionAvailable` true/false per
environment.
**Depends on:** Steps 3.1, 3.2 (interface), Phase 2 Step 2.4.

---

### Step 3.4 — Storage status in the settings tab

**Goal:** the user always knows how protected their key is.

**How to implement:**

1. Open `Byok\ByokSettingsTab.js`. The status row (Phase 1 step 1.4) now reads
   `isByokKeyEncryptionAvailable()` **and** `getByokKeyStorageInfo()`.
2. Three states, three plain texts, chosen by guard clauses in a small named
   helper `getKeyStorageStatusText(encrypted, hasStoredKey)` (unit-test it):
   - Desktop, encryption available: "Your API key is encrypted by Windows (DPAPI)
     and can only be read by this app under your user account." (wording
     flexible, keep it honest and short, `<Trans>`-wrapped)
   - Web / no encryption, key stored: "Your API key is stored with light
     obfuscation only. The desktop app protects it with OS-level encryption."
   - No key stored: hide the row (early return).
3. Nothing else changes in the tab.

**Files created:** none
**Files modified:** `Byok\ByokSettingsTab.js`, `Byok\ByokSettingsTab.spec.js`
**Tests:** `getKeyStorageStatusText` truth table; component test asserting the
desktop text renders when `isByokKeyEncryptionAvailable` is mocked `true`.
**Depends on:** Step 3.3, Phase 1 Step 1.4.

---

### Step 3.5 — Desktop verification pass (manual, recorded in worklog)

**Goal:** prove the desktop story end-to-end in the real Electron app, not just
`npm start` in a browser.

**How to implement:**

1. Run the desktop dev workflow documented in `newIDE\README.md` (Electron app
   loading the local renderer). Open the BYOK tab and record in the worklog:
   - Status row shows the OS-encryption text.
   - Save a key → DevTools → Local Storage → `gd-byok-key`: the value is
     ciphertext (base64 blob), **not** the key, and differs from the Phase 2
     obfuscation format.
   - Restart the app → chat/test-connection still works without re-entering the
     key (DPAPI decrypts across restarts; it does **not** decrypt under a
     different Windows user — note which was tested).
   - Sign out/in of Windows is *not* tested (DPAPI machine/user binding) — note
     as a known untested edge, do not claim it.
2. Networking check: with the dev tools network tab open, run "Test connection"
   against an arbitrary https endpoint — the request leaves the renderer with
   the `Authorization` header and succeeds (no CORS errors). This works because
   desktop windows run with `webSecurity: false` (`main.js:174-187`); cite this
   in the worklog entry so the knowledge survives.
3. Packaged build check: build the desktop app the way the repository documents
   for a release-like package (electron-builder config lives at
   `newIDE\electron-app\electron-builder-config.js`; use the existing
   `newIDE\electron-app` scripts — do not invent a new build pipeline). Repeat
   checklist items 1–2 inside the packaged app.
4. Regression: launch a local project, run a normal preview — the main process
   changes touched nothing else (the only diff in `main.js` is the 3 handler
   lines).

**Files created:** none · **Files modified:** none (any fix lands in 3.1–3.4
files)
**Depends on:** Steps 3.1–3.4.

---

## 3. Phase 3 acceptance criteria (phase gate)

- [ ] On desktop, the API key at rest is `safeStorage` ciphertext (DPAPI), stored under `gd-byok-key` with a `version: 3` marker; the plaintext key is nowhere in localStorage.
- [ ] Key round-trip (save → restart → load) works in the packaged desktop app.
- [ ] `byok-encryption-available` / `byok-encrypt` / `byok-decrypt` handlers exist in `main.js` as a ≤ 10-line block calling `ByokSafeStorage.js`; no other `main.js` changes (diff-checked and recorded).
- [ ] Renderer code reaches Electron only via `optionalRequire` — the web build still runs, uses obfuscated storage, and shows the honest web warning text.
- [ ] All `ByokKeyStorage` public signatures unchanged since Phase 1 (grep-level check recorded in worklog); Phase 2 spec suite still green.
- [ ] Renderer-side tests cover the desktop/web branching with mocked IPC; the main-process thinness trade-off is documented in the worklog.
- [ ] Manual desktop verification checklist (step 3.5) executed with results recorded in the worklog, including the packaged build.
- [ ] All four checks (`test`, `lint`, `flow`, `check-format`) pass in `newIDE\app`; worklog entry contains all five mandatory items.

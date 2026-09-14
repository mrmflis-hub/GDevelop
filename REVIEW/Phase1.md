# Phase 1 — BYOK Settings UI

**Status:** planned · **Depends on:** nothing (this is the first phase) ·
**Read first:** [report.md](report.md), [styleguide.md](styleguide.md), [agents.md](agents.md)

---

## 1. Introduction — what this phase delivers

By the end of Phase 1 the user can open the app's **Preferences dialog**, see a
new **"BYOK" tab**, and configure their own OpenAI-compatible connection:

- a master switch ("Use BYOK for Ask AI"),
- the endpoint base URL,
- the API key (masked input, stored outside the normal preferences blob),
- a model name (free text in this phase — the "fetch models from server"
  dropdown is delivered in Phase 2),
- a reasoning-effort selector (default / low / medium / high),
- a context-window size in tokens (manual in this phase — auto-detection is
  Phase 2).

Everything is persisted and survives an app restart. No AI calls are made yet —
this phase is pure UI + storage plumbing.

### Why there are no chat modifications in this phase

We checked the chat code: `AiRequestChat/index.js` renders whatever `AiRequest`
object and props it is given (`quota`, `price`, `contextUsedRatio`, …), and
`AiUsageIndicator` already hides credit sections when their props are empty.
That means BYOK chats can reuse the existing chat UI as-is once the backend
phases produce the data. The two chat-related additions we will eventually want
(token-exact usage row, BYOK badge) depend on data that only exists after
Phase 2, so they are scheduled there and in Phase 4. **Phase 1 changes exactly
two existing files, by a few lines each.**

### Existing files that play a role

| File | Role in this phase | What we do to it |
|---|---|---|
| `newIDE\app\src\MainFrame\Preferences\PreferencesDialog.js` | The Preferences dialog; its `<Tabs options>` array (lines ~112–124) is the tab registry; tab bodies are conditionally rendered (lines ~127, 697–718) | **Modify**: add one tab option + one render block + one import |
| `newIDE\app\src\MainFrame\Preferences\PreferencesContext.js` | Declares the `PreferencesValues` Flow type (lines ~196–261) and `initialPreferences` defaults (lines ~396–463) | **Modify**: add the `byok` field + its default |
| `newIDE\app\src\MainFrame\Preferences\PreferencesProvider.js` | Persists all preferences under the single localStorage key `gd-preferences`; auto-fills missing keys from defaults on load (lines ~56–67) | **Not modified** — new preference fields migrate automatically |
| `newIDE\app\src\MainFrame\EditorContainers\HomePage\GetStartedSection\UserSurveyStorage.js` | The codebase's canonical small localStorage module (try/catch pattern) | **Read only** — template for our key storage |
| `newIDE\app\src\UI\TextField.js` | Text field; supports `type="password"` with a visibility toggle (lines ~27, 284–289) | **Read only** |
| `newIDE\app\src\UI\CompactSelectField.js`, `src\UI\SelectOption.js`, `src\UI\Layout.js`, `src\UI\Text.js`, `src\UI\Checkbox.js` (or `Toggle`) | Standard controls used all over `PreferencesDialog.js` | **Read only** |

### New tech stack?

None. Flow, Lingui, the existing `src\UI` kit, and localStorage. No new npm
dependencies (styleguide section 4).

### New files created in this phase (all under `newIDE\app\src\AiGeneration\Byok\`)

```
Byok\ByokTypes.js            settings types + defaults + safe reader
Byok\ByokTypes.spec.js
Byok\ByokKeyStorage.js       key storage (Phase 1: plaintext, behind the FINAL async interface)
Byok\ByokKeyStorage.spec.js
Byok\ByokSettingsTab.js      the tab's form component
Byok\ByokSettingsTab.spec.js
```

> **Why is `ByokKeyStorage` created here but only "encrypted" in Phase 2/3?**
> The settings tab needs somewhere to put the key from day one. We create the
> module in Phase 1 with a clearly-marked temporary plaintext implementation but
> its **final public interface** (async functions, an `isEncryptionAvailable()`
> probe). Phase 2 swaps the internals for web-safe obfuscation and Phase 3 for
> Electron `safeStorage` — without the UI or the interface ever changing again.

---

## 2. Steps

### Step 1.1 — BYOK settings types (`ByokTypes.js`)

**Goal:** one module that owns the shape of BYOK settings and their defaults, so
every other module imports the same truth.

**How to implement:**

1. Create the folder `newIDE\app\src\AiGeneration\Byok\`.
2. Create `ByokTypes.js` starting with `// @flow`.
3. Define and export the settings type (use the exact-object syntax the repo
   uses in `PreferencesContext.js`):
   ```js
   export type ByokSettings = {|
     enabled: boolean,
     endpointUrl: string,
     modelName: string,
     reasoningEffort: 'default' | 'low' | 'medium' | 'high',
     contextWindowTokens: number,
   |};
   ```
   (The API key is intentionally **not** part of this type — it never enters
   the preferences blob. It is stored by `ByokKeyStorage`, step 1.3.)
4. Define and export `export const DEFAULT_BYOK_SETTINGS: ByokSettings = {...}`
   with: `enabled: false`, `endpointUrl: ''`, `modelName: ''`,
   `reasoningEffort: 'default'`, `contextWindowTokens: 8192`.
5. Define and export a safe reader used everywhere instead of touching the
   preference object directly:
   - `export const getByokSettings = (values: { byok: ?ByokSettings }): ByokSettings`
   - Implementation: one early return for a missing/`null` `byok` field, one
     early return for a value that is not an object — both return
     `DEFAULT_BYOK_SETTINGS`. Otherwise merge over the defaults field-by-field
     (a simple explicit object build, no clever spread tricks), so a settings
     object saved by an older build still works when new fields are added later.
6. Define and export `isByokFullyConfigured = (settings: ByokSettings): boolean`
   — true when `enabled` is true AND `endpointUrl` is a non-empty `https://` (or
   `http://` for local servers like Ollama) URL AND `modelName` is non-empty.
   Use guard clauses; return `false` early.

**Files created:** `Byok\ByokTypes.js`, `Byok\ByokTypes.spec.js`
**Files modified:** none
**Tests to write (`ByokTypes.spec.js`):**

- `DEFAULT_BYOK_SETTINGS` has the documented values.
- `getByokSettings` returns defaults when `byok` is missing, `null`, or not an
  object.
- `getByokSettings` returns defaults for **missing individual fields** on a
  partially-filled object (e.g. saved before a new field existed).
- `getByokSettings` returns the stored values when the object is complete.
- `isByokFullyConfigured`: false when disabled; false with empty URL/model;
  true with `https://…` URL; true with `http://localhost:1234` URL; false with
  `ftp://…`.

**Depends on:** nothing.

---

### Step 1.2 — Register the `byok` preference

**Goal:** BYOK settings become a real preference, persisted in the existing
`gd-preferences` localStorage blob with automatic defaults for existing users.

**How to implement:**

1. Open `newIDE\app\src\MainFrame\Preferences\PreferencesContext.js`.
2. Add the import of the type: `import { type ByokSettings } from '../../AiGeneration/Byok/ByokTypes';`
   (check the repo's import style — some files use `import { type X }`, others
   `import type { X }`; match the nearest imports in this file).
3. In `export type PreferencesValues = {| ... |}` (around line 196–261), add one
   field next to the existing AI preferences cluster (near
   `automaticallyUseCreditsForAiRequests`, line ~255):
   `byok: ByokSettings,`
4. In `initialPreferences` (around line 396–463), add the default next to the
   matching AI defaults (line ~456–458):
   `byok: DEFAULT_BYOK_SETTINGS,` (import it from `ByokTypes.js`).
5. Do **not** touch `PreferencesProvider.js`: `loadPreferencesFromLocalStorage`
   (lines ~56–67) already fills missing keys from `initialPreferences`, and the
   generic `setMultipleValues` setter (lines ~448–458) already writes any value.
6. Run `npm run flow` — if Flow complains about the new field in a type
   annotation somewhere (e.g. a function that lists preference keys), fix by
   adding the field there; note any such extra spot in the worklog.

**Files created:** none
**Files modified:** `newIDE\app\src\MainFrame\Preferences\PreferencesContext.js`
**Tests to write:** none in this step (no new function is introduced here;
behavior is covered by the step 1.4 component test and step 1.6 manual checks).
**Depends on:** Step 1.1.

---

### Step 1.3 — Key storage module with its final interface (temporary plaintext)

**Goal:** a tiny, fully-tested module that saves/loads/clears the API key. Phase
1 ships a plaintext implementation so the UI is testable; the *interface* is
already async and already has an availability probe, so Phases 2–3 only replace
the internals.

**How to implement:**

1. Read `UserSurveyStorage.js` first — copy its structure: a module-level
   key constant, small exported functions, every operation wrapped in
   try/catch with a `console.error` (never a throw) on storage failures.
2. Create `Byok\ByokKeyStorage.js` with `// @flow` and:

   ```js
   const BYOK_KEY_STORAGE_ITEM = 'gd-byok-key';
   ```

3. Export exactly this interface (all functions `async` from day one):

   - `export const saveByokKey = async (key: string): Promise<void>`
   - `export const loadByokKey = async (): Promise<?string>` — `null` when no
     key is stored.
   - `export const clearByokKey = async (): Promise<void>`
   - `export const isByokKeyEncryptionAvailable = async (): Promise<boolean>`
     — returns `false` in Phase 1 (plaintext). Phase 2 keeps `false` (obfuscated)
     and Phase 3 returns `true` on desktop.
   - `export const getByokKeyStorageInfo = async (): Promise<{| encrypted: boolean |}>`
     — what the settings tab displays as a status row.

4. Phase 1 internals: store `JSON.stringify({ key })` under the localStorage
   item (the object wrapper makes later format migrations painless). Mark the
   plaintext clearly with a comment: `// TEMPORARY (Phase 1): stored in
   plaintext. Phase 2 replaces this with obfuscated storage, Phase 3 with
   Electron safeStorage. The interface below is final.`
5. Guard clauses: empty-string key input to `saveByokKey` should clear the
   entry (call `clearByokKey`) rather than store `""` — one early return.

**Files created:** `Byok\ByokKeyStorage.js`, `Byok\ByokKeyStorage.spec.js`
**Files modified:** none
**Tests to write (`ByokKeyStorage.spec.js`):**

- Roundtrip: save then load returns the same key.
- Load with nothing stored returns `null`.
- Clear removes the entry; load returns `null` afterwards.
- Saving an empty string is equivalent to clearing.
- A corrupted (non-JSON) localStorage value does not throw; load returns `null`.
- `isByokKeyEncryptionAvailable` resolves to `false` in Phase 1.
- (The test file manipulates `localStorage` directly — it runs in the node
  environment, so assign a minimal stub if `localStorage` is undefined, or use
  the `@jest-environment jsdom` docblock where `localStorage` exists.)

**Depends on:** nothing (can run in parallel with 1.1).

---

### Step 1.4 — The BYOK settings tab component

**Goal:** the form the user actually sees, following the exact look & feel of
the existing Preferences dialog.

**How to implement:**

1. Open `PreferencesDialog.js` and study its "preferences" tab body (from line
   ~127): sections use `<ColumnStackLayout noMargin>` with
   `<Text size="block-title">` headers, rows use `<LineStackLayout>`, and
   every label is wrapped in `<Trans>`. Do the same.
2. Create `Byok\ByokSettingsTab.js` with `// @flow`. Props: none — the
   component reads and writes preferences itself:
   ```js
   const { values, setMultipleValues } = React.useContext(PreferencesContext);
   const byokSettings = getByokSettings(values);
   ```
3. Render, top to bottom:
   - **Header** `<Text size="block-title"><Trans>BYOK — Bring Your Own Key</Trans></Text>`
     plus a short explanatory `<Text>` (Lingui `t`` string or nested `<Trans>`)
     saying what BYOK does in one sentence.
   - **Enable checkbox** bound to `byokSettings.enabled`.
   - **Endpoint URL** — `<TextField>` with
     `placeholder="https://api.openai.com/v1"` (helper text: the base URL,
     `/models` and `/chat/completions` are appended automatically).
   - **API key** — `<TextField type="password">` (built-in visibility toggle —
     see `UI\TextField.js:284-289`). Value held in **local component state
     only**; on blur (or on a "Save key" press), call `saveByokKey(value)`.
     The field never writes the key into `setMultipleValues`.
   - **Model** — `<TextField>` free text in this phase, with helper text:
     "Fetching the model list from your provider arrives in a later update."
   - **Reasoning effort** — `<CompactSelectField>` + `<SelectOption>` with the
     four options from `ByokTypes.js`.
   - **Context window** — `<TextField type="number">` (or the repo's numeric
     field pattern) bound to `contextWindowTokens`; clamp on change to
     512–1,000,000 using a small named helper `clampContextWindow(value)` —
     no inline magic.
   - **Storage status row** — a one-line `<Text>` fed by
     `getByokKeyStorageInfo()` loaded in a `React.useEffect`: "API key storage:
     not yet encrypted (planned)" in Phase 1.
4. Persistence pattern: write on change, like existing preferences do —
   `setMultipleValues({ byok: { ...byokSettings, endpointUrl: newValue } })`.
   Keep one helper inside the component file,
   `const updateByokSetting = (partial: $Shape<ByokSettings>) => {...}`, so
   every control is a one-liner. This is our own new file — no existing code
   is touched.
5. Every user-visible string wrapped in `<Trans>`. No hardcoded colors — no
   colors at all; the theme handles it.
6. If the component needs `useSecureKeyDown`-style niceties — it doesn't. Keep
   it boring.

**Files created:** `Byok\ByokSettingsTab.js`, `Byok\ByokSettingsTab.spec.js`
**Files modified:** none
**Tests to write (`ByokSettingsTab.spec.js`):**

- Render smoke test: mounts without crashing and shows the BYOK title
  (use `@jest-environment jsdom` docblock; wrap in a fake
  `PreferencesContext.Provider` supplying `values` from
  `DEFAULT_BYOK_SETTINGS` and a `jest.fn()` for `setMultipleValues`).
- Changing the endpoint field calls `setMultipleValues` with
  `{ byok: { ...defaults, endpointUrl: 'https://example.com/v1' } }`.
- Context-window clamping: entering `10` persists `512`; entering `99999999`
  persists `1000000` (test `clampContextWindow` directly — export it).
- The key field does **not** appear in any `setMultipleValues` call
  (assert on the mock's `calls`).

**Depends on:** Steps 1.1, 1.2, 1.3.

---

### Step 1.5 — Register the "BYOK" tab in the Preferences dialog

**Goal:** the tab appears in the existing dialog. This is the only step that
touches a second existing file.

**How to implement:**

1. Open `PreferencesDialog.js`.
2. Add the import near the other local imports:
   `import ByokSettingsTab from '../../AiGeneration/Byok/ByokSettingsTab';`
   (adjust relative depth to match how the file imports from other folders).
3. In the `<Tabs options={...}>` array (lines ~115–121), add after the
   shortcuts entry and before the electron-gated folders entry:
   `{ value: 'byok', label: <Trans>BYOK</Trans> },`
4. After the folders render block (the `{electron && currentTab === 'folders' && (...)}` 
   ending near line 718), add:
   ```jsx
   {currentTab === 'byok' && (
     <ColumnStackLayout noMargin>
       <ByokSettingsTab />
     </ColumnStackLayout>
   )}
   ```
5. Nothing else. No new state, no prop drilling — the tab component is
   self-contained.

**Files created:** none
**Files modified:** `newIDE\app\src\MainFrame\Preferences\PreferencesDialog.js`
**Tests to write:** none (pure registration; verified by manual QA in 1.6 —
the dialog is rendered inside heavy providers that make an isolated test
disproportionate. Note this decision in the worklog).
**Depends on:** Step 1.4.

---

### Step 1.6 — Phase gate: verification & regression

**Goal:** prove Phase 1 works and broke nothing.

**How to implement:**

1. From `newIDE\app` run all four: `npm test -- --watchAll=false`,
   `npm run lint`, `npm run flow`, `npm run check-format`. Fix everything.
2. Launch the dev app (`npm start` in `newIDE\app` for the web dev server, or
   the Electron dev workflow — see the newIDE README). Open **File →
   Preferences**.
3. Manual QA checklist (record results in the worklog):
   - "BYOK" tab is present between "Keyboard Shortcuts" and "Folders".
   - All fields render; toggling/typing updates them.
   - Close and reopen the dialog: values persisted.
   - Restart the app: values still persisted (localStorage migration works).
   - DevTools → Application → Local Storage → `gd-preferences`: the `byok`
     object contains endpoint/model/effort/context window but **no API key
     material**. The `gd-byok-key` entry holds the key (Phase 1: plaintext —
     expected, fixed in Phase 2/3).
   - Type an obviously wrong URL (e.g. `not a url`): no crash; the enable
     toggle stays but `isByokFullyConfigured` would be false (unit-tested).
   - The rest of the Preferences dialog (language, theme, shortcuts, folders)
     still works — quick click-through regression.
4. Write the worklog entry (all five mandatory items).

**Files created:** none · **Files modified:** none (fixes land in the step
files above)
**Depends on:** Step 1.5.

---

## 3. Phase 1 acceptance criteria (phase gate)

- [ ] A "BYOK" tab is visible in the Preferences dialog in both web and desktop builds.
- [ ] The tab contains: enable toggle, endpoint URL, masked API key field, model name, reasoning-effort selector, context-window field, and a storage-status row.
- [ ] Settings persist across dialog close/reopen **and** full app restart.
- [ ] The API key is **not** stored inside `gd-preferences`; it lives under the separate `gd-byok-key` entry via `ByokKeyStorage`.
- [ ] `getByokSettings` never crashes on missing/partial/corrupt settings (unit-tested).
- [ ] `clampContextWindow` enforces 512–1,000,000 (unit-tested).
- [ ] Every new exported function has at least one test; `npm test`, `npm run lint`, `npm run flow`, `npm run check-format` all pass from `newIDE\app`.
- [ ] Existing files touched: **only** `PreferencesContext.js` and `PreferencesDialog.js`, with a combined diff of roughly 20 lines.
- [ ] No locale files were edited; all new strings use `<Trans>`.
- [ ] Worklog entry for the phase exists with all five mandatory items.

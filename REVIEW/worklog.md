# Worklog

Mandatory log of all work done in this repository. One entry per working
session, newest first. **Every entry must contain all five items** (date,
description of actions, bugs found, issues found, full list of files worked on)
— missing any one means the run failed. Subagents never write entries here; the
orchestrating agent writes one consolidated entry per session.

---

## Entry template

```
## YYYY-MM-DD — <short title>
**Agent:** <who/what worked (orchestrator + which subagents)>
**Actions:** <brief description>
**Bugs found:** <list or "none">
**Issues found:** <list or "none">
**Files worked on:** <full list — created / modified / read>
```

---

## 2026-09-14 — Phase 1 implemented: BYOK settings UI (types, key storage, tab, dialog registration)

**Agent:** ZCode main orchestrator (no subagents dispatched).

**Actions:**
- Implemented all steps of `REVIEW/Phase1.md`:
  - **Step 1.1** — Created `ByokTypes.js`: `ByokSettings` exact type (`enabled`, `endpointUrl`, `modelName`, `reasoningEffort`, `contextWindowTokens`), `DEFAULT_BYOK_SETTINGS` (disabled / empty / `default` / 8192), safe reader `getByokSettings` (per-field merge over defaults; never crashes on missing/null/non-object/partial/corrupt settings), `isByokFullyConfigured` (enabled + `https://`/`http://` URL + non-empty model), `isByokReasoningEffort`, `BYOK_REASONING_EFFORTS`, and the context-window bounds constants (512 / 1,000,000). Spec: 16 tests.
  - **Step 1.2** — Registered the `byok` preference in `PreferencesContext.js`: type import, `byok: ByokSettings` in `PreferencesValues` next to the AI prefs cluster, `byok: DEFAULT_BYOK_SETTINGS` in `initialPreferences`. `PreferencesProvider.js` was left untouched at this step (auto-fill migration verified by code reading); one Flow-required annotation addition landed there later (see Issues).
  - **Step 1.3** — Created `ByokKeyStorage.js` with the **final async interface** (`saveByokKey`, `loadByokKey`, `clearByokKey`, `isByokKeyEncryptionAvailable` → `false` in Phase 1, `getByokKeyStorageInfo`), plaintext Phase 1 internals clearly marked, JSON `{ key }` wrapper under localStorage key `gd-byok-key`, empty-string save clears the entry, every operation in try/catch (never throws, never logs key material). Spec: 9 tests (jsdom; includes corrupted/non-JSON stored values).
  - **Step 1.4** — Created `ByokSettingsTab.js`: block-title header + one-sentence explanation, enable checkbox, endpoint URL field (hint `https://api.openai.com/v1`, helper text about `/models` + `/chat/completions` being appended), masked API-key `TextField type="password"` whose value lives in **local state only** and is written to `ByokKeyStorage` on blur (never through `setMultipleValues`), storage-status row fed by `getByokKeyStorageInfo()` in a `React.useEffect` ("not yet encrypted (planned)" in Phase 1), free-text model field, reasoning-effort `CompactSelectField` (guarded narrowing through `BYOK_REASONING_EFFORTS`), numeric context-window field clamped by exported `clampContextWindow` (512–1,000,000; non-number falls back to default). Writes on change via a single `updateByokSetting` helper; all user-visible strings wrapped in `<Trans>`/``t``; no colors, no new dependencies. Spec: 10 tests (jsdom + `react-test-renderer`; asserts the key never appears in any `setMultipleValues` call, that blur lands the key under `gd-byok-key` while `gd-preferences` stays unwritten, and the clamping bounds).
  - **Step 1.5** — Registered the tab in `PreferencesDialog.js`: one import, `{ value: 'byok', label: <Trans>BYOK</Trans> }` between "Keyboard Shortcuts" and the Electron-gated "Folders" entry, and one conditional render block wrapping `<ByokSettingsTab />`. Not Electron-gated, so the tab shows in web and desktop.
  - **Step 1.6** — Environment bring-up and gates: `npm install --ignore-scripts`, applied all `patch-package` patches, generated `src/Version/VersionMetadata.js` and the theme resource files (`scripts/build-theme-resources.js`), fetched `libGD.js-for-tests-only` via the repo's own `scripts/import-libGD.js` (S3 `master/latest` mirror). Then ran the four gates (results below). Additionally verified the dialog registration with a **temporary** jsdom test (deleted afterwards, per step 1.5's decision not to commit a dialog test) that mounted the real `PreferencesDialog` in jsdom via react-dom, asserted the "BYOK" tab button is present, clicked it, and asserted every field (title, enable toggle, endpoint, API key, storage-status, model, reasoning effort, context window) renders.
- Gate results, final tree: `npm test -- --watchAll=false` → **147 suites passed, 1357 passed (1 pre-existing skip)**; `npm run lint` (`--max-warnings=0`) → **clean**; `npm run check-format` → **clean**; `npm run flow` → **Found 0 errors** (full re-check; see Issues for the Windows flow-server detail).
- Wrote this worklog entry.

**Bugs found:**
- Flow 0.299 treats `{...}` object types as **exact by default**, so the phase doc's literal signature `getByokSettings(values: { byok: ?ByokSettings })` rejected the full `PreferencesValues`. Fixed with inexact + covariant syntax `{ +byok: ?ByokSettings, ... }` (covariant because the field is only read; matches Flow's own suggested fix).
- `$Shape` is a hard `[deprecated-utility]` error in Flow 0.299 (the repo suppresses it elsewhere); for new code, `Partial<ByokSettings>` achieves the same without any `$FlowFixMe` — used in `ByokSettingsTab.js` and the specs.
- Prettier 1.15.3 (repo-pinned) cannot parse modern Flow call-site type arguments: `jest.fn<any, any>()` in a spec is a check-format SyntaxError. Fixed by using the repo's `mockFn` wrapper pattern (same as `AiRequestContext.spec.js`).

**Issues found:**
- `node_modules` was **missing** in this checkout, so the gates could not run until the environment was rebuilt. The full postinstall chain (GDJS `npm install`, GDJS runtime import, monaco/zipped editors) was **not** run — only the pieces the IDE's tests need (patches, `VersionMetadata.js`, theme resources, `libGD.js-for-tests-only`). Consequence: the dev app was not launched in this session, so the interactive parts of the manual QA checklist (visual click-through in the running app, full app-restart persistence check, DevTools localStorage inspection) could not be performed by hand. What was verified instead, per item:
  - "BYOK" tab present between "Keyboard Shortcuts" and "Folders" (desktop) / last (web): verified in code **and** by the temporary dialog-mount test (tab button found, click switches panel, all fields render).
  - Fields render and update: covered by `ByokSettingsTab.spec.js` (change handlers write through `setMultipleValues` with exact expected payloads).
  - Persist across dialog close/reopen and app restart: persistence is the existing `PreferencesProvider` mechanism, unchanged; `loadPreferencesFromLocalStorage` auto-fills the missing `byok` key from `initialPreferences` for existing users (code-verified, `PreferencesProvider.js`); round-trip covered indirectly by the provider's generic setter (code-verified) + unit tests of the values written.
  - Key never inside `gd-preferences`: unit-tested (mock-call key-set assertion + `gd-preferences` untouched; key stored under `gd-byok-key`).
  - Wrong URL ("not a url"): no validation code that can crash; `isByokFullyConfigured` returns false — unit-tested.
- **One extra existing file was touched beyond the two planned:** `PreferencesProvider.js` — the explicitly-typed return of `getInitialPreferences` lists every preference key, and Flow rejected the now-extra `byok` property; per Phase 1 step 1.2(6) the `byok: ByokSettings` annotation (+ type import) was added there. Net diff: ~3 lines.
- jsdom test environment: the `@jest-environment jsdom` docblock must be the **first** docblock, before `// @flow` (precedent `TouchDragDelay.spec.js`); with `// @flow` first, the node environment silently stays active. Also, jsdom lacks `window.matchMedia` (called at module load by `PreferencesContext.js`) and lingui's `I18n` context is undefined without a provider (crashes `SelectOption`); the component spec polyfills matchMedia and installs a minimal `setupI18n({language:'en',catalogs:{}})` + `I18nProvider`, mirroring `GDI18nProvider`.
- React-test-renderer cannot mount the whole `PreferencesDialog` (portal/react-dnd internals throw `parentInstance.children.indexOf`); the temporary verification used react-dom + jsdom instead, and needed `jest.mock('three/src/math/MathUtils')` because `ErrorBoundary` imports untranspiled ES modules from `three`.
- Windows flow-server quirk: flow clients hung when their stdout was a pipe (the spawned server inherits the handle, so the pipe never closes). Final check was run with the direct `flow.exe check` after killing stale `flow.exe` processes; it re-initialized from scratch and completed.
- No locale files were touched; all new strings use `<Trans>`/``t`` (English fallback confirmed rendering in tests).

**Files worked on:**
- Created: `newIDE/app/src/AiGeneration/Byok/ByokTypes.js`, `newIDE/app/src/AiGeneration/Byok/ByokTypes.spec.js`, `newIDE/app/src/AiGeneration/Byok/ByokKeyStorage.js`, `newIDE/app/src/AiGeneration/Byok/ByokKeyStorage.spec.js`, `newIDE/app/src/AiGeneration/Byok/ByokSettingsTab.js`, `newIDE/app/src/AiGeneration/Byok/ByokSettingsTab.spec.js`.
- Modified: `newIDE/app/src/MainFrame/Preferences/PreferencesContext.js` (import, `PreferencesValues.byok`, `initialPreferences.byok`), `newIDE/app/src/MainFrame/Preferences/PreferencesDialog.js` (import, tab option, render block), `newIDE/app/src/MainFrame/Preferences/PreferencesProvider.js` (`getInitialPreferences` return type + type import — Flow-required, see Issues).
- Read: `REVIEW/Phase1.md`, `REVIEW/report.md`, `REVIEW/styleguide.md`, `REVIEW/agents.md`, `REVIEW/worklog.md`, `newIDE/app/package.json`, `newIDE/app/.flowconfig`, `newIDE/app/src/MainFrame/Preferences/PreferencesContext.js`, `PreferencesDialog.js`, `PreferencesProvider.js`, `newIDE/app/src/MainFrame/EditorContainers/HomePage/GetStartedSection/UserSurveyStorage.js`, `newIDE/app/src/UI/TextField.js`, `Text.js`, `Checkbox.js`, `CompactSelectField/index.js`, `SelectOption.js`, `Theme/GDevelopThemeContext.js`, `Responsive/ScreenTypeMeasurer.js`, `newIDE/app/src/AiGeneration/AiRequestContext.spec.js`, `newIDE/app/src/UI/CompactSemiControlledNumberField/CompactSemiControlledNumberField.spec.js`, `newIDE/app/src/UI/DragAndDrop/TouchDragDelay.spec.js`, `newIDE/app/src/setupTests.js`, `newIDE/app/src/Utils/i18n/GDI18nProvider.js`, `newIDE/app/src/Utils/i18n/MessageDescriptor.flow.js`, `newIDE/app/scripts/import-libGD.js`, `make-version-metadata.js`.
- Generated build artifacts (upstream-gitignored; produced by the repo's own scripts, not hand-written): `newIDE/app/src/Version/VersionMetadata.js`, `newIDE/app/src/UI/Theme/*/​*Variables.{css,json}`, `newIDE/app/public/libGD.js` + `libGD.wasm`, `node_modules/libGD.js-for-tests-only/`, `patch-package` patches applied inside `node_modules`.

---

## 2026-09-13 — Project documentation suite (styleguide, agents manual, phase plans)

**Agent:** ZCode main orchestrator (no subagents dispatched).

**Actions:**
- Verified implementation details against the source before writing plans: preferences typing and defaults (`PreferencesContext.js`), the Preferences dialog tab registry (`PreferencesDialog.js`), chat wiring in `AiRequestChat/index.js` (context consumption, `AiUsageIndicator` props, preset selection, `canPayForAiRequest` gating), the `EditorFunction`/`EditorFunctionCall` type definitions and tool registry (`EditorFunctions/index.js`), the Electron `ipcMain.handle` pattern (`electron-app/app/main.js`), the `retryIfFailed` helper (`Utils/RetryIfFailed.js`), the localStorage module template (`UserSurveyStorage.js`), and the test conventions (Jest via `react-app-rewired test --env=node`, `@jest-environment jsdom` docblocks, no @testing-library dependency, npm checkout via `package-lock.json`).
- Created the project documentation set in `/REVIEW`: `styleguide.md` (repo rules + BYOK project rules), `agents.md` (operating manual for AI agents), `worklog.md` (this file), `Phase1.md` (BYOK settings UI), `Phase2.md` (BYOK backend engine), `Phase3.md` (Electron desktop integration), `Phase4.md` (client-side agent loop).

**Bugs found:** none.

**Issues found:**
- `EditorFunction` type has **no client-side description or JSON-schema metadata** (`EditorFunctions/index.js:429-450` — only `launchFunction`, `modifiesProject`, `getModifiesProject`). Tool descriptions/schemas are server-owned (`toolsVersion`), so BYOK must author its own OpenAI tool schemas in Phase 2 (`ByokToolSchema.js`).
- Tests default to a **node** Jest environment; DOM tests require a `@jest-environment jsdom` docblock, and `@testing-library` is not a dependency — component tests must use `react-test-renderer` or jsdom directly.
- This checkout uses **npm** (`package-lock.json` present in `newIDE/app`), while upstream CI references yarn — noted in styleguide so agents check `package.json` scripts.
- `aiConfigurationPresetId` (model/effort) is only sent at chat creation and lives in local component state (`AiRequestChat/index.js:318-321, 527-532`) — BYOK can do per-chat settings more naturally, noted in Phase 2.

**Files worked on:**
- Created: `REVIEW/styleguide.md`, `REVIEW/agents.md`, `REVIEW/worklog.md`, `REVIEW/Phase1.md`, `REVIEW/Phase2.md`, `REVIEW/Phase3.md`, `REVIEW/Phase4.md`.
- Read (verification): `newIDE/app/package.json`, `newIDE/app/src/MainFrame/Preferences/PreferencesContext.js`, `newIDE/app/src/MainFrame/Preferences/PreferencesDialog.js`, `newIDE/app/src/AiGeneration/AiRequestChat/index.js`, `newIDE/app/src/AiGeneration/AiRequestUtils.spec.js`, `newIDE/app/src/EditorFunctions/index.js`, `newIDE/app/src/Utils/RetryIfFailed.js`, `newIDE/app/src/Utils/UserSurveyStorage.js`, `newIDE/app/src/MainFrame/EditorContainers/HomePage/GetStartedSection/UserSurveyStorage.js`, `newIDE/electron-app/app/main.js`.

---

## 2026-09-13 — Repository mapping for BYOK feasibility (5 parallel read-only agents)

**Agent:** ZCode main orchestrator + 5 Explore subagents (AI pipeline; preferences/tabs; HTTP/Electron network; secrets/encryption; chat UI/i18n) — dispatched in a single wave of 5, within the rate-limit rule.

**Actions:**
- Mapped the GDevelop repository (focus: `newIDE/app` renderer, `newIDE/electron-app` main process) across five subsystems relevant to a BYOK feature.
- Established the critical architectural fact: GDevelop's "Ask AI" runs its agent loop **server-side** (`api.gdevelop.io/generation`); the client only posts the user request + serialized project, polls the transcript, executes "editor functions" locally, and posts tool outputs back. BYOK therefore requires a new client-side orchestrator that reuses the existing tool registry, chat UI, and OpenAI-shaped internal message types.
- Wrote up findings and the overall action plan.

**Bugs found:** none (read-only session; no repo code executed or modified).

**Issues found:**
- Windows shell: `ls` and `head` are not recognized in cmd — switched to `dir`/`findstr`/Read tool.
- No OpenAI/LLM client code exists anywhere in the repo; no LLM SDK in any package.json (greenfield — good for isolation).
- No streaming HTTP code exists (no SSE/`getReader`/`EventSource`); the existing feature is poll-based. Plan phased to start non-streaming.
- No secure storage primitives exist (no keytar, no `safeStorage` usage, no DPAPI); localStorage is plaintext throughout; Electron 32.3.3 supports `safeStorage` (DPAPI on Windows) — encryption must be built new in Phase 3.
- Desktop build runs with `webSecurity: false` (`main.js:174-187`) so renderer calls to arbitrary hosts work without CORS; the web build has no proxy, so BYOK on web is limited to CORS-friendly providers.
- AI presets/models are served from GDevelop's CDN (`ai-settings-v2.json`), plan-gated server-side — BYOK replaces this with `GET /v1/models` from the user's endpoint.

**Files worked on:**
- Created: `REVIEW/report.md`.
- Read (mapping, key files): `newIDE/app/src/AiGeneration/*` (AiRequestContext.js, AskAiEditorContainer.js, AiRequestUtils.js, Utils.js, PrepareAiUserContent.js, UseGenerateEvents.js, AskAiStandAloneForm.js, AiConfiguration.js, AiRequestChat/*), `newIDE/app/src/Utils/GDevelopServices/*` (Generation.js, ApiConfigs.js, Authentication.js, Usage.js), `newIDE/app/src/EditorFunctions/index.js`, `newIDE/app/src/MainFrame/index.js`, `newIDE/app/src/MainFrame/EditorTabs/EditorTabsHandler.js`, `newIDE/app/src/MainFrame/EditorTabsPane.js`, `newIDE/app/src/MainFrame/Preferences/*`, `newIDE/app/src/Profile/AuthenticatedUserProvider.js`, `newIDE/app/src/Providers.js`, `newIDE/app/src/Utils/*` (OptionalRequire.js, Window.js, BlobDownloader.js, LocalFileDownloader.js, DataValidator.js), `newIDE/app/src/locales/*` (structure), `newIDE/electron-app/app/main.js`, `newIDE/electron-app/app/LocalFileDownloader.js`, `newIDE/electron-app/package.json`, `newIDE/app/package.json`.

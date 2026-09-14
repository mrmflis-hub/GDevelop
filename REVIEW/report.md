# BYOK (Bring Your Own Key) — Repository Map & Action Plan

**Repo:** `D:\Projects\GDevelop` (GDevelop monorepo; the IDE lives in `newIDE\app` — React/CRA renderer — and `newIDE\electron-app` — Electron 32.3.3 main process).
**Scope of this document:** findings only, no code written yet. All paths relative to repo root unless absolute.
**Method:** 5 parallel read-only mapping agents (AI request pipeline · preferences/tabs · HTTP/Electron network · secrets/encryption · chat UI/i18n).

---

## 1. Executive summary

1. **GDevelop's "Ask AI" is *not* a client-side LLM call.** The renderer sends a plain-text user request plus a serialized simplified project to GDevelop's backend (`https://api.gdevelop.io/generation`), and **the entire agent loop runs server-side** — system prompts, tool schemas, model selection, retries, sub-agents, context-size stats. The client only polls the transcript and executes "editor functions" (tools) locally, posting results back.
   → **BYOK cannot "redirect" the existing traffic.** It requires a **new client-side orchestrator** that drives an OpenAI-compatible chat-completions loop itself. The good news: everything the loop needs already exists client-side (tool registry, transcript helpers, chat UI, message types), and the internal message schema is already shaped like OpenAI's (`function_call`, `function_call_output`, `reasoning`, `output_text`), so the mapping is nearly 1:1.
2. **Piggyback strategy:** the BYOK adapter should translate OpenAI ↔ GDevelop's internal `AiRequest` types and reuse the existing `AiRequestChat` UI untouched. Token usage, reasoning level, and chat-context indicators already have UI we can feed data into.
3. **Minimal-diff budget is achievable:** roughly **4 small edits to existing files** (2-line tab registration in `PreferencesDialog.js`, ~15 lines in `PreferencesContext.js` for the preference object, a small provider/branch seam in `AskAiEditorContainer.js`, and one `ipcMain.handle` block in the Electron `main.js`) + **one new folder of self-contained modules** for everything else.
4. **Encryption:** nothing secure exists today (no keytar, no safeStorage usage; localStorage is plaintext). Electron 32 fully supports `safeStorage` (DPAPI on Windows) — two small IPC handlers in the main process; web build falls back to obfuscated storage with a documented caveat.
5. **Model & context-window discovery:** `GET {baseUrl}/v1/models` is the standard pull. OpenAI itself does **not** return context-window sizes in that endpoint, but many OpenAI-compatible servers do (`context_length` / `max_model_len` / `max_context_length`). Plan: parse those fields when present, otherwise a user-set value, otherwise a safe default.
6. **Streaming:** zero streaming HTTP code exists in the repo today (the existing feature polls). **Phase the plan to start non-streaming** (chat-completions `usage` field then gives exact token counts for free); streaming is an optional later phase.

---

## 2. Critical finding — how the current AI pipeline works

This is the fact that shapes the whole plan.

```
Renderer (newIDE\app)                        GDevelop backend (api.gdevelop.io/generation)
─────────────────────                        ─────────────────────────────────────────────
createAiRequest(userRequest,                  → owns system prompt, tools, model, agent loop
  serialized project JSON, presetId)   POST       (runs LLM turns, decides next tool calls)
        └── poll getAiRequest()        GET    ← transcript items: output_text / reasoning /
        └── execute "editor functions"          function_call / function_call_output
             locally (EditorFunctions)
        └── post tool outputs back     POST    → server feeds results to LLM, next turn…
             (addMessageToAiRequest)
```

Key files:

| Concern | File | Lines |
|---|---|---|
| AI HTTP service (all endpoints) | `newIDE\app\src\Utils\GDevelopServices\Generation.js` | 315–388, 507–649, 655–687, 870–990, 1091–1128 |
| Base URL config | `newIDE\app\src\Utils\GDevelopServices\ApiConfigs.js` | 111–122 |
| Firebase bearer auth | `newIDE\app\src\Utils\GDevelopServices\Authentication.js` | 578–583 |
| Conversation state + polling/watch loop | `newIDE\app\src\AiGeneration\AiRequestContext.js` | 213–704, 1159–1303, 1368–1387 |
| Transcript helpers (pure, no HTTP) | `newIDE\app\src\AiGeneration\AiRequestUtils.js` | 103–163, 380–413 |
| Create-request / send-message flow | `newIDE\app\src\AiGeneration\AskAiEditorContainer.js` | 609–629 (create), 698–924 (onSendMessage) |
| Function-call processor (auto-executes tools) | `newIDE\app\src\AiGeneration\Utils.js` | 232–729 (`useProcessFunctionCalls`) |
| **Tool registry** (what the model can call) | `newIDE\app\src\EditorFunctions\index.js` | 9029–9083 |
| `AiRequest` / `AiRequestMessage` types (OpenAI-shaped) | `Generation.js` | 39–101, 121–168 |

**Implications for BYOK:**

- There is **no single choke point** to redirect; `createAiRequest` / `addMessageToAiRequest` / `getAiRequest` are a coordinated trio with the server owning the loop.
- The client already has: the **tool executor** (`EditorFunctions`, incl. `run_script` sandbox), **transcript walking helpers** (`AiRequestUtils.js`), **auto-edit-approval gating** (`doesFunctionCallModifyProject`), and the **full chat UI**.
- Some tools recursively call GDevelop's backend: `generate_events` (`UseGenerateEvents.js` → server-side event-generation job), `search_object_asset_store` / `search_resource_store` (GDevelop store APIs). BYOK must either keep these (they work when logged into a GDevelop account; the store searches are plain GDevelop API calls, not LLM calls) or hide them from the BYOK tool list. `generate_events` can be re-implemented as a nested BYOK chat-completion call, or hidden in v1.
- GDevelop's system prompts are **server-side and not in the repo** — the BYOK orchestrator needs its own prompt describing the tool set. Quality will depend on the model and that prompt.
- No OpenAI/LLM client code exists anywhere in the repo today (verified by case-insensitive sweep for `openai`, `chat/completions`, `/v1/models`, `anthropic` — only false positives like the `onOpenAiRequest` React prop). No LLM SDK in any `package.json`. BYOK client code is fully greenfield → easy to keep in new files.

---

## 3. Feature-by-feature design (mapped to requirements)

### 3.1 OpenAI-compliant connection
- **New module** `ByokClient.js`: base-URL + key + model in, requests out. Endpoints: `GET {base}/models`, `POST {base}/chat/completions`.
- **CORS:** desktop build runs with `webSecurity: false` (`newIDE\electron-app\app\main.js:174-187`), so direct renderer `fetch` with an `Authorization` header to any host already works. Web build has no proxy; it works only against endpoints sending CORS headers (OpenAI, OpenRouter, Groq, Ollama do; some self-hosted gateways don't). Note this limitation in the UI; no proxy infrastructure exists to reuse in the web build.

### 3.2 Pull available models from the address
- `GET {base}/models` on the BYOK tab ("Test / fetch models" button and on save); populate a `CompactSelectField` (the same dropdown component used throughout `PreferencesDialog.js`).
- Handle failures (bad URL, 401) with inline error text; allow free-text model entry as fallback (some gateways hide `/models`).

### 3.3 Key encryption
- Today: **nothing** — auth tokens are never persisted by app code (Firebase SDK manages its own IndexedDB session); all localStorage is plain JSON under `gd-`-prefixed keys (full inventory confirmed; no keytar/safeStorage/DPAPI anywhere).
- **Desktop:** Electron **32.3.3** → `safeStorage` available (DPAPI on Windows). Add `ipcMain.handle('byok-encrypt' | 'byok-decrypt')` next to existing handlers in `newIDE\electron-app\app\main.js` (handlers live at lines ~443–620; the `ipcMain.handle` + axios pattern precedent is `local-file-download` at main.js:583 ↔ `Utils\LocalFileDownloader.js:39`). Store the base64 ciphertext blob in localStorage under `gd-byok` (main window uses the default partition, so this is fine).
- **Web fallback:** obfuscated base64 in `gd-byok` localStorage with a visible "stored with light obfuscation only" caveat (matches existing conventions; no WebCrypto usage exists to build on).
- Both paths live in **one new file** `ByokKeyStorage.js` modeled on `Utils\UserSurveyStorage.js` (the codebase's canonical small typed localStorage module), using the established `optionalRequire('electron')` pattern (`Utils\OptionalRequire.js:14-39`) so the same file serves web and desktop.

### 3.4 AI settings: effort / thought level, context window
- **Effort:** OpenAI-compatible `reasoning_effort` (`low`/`medium`/`high`) — expose a selector on the BYOK tab *and* per-chat (next to the existing `ReasoningLevelSelector`, which is a pure-UI preset picker today). Because not every OpenAI-compatible server accepts the parameter, include a toggle "send reasoning_effort parameter" and auto-retry without it on 4xx — all logic in new BYOK files.
- **Context window:** `GET /models` on many OpenAI-compatible servers returns `context_length` (vLLM, LM Studio: `max_context_length`) or `max_model_len`. Parse those fields when present; otherwise the user sets it per model on the BYOK tab; default 8192 with a "verify" hint. Stored in the BYOK preference object as a per-model map.
- The existing chat picks model/preset **only at chat creation** (`AskAiEditorContainer.js:609-629`); follow-ups can't change it — BYOK can do better cheaply (store per-chat in its own state).

### 3.5 Token-window usage in the active chat
- Chat-completions responses return exact `usage: { prompt_tokens, completion_tokens, total_tokens }` (non-streaming; in streaming it needs `stream_options: {include_usage}` — another reason to phase streaming later).
- Running context usage = last `prompt_tokens` + last `completion_tokens`. Ratio = usage / context window.
- **Piggyback:** the existing `AiUsageIndicator` ("Chat context" bar with ≥80% warning / ≥100% error, `AiRequestChat\AiUsageIndicator.js:186-221`) is driven purely by a `contextUsedRatio` prop fed from `aiRequest.contextStats.usedPercentage` (`AiRequestChat\index.js:500-524`; type at `Generation.js:121-131`). If the BYOK orchestrator populates `contextStats` on its local `AiRequest` objects, **the existing usage UI works unchanged**. Raw `totalTokens` is already typed and simply never consumed today. Credits/quota sections are props — pass null and they degrade gracefully (verify during implementation).
- Exact token counts (prompt/completion/context) can additionally be shown in a small new `ByokUsageRow.js` if desired — new file, zero risk.

### 3.6 "BYOK" menu tab
Two options were mapped; **Option A recommended** (smallest diff):

- **Option A — tab inside the Preferences dialog** (`newIDE\app\src\MainFrame\Preferences\PreferencesDialog.js`):
  - Add `{ value: 'byok', label: <Trans>BYOK</Trans> }` to the `Tabs options` array (lines 111–124) and one conditional render block beside the others (pattern at lines 127, 697–718).
  - Existing tabs are exactly `preferences`, `shortcuts`, `folders` (desktop-only) — BYOK fits the pattern; desktop gating is available via the `electron` truthiness convention (`optionalRequire`) if the tab should be desktop-only because of encryption.
  - Cost: **2 small edits in 1 file + 1 new component file.** No persistence work (see 3.7).
- **Option B — top-level editor tab like "Ask AI"** (`'ask-ai'` precedent): requires the `EditorKind` union (`EditorTabsHandler.js:36-48`), the `editorKindToRenderer` map (`MainFrame\index.js:305-320`), label/icon branches (`index.js:814-900`), plus special-casing in `EditorTabsPane.js` (lines 472, 574, 737 where `'ask-ai'` is hard-coded) and open-tab persistence. Moderate diff, more update-conflict surface. Not recommended.

### 3.7 Where BYOK settings live (preference storage)
- One shared pattern: `PreferencesContext.js` (Flow type + defaults) + `PreferencesProvider.js` (single localStorage key `gd-preferences`, line 47).
- **New BYOK preference object** (e.g. `{ enabled, endpointUrl, encryptedKey, model, modelsCache, reasoningEffort, sendReasoningEffort, contextWindowByModel }`):
  - add to `PreferencesValues` type (after line ~260, next to the existing AI prefs cluster at 254–256) and to `initialPreferences` (after line ~462);
  - **no `PreferencesProvider.js` edit strictly required**: `loadPreferencesFromLocalStorage` auto-fills missing keys from defaults (lines 56–67), and the generic `setMultipleValues` setter (lines 448–458) writes the whole BYOK object. (Adding one dedicated setter is optional and cheap.)
- Consumption: `React.useContext(PreferencesContext)` — precedent directly relevant: `AskAiEditorContainer.js:497-499` already consumes `automaticallyUseCreditsForAiRequests` from it.

### 3.8 i18n
- Lingui: write `<Trans>` / `t` in new components; **English source strings are the msgids and missing translations fall back to source automatically**, so *no locale-file edits are needed to ship*. Catalog extraction/compile (`scripts\extract-all-translations.js`, `scripts\compile-translations.js`, Crowdin) is a release-time step, not a code step. Locale catalogs are one big compiled file per language (`src\locales\<lang>\messages.js`); AI strings are scattered, not grouped — nothing to merge-conflict.

---

## 4. Proposed new-file layout (all BYOK code in its own folder)

Everything new goes under `newIDE\app\src\AiGeneration\Byok\` (+ one main-process file). No logic added to existing modules.

```
newIDE\app\src\AiGeneration\Byok\
  ByokTypes.js              — flow types: settings object, OpenAI request/response, mapping types
  ByokKeyStorage.js         — encrypted key storage (Electron safeStorage IPC; web obfuscated fallback)
  ByokClient.js             — OpenAI-compatible HTTP: GET /models, POST /chat/completions; error normalization
  ByokModelsCache.js        — models fetch + context-window field parsing (context_length/max_model_len/…)
  ByokToolsSchema.js        — maps the EditorFunctions tool registry → OpenAI `tools` JSON schema;
                              visibility filter (hide generate_events etc. in v1)
  ByokOrchestrator.js       — THE client-side agent loop: messages + tools → execute tool calls via
                              existing EditorFunctions runner → feed outputs back → until final answer.
                              Emits/consumes GDevelop AiRequest-shaped transcript items so the
                              existing chat UI renders BYOK conversations unchanged.
  ByokUsageTracker.js       — token accounting from `usage` fields → contextStats {totalTokens, usedPercentage}
  ByokSettingsTab.js        — the "BYOK" tab UI (endpoint, key, test button, model dropdown,
                              effort selector, context-window table, enable toggle)
  ByokUsageRow.js           — optional exact token readout row for the chat (prompt/completion/context)
newIDE\electron-app\app\
  (edit) main.js            — +~30 lines: ipcMain.handle('byok-encrypt'|'byok-decrypt') using safeStorage
```

Reuse from existing code (imports only, no edits): `EditorFunctions` runner (`EditorFunctions\EditorFunctionCallRunner.js`), `AiRequestUtils.js` transcript helpers, `AiRequest`/`AiRequestMessage` types from `Generation.js`, `AiUsageIndicator` props contract, `UI\TextField` (`type="password"` with built-in visibility toggle, `UI\TextField.js:27,284-289`), `UI\CompactSelectField`, `optionalRequire`, `RetryIfFailed`.

---

## 5. Exact touchpoints in existing files (the whole "diff budget")

| # | File | Change | Size |
|---|---|---|---|
| 1 | `newIDE\app\src\MainFrame\Preferences\PreferencesDialog.js` | add BYOK tab option (lines 111–124) + conditional render of `<ByokSettingsTab />` (beside lines 697–718) | ~3 lines |
| 2 | `newIDE\app\src\MainFrame\Preferences\PreferencesContext.js` | add `byok` object to `PreferencesValues` (~line 260) + default in `initialPreferences` (~line 462) | ~15 lines |
| 3 | `newIDE\app\src\AiGeneration\AskAiEditorContainer.js` | BYOK seam: when BYOK enabled+configured, create chats through `ByokOrchestrator` instead of `createAiRequest`, and route `onSendMessage` tool outputs into the local loop instead of `addMessageToAiRequest`. Keep it a single conditional at the two entry points (lines 609–629, 698–924) delegating to new modules | ~20–40 lines |
| 4 | `newIDE\electron-app\app\main.js` | two `ipcMain.handle` handlers for encrypt/decrypt (beside lines 443–620) | ~30 lines |
| 5 (opt) | `newIDE\app\src\AiGeneration\AiRequestChat\index.js` | only if passing BYOK props through proves necessary (e.g. a byok badge / per-chat effort selector next to `ReasoningLevelSelector` at lines 915–935) | 0–20 lines |
| — | `PreferencesProvider.js`, `AiRequestContext.js`, `Generation.js`, `AiUsageIndicator.js`, locale files | **no changes** | 0 |

**Integration decision to settle first (during implementation spike):** how BYOK chats get their `AiRequest` state. Two viable low-diff shapes:
- **(A) Parallel provider:** a `ByokAiRequestProvider` supplying the same context shape `AiRequestChat/index.js` consumes, chosen at the `AskAiEditorContainer` seam. Zero edits inside `AiRequestChat`/`AiRequestContext`, but requires matching the context interface exactly.
- **(B) Local records in the existing store:** BYOK chats are normal `AiRequest` objects with synthetic ids (e.g. `byok-<uuid>`) held in a local record; the few `AiRequestContext` functions that hit the network skip/guard `byok-` ids. Fewer moving parts, but adds small guards inside `AiRequestContext.js`.
Decide by reading how `AiRequestChat/index.js` obtains `aiRequest` + send callbacks (imports at ~lines 257–264, 500–524, 634–638); the agent evidence supports either.

Also note the **second mount point**: `AskAiStandAloneForm.js` (homepage/new-project AI form, renders `AiRequestChat` directly at ~line 667) — **de-scope for v1** (BYOK only in the editor Ask AI tab) to keep the diff minimal.

---

## 6. Phased action plan

**Phase 0 — implementation spike (½ day):** read `AiRequestChat/index.js` consumption of `AiRequestContext` and settle integration shape (A) vs (B) above; confirm `AiUsageIndicator` renders correctly with `quota/price/availableCredits = null`.

**Phase 1 — storage & settings UI (no AI behavior yet):**
1. `ByokTypes.js` + BYOK preference object in `PreferencesContext.js`.
2. `ipcMain.handle` encrypt/decrypt in electron `main.js` (guard `safeStorage.isEncryptionAvailable()`).
3. `ByokKeyStorage.js` (desktop + web fallback).
4. `ByokSettingsTab.js` + 3-line registration in `PreferencesDialog.js`: endpoint URL, key (masked), "Fetch models" button (`GET /models` with inline errors), model dropdown, effort selector + "send reasoning_effort" toggle, context-window per model (auto-detected where the server reports it, editable otherwise, default 8192), "Use BYOK for Ask AI" master toggle.

**Phase 2 — BYOK client & chat loop:**
5. `ByokClient.js`: non-streaming `chat/completions` with `tools`; 401/404/429/4xx error normalization (auto-retry once without `reasoning_effort` on 4xx).
6. `ByokToolsSchema.js`: registry → OpenAI tools schema; v1 filter list (hide `generate_events`, keep or hide store-search tools based on login state).
7. `ByokOrchestrator.js`: system prompt (new, must describe the tool set — GDevelop's prompts are server-side), tool-call loop driving the existing `EditorFunctions` runner, honoring the existing auto-edit-approval gating, populating `AiRequest`-shaped transcript (`output_text`, `function_call`, `function_call_output`) + `contextStats`.
8. Wire the seam in `AskAiEditorContainer.js` (Phase 0 decision).

**Phase 3 — usage display & polish:**
9. `ByokUsageTracker.js` → feed `contextStats.usedPercentage` so the existing "Chat context" bar just works; optional `ByokUsageRow.js` for exact token counts.
10. BYOK badge on chats; error rows reuse `AiRequestErrorRow` where the error codes align, else BYOK-specific row in new files.

**Phase 4 (optional, later):** token streaming (`getReader()` on `response.body` + `stream_options.include_usage` — net-new capability, zero existing code to conflict with); replace `generate_events` with a nested BYOK call; editor-tab or menu-item entry points; per-chat persisted history in localStorage (`gd-byok-chats`, size-capped; v1 can be session-only).

**Out of scope by design (don't touch):** GDevelop credits/plan gating (bypassed for BYOK chats), `AskAiStandAloneForm`, fork/suggestions/retry-server endpoints, sub-agent mechanism (the BYOK loop can simply run everything in one conversation).

---

## 7. Risks & caveats

1. **Biggest risk — prompt quality.** GDevelop's system prompts/tools-versioning (`AI_ORCHESTRATOR_TOOLS_VERSION = 'v15'`) live server-side. BYOK results depend on a hand-written client-side prompt and the user's model. Expect an iteration loop on the prompt; keep it in `ByokOrchestrator.js`/a `ByokPrompts.js` so it's isolated.
2. **Update-conflict surface.** The only files likely to conflict with upstream updates are `AskAiEditorContainer.js` (heavily developed) and optionally `AiRequestChat/index.js`. Keeping the seam to thin conditionals that delegate to new modules minimizes merge pain; everything else is new files.
3. **Context-window accuracy.** `/models` rarely reports context size on vanilla OpenAI; the manual per-model setting is the reliable path. Mis-set windows → silent truncation; mitigate with the existing ≥80%/≥100% color states and a conservative default.
4. **Tool-call reliability varies by model/provider.** The existing code already handles pathological cases (e.g. `repeated-tool-call-loop`); replicate equivalents locally in the orchestrator (max-iterations cap).
5. **Web-build CORS.** Works only with CORS-friendly providers; state it in the BYOK tab. Desktop (the primary target on this Windows machine) is unaffected thanks to `webSecurity: false`.
6. **Key security ceiling.** Desktop: solid (DPAPI via safeStorage). Web: obfuscation only — say so in the UI. Never log the key; strip it from error objects in `ByokClient.js`.
7. **Multi-window note:** secondary windows use separate `persist:` partitions (`main.js:195-198`) and would not share localStorage — BYOK UI lives in the main window, so this is fine; storing ciphertext in `userData` via the main process is the fallback if that ever changes.

---

## 8. Evidence index (from mapping agents)

- AI pipeline: `Generation.js` (service), `AiRequestContext.js` (state/polling), `AiRequestUtils.js` (transcript helpers), `AskAiEditorContainer.js:609-924` (create/send), `Utils.js:232-729` (tool processor), `EditorFunctions\index.js:9029-9083` (tool registry), `AiConfiguration.js:15-68` (preset availability), `AiRequestChat\index.js:265,318-321,500-524` (chat wiring).
- Preferences/tabs: `PreferencesDialog.js:111-127,697-718`, `PreferencesContext.js:196-463`, `PreferencesProvider.js:47,56-67,448-458,972-983`, `EditorTabsHandler.js:36-48`, `MainFrame\index.js:305-320,814-900,1104-1179`, `EditorTabsPane.js:472,574,737`.
- Network/Electron: `ApiConfigs.js:44-145`, `Authentication.js:578-583`, `Utils\LocalFileDownloader.js:5-70` (IPC+axios template), `electron-app\app\main.js:174-206,443-620` (webPreferences, ipc handlers), CORS workarounds `Utils\BlobDownloader.js:42-64`; no streaming/SSE code anywhere.
- Secrets: no keytar/safeStorage/DPAPI today; Firebase session via SDK-managed IndexedDB (`Authentication.js:133-159`); localStorage inventory `PreferencesProvider.js:47`, `UserSurveyStorage.js` (template), `UserUUID.js`, `LocalStats.js`; Electron 32.3.3 (`electron-app\package.json:26`); `optionalRequire` pattern (`Utils\OptionalRequire.js:14-39`).
- UI/i18n: `AiUsageIndicator.js:112-260` (props-driven; "Chat context" bar 186–221), `ReasoningLevelSelector.js:101-232`, `AiConfigurationPresetSelector.js:18-97`, `Generation.js:121-131` (`contextStats` type; `totalTokens` unused), Lingui pipeline (`GDI18nProvider.js:42-65`, `locales\en\README.md` — English is source language, missing keys fall back to source).

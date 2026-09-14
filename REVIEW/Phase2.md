# Phase 2 — BYOK Backend Engine

**Status:** planned · **Depends on:** Phase 1 (all ACs green) ·
**Read first:** [report.md](report.md) sections 2–3, [styleguide.md](styleguide.md), [agents.md](agents.md)

---

## 1. Introduction — what this phase delivers

Phase 2 builds the **headless engine** that later phases drive: everything
needed to talk to an OpenAI-compatible server, with no wiring into the Ask AI
chat yet (that is Phase 4). Concretely:

1. **Client connection** — `ByokClient.js`: authenticated HTTP calls to
   `GET {baseUrl}/models` and `POST {baseUrl}/chat/completions` (non-streaming),
   with timeouts and typed errors.
2. **Retries** — automatic retry with backoff for transient failures, and an
   automatic "degradation" retry that drops the `reasoning_effort` parameter
   when a server rejects it.
3. **Key storage, real version** — the Phase 1 plaintext implementation is
   replaced by obfuscated storage for the web build (the Electron
   `safeStorage` upgrade is Phase 3). The interface from Phase 1 does not
   change.
4. **Model discovery + context window** — `ByokModelsCache.js`: pulls the model
   list from the server, parses context-window sizes when the server reports
   them (many OpenAI-compatible servers do; OpenAI itself does not), and falls
   back to the user's manual setting.
5. **Usage tracking** — `ByokUsageTracker.js`: converts each response's
   `usage` field into the same `contextStats` shape GDevelop's chat UI already
   displays, so the existing "Chat context" bar works for BYOK chats without
   modifying it.
6. **Tool orchestration mechanics** — `ByokToolSchema.js` (whitelisted tools
   described as OpenAI function schemas) and `ByokTranscript.js` (translation
   between OpenAI messages/tool-calls and GDevelop's internal
   `AiRequestMessage` transcript items). The **runtime loop** that executes
   these tools against a project is Phase 4.
7. **Settings tab upgrades** (our own file, zero existing-code risk): models
   dropdown fed by the cache, a "Test connection" button, per-model context
   window.

### Existing files that play a role (imported — never modified in this phase)

| File | Role |
|---|---|
| `newIDE\app\src\Utils\GDevelopServices\Generation.js` | Source of the internal types we translate to/from: `AiRequest`, `AiRequestMessage`, `AiRequestContextStats` (lines ~39–168). **Types imported only.** |
| `newIDE\app\src\EditorFunctions\index.js` | The tool registry `editorFunctions` (lines ~9029–9076). Imported by `ByokToolSchema.js` to validate the whitelist. **Never modified.** |
| `newIDE\app\src\Utils\RetryIfFailed.js` | Existing `retryIfFailed({ times, backoff }, fn)` helper with exponential backoff — reused instead of writing our own. |
| `newIDE\app\src\AiGeneration\AiRequestChat\AiUsageIndicator.js` | Read-only reference: proves `contextUsedRatio` / `contextStats` is all the usage UI needs. |
| `newIDE\app\src\AiGeneration\Byok\ByokKeyStorage.js`, `ByokSettingsTab.js` | Created in Phase 1; **internals upgraded** here. |
| `newIDE\app\src\Utils\GDevelopServices\ApiConfigs.js` | Style reference for how services declare clients (axios usage in `Generation.js`). |

### New tech stack?

- **None to install.** axios is already the repo's HTTP library; Jest is the
  test runner. No new npm dependencies (styleguide section 4).
- **One external contract to learn:** the OpenAI chat-completions API —
  `POST {base}/chat/completions` with `{ model, messages, tools?, tool_choice?,
  reasoning_effort? }`, responding with
  `{ choices: [{ message: { content, tool_calls? }, finish_reason }], usage: { prompt_tokens, completion_tokens, total_tokens } }`,
  and `GET {base}/models` responding `{ data: [{ id, ... }] }`. Write these
  shapes as Flow types in `ByokTypes.js` — treat the API as an interface, not
  as "whatever the server returns".

### ⚠️ One honest constraint to know before starting

GDevelop's **tool descriptions and argument JSON-schemas are not in the client
code** — the `EditorFunction` type (see
`EditorFunctions\index.js:429-450`) only carries `launchFunction`,
`modifiesProject`, and `getModifiesProject`; the prompts and schemas live on
GDevelop's servers (versioned as `toolsVersion`). Therefore `ByokToolSchema.js`
must **author BYOK-owned schemas** for the tools we expose. This is a feature
of the design (our schemas can never be broken by upstream changes) and a
responsibility (they must describe the arguments the `launchFunction`
implementations actually read — verify each one against its
`SafeExtractor.extract…` calls before writing its schema).

### New files created in this phase

```
Byok\ByokErrors.js / .spec.js           error kinds + normalization
Byok\ByokClient.js / .spec.js           HTTP: models + chat completions + retries
Byok\ByokModelsCache.js / .spec.js      model list + context-window parsing
Byok\ByokToolSchema.js / .spec.js       tool whitelist → OpenAI function schemas
Byok\ByokUsageTracker.js / .spec.js     usage → contextStats
Byok\ByokTranscript.js / .spec.js       OpenAI ↔ internal transcript mapping
```

Modified: `Byok\ByokKeyStorage.js` (+ spec), `Byok\ByokSettingsTab.js` (+ spec),
`Byok\ByokTypes.js` (+ spec) — **all Phase 1 files of ours; no upstream file is
touched in this phase.**

---

## 2. Steps

### Step 2.1 — Error model (`ByokErrors.js`)

**Goal:** every failure the server/network can produce becomes one typed,
user-presentable error — used by the client, the settings tab, and later the
chat error row.

**How to implement:**

1. Create `Byok\ByokErrors.js` (`// @flow`).
2. Define the kind union:
   ```js
   export type ByokErrorKind =
     | 'authentication'   // 401 / invalid key
     | 'forbidden'        // 403
     | 'not-found'        // 404 — wrong base URL is the usual cause
     | 'rate-limit'       // 429
     | 'invalid-request'  // 400 — e.g. unknown parameter
     | 'server'           // 5xx
     | 'network'          // request never got a response
     | 'timeout'
     | 'unknown';
   ```
3. Define `export type ByokError = {| kind: ByokErrorKind, message: string, status: ?number |}`.
4. Implement `classifyByokError = (error: any): ByokError`:
   - Early-return guard clauses per case (no nested ifs): axios error with
     `response.status` → map status to kind; axios error with `request` but no
     response → `network` (or `timeout` when `error.code === 'ECONNABORTED'`);
     otherwise `unknown`.
   - Extract a readable message from the OpenAI error body when present
     (`error.response.data.error.message`); fall back to a generic
     human sentence per kind ("Your key was rejected by the endpoint (401)…").
5. Implement `isRetryableByokError = (error: ByokError): boolean` — true only
   for `rate-limit`, `server`, `network`, `timeout`.
6. Implement `describeInvalidRequestForReasoningEffort = (error: ByokError): boolean`
   — true when kind is `invalid-request` AND the message mentions
   `reasoning_effort` (case-insensitive). This drives the degradation retry in
   2.3.

**Files created:** `Byok\ByokErrors.js`, `Byok\ByokErrors.spec.js`
**Files modified:** none
**Tests:** one per kind with synthetic axios-shaped errors; message extraction
from OpenAI-style bodies (`{ error: { message: '…' } }`); retryable predicate
truth table; the reasoning-effort detector (matching, non-matching, mixed case).
**Depends on:** nothing.

---

### Step 2.2 — HTTP client (`ByokClient.js`)

**Goal:** the two API calls, fully typed, key never logged.

**How to implement:**

1. Create `Byok\ByokClient.js` (`// @flow`). Import axios and the types from
   `ByokTypes.js`.
2. Extend `ByokTypes.js` with the API contract types (exact objects):
   `ByokModelInfo {| id: string, contextWindowTokens: ?number |}`,
   `ByokChatMessage` (role/content/tool_calls union), `ByokChatCompletionResponse`,
   `ByokUsage {| promptTokens: number, completionTokens: number, totalTokens: number |}`,
   and the request-options type
   `{| model: string, messages: Array<ByokChatMessage>, tools?: Array<Object>, reasoningEffort?: 'low'|'medium'|'high', timeoutMs?: number |}`.
3. Implement `buildEndpointUrl = (baseUrl: string, path: string): string` —
   trims trailing `/` from the base, prepends nothing else (the user's base URL
   already includes `/v1` if their provider uses it — document this in a comment
   and in the settings tab helper text).
4. Implement `fetchByokModels = async ({ baseUrl, apiKey }): Promise<Array<ByokModelInfo>>`:
   - axios `GET` on `/models`, header `Authorization: Bearer <key>`, 15s timeout.
   - Validate with early-returns: non-array `data` → throw a `ByokError`
     (`unknown`, message "The endpoint did not return a model list — check the
     base URL").
   - Map each entry to `ByokModelInfo` (keep only `id` for now; context-window
     parsing is step 2.5 and lands in `ByokModelsCache`, keeping this function
     dumb on purpose).
5. Implement `sendByokChatCompletion = async ({ baseUrl, apiKey, options }): Promise<ByokChatCompletionResponse>`:
   - axios `POST` on `/chat/completions`, same header, `timeoutMs` (default
     120s — tool-heavy turns are slow).
   - Include `reasoning_effort` in the body **only** when `options.reasoningEffort`
     is set and is not `'default'` (guard clause).
   - Validate the response shape (has `choices` array with at least one item)
     before returning; otherwise throw classified `unknown` error.
   - Wrap every axios catch with `throw classifyByokError(error)`.
6. Hygiene: never include `apiKey` in any thrown message or `console` call. Add
   a one-line comment stating this constraint where the header is built.

**Files created:** `Byok\ByokClient.js`, `Byok\ByokClient.spec.js`
**Files modified:** `Byok\ByokTypes.js` (new contract types + tests)
**Tests:** mock axios with `jest.mock('axios')` —
correct URL and headers; `reasoning_effort` present/absent per option; shape
validation throws classified errors; axios 401/429/timeout become the right
`ByokErrorKind`; the key never appears in error messages (assert on
`error.message`).
**Depends on:** Step 2.1 (and Phase 1's `ByokTypes.js`).

---

### Step 2.3 — Retries and reasoning-effort degradation

**Goal:** transient failures retry themselves; an unsupported
`reasoning_effort` parameter disappears instead of failing the chat.

**How to implement:**

1. In `ByokClient.js`, add a wrapper
   `sendByokChatCompletionWithRetries = async (connection, options): Promise<ByokChatCompletionResponse>`:
   - First attempt: `sendByokChatCompletion` as-is.
   - Catch a `ByokError`:
     - If `describeInvalidRequestForReasoningEffort(error)` AND
       `options.reasoningEffort` was set → retry **once** with
       `reasoningEffort` stripped (early returns, no nesting).
     - Else if `isRetryableByokError(error)` → retry via the existing
       `retryIfFailed({ times: 2, backoff: { initialDelay: 800, factor: 2 } }, …)`
       helper from `Utils\RetryIfFailed.js` (total 2 additional attempts).
     - Else rethrow.
   - Keep the two behaviors mutually exclusive and plainly ordered — long
     readable code per the styleguide.
2. Export only the wrapper to future consumers (chat loop, test-connection
   button) — keep the raw function exported too for tests.

**Files created:** none
**Files modified:** `Byok\ByokClient.js`, `Byok\ByokClient.spec.js`
**Tests:** 500 → retried then succeeds; 500 twice → fails after retries with
the original error; 401 → no retry; 400 mentioning `reasoning_effort` → second
attempt has no `reasoning_effort` in the body and succeeds; 400 about something
else → no retry.
**Depends on:** Steps 2.1, 2.2.

---

### Step 2.4 — Key storage: replace plaintext with web-safe obfuscation

**Goal:** the key at rest is not human-readable; the interface and UI do not
change.

**How to implement:**

1. Open `Byok\ByokKeyStorage.js`. Keep every export signature identical
   (this is the payoff of the Phase 1 interface).
2. Replace the plaintext body with obfuscation: `base64(xor(key, pepper))`
   where `pepper` is a module constant byte array (clearly commented:
   *obfuscation, not encryption — a determined reader of localStorage can
   recover the key; real encryption arrives on desktop in Phase 3*). Implement
   `obfuscate` / `deobfuscate` as two small exported-for-test helpers using
   plain loops with early returns; no cleverness.
3. `isByokKeyEncryptionAvailable` still returns `false` (Phase 3 changes it).
4. `getByokKeyStorageInfo` now reports `{| encrypted: false, obfuscated: true |}` —
   update the type in this file and the settings-tab status text accordingly
   (step 2.9 renders it).
5. Keep the object wrapper in localStorage (`{ version: 2, value: <obfuscated> }`)
   so future format changes are a versioned migration, and **keep a load path
   for version 1** (plaintext) that migrates on read — one early-return branch,
   clearly commented.

**Files created:** none
**Files modified:** `Byok\ByokKeyStorage.js`, `Byok\ByokKeyStorage.spec.js`
**Tests:** roundtrip survives obfuscate→deobfuscate; stored value is not the
plaintext key (assert `localStorage.getItem` does not contain the key); a v1
plaintext entry is loaded and re-saved as v2; corrupted entries return `null`
(still); `obfuscate` is deterministic (same input → same output).
**Depends on:** Phase 1 Step 1.3.

---

### Step 2.5 — Model discovery and context-window parsing (`ByokModelsCache.js`)

**Goal:** the dropdown gets real models; the context window is auto-filled when
the server tells us, manual otherwise.

**How to implement:**

1. Create `Byok\ByokModelsCache.js`.
2. Implement
   `extractContextWindowTokens = (modelEntry: Object): ?number` — check, in
   order, the fields different servers actually use:
   `context_length` (vLLM, some gateways), `max_context_length` (LM Studio),
   `max_model_len`, `context_size`, then any nested `metadata.context_length`.
   Return the first positive number, else `null`. One early return per field —
   flat and readable, with a comment naming which servers use which field.
3. Implement
   `normalizeByokModels = (rawModels: Array<Object>): Array<ByokModelInfo>` —
   map entries to `{ id, contextWindowTokens }`, drop entries without an `id`,
   sort by `id` ascending.
4. Implement a small in-memory cache:
   `cacheByokModels(baseUrl, models)` / `getCachedByokModels(baseUrl)` (module-
   level `Map`, the only mutable module state — comment why it's safe), plus
   `refreshByokModels(connection)` that calls `fetchByokModels`, normalizes,
   caches, and returns.
5. Implement the fallback chain
   `resolveContextWindowTokens = (settings, modelInfo, modelId): number` —
   model-reported → user-set `contextWindowTokens` from `ByokSettings` →
   `DEFAULT_BYOK_SETTINGS.contextWindowTokens`. Guard clauses.

**Files created:** `Byok\ByokModelsCache.js`, `Byok\ByokModelsCache.spec.js`
**Files modified:** none
**Tests:** fixtures for an OpenAI-style response (no context fields → `null`),
a vLLM-style response (`max_model_len`), an LM Studio-style response
(`max_context_length`); normalize drops id-less entries and sorts; the resolve
chain honors each fallback level.
**Depends on:** Step 2.2.

---

### Step 2.6 — Tool schemas (`ByokToolSchema.js`)

**Goal:** a BYOK-owned whitelist of editor tools, each described as an OpenAI
function schema — because GDevelop's own schemas are server-side only (see the
warning in the introduction).

**How to implement:**

1. Create `Byok\ByokToolSchema.js`. Define:
   ```js
   export type ByokToolSchema = {|
     name: string,
     description: string,
     parameters: {| type: 'object', properties: Object, required: Array<string> |},
   |};
   ```
2. Define the Phase 2 whitelist constant
   `BYOK_V1_TOOL_NAMES: Array<string>` — start conservative with the read/inspect
   tools plus the simplest write tools (verify each against
   `EditorFunctions\index.js:9029-9076` before listing it; Phase 4 grows this
   list after the loop works):
   `describe_instances`, `inspect_variables`, `read_scene_events`,
   `read_game_project_json`, `read_full_docs`, `search_docs`,
   `create_scene`, `create_or_replace_object`, `add_behavior`,
   `change_behavior_property`, `add_or_edit_variable`, `put_2d_instances`,
   `add_scene_events`, `create_or_update_plan`.
   Deliberately **excluded** for now: `run_script`, `run_edit_agent`,
   `run_explorer_agent`, `generate_events`, the store-search tools, and the
   gameplay-test tools (Phase 4 decisions — document this in a comment).
3. For **each** whitelisted tool: open its implementation in
   `EditorFunctions\index.js` (search the function name, read which
   `SafeExtractor.extract…` / argument properties `launchFunction` reads) and
   write its schema accordingly — real descriptions, real required fields.
   Do this one tool at a time; if an argument is unclear, leave it out of
   `required` and note it in the worklog.
4. Implement `getByokToolSchemas = (): Array<ByokToolSchema>` returning the
   constant, and `toOpenAiToolsFormat = (schemas) => Array<Object>` producing
   `{ type: 'function', function: { name, description, parameters } }`.
5. Implement `validateByokToolSchemas = (): Array<string>` returning a list of
   problems: a whitelisted name missing from the `editorFunctions` registry
   (import it), a schema with no description, a property type that is not one
   of the six JSON-schema primitives we use. The test suite fails on a non-empty
   list — this is the guard that keeps our whitelist and GDevelop's registry in
   sync across upstream updates.

**Files created:** `Byok\ByokToolSchema.js`, `Byok\ByokToolSchema.spec.js`
**Files modified:** none
**Tests:** `validateByokToolSchemas()` returns `[]` (the sync guard); every
schema has name/description/parameters; `toOpenAiToolsFormat` output shape;
one schema spot-check (e.g. `create_scene` requires exactly the properties its
implementation extracts).
**Depends on:** nothing (parallelizable with 2.2–2.5).

---

### Step 2.7 — Usage tracking (`ByokUsageTracker.js`)

**Goal:** exact token counts per turn, expressed in the type the existing chat
UI already consumes (`AiRequestContextStats`, `Generation.js:121-131`).

**How to implement:**

1. Create `Byok\ByokUsageTracker.js`. Import the `AiRequestContextStats` type
   from `Generation.js` (type-only import).
2. Implement
   `usageFromResponse = (response: ByokChatCompletionResponse): ?ByokUsage` —
   map `usage.prompt_tokens` etc.; return `null` with an early return when the
   server omitted `usage` (some proxies do).
3. Implement
   `contextStatsFromUsage = (usage: ByokUsage, contextWindowTokens: number): AiRequestContextStats`:
   - The next prompt will re-send the whole history, so "context used now" is
     `promptTokens + completionTokens` of the latest call. Comment this
     reasoning — it is the one non-obvious line in the module.
   - `usedPercentage` = that sum / contextWindowTokens, clamped to `[0, 1]`
     (a model can exceed its nominal window before erroring).
   - `totalTokens` = `usage.totalTokens`.
4. Implement a per-chat accumulator class/factory
   `createByokUsageTracker()` with `recordTurn(usage)` and
   `getTotals(): {| promptTokens, completionTokens, totalTokens, turns |}` for
   the optional exact-token row later. Plain object with closure state —
   match the repo's function-first style.

**Files created:** `Byok\ByokUsageTracker.js`, `Byok\ByokUsageTracker.spec.js`
**Files modified:** none
**Tests:** mapping of a full usage object; `null` on missing usage; ratio
math `{promptTokens: 100, completionTokens: 50}` with window 8192 →
`usedPercentage ≈ 0.0183` and `totalTokens: 150`; clamping above the window;
accumulator across three turns.
**Depends on:** Step 2.2 (response type).

---

### Step 2.8 — Transcript translation (`ByokTranscript.js`)

**Goal:** OpenAI ↔ GDevelop message mapping, so BYOK conversations can be
rendered by the existing chat UI and manipulated by the existing helpers
(`AiRequestUtils.js`) with zero UI changes.

**How to implement:**

1. Create `Byok\ByokTranscript.js`. Import the internal types from
   `Generation.js` (`AiRequestMessage`, `AiRequest`, …) — **types only**.
2. Re-read `Generation.js:39-101` first: assistant messages are
   `{ type: 'message', role: 'assistant', status, content: [...] }` where
   content items are `output_text` ({ text }), `reasoning`, or `function_call`
   ({ name, arguments, call_id }); user requests are `{ user_request: … }`;
   tool results are standalone `{ type: 'function_call_output', call_id, output }`
   messages. Our mapping targets exactly these shapes.
3. Implement:
   - `byokResponseToAssistantMessage = (response) => AiRequestMessage` — one
     assistant message whose content array holds an `output_text` item for the
     text (early-return skip when empty) and one `function_call` item per
     `tool_calls[]` entry (`name`, `arguments` string, `call_id` from `id`).
   - `byokToolResultToFunctionCallOutput = (callId, resultJsonString) => AiRequestMessage`.
   - `userRequestToByokMessage = (text, options?) => ByokChatMessage` (role
     `user`) and `assistantMessageToByokMessage = (aiRequestMessage) => ByokChatMessage`
     for rebuilding the request body each turn (tool results become role `tool`
     messages with `tool_call_id`).
   - `createByokAiRequestShell = (id, contextStats?) => AiRequest` — a minimal
     internal-shape object (status `working`, empty `output`) used by Phase 4's
     store; mirror the factory style of `AiRequestUtils.spec.js`.
4. Round-trip rule: for the messages the loop sends every turn, prefer
   rebuilding from our own transcript (single source of truth) over keeping a
   parallel OpenAI array.

**Files created:** `Byok\ByokTranscript.js`, `Byok\ByokTranscript.spec.js`
**Files modified:** none
**Tests:** response with text + 2 tool calls maps to one assistant message with
3 content items; `call_id`s preserved; tool result maps to
`function_call_output`; reverse mapping produces valid `ByokChatMessage`s;
the shell factory satisfies the fields `AiRequestUtils.js` functions read
(feed one through `getFunctionCallsToProcess` as an integration-flavored test).
**Depends on:** Step 2.2; Phase 1 Step 1.1 (types style).

---

### Step 2.9 — Settings tab upgrades

**Goal:** the BYOK tab becomes self-service: fetch models, test connection,
per-model context window. All edits are inside our own `ByokSettingsTab.js`.

**How to implement:**

1. Replace the free-text model field with: a **Fetch models** button (calls
   `refreshByokModels` with the endpoint + key from `ByokKeyStorage`), a
   `<CompactSelectField>` listing `ByokModelInfo.id`s, and a free-text fallback
   option ("Type manually…") for servers without `/models` (early-return guard
   on empty fetched list → show the text field instead — no nested ifs).
2. Context window becomes **per model**: a small list of
   `{ model, tokens }` rows rendered from a new `contextWindowByModel` map you
   add to `ByokSettings` (update `ByokTypes.js` + defaults + tests — the
   migration-safe reader from step 1.1 makes this free). When a fetched model
   reports a context window, prefill and mark it "auto (server)".
3. Add a **Test connection** button: runs `sendByokChatCompletionWithRetries`
   with a 1-token "ping" message; renders the outcome inline as
   success text or the `ByokError.message` — no dialogs, matching the inline
   error style of the preferences tab.
4. Storage status row now renders the `obfuscated` info from step 2.4
   ("Stored obfuscated — OS-level encryption is added on desktop").
5. Keep every string in `<Trans>`.

**Files created:** none
**Files modified:** `Byok\ByokSettingsTab.js`, `Byok\ByokSettingsTab.spec.js`,
`Byok\ByokTypes.js`, `Byok\ByokTypes.spec.js`
**Tests:** with a mocked models cache — button populates the dropdown; empty
result falls back to the text field; test-connection success/failure renders
the right inline message; per-model map persists via `setMultipleValues`.
**Depends on:** Steps 2.2, 2.3, 2.4, 2.5.

---

### Step 2.10 — Phase gate: verification & regression

1. Full suite from `newIDE\app`: `npm test -- --watchAll=false`, `npm run lint`,
   `npm run flow`, `npm run check-format` — all green.
2. `git`-less diff check: confirm the only repository files changed since Phase 1
   are inside `newIDE\app\src\AiGeneration\Byok\` (list them in the worklog).
3. Manual QA against a real endpoint (local Ollama or LM Studio on
   `http://localhost:…`, or any OpenAI-compatible host) — record in worklog:
   - "Fetch models" lists the server's models; context window prefills where
     the server reports it.
   - Wrong key → inline authentication error; wrong URL → `not-found` error
     with a helpful message.
   - "Test connection" succeeds; with `reasoning_effort: high` against a server
     that rejects it, the ping still succeeds (degradation retry).
   - Key at rest in localStorage is obfuscated (not readable).
4. Write the worklog entry (five mandatory items).

**Depends on:** Steps 2.1–2.9.

---

## 3. Phase 2 acceptance criteria (phase gate)

- [ ] `fetchByokModels` + `sendByokChatCompletion` (via the retry wrapper) work against a real OpenAI-compatible endpoint in manual QA.
- [ ] Every failure surfaces as a typed `ByokError` with a human-readable message; the API key never appears in any error, log, or thrown string.
- [ ] Retry policy verified by tests: transient errors retried with backoff; auth errors not retried; `reasoning_effort` dropped exactly once on a rejection that names it.
- [ ] The API key at rest is obfuscated, with a v1→v2 read migration; the settings tab says so honestly.
- [ ] Model list dropdown works; per-model context window: server-reported → user-set → 8192 default (unit-tested chain).
- [ ] `validateByokToolSchemas()` returns no problems and the test enforces registry/schema sync.
- [ ] `contextStatsFromUsage` produces the exact shape `AiUsageIndicator` consumes; ratio math and clamping unit-tested.
- [ ] Transcript mapping round-trips and is compatible with `getFunctionCallsToProcess` (tested).
- [ ] **Zero existing upstream files modified in this phase** — all changes inside `src\AiGeneration\Byok\`.
- [ ] All four checks (`test`, `lint`, `flow`, `check-format`) pass; worklog entry with all five items present.

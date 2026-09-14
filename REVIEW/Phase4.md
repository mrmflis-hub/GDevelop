# Phase 4 — The BYOK Agent Loop

**Status:** planned · **Depends on:** Phases 1–3 (all ACs green) ·
**Read first:** [report.md](report.md) sections 1–2 (the server-side loop is the
thing we are replicating) · [styleguide.md](styleguide.md) · [agents.md](agents.md)

---

## 1. Introduction — what this phase delivers

This is the phase where BYOK becomes real: typing a request in the **Ask AI**
chat, with BYOK enabled, runs a **client-side agent loop** against the user's
own endpoint — the model reads the project, calls editor tools, and edits the
game — with no call to `api.gdevelop.io/generation`.

Concretely:

1. **Prompts** (`ByokPrompts.js`) — the system prompt that teaches the model how
   GDevelop projects work and which tools exist. GDevelop's own prompts are
   server-side and unavailable; ours are BYOK-owned and versioned.
2. **The loop** (`ByokOrchestrator.js`) — send conversation + tool definitions →
   execute the model's tool calls through the **existing** editor-function
   runner → feed results back → repeat until the model answers in plain text
   (or a guard stops it). Edit approvals are honored; failures are fed back to
   the model as tool errors, exactly like the server-side loop does.
3. **Sub-agent policy** — GDevelop's server spawns sub-agents (`run_edit_agent`,
   `run_explorer_agent`). v1 runs everything in **one conversation** and filters
   those tools out; the code leaves a clean seam for nested sub-loops later.
4. **Chat state** (`ByokChatStore.js`) — BYOK chats are stored as the same
   `AiRequest` shape the UI already renders, locally, with synthetic ids.
5. **The seam** (`AskAiEditorContainer.js`) — one conditional that routes chat
   creation and message sending to the orchestrator instead of the GDevelop
   backend when BYOK is enabled and configured. **This is the only existing-file
   edit of substance in the whole project**, and it is deliberately kept to two
   guarded branches.

### Existing files that play a role

| File | Role | What we do to it |
|---|---|---|
| `newIDE\app\src\AiGeneration\AskAiEditorContainer.js` | Owns chat creation (`createAiRequest`, lines ~609–629) and message sending incl. tool-result upload (`onSendMessage`, lines ~698–924); renders `AiRequestChat` (lines ~1610–1686); already reads `PreferencesContext` (line ~497) | **Modify**: BYOK branch at the two entry points + BYOK-specific props (~30–40 lines total) |
| `newIDE\app\src\EditorFunctions\EditorFunctionCallRunner.js` | Executes editor function calls against the project (`processEditorFunctionCalls`) | **Import only** |
| `newIDE\app\src\AiGeneration\Utils.js` | `doesFunctionCallModifyProject` (lines ~130–148) and the existing auto-processing loop `useProcessFunctionCalls` (lines ~232–729) | **Read only** — we reuse the helper, not the hook (the hook posts results to the GDevelop backend; our loop keeps them local) |
| `newIDE\app\src\AiGeneration\AiRequestUtils.js` | Transcript walking: `getFunctionCallsToProcess`, `getFunctionCallOutputsFromEditorFunctionCallResults`, etc. | **Import only** |
| `newIDE\app\src\AiGeneration\PrepareAiUserContent.js` | Builds the simplified project JSON the AI sees (`prepareAiUserContent`) | **Import only** |
| `newIDE\app\src\AiGeneration\AiRequestChat\index.js`, `AiUsageIndicator.js`, `AiRequestErrorRow.js` | The chat UI | **Ideally not modified.** One allowed exception, capped at ~10 lines: bypassing the credits gate if passing `null` props does not already achieve it (see step 4.7) |
| `newIDE\app\src\AiGeneration\AiRequestContext.js` | Server-backed chat storage + polling | **Not modified** (BYOK chats live in `ByokChatStore`; decision spike in step 4.0 confirms this stays true) |

### New tech stack?

None. Everything was put in place by Phases 1–3. This phase is logic and wiring.

### New files created in this phase

```
Byok\ByokPrompts.js / .spec.js          system prompt + prompt version constant
Byok\ByokOrchestrator.js / .spec.js     the loop
Byok\ByokChatStore.js / .spec.js        local BYOK chat records
Byok\ByokSeam.js / .spec.js             tiny pure decision helpers used by the container
```

Modified: `AskAiEditorContainer.js` (required), `AiRequestChat\index.js`
(only if 4.7's cap cannot be met otherwise — check first).

---

## 2. Steps

### Step 4.0 — Integration decision spike (do this before writing any code)

**Goal:** lock the wiring design so the container edit happens exactly once.

**How to implement:**

1. Read `AskAiEditorContainer.js` fully around the two entry points
   (`createAiRequest` at ~609–629; `onSendMessage` at ~698–924) and the render
   of `AiRequestChat` (~1610–1686). List which values flow in and out
   (aiRequest object, editorFunctionCallResults, callbacks).
2. Read how `AiRequestChat/index.js` obtains the selected request (props vs
   context) and confirm BYOK chats can be supplied the same way **without**
   touching `AiRequestContext.js`.
3. Verify the bypass: with `quota = null`, `price = null`,
   `availableCredits = 0`, `automaticallyUseCreditsForAiRequests = false`, does
   `canPayForAiRequest` (`AiRequestChat\Utils.js:94-113`) return `true`? Write
   a scratch check (not committed) or a unit test. Record the outcome.
4. Write the decision in the worklog: chosen branch points, the props to pass,
   and whether the 10-line cap of step 4.7 is needed.

**Files created:** none · **Files modified:** none
**Depends on:** Phase 2 (for the shapes involved).

---

### Step 4.1 — System prompt (`ByokPrompts.js`)

**Goal:** a versioned, test-guarded system prompt. Quality here decides BYOK
quality; keep it in one file so it can be iterated without touching anything
else.

**How to implement:**

1. Create `Byok\ByokPrompts.js`. Export:
   - `BYOK_AGENT_PROMPT_VERSION: string` (start at `'byok-v1'` — bump whenever
     the prompt changes behavior, and note it in the worklog),
   - `buildByokSystemPrompt(options: {| toolNames: Array<string>, hasOpenedProject: boolean |}): string`.
2. Write the prompt itself as a template covering, in this order:
   - Role: an assistant editing a GDevelop game through tools; never invent
     tool names; prefer the smallest edit that satisfies the request.
   - The tool list (`toolNames.join(', ')`) with one line each taken from
     `ByokToolSchema` descriptions (single source of truth: build from
     `getByokToolSchemas()`, do not duplicate prose).
   - Project context strategy: the conversation starts with a simplified
     project snapshot; afterwards the model must **inspect before editing**
     (`describe_instances`, `read_scene_events`) rather than assuming state.
   - Output rules: plain text only when the task is done; always call tools for
     changes; one tool batch per turn, no dependent calls in the same batch.
   - Plan tool: use `create_or_update_plan` first for multi-step requests.
3. Structure the string with small named constant sections joined together
   (readable, diffable) — not one 200-line template literal.

**Files created:** `Byok\ByokPrompts.js`, `Byok\ByokPrompts.spec.js`
**Files modified:** none
**Tests:** the prompt contains every name from `getByokToolSchemas()` (keeps
prompt and schema in sync — this test fails if someone adds a tool without
prompt coverage); `hasOpenedProject: false` swaps in the no-project instructions;
version constant is a non-empty string.
**Depends on:** Phase 2 Step 2.6.

---

### Step 4.2 — The orchestrator (`ByokOrchestrator.js`)

**Goal:** the loop. This is the most important new module of the project.

**How to implement:**

1. Create `Byok\ByokOrchestrator.js` with a factory:
   ```js
   export const createByokOrchestrator = (options: {|
     connection: {| baseUrl: string, apiKey: string |},
     settings: ByokSettings,
     aiRequest: AiRequest,                       // the local chat record (4.5)
     editorFunctionCallRunner: Function,         // processEditorFunctionCalls, injected
     getProjectUserContent: Function,            // prepareAiUserContent wrapper, injected
     onAiRequestUpdated: AiRequest => void,      // push transcript updates to the store/UI
     onRequestEditApproval: Function,            // pause the loop for edit approval
     usageTracker: ByokUsageTracker,
   |}) => ({ startNewChat, sendUserMessage, suspend })
   ```
   Everything is injected — the orchestrator imports no React and no editor
   code, which is what makes it unit-testable.
2. Implement `runTurn` as a flat sequence of named sub-functions (no nesting
   deeper than one guard level):
   - `buildMessagesForModel()` — system prompt (4.1) + transcript replay via
     `ByokTranscript` mappers.
   - `callModel()` — `sendByokChatCompletionWithRetries`, `tools` from
     `toOpenAiToolsFormat()`, `reasoningEffort` from settings unless `'default'`.
   - `recordAssistantTurn()` — map response → transcript items, update usage →
     `contextStats`, call `onAiRequestUpdated`.
   - `collectPendingToolCalls()` — reuse `getFunctionCallsToProcess` from
     `AiRequestUtils.js` on the local `AiRequest`.
   - `executeToolCalls()` — **sequentially** (no parallel edits): for each call,
     if `doesFunctionCallModifyProject` and approval is required →
     `await onRequestEditApproval(call)`; refusal → mark the chat `suspended`
     and stop. Run the batch through the injected runner, cap each output
     (truncate to ~20,000 chars with a named `capToolOutput` helper), map
     results via `getFunctionCallOutputsFromEditorFunctionCallResults` /
     `ByokTranscript`.
   - `shouldContinue()` — continue while the model returned tool calls AND
     `roundCount < MAX_BYOK_TOOL_ROUNDS` (constant, 20) AND the context ratio
     from the usage tracker is below `MAX_BYOK_CONTEXT_RATIO` (constant, 0.9).
3. Implement the public methods with early-return guards:
   - `startNewChat(userRequest)` — append the user message + fresh project
     content, then loop `runTurn` until `shouldContinue` is false; finalize
     status (`ready`, or `error` with the `ByokError.message`).
   - `sendUserMessage(text)` — same, appending to the existing transcript.
   - `suspend()` — flips status; the loop checks between tool executions.
4. Tool failures are **not** thrown: a failed editor function becomes a
   `function_call_output` with `success: false` and the error text, and the loop
   continues so the model can correct itself — this mirrors the server loop and
   is asserted in tests.

**Files created:** `Byok\ByokOrchestrator.js`, `Byok\ByokOrchestrator.spec.js`
**Files modified:** none
**Tests:** (mock client + fake runner, factories in the
`AiRequestUtils.spec.js` style)
- Happy path: model calls one tool → result fed back → final text answer;
  transcript contains `function_call` + `function_call_output` + final
  `output_text`; status `ready`.
- Two-round tool chain; `MAX_BYOK_TOOL_ROUNDS` guard stops runaway loops with
  an error status.
- Model returns malformed arguments → tool output `success: false` → model
  recovers → completes.
- Edit approval: modification call pauses; approval `false` → status
  `suspended`, loop exits; approval `true` → proceeds.
- Usage/context: `contextStats` updated each round; context guard stops the
  loop at the ratio threshold.
- `onAiRequestUpdated` called after every transcript mutation (UI liveness).
**Depends on:** Steps 4.1, 4.5 (the shell type), Phase 2 Steps 2.2–2.3, 2.6–2.8.

---

### Step 4.3 — Edit-approval integration

**Goal:** BYOK chats behave like GDevelop chats: edits pause for approval when
auto-edit is off, and the UI's existing approval row drives the pause.

**How to implement:**

1. In the container (step 4.6) keep using the existing
   `pendingEditApproval` / `onResolveEditApproval` plumbing that
   `AskAiEditorContainer` already wires for server chats.
2. The orchestrator's `onRequestEditApproval(call)` implementation (composed in
   the container) returns a promise resolved with `true/false` from that same
   plumbing — so no new UI is needed.
3. Decide "requires approval" exactly like the server flow does: reuse
   `doesFunctionCallModifyProject` **plus** the per-call
   `getModifiesProject(args)` refinement (both already exist — import, do not
   reimplement). Wrap that check in a named exported helper
   `byokCallRequiresApproval(editorFunction, args)` in `Byok\ByokSeam.js` so it
   is unit-tested independently of React.

**Files created:** `Byok\ByokSeam.js`, `Byok\ByokSeam.spec.js`
**Files modified:** none in this step
**Tests:** helper truth table over the three outcomes (registry function
missing → `true` (safe default), `modifiesProject: false` → `false`,
`getModifiesProject` override respected).
**Depends on:** Step 4.2's contract; Phase 2 Step 2.6.

---

### Step 4.4 — Sub-agent policy (v1: single conversation)

**Goal:** an explicit, documented decision — not an accident.

**How to implement:**

1. Ensure `run_edit_agent`, `run_explorer_agent` (and `generate_events` for v1)
   are **not** in `ByokToolSchema`'s whitelist (they were excluded in Phase 2;
   verify the test still enforces it).
2. In `ByokPrompts.js`, add one instruction: "You are a single agent; do the
   work yourself with the provided tools" so models trained to delegate don't
   ask for sub-agents.
3. Leave the seam for the future: `ByokOrchestrator` gets a named, currently-
   unused factory function `createByokSubAgentRunner()` that returns
   `null` in v1 — with a comment describing the future design (a sub-agent =
   a nested orchestrator conversation with its own message list and a scoped
   system prompt; results summarized back into the parent transcript as
   `function_call_output`). Phase 5+ material; do not implement now.

**Files created:** none (additions land in the 4.1/4.2 files)
**Files modified:** `Byok\ByokPrompts.js`, `Byok\ByokOrchestrator.js` (+ specs)
**Tests:** whitelist assertions (already in Phase 2 suite) still pass;
`createByokSubAgentRunner()` returns `null`.
**Depends on:** Steps 4.1, 4.2.

---

### Step 4.5 — Local chat store (`ByokChatStore.js`)

**Goal:** BYOK chats live as `AiRequest`-shaped records with synthetic ids —
the UI renders them with zero knowledge that no server exists.

**How to implement:**

1. Create `Byok\ByokChatStore.js`: a small module-level store (same spirit as
   `AiRequestContext`'s record, but ~100 lines):
   - `createByokChat(): AiRequest` — id `'byok-' + uuid`, status `working`,
     empty `output`, `createdAt/updatedAt`.
   - `getByokChat(id)`, `updateByokChat(aiRequest)` (bumps `updatedAt`),
     `listByokChats()`, `archiveByokChat(id)`.
   - `subscribeByokChats(listener)` so the container can re-render on updates
     (a `Set` of listeners; `useSyncExternalStore`-friendly).
2. Persistence: **session-only in v1** — persisting full transcripts (with
   embedded tool outputs) to localStorage is a follow-up step (recorded as such
   in the worklog); keep a named constant `BYOK_CHAT_PERSISTENCE_ENABLED = false`
   with the follow-up note so flipping it later is a deliberate act.
3. Import `createByokAiRequestShell` from `ByokTranscript.js` for the base
   shape — one source of truth.

**Files created:** `Byok\ByokChatStore.js`, `Byok\ByokChatStore.spec.js`
**Files modified:** none
**Tests:** create → ids unique and prefixed `byok-`; update bumps `updatedAt`
and notifies subscribers; archive removes from `list`; subscription
subscribe/unsubscribe works.
**Depends on:** Phase 2 Step 2.8.

---

### Step 4.6 — The seam in `AskAiEditorContainer.js`

**Goal:** the single place where the two worlds switch. Keep it embarrassingly
small.

**How to implement:**

1. Add pure decision helpers in `Byok\ByokSeam.js` first (testable without
   React):
   - `shouldUseByokForNewRequest(values): boolean` —
     `isByokFullyConfigured(getByokSettings(values))`.
   - `buildByokChatProps(aiRequest): {| quota: null, price: null, availableCredits: 0, ... |}`
     — the prop bundle that makes the chat UI's credit machinery idle; name
     every prop explicitly (readable over clever).
2. In `AskAiEditorContainer.js`:
   - Import the orchestrator factory, store, and seam helpers.
   - **Creation branch** (inside the effect/function that calls
     `createAiRequest`, ~lines 609–629): one guard —
     ```js
     if (shouldUseByokForNewRequest(preferences.values)) {
       startByokChat(userRequest);   // container-level callback defined below
       return;
     }
     ```
     `startByokChat` creates the store record, builds the orchestrator with the
     injected runner/content/approval callbacks, and calls `startNewChat`.
   - **Send branch** (top of `onSendMessage`, ~line 698): the mirrored guard
     routing user messages **and** editor-function results into
     `orchestrator.sendUserMessage` / the orchestrator's pending-tool handling
     instead of `addMessageToAiRequest`. Keep the branch to the early-return
     plus one delegated call; all logic lives in the orchestrator.
   - **Props to the chat** (render of `AiRequestChat`, ~1610–1686): when the
     selected request is a BYOK chat (id prefix check via a seam helper
     `isByokAiRequestId(id)`), spread `buildByokChatProps()` so credits UI
     idles; `contextUsedRatio` already flows from `contextStats`, which the
     orchestrator fills.
   - Track the active orchestrator instance in a `React.useRef` (one per chat).
3. Do **not** touch `AiRequestContext.js`. If step 4.0's spike discovered this
   is impossible, stop, record why in the worklog, and consult the user before
   widening the diff.

**Files created:** none (helpers land in `ByokSeam.js`)
**Files modified:** `newIDE\app\src\AiGeneration\AskAiEditorContainer.js`,
`Byok\ByokSeam.js`, `Byok\ByokSeam.spec.js`
**Tests:** seam helpers fully unit-tested (`shouldUseByokForNewRequest`,
`isByokAiRequestId`, `buildByokChatProps` returns the exact idle-credits
bundle). The container wiring itself is covered by the manual QA in 4.8 —
note that decision in the worklog.
**Depends on:** Steps 4.2, 4.3, 4.5; Step 4.0's decision.

---

### Step 4.7 — Chat adjustments (only if unavoidable, ≤ 10 lines)

**Goal:** zero edits here if possible; a capped edit if not.

**How to implement:**

1. First verify (step 4.0) whether `quota = null` props already disable the
   credits gate (`canPayForAiRequest`) and the "Calculating limits" row. If yes:
   **this step is done with no changes** — record that in the worklog.
2. Only if something visibly misbehaves: patch inside
   `AiRequestChat\index.js` with the smallest possible conditional (e.g. one
   guard around the credits row), hard-capped at 10 changed lines. Every line
   beyond that means the design is wrong — revisit step 4.6 instead of growing
   this file.
3. A BYOK badge/label is explicitly **deferred** (nice-to-have list at the
   bottom of this document).

**Files created:** none
**Files modified:** ideally none; at most `newIDE\app\src\AiGeneration\AiRequestChat\index.js` (≤ 10 lines)
**Tests to write:** any new conditional gets a unit test only if it is
extractable; otherwise manual QA. Record which case applied.
**Depends on:** Steps 4.0, 4.6.

---

### Step 4.8 — End-to-end QA & phase gate

**Goal:** prove the whole story and prove the old story still works.

**How to implement:**

1. Full suite from `newIDE\app`: `npm test -- --watchAll=false`,
   `npm run lint`, `npm run flow`, `npm run check-format`.
2. Diff check: the only upstream files modified in the entire project are
   `PreferencesContext.js`, `PreferencesDialog.js`, `AskAiEditorContainer.js`,
   optionally `AiRequestChat\index.js` (≤ 10 lines), and
   `newIDE\electron-app\app\main.js` (≤ 10 lines). List exact files + line
   counts in the worklog.
3. Manual QA (desktop, real endpoint — e.g. local Ollama/LM Studio or an
   OpenAI-compatible host), recorded step by step in the worklog:
   - Enable BYOK, open Ask AI with a small project, ask: "Create a scene called
     Forest with a player object and a few trees." → the chat shows tool calls,
     the scene appears, final answer arrives, status `ready`.
   - Ask a follow-up ("add a score variable") → history is honored (model
     inspects then edits).
   - Turn auto-edit off → a modifying tool call pauses with the existing
     approval prompt → refusing suspends the chat; approving proceeds.
   - Context bar reflects usage as the conversation grows (watch it move with a
     small context-window setting).
   - DevTools network tab: **zero** requests to `api.gdevelop.io/generation`
     during BYOK chats.
   - Disable BYOK → normal Ask AI with a GDevelop account still works
     end-to-end (regression).
   - Kill a chat mid-loop (close tab) → app does not hang; reopening is clean.
4. Write the final worklog entry (five mandatory items), including prompt
   version used and any tool-schema fixes discovered during QA.

**Depends on:** Steps 4.1–4.7.

---

## 3. Phase 4 acceptance criteria (phase gate)

- [ ] With BYOK enabled and configured, an Ask AI chat performs at least one real multi-tool edit (create scene/object/events) on a real project via the user's endpoint, with **no calls to GDevelop's generation API** (network-tab verified).
- [ ] The loop honors edit approvals (pause / refuse-suspends / approve-continues) through the existing approval UI, with zero new approval UI code.
- [ ] Runaway protection verified: tool-round cap and context-ratio cap both stop the loop with a clear status (unit-tested).
- [ ] Tool failures feed back to the model as `success: false` outputs and the loop can recover (unit-tested).
- [ ] The chat UI (messages, tool-call rows, usage indicator's context bar) renders BYOK chats **unmodified**; the only allowed chat-file change is the ≤ 10-line gate bypass if 4.7 needed it.
- [ ] BYOK chats are `AiRequest`-shaped records in `ByokChatStore` with `byok-` ids; `AiRequestContext.js` is untouched (diff-checked).
- [ ] `AskAiEditorContainer.js` diff is two guarded entry-point branches + prop bundling (~40 lines); decision helpers are pure and unit-tested in `ByokSeam.js`.
- [ ] With BYOK disabled, the existing GDevelop-backed Ask AI works unchanged (manual regression recorded).
- [ ] Sub-agent tools stay excluded from the whitelist with the documented future seam; prompt carries the single-agent instruction.
- [ ] All four checks pass in `newIDE\app`; the project-wide existing-file diff budget from `report.md` section 5 is confirmed and listed in the worklog; worklog entry has all five mandatory items.

---

## 4. Deferred nice-to-haves (post-Phase 4 backlog — do not build now)

- Persisted BYOK chat history (localStorage, capped; `BYOK_CHAT_PERSISTENCE_ENABLED`).
- Token streaming (`fetch` + `getReader`, `stream_options: {include_usage}`).
- `generate_events` re-implemented as a nested BYOK call; re-admitting the
  store-search tools.
- Sub-agents via `createByokSubAgentRunner` (nested orchestrator conversations).
- BYOK badge in the chat header; exact prompt/completion token row
  (`ByokUsageTracker.getTotals` already provides the data).
- Per-chat model/effort override UI.

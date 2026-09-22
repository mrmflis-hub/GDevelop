# BYOK Implementation Audit

**Date:** 2026-09-21 · **Auditor:** ZCode orchestrator (review of `REVIEW/worklog.md`,
`report.md`, `Phase1–4.md`, `usertasks.md`, and the actual source tree after Phases 1–4)
**Fix pass:** 2026-09-21 — **A1, A2, A3, A4, A5, C5 and C13 are FIXED** (see the
"**Fixed**" notes and the worklog entry of that date; gates re-run green:
1561 tests passed, lint/flow/format clean). B-section items still need the
interactive desktop session (`usertasks.md` Tasks 1–2).
**Scope:** everything the four phases delivered vs. everything the four phase
documents promise. Every finding has a reference and a fix proposal.
Severity: **P1** = breaks functionality or a phase AC, **P2** = behavioral gap or
documented deviation worth a decision, **P3** = minor / housekeeping.

**Verdict up front:** Phases 1–2 are solid and fully gated (tests, lint, flow,
format all green; their ACs are verified at unit level). Phases 3–4 are
code-complete and green on all four gates, but their **manual/desktop ACs are
unverified** (B1, B2 → `usertasks.md` Tasks 1–2). The review's two P1 bugs
(A1, A4) and the smaller A2/A3/C5/C13 gaps were fixed on 2026-09-21.

| Area | P1 | P2 | P3 |
|---|---|---|---|
| A. Functional bugs (found in this review) | A1 ✅ fixed, A4 ✅ fixed | A2 ✅ fixed | A3 ✅ fixed, A5 ✅ fixed |
| B. Missing / unverified ACs | B1, B2 | — | B3, B4 |
| C. Deviations & doc drift | — | C1, C5 ✅ fixed | C2, C3, C4, C6, C7–C12, C13 ✅ fixed |
| D. Documented, deliberately not implemented | — | — | D1–D7 |
| E. Environment & process | — | — | E1–E3 |

---

## A. Functional implementation bugs (verified in code during this review)

### A1 (P1) — Edit refusal leaves dangling tool calls; the chat then breaks on strict endpoints — **FIXED 2026-09-21**

> Fix applied as proposed: `appendNotExecutedToolOutputs` records a `success:false` output for every call of a refused batch before suspending (`ByokOrchestrator.js`); unit tests cover the outputs, the protocol-valid resume request, and the cleared pending-calls state.

- **Ref:** `Byok/ByokOrchestrator.js` `executeToolCalls` refusal branch
  (~lines 271–278: `if (!approved) { markSuspended(); return false; }`);
  `Byok/ByokTranscript.js` `assistantMessageToByokMessage`; OpenAI
  chat-completions protocol.
- **Problem:** on a refused approval the batch's `function_call` items stay in
  the transcript with **no** `function_call_output`. Every later
  `sendUserMessage` in that chat replays an `assistant` message with
  `tool_calls` that is *not* followed by `tool` messages — strict
  OpenAI-compatible endpoints (OpenAI itself included) reject that with
  `400 invalid_request_error` ("an assistant message with 'tool_calls' must be
  followed by tool messages"). The chat is then permanently erroring: every
  follow-up dies in `classifyByokError` → status `error`.
- **Secondary effect (A5):** the unprocessed calls keep
  `getFunctionCallsToProcess` non-empty, so the chat UI computes
  `isWorking = true` forever (`AiRequestChat/index.js` ~lines 533–563) while
  the record's status is `suspended` — the UI shows a Stop button whose
  `onStop` no-ops (the container's `getHasWorkInProgress` is false for
  suspended status). The server flow avoids both because its backend
  synthesizes refusal outputs.
- **Fix:** in the refusal branch, before `markSuspended()`, append one
  `function_call_output` per pending call of the batch:
  `JSON.stringify({ success: false, message: 'The user refused this edit. Ask them how to proceed.' })`
  (reuse `byokToolResultToFunctionCallOutput`), then suspend. Add unit
  tests: refusal appends outputs; a follow-up message after refusal produces
  a protocol-valid messages array; UI pending-calls state clears. ~15 lines +
  spec. This also restores "suspend → user redirects → conversation
  continues", which the current code intends (`runWithUserMessage` resets
  `isSuspended`).

### A2 (P2) — The Stop button does not stop an already-arrived batch — **FIXED 2026-09-21**

> Fix applied: `executeToolCalls` re-checks `isSuspended` before approval/execution and records the batch as not executed (same helper as A1); unit-tested with a suspended-mid-model-call scenario.

- **Ref:** `Byok/ByokOrchestrator.js` `runLoop` (~lines 325–351): `isSuspended`
  is checked only at the top of each round, before `callModel()`.
- **Problem:** `suspend()` arriving while a model call (or the context check)
  is in flight lets the round's tool batch execute anyway — edits can land
  after the user pressed stop. The next round then exits, so the loop stops
  *eventually*, but one full batch too late.
- **Fix:** add `if (isSuspended) return;` immediately before
  `executeToolCalls(...)` (and ideally at the top of `executeToolCalls`
  itself, before the approval request). 1–2 lines + one unit test.

### A3 (P3) — BYOK follow-up message is not cleared from the input field — **FIXED 2026-09-21**

> Fix applied: the BYOK branch of `onSendMessage` now resets the input immediately after dispatching to the orchestrator (without awaiting the whole loop). Container wiring — covered by manual QA (Task 2), per the step 4.6 decision.

- **Ref:** `AskAiEditorContainer.js` BYOK branch of `onSendMessage`
  (~lines 943–955) returns before the `resetUserInput('')` /
  `resetUserInput(aiRequestId)` calls the server path performs
  (~lines 1127–1128). New chats are covered (`startByokChat` ~lines 626–627);
  follow-ups are not.
- **Fix:** mirror the two `resetUserInput` calls inside the branch (after
  dispatching to the orchestrator). 2 lines.

### A4 (P1) — Four of the fourteen whitelisted tools can never succeed in BYOK v1 — **FIXED 2026-09-21**

> Fix applied (mixed strategy): `create_or_update_plan` is now intercepted by the orchestrator (`appendPlanToolOutput` echoes the tasks back as the `plan` output, making the tool real and the plan UI usable); `add_scene_events`, `read_full_docs` and `search_docs` were removed from `BYOK_V1_TOOL_NAMES` + schemas (11 tools remain) and the exclusion comment documents why; `BYOK_AGENT_PROMPT_VERSION` bumped to `byok-v2` (the generated tool list changed). Unit tests updated/added for all of it.

The Phase 2 whitelist (`ByokToolSchema.js` `BYOK_V1_TOOL_NAMES`) is validated
against the registry (names exist), but four of its tools have client-side
implementations that are permanent failure stubs or depend on collaborators
the BYOK executor deliberately stubs (worklog 2026-09-14, Step 2.10 issue;
Phase 4 executor decision). The prompt advertises all fourteen, and for one
of them even *mandates* use:

| Tool | Upstream behavior (verified) | Consequence in BYOK v1 |
|---|---|---|
| `create_or_update_plan` | `EditorFunctions/index.js` ~8600–8607: `launchFunction` **always** returns `makeGenericFailure('…handled server-side')` | The system prompt's planning section (`ByokPrompts.js:52-53`) tells the model to call it **first** for multi-step requests → every multi-step chat starts with a guaranteed failed tool call; the `OrchestratorPlan` UI can never render for BYOK (`getLatestActivePlan` finds no `plan` output) |
| `add_scene_events` | ~index.js:5430 — delegates event generation to the `generateEvents` collaborator | The executor provides `generateEvents` as a failure stub (`ByokSeam.js` `makeUnavailableDependency`) → **event editing is impossible** in BYOK v1; weakens Phase 4 AC 1 ("multi-tool edit … create scene/object/**events**") |
| `read_full_docs` | ~index.js:8646–8650: always `makeGenericFailure('…continue with your existing knowledge')` | Benign degradation, but the tool is advertised as available |
| `search_docs` | ~index.js:8640+: same always-fail stub | Same |

- **Fix (choose per tool):**
  1. `create_or_update_plan` — **intercept in the orchestrator** (it owns
     transcript policy): recognize the call in `executeToolCalls`, skip the
     editor executor, and append a `function_call_output` of
     `{ success: true, plan: { tasks: <args.tasks> } }` (the Phase 2 schema
     already mirrors `AiRequestPlanTask`). This makes the tool real *and*
     lights up the existing plan UI. ~20 lines + spec.
  2. `add_scene_events` — remove from `BYOK_V1_TOOL_NAMES` + schemas + prompt
     until "generate_events as a nested BYOK call" is built (D3), **or**
     implement the nested call (bigger; it is the documented backlog item).
  3. `read_full_docs` / `search_docs` — remove from the whitelist (and the
     prompt's implied availability) or implement a BYOK-side docs fetch.
     If kept, they fail gracefully, but a model burning a round on them every
     conversation is waste.
  - Whichever choice: update `ByokPrompts.js` in the same change and bump
    `BYOK_AGENT_PROMPT_VERSION` (per its own contract), and keep the
    prompt↔schema sync test green.

### A5 (P3) — (Consequence of A1, tracked separately for visibility) — **FIXED via A1**

Suspended-after-refusal chats render as perpetually "working" with a dead
Stop button. Fixed entirely by A1; listed so QA (Task 2, step 4) knows what
it is seeing if A1 is not applied first.

---

## B. Missing / unverified acceptance criteria

### B1 (P1, phase gate) — Phase 3 manual desktop checklist never executed

- **Ref:** `Phase3.md` step 3.5 and ACs 1, 2, 7; worklog 2026-09-19 "Issues
  found", first bullet.
- **What is missing:** status-row text in the running app, `gd-byok-key` v3
  ciphertext inspected in DevTools, DPAPI round-trip across a real app
  restart, the desktop networking check, the **packaged build** checks, and
  the preview regression. Cause: headless sessions; `newIDE/electron-app` has
  no `node_modules`.
- **What stands in:** desktop-path unit tests with mocked IPC (v3 at rest,
  migrations), `node --check` parses, an 8-check stubbed-`electron` smoke of
  `ByokSafeStorage.js` (harness outside the repo), and the git-diff proof
  that `main.js` changed only by the handler block.
- **Fix:** execute `usertasks.md` **Task 1** and record results in the
  worklog. Nothing code-side is known-missing.

### B2 (P1, phase gate) — Phase 4 manual QA on a real endpoint never executed

- **Ref:** `Phase4.md` step 4.8 and ACs 1, 2, 8; worklog 2026-09-20 "Issues
  found".
- **What is missing:** the real multi-tool edit on a real project, the
  DevTools "zero requests to `api.gdevelop.io/generation`" observation, the
  approval pause/refuse/approve pass, the BYOK-disabled regression, and the
  kill-mid-loop check.
- **What stands in:** 45 Phase 4 unit tests (including approval and both
  runaway guards) and a temporary end-to-end smoke (created, run, deleted;
  results in worklog 2026-09-20) driving the real orchestrator + real HTTP
  client against a local OpenAI-compatible server through a two-tool
  conversation — all requests observed to go only to the local endpoint.
- **Fix:** execute `usertasks.md` **Task 2** — **after** deciding on A1/A4
  (Task 4), because the refuse-path QA item will hit A1.

### B3 (P3) — Phase 2 AC 1 ("work against a real OpenAI-compatible endpoint in manual QA") was met with a mock server

- **Ref:** worklog 2026-09-14, Step 2.10 (local mock server, 12/12 checks,
  caught a real envelope bug); `Phase2.md` AC 1.
- **Fix:** one "Test connection" click against a real provider covers it
  (Task 6.2). Low risk: the wire format is OpenAI's, and the envelope bug the
  smoke caught is fixed and tested.

### B4 (P3) — Phase 1 "settings persist across full app restart" verified by code-reading only

- **Ref:** `Phase1.md` AC 3; worklog 2026-09-14 (Phase 1) "Issues found" —
  the live app was never launched in that session.
- **Fix:** covered implicitly by Task 1 steps 5–6 (the app restart there
  exercises the preferences provider too). Tick the AC after that run.

---

## C. Deviations from the phase documents & documentation drift

### C1 (P2) — `AskAiEditorContainer.js` diff is +307/−30 vs the ~20–40-line budget

- **Ref:** `report.md` §5 row 3; `Phase4.md` AC ("~40 lines"); worklog
  2026-09-20 "Issues found".
- **Why it grew (structural, not scope creep):** (a) the tool executor's
  15-argument wiring — container props/hooks that cannot live in the
  orchestrator (no editor imports) and had no importable upstream wrapper;
  (b) container-local BYOK chat selection + store subscription + orchestrator
  ref map — forced by the spike finding that a `byok-` id inside
  `AiRequestContext` triggers server loads/polls (AiRequestContext.js
  ~lines 943–957, 1044–1059); (c) byok-aware suspend/stop/confirm plumbing.
- **Mitigation in place:** all decision logic lives in unit-tested Byok
  modules; the container holds wiring only. `AiRequestContext.js` and the
  whole `AiRequestChat/` folder are untouched (git-verified).
- **Fix (optional, needs budget approval since it adds a Byok file):**
  extract the executor wiring into a `useByokEditorToolExecutor` hook in
  `Byok/` — would cut ~60 container lines and make the wiring unit-testable.

### C5 (P2) — BYOK re-asks edit approval for every batch (no batch-approval memory) — **FIXED 2026-09-21**

> Fix applied: `approvedByokEditCallIdsRef` in the container (capped at 500, cleared when the auto-edit toggle flips, alongside the server-side `clearApprovedEditBatches`).

- **Ref:** `AiGeneration/Utils.js` ~lines 376–389 (`approvedEditBatchKeysRef`)
  vs the container's BYOK `onRequestEditApproval` (worklog 2026-09-20).
- **Problem:** with auto-edit off, the server flow remembers an approved
  edit-agent batch and stops re-asking within it; BYOK v1 re-prompts for each
  new batch of modifying calls. More clicks, same safety.
- **Fix:** port the pattern into the container's BYOK approval wrapper — a
  `Set` of approved call ids (or a per-chat batch key), cleared when the
  auto-edit toggle flips (hook it next to the existing
  `clearApprovedEditBatches` call site). ~15 lines.

### C13 (P2) — No retry affordance for failed BYOK chats — **FIXED 2026-09-21**

> Fix applied: the orchestrator exposes `retryAfterError()` (re-enters the loop without appending anything — the transcript replay is the retry; unit-tested incl. the non-error guard), and the container passes it as `onRetryAfterError` for BYOK chats.

- **Ref:** container render: `onRetryAfterError={selectedByokChat ? undefined : onRetryAfterError}`;
  server chats get `retryAiRequest` (container ~lines 1210–1235 pre-edit).
- **Problem:** an endpoint error ends the chat with the message shown but no
  retry button; the only recovery is sending a new message (which appends a
  *new* user message rather than continuing cleanly — still valid protocol,
  unlike the server's zero-cost retry).
- **Fix (accept or build):** small — give the orchestrator a
  `retryAfterError()` that re-enters `runLoop` without appending anything
  (the transcript is unchanged, so the replay is exactly a retry), and pass a
  wrapper as `onRetryAfterError` for BYOK. ~10 lines + spec.

### C2 (P3) — "Import, do not reimplement" helpers are not exported upstream

- **Ref:** `Phase4.md` step 4.3 vs `AiGeneration/Utils.js` —
  `doesFunctionCallModifyProject` (~130) and `renderFunctionCallLabel`
  (~155) are module-private. Reimplemented as
  `ByokSeam.byokCallRequiresApproval` (with the documented safe-default
  difference) and plain tool-name approval labels. Recorded in worklog
  2026-09-20.
- **Fix:** export both upstream and switch the seam to them; the label
  upgrade (rendered editor labels in the approval row) comes free.

### C3 (P3) — Phase 3 doc says "two handlers", the code block and ACs say three

- **Ref:** `Phase3.md` §1 table + step 3.2 intro vs its own code block and
  AC 3. Three were registered (`byok-encryption-available`, `byok-encrypt`,
  `byok-decrypt`) — the code block was followed. Worklog 2026-09-19 records
  it.

### C4 (P3) — `AGENTS.md` no longer matches the checkout

- **Ref:** AGENTS.md §3 ("this checkout is not a git repository", `D:\…`,
  classic Command Prompt) vs reality (git repo on `master`, `C:\…`, sessions
  ran Git Bash; Phases 1–2 committed as `914d97eebf`/`f5b7f0e8e8`; the
  `REVIEW/agents.md`→root move is uncommitted).
- **Fix:** Task 3 in `usertasks.md`.

### C6 (P3) — BYOK chats are session-only and absent from the history list

- **Ref:** `ByokChatStore.js` (`BYOK_CHAT_PERSISTENCE_ENABLED = false`),
  worklog 2026-09-20; the history reads server summaries only. Documented v1
  limit; the build-out is D1.

### C7 (P3) — `package-lock.json` churn on every environment rebuild

- **Ref:** worklog 2026-09-19 — `npm install` stamps harmless `"peer": true`
  metadata; the file was restored to HEAD. Expect and re-restore in future
  sessions (or upgrade npm to match whatever produced the lockfile).

### C8 (P3) — Electron main-process code has no automated tests (by design)

- **Ref:** `Phase3.md` §1 "Testing reality" note; worklog 2026-09-19. The
  two-line handlers are parse-checked + smoke-verified against a stubbed
  `safeStorage`; the thinness trade-off is the documented mitigation. Live
  verification is Task 1.

### C9 (P3) — `import-libGD.js` falls back to the HEAD~2 S3 mirror in every session

- **Ref:** worklog 2026-09-14 and 2026-09-19 — the HEAD~1 object 404s from
  the S3 bucket. Harmless for tests, but recurring noise; worth an upstream
  report or a pinned hash in the docs.

### C10 (P3) — Phase 1 touched a third file (`PreferencesProvider.js`, ~3 lines)

- **Ref:** worklog 2026-09-14 (Phase 1) "Issues found" — Flow required the
   explicitly-typed return to list the new `byok` key. Within the spirit of
   the budget; recorded for completeness.

### C11 (P3, pre-existing) — Blurring the API-key field empty deletes the stored key

- **Ref:** `ByokSettingsTab.js` onBlur → `saveByokKey('')` → clears
  (`ByokKeyStorage.js`); the field starts empty, so focus+blur without typing
  silently deletes the saved key. Phase 1 behavior, never changed since; not
  introduced by Phases 3–4.
- **Fix:** skip the save when the field is empty **and untouched**
  (`apiKey === '' && !fieldWasEdited`), or clear only on an explicit "remove
  key" action. Needs a product decision (Task 6.1).

### C12 (P3) — Manual "process function calls" affordances are silent no-ops on BYOK chats

- **Ref:** container `onProcessFunctionCalls={onProcessSelectedAiRequestFunctionCalls}`
  binds the *context* record (null for BYOK) → early return. Automatic
  processing by the orchestrator makes the window tiny, but any hand-rendered
  process/run button during a BYOK round would do nothing. Fix if QA (Task 2)
  ever surfaces it: route a byok-aware processor.

---

## D. Documented features deliberately not implemented (backlog)

All of these are explicitly deferred in `Phase4.md` §4 (and §5 of
`report.md`); listed with their seams so a future decision is one flip away
(`usertasks.md` Task 5):

| ID | Feature | Where the seam is | Next step |
|---|---|---|---|
| D1 | Persisted BYOK chat history (localStorage, capped) | `ByokChatStore.js` `BYOK_CHAT_PERSISTENCE_ENABLED` | serialize on update, hydrate on load, cap total size; add an `archivedAt` filter |
| D2 | Token streaming | `ByokClient.js` (non-streaming by design) | `fetch` + `getReader` + `stream_options.include_usage`; orchestrator grows an onToken callback |
| D3 | `generate_events`/`add_scene_events` via a nested BYOK call; re-admit store-search tools | executor stubs in `ByokSeam.js`; see A4 | nested orchestrator conversation (same shape as D4) |
| D4 | Sub-agents (`run_edit_agent`/`run_explorer_agent`) | `ByokOrchestrator.js` `createByokSubAgentRunner()` (returns null; design comment) | nested orchestrator with scoped prompt, summarized back as `function_call_output` |
| D5 | BYOK badge in chat header + exact token row | `ByokUsageTracker.getTotals` already provides the data | needs the ≤10-line chat-file edit budget Phase 4.7 allowed but did not use |
| D6 | Per-chat model/effort override | settings are global in `ByokTypes.js` | extend `createByokOrchestrator` options (already injected — no seam change needed) |
| D7 | BYOK in the stand-alone homepage AI form | `AskAiStandAloneForm.js` untouched (de-scoped in `report.md` §5) | reuse the container's seam pattern if wanted |

---

## E. Environment & process

- **E1 (P3):** `newIDE/app/node_modules` was missing at the start of the
  Phase 3 and Phase 4 sessions and rebuilt both times
  (`npm install --ignore-scripts` + patches + version metadata + theme
  resources + libGD). `newIDE/electron-app/node_modules` has **never** been
  installed in these sessions — the root cause of B1. Recipe: `usertasks.md`
  Task 1, step 1.
- **E2 (P3):** sessions were headless — no GUI, no DevTools, no interactive
  app. Root cause of B1/B2/B4; not fixable agent-side.
- **E3 (P3):** local npm is newer than the one that produced
  `package-lock.json` (see C7). Pin/upgrade once to stop the churn.

---

## Gate status at audit time (for the record)

- `npm test -- --watchAll=false` → 157 suites, **1555 passed**, 1 pre-existing skip.
- `npm run lint` (`--max-warnings=0`) → clean. `npm run flow` → 0 errors.
- `npm run check-format` → clean.
- Uncommitted tree = Phase 3 (`electron-app/app/main.js`, `ByokSafeStorage.js`)
  + Phase 4 (`AskAiEditorContainer.js`, four Byok module pairs) + docs.
  Phases 1–2 are committed (`914d97eebf`, `f5b7f0e8e8`).

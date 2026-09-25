# Deferred — deliberately postponed, with reasoning

**Purpose:** everything the agent decided **not** to do now, on purpose —
not lost, not forgotten. One entry per item, human-readable: what it is, why
it was deferred, when it should be tackled, and the standing proposal to the
owner. The owner green-lights or rejects these items via the numbered
decision list in `usertasks.md`; a green-lit item is planned like a phase
step and leaves this file (a rejected one stays here as by-design/never).

Rules for agents: see `AGENTS.md` §5.2. If nothing new belongs here at the
end of a session, the worklog entry says `no deferred`.

**Seeded 2026-09-22** from `audit2209.md` §2 (D-ids kept). **Owner decisions
recorded 2026-09-22** (answers in `usertasks.md`): D1, D5, D6 and D10 were
approved and moved to `outofscoped.md` (F1–F3 + findings table); D3 and D9
were rejected and are by-design below; D2, D4, D8 keep their Phase 8/9
homes. Project is **paused** — nothing is built until the owner restarts.

**Phase homes assigned 2026-09-22 (replan):** the items with committed
future homes are D4 → `Phase8.md` step 8.1, D8 → step 8.0, O3 → step 8.0,
O4 → `Phase7.md` step 7.0, and F2's two halves → `Phase7.md` step 7.1 +
`Phase9.md` step 9.1. D2 and the O2 fallback stay **conditional** (no
committed home; also noted in `Phase9.md` §4) until the owner green-lights
them.

---

### D2 — Token streaming — *deferred (answer #2, 2026-09-22)*

- **What:** streaming chat completions (`stream_options.include_usage`).
  `ByokClient.js` is non-streaming by design.
- **Why deferred:** owner decision — the spinner stays for now; the waiting
  experience is addressed by the approved prompt-based progress updates +
  watchdog instead (F2 in `outofscoped.md`).
- **When to tackle:** Phase 9 (model economics), only if perceived latency
  is still a complaint after F2 lands (`Phase7.md` step 7.1 + `Phase9.md`
  step 9.1); recorded as conditional in `Phase9.md` §4.

### D3 — Store tools (`search_object_asset_store`…) — *BY-DESIGN: never (answer #3, 2026-09-22)*

- **What:** the account-gated asset/resource-store search tools, excluded
  from the BYOK whitelist.
- **Owner's reasoning:** users who need store tools swap back to the
  official workflow. The confirmed routing model makes that painless: the
  user stays logged in, the BYOK-enabled setting is the router toggle (on →
  new chats use BYOK; off → official AI), and every non-AI feature works
  identically in both modes. No coupling decisions like this one are needed
  again — BYOK offers only what is built for it locally.

### D4 — Sub-agents (edit / explorer) — *DONE in Phase 8 step 8.1 (2026-09-22)*

- **What:** nested BYOK agent runs (`createByokSubAgentRunner()` currently
  returns null).
- **Status:** the scout/reviewer halves are implemented and verified in
  Phase 8 step 8.1 (`ByokSubAgents.js`, worklog 2026-09-22). The EDIT
  sub-agent stays excluded by design (see `Phase8.md` §4).

### D7 — BYOK in the homepage stand-alone AI form — *SUPERSEDED by the Phase 8 replan*

- **What:** BYOK support in `AskAiStandAloneForm.js`.
- **Status:** the de-scoping was superseded when the owner-approved
  `Phase8.md` step 8.5 made the homepage form a mandated BYOK entry point
  (feature parity — the homepage make-me-a-game flow). Implemented and
  verified in the Phase 8 session (worklog 2026-09-22).

### D8 — Shrink `AskAiEditorContainer.js`'s BYOK additions into a hook — *DONE in Phase 8 step 8.0 (2026-09-22)*

- **What:** optional refactor moving the BYOK seam code out of the container
  into a dedicated hook.
- **Status:** done — `Byok/useByokChatSeam.js` (also reused by the
  standalone form since step 8.5); the container keeps a single hook call.
  Verified by the Phase 8 gates (worklog 2026-09-22).

### D9 — Upstream export of the helpers BYOK reimplements — *BY-DESIGN: keep local (answer #8, 2026-09-22)*

- **What:** exporting upstream internals (e.g. the `Generation.js` content
  union) so BYOK can type against them instead of reimplementing.
- **Owner's reasoning:** GDevelop is not accepting BYOK-fork PRs at the
  moment; this fork may be the only full server-independent BYOK
  implementation, and the owner may speak with a team member about how such
  a PR could ever be approached — until then nothing is upstreamed. O12's
  `Array<any>` escapes therefore stay by-design too.

### O2-fallback — Char-based token estimate for usage-less endpoints — *deferred (answer #12, 2026-09-22)*

- **What:** a characters/4 token estimate so the context guard still fires
  when an endpoint omits `usage` (today only the 20-round cap protects the
  run — test-pinned).
- **Why deferred:** owner accepted the current behavior; an estimate can
  false-positive the context-full stop on healthy chats.
- **When to tackle:** if a real endpoint in use proves to never send
  `usage` (conditional; also noted in `Phase9.md` §4).

### O3 — Executor/`ensureExtensionInstalled` memo staleness — *DONE in Phase 8 step 8.0 (2026-09-22)*

- **What:** the memo can use a stale project for ~1s around a mid-chat
  project creation; needs an upstream getter refactor.
- **Status:** done — `useEnsureExtensionInstalled` accepts a `getProject`
  getter (the BYOK live-project getter); unit-tested in
  `UseEnsureExtensionInstalled.spec.js` (worklog 2026-09-22).

### O4 — Transcript images not rendered to the user — *deferred (standing rec. #14)*

- **What:** images reach the model but the user sees only the tool-output
  text.
- **When to tackle:** Phase 7/8 polish (unchanged recommendation; not
  explicitly answered in the 2026-09-22 round) — placed in the step 7.0
  chat-UX batch in `Phase7.md`.

---

## 2026-09-23 — Phase 9 leftovers (CLOSED in the Phase 10 session)

### Eval harness: the LLM-as-judge pass — IMPLEMENTED (2026-09-23)

- **Closed:** the owner ordered every outstanding item closed with the
  Phase 10 implementation. `scripts/run-byok-evals.js` now runs a real
  judge pass when `--judge-model` is given: one chat call per FAILED task
  ("was the outcome nonetheless acceptable?"), verdicts rendered as an
  advisory section of the markdown report; judge failures degrade to
  `unavailable` rows and never fail the run. Covered by
  `ByokEvalHarness.spec.js` ("the LLM-as-judge pass").

### Benchmark results persisted per model — IMPLEMENTED (2026-09-23)

- **Closed:** `Byok/ByokBenchmarkStore.js` (localStorage, per
  endpoint+model key) keeps the last report; the settings tab shows the
  stored result (with its timestamp) without re-running the ~2-minute
  benchmark. Covered by `ByokBenchmarkStore.spec.js`.

## 2026-09-23 — Accepted limitations (by design, from the Phase 10 closeout)

### In-place BYOK restore may leave deeply-held views stale until interaction

- **What:** after an in-place restore, open scene editors can show
  pre-restore content until their next interaction or reopen (recorded in
  `outofscoped.md` during Phase 8; v1 shipped with the disclaimer).
- **Why accepted:** a full editor refresh (like `onCheckoutVersion`'s
  reload) is disruptive mid-session; choosing how hard to refresh is a
  design decision that was never made.
- **When to tackle:** if restores become a frequent workflow and users hit
  stale views; the fix belongs next to `onRestoreByokChat` in
  `AskAiEditorContainer.js`.
- **Standing proposal to the owner:** keep the v1 behavior unless restore
  becomes a primary loop.

### Repeated in-place restores inside ONE jest/WASM instance are flaky

- **What:** a second restore of the same project inside one Jest worker can
  hit an embind "null function or function signature mismatch" — tests
  only; production does one restore per user action. Recorded during
  Phase 8; the ByokFork tool test mocks the restore and the round-trip test
  covers the real path once.
- **Why accepted:** unknown embind lifetime cause, no user-facing impact,
  and the current tests are deterministic as written.
- **When to tackle:** only if it ever makes a suite flaky in practice (it
  has not); then investigate the embind object lifetime around
  `unserializeFrom`/`delete()`.
- **Standing proposal to the owner:** leave as-is.

## 2026-09-23 — Phase 10 v1 scope (approved by the phase order)

### The GDevelop MCP server ships tools-only, stateless, loopback

- **What:** the Phase 10 MCP server implements only `initialize` / `ping` /
  `tools/list` / `tools/call` (+ notifications) over loopback HTTP with no
  SSE half — so no `resources`/`prompts`, no server-push notifications
  (`tools/list_changed`, progress), no sampling/elicitation, no remote/LAN
  transport; requests route to the focused project window only; the client
  wiring is dev-time commands, not a packaged-app story.
- **Why closed as scope (not deferred work):** the owner ordered
  "implement this" on 2026-09-23 for the phase whose design declares this
  exact v1 boundary (`Phase10.md` §5, decisions D10-1…D10-5 taken as
  recommended). The 2026-07-28 spec revision is stateless-first and the
  stateless JSON mode covers the entire v1 use case; the loopback +
  per-session token posture IS the security model — a remote transport
  would need its own threat model and an explicit owner request.
- **When to revisit:** `resources`/`prompts` once tools prove the transport
  in daily use; the SSE half with the first feature that needs server-push;
  per-project multi-window routing if multi-project agent sessions appear;
  the packaged-adapter story in a packaging phase.
- **Standing proposal to the owner:** keep v1 tools-only; revisit the list
  above only after real client use.


## 2026-09-24 — Owner QA round 1 follow-ups (found via the durable chat transcript)

### 1. Tool-schema descriptions teach the hosted placeholder syntax

- **What:** several BYOK tool descriptions (ported from the hosted v15
  harness vocabulary) include or imply the `<parameter name="x">value</parameter>`
  placeholder convention. A weak model (mimo-v2.6-flash via cometAPI)
  copied that literal syntax into an argument VALUE in a real chat
  (`create_scene` got `background_color: "<parameter name=\"background_color\">#1c3b1c"`),
  producing silent garbage where the handler does not strictly validate.
- **Why deferred:** the fix is a sweep over ~62 schema descriptions (and a
  decision on how much hosted-harness phrasing to keep), mid-QA; the
  strong models ignore it and weak models also fail on many other axes.
- **When to tackle:** the next prompt/schema-quality pass (a natural fit
  with a future `byok-v9` prompt revision).
- **Standing proposal to the owner:** rewrite schema descriptions to plain
  JSON-argument language (no placeholder syntax) in a dedicated pass, and
  add strict type validation on stringly-typed style arguments
  (colors, positions) so garbage fails loudly.

### 2. Gameplay-test harness API is under-documented for the model

- **What:** in the QA chat the model wrote `stack.replace("Forest")` — a
  guessed API that does not exist in the gameplay-test harness — and
  burned a test round on the TypeError.
- **Why deferred:** the harness API surface (getSceneStack, stepFrames,
  getObjects, assert, screenshots...) needs a concise reference either in
  the `run_gameplay_test` tool description or the knowledge/skills
  library; doing it well deserves its own step, not a mid-QA patch.
- **When to tackle:** next prompt/knowledge pass (with item 1).
- **Standing proposal to the owner:** add a compact harness-API cheat
  sheet to the tool description and a knowledge section example.

### 3. Hosted `ai-request-summary` refresh runs while a BYOK chat is on screen

- **What:** with the Ask AI panel open, `AiRequestContext` keeps fetching
  `GET /generation/ai-request-summary` (hosted chat list). During QA this
  read as "AskAI routes through GDevelop completions" in the network tab.
  It is a list refresh, not a model call, and BYOK chats never appear in it.
- **Why deferred:** upstream behavior in a shared file; suppressing it
  when BYOK is enabled would also freeze the list of the owner's existing
  HOSTED chats (still shown in the history panel). Any change is a UX
  product call.
- **When to tackle:** only if the owner wants a cleaner BYOK story
  (e.g. label the history sections "GDevelop AI" vs "Your endpoint (BYOK)"
  or pause the refresh while a BYOK chat is selected).
- **Standing proposal to the owner:** leave the polling; optionally add
  the history-section labels in a polish pass.

## 2026-09-24 — Accepted limitation + polish candidates (from QA session 5, CometAPI desktop QA)

### OpenAI-style models that reject `tools` + `reasoning_effort` in chat/completions (gpt-6-luna on CometAPI)

- **What:** on `api.cometapi.com/v1`, `gpt-6-luna` answers every
  chat/completions call that carries `tools` with `invalid_request_error`
  ("Function tools with reasoning_effort are not supported for gpt-6-luna
  … use /v1/responses or set reasoning_effort to 'none'"). The gateway
  forces a non-none default effort even when the client omits the
  parameter, so BYOK (which sends `reasoning_effort` only as
  low/medium/high, and never `none`) cannot use such models for agentic
  chats at all. Verified by curl: the identical request with
  `"reasoning_effort":"none"` succeeds.
- **Why deferred:** it is a per-endpoint gateway behavior, not a BYOK bug;
  the general fix is a capability-probe extension ("on 400 naming
  reasoning_effort, remember to send `none` instead of dropping it") which
  touches `ByokClient.js` degradation logic and the settings effort
  dropdown (add a "none/auto" option).
- **When to tackle:** next robustness pass on `ByokClient` degradation.
- **Standing proposal to the owner:** extend the existing
  reasoning-effort degradation to fall back to `reasoning_effort: "none"`
  for models whose 400 names the parameter, and expose "none" in the
  effort dropdown.

### glm-5.3-flash on CometAPI returns 200 with an unusable body after very large tool outputs

- **What:** after the `get_game_starter_summary` output (the full 286-entry
  catalog, ~100 KB) is in the conversation, every subsequent glm-5.3-flash
  request returns HTTP 200 with a ~2 kB body the orchestrator cannot use;
  the chat dies with the "unknown" error classification and retries fail
  identically (including the compaction call, so a poisoned chat cannot
  self-compact). Deterministic across two sessions and a retry; curl
  confirms the same 200-with-error envelope for oversized inputs.
- **Why deferred:** endpoint-side behavior; BYOK already surfaces the
  error row, keeps the work, does not count the failed request, and offers
  Retry. A client-side mitigation (paging the starter-catalog output)
  would change a Phase 12 tool contract for one gateway's bug.
- **When to tackle:** if CometAPI fixes their envelope, nothing to do;
  otherwise consider capping `get_game_starter_summary` output size in a
  Phase 12 polish pass.
- **Standing proposal to the owner:** accept as an endpoint limitation;
  prefer gpt-6-class or mimo models with endpoints that handle large
  tool outputs, or self-host.

---

## Deferred 2026-09-25 (Phase 13 session)

- **Auto-rebuild on RAG backend switch.** The RAG tab's backend dropdown
  invalidates the index (the manifest records the backend) but does not
  automatically start the rebuild/upload the phase text describes — the
  user clicks "Rebuild index". *Why deferred:* the rebuild downloads/loads
  the embedder and can take minutes; auto-triggering a long-running,
  token-free but battery-heavy job from a dropdown felt worse than one
  explicit click, and the consent dialog (D13-9) already gates the button.
  *When to tackle:* a Phase 13 polish pass if the owner prefers the
  automatic behavior. *Standing proposal:* keep the explicit rebuild; add
  a "rebuild needed" hint on the status card (one line).
- **A real-MiniLM evaluation run of `search_knowledge`.** The shipped eval
  (24 queries, ≥70% top-3) runs with the deterministic hashing embedder so
  CI never downloads a model; the real MiniLM's ranking is expected to be
  strictly better but was not measured (needs the ~25 MB download — a
  desktop QA item, `usertasks.md` Task 15). *Why deferred:* CI must stay
  offline (D13-9 consent). *When to tackle:* with the desktop QA pass.
- **`search_knowledge` over MCP, speech/audio attachments, multi-file
  project upload** — already listed as explicitly deferred by Phase 13 §5;
  recorded here so the deferral survives the phase doc.

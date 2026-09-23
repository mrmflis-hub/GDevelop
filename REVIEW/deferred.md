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

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

### D4 — Sub-agents (edit / explorer) — *deferred (answer #4, 2026-09-22)*

- **What:** nested BYOK agent runs (`createByokSubAgentRunner()` currently
  returns null).
- **Why deferred:** owner said defer; they only pay off once the autonomous
  build workflow and the knowledge system exist.
- **When to tackle:** Phase 8 (autonomous build workflow), unchanged —
  now step 8.1 in `Phase8.md`.

### D7 — BYOK in the homepage stand-alone AI form — *BY-DESIGN: de-scoped (reconfirmed 2026-09-22)*

- **What:** BYOK support in `AskAiStandAloneForm.js`.
- **Reasoning:** the form is account/credits-oriented with no project
  context; `report.md` §5 de-scoped it originally and the owner confirmed
  keeping it so.

### D8 — Shrink `AskAiEditorContainer.js`'s BYOK additions into a hook — *deferred (answer #7, 2026-09-22)*

- **What:** optional refactor moving the BYOK seam code out of the container
  into a dedicated hook.
- **Why deferred:** keep local for now; the file churns again at Phase 8,
  which is the cheap moment to refactor.
- **When to tackle:** start of Phase 8 — now step 8.0 in `Phase8.md`.

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

### O3 — Executor/`ensureExtensionInstalled` memo staleness — *deferred (standing rec. #13)*

- **What:** the memo can use a stale project for ~1s around a mid-chat
  project creation; needs an upstream getter refactor.
- **When to tackle:** Phase 8 (unchanged recommendation; not explicitly
  answered in the 2026-09-22 round) — now step 8.0 in `Phase8.md`.

### O4 — Transcript images not rendered to the user — *deferred (standing rec. #14)*

- **What:** images reach the model but the user sees only the tool-output
  text.
- **When to tackle:** Phase 7/8 polish (unchanged recommendation; not
  explicitly answered in the 2026-09-22 round) — placed in the step 7.0
  chat-UX batch in `Phase7.md`.

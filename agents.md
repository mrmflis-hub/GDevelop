# Agents Working in This Repository — Operating Manual

You are an AI agent (or a human following agent-style discipline) working in
`C:\Projects\GDevelop`. Read this file fully before touching anything. The style
rules live in [styleguide.md](styleguide.md); this file is the operating manual:
what the project is, where it stands, what you may do, how decisions get made
and recorded, and what makes a run pass or fail.

---

## 1. What this project is

Adding **BYOK (Bring Your Own Key)** to the GDevelop IDE: the user provides an
OpenAI-compatible endpoint and API key; the existing "Ask AI" chat then runs
against that endpoint instead of GDevelop's hosted backend. GDevelop's current AI
runs its agent loop **server-side** (see `REVIEW/report.md` section 2), so BYOK
means building a client-side orchestrator that reuses the existing tool registry
(`src\EditorFunctions`), chat UI (`src\AiGeneration\AiRequestChat`), and message
types (`src\Utils\GDevelopServices\Generation.js`), while adding as little code
as possible to existing files.

The roadmap is `REVIEW/Phase1.md` → `REVIEW/Phase12.md`, worked strictly in
order: each phase assumes the previous one's acceptance criteria (ACs) all
pass. `REVIEW/report.md` is the original architecture survey;
`REVIEW/AIflow.md` maps the AI prompt/tool flow as actually built.

## 2. Where the project stands — keep this section current

Status as of 2026-09-24 (update at the end of every session):

- **Implemented** — Phases 1–7 committed (owner commits `0802d2d21e` and
  `e81697cbe6` on `master`): settings UI, client engine, Electron
  safeStorage integration, client-side agent loop, local EventScript event
  writing + full tool parity, perception, knowledge/prompt composer +
  skills (`byok-v5`). **Phase 8 committed by the owner** (`ddb87ffcb4`):
  the D8 hook extraction (`Byok/useByokChatSeam.js`), scout/reviewer
  sub-agents, the completion gate, the build-workflow + extend-with-js
  skills, events-based extension authoring, Ask-AI context-menu entry
  points, fork/restore points, prompt `byok-v6` (48 tools). QA Tasks 9/10
  open. **Phase 9 implemented 2026-09-23, uncommitted** (the owner
  restarted the project for it in chat): the F2 stall watchdog with
  in-chat notice rows, context compaction (preserved block + drop order),
  durable chat history (Markdown + image sidecars; Electron IPC files /
  IndexedDB; quarantine; 200 MB quota; history button), multi-provider
  routing with per-chat model/effort dropdowns + the D5 badge/token row,
  per-provider key slots, capability probing + the 4-task built-in
  benchmark, opt-in suggestions + local feedback, retry/robustness polish
  (Retry-After cap, remembered reasoning_effort degradation, per-round
  snapshot refresh), and the dev-only eval harness
  (`scripts/run-byok-evals.js`, 30 tasks). Prompt stays `byok-v6` (no
  behavior-text change). QA Task 11 open. **Phase 10 implemented
  2026-09-23, uncommitted** (owner ordered it in chat; decisions D10-1…D10-5
  answered as recommended): the GDevelop MCP server — loopback HTTP endpoint
  in the Electron main (`electron-app/app/ByokMcpServer.js`: Bearer token,
  ephemeral port, discovery file `<userData>\gdevelop-mcp-endpoint.json`,
  focused-window routing, second-instance refusal, 150 s forward timeout),
  the zero-dependency stdio adapter
  (`scripts/gdevelop-mcp-stdio.js` over the plain-CJS, tested
  `Byok/Mcp/ByokMcpStdioAdapterCore.js`), the renderer protocol core pinned
  to MCP revision `2026-07-28` (`Byok/Mcp/ByokMcpProtocol.js`), tool
  mapping + the read-only/read-write access gate
  (`Byok/Mcp/ByokMcpTools.js`), the serialized tool host with activity ring
  (`Byok/Mcp/ByokMcpToolHost.js`), the seam-registered executor bridge, the
  `MainFrame`-mounted endpoint hook, and the settings card. Also closed in
  this session: the eval-harness LLM-as-judge pass, benchmark report
  persistence (`ByokBenchmarkStore.js`), the notes-identifier live ref, the
  `Utils/Serializer.js` project-self-unserialization guard, and the
  duplicate `onOpenAskAi` Props key. QA Task 12 open (MCP desktop QA).
- **Planned, not started:** **Phase 11** (`Phase11.md`, planned 2026-09-24
  — authoring reach: external events/layouts tools, effect catalog,
  sprite-frame internals, resource import/replace, extension internals;
  prompt → `byok-v7`) and **Phase 12** (`Phase12.md`, planned 2026-09-24 —
  discovery/runtime/integration: starter summaries, local asset/resource
  store search + seam wiring, command palette + shortcut, MCP
  prompts/resources + read-notes, debugger/profiler tools; prompt →
  `byok-v8`). Owner green-lit the 10-item audit backlog on 2026-09-24
  (record in `usertasks.md`); D11-1…5 / D12-1…8 are answered at
  implementation kickoff. After both: only the human QA list in
  `usertasks.md`.

- **Audits:** every 2026-09-21 audit B-finding is fixed. The remaining open
  findings are consolidated in `REVIEW/audit2209.md` (full detail) and triaged
  into three actionable docs:
  - `REVIEW/outofscoped.md` — approved work to be tackled (agent backlog;
    includes the owner-designed features F1–F3),
  - `REVIEW/deferred.md` — deliberately postponed / by-design items, with
    reasoning,
  - `REVIEW/usertasks.md` — the answered decision record + human QA
    (Tasks 1, 2, 6, 7 open).
- **Owner decisions:** all 16 decisions of 2026-09-22 are **answered**
  (canonical record in `usertasks.md`; dispositions in the triage docs), as
  are the 5 Phase 10 decisions (D10-1…D10-5, answered 2026-09-23 by the
  "implement this" order on the presented recommendations), as is the
  2026-09-24 surface-audit backlog: the owner picked 10 of the audit's
  unconnected candidates, planned as `Phase11.md` + `Phase12.md`.
  Every approved/queued item now has a committed phase home: the fixes
  batch is `Phase7.md` step 7.0 (D10, O1, O4, O5–O11, O13), F2's halves
  are `Phase7.md` step 7.1 + `Phase9.md` step 9.1, the owner's
  persistence + multi-provider designs are `Phase9.md` steps 9.3/9.4
  (with D5), and the Phase 8 prep (D8 hook + O3 memo fix) is
  `Phase8.md` step 8.0. Streaming (D2) and the O2 char-estimate stay
  **conditional** in `deferred.md` / `Phase9.md` §4 (that §4 line's "no
  Phase 10 was needed" meant leftovers only — Phase 10 now exists as the
  owner-ordered MCP phase).
- **Project state: the owner RESTARTED it in chat on 2026-09-23 with the
  order "implement Phase 9", then ordered Phase 10 (MCP server) the same
  day — both are done (above). `outofscoped.md` is empty (the owner closed
  the backlog with the Phase 10 order); `deferred.md` holds only
  owner-answered by-design items and accepted limitations. The remaining
  work is the owner's QA list (`usertasks.md` Tasks 1, 2, 6, 7, 9–12) and
  the owner's commit review.
- Owner-provided local assets: `libgd-2.3.3\` (repo root — import-libGD
  source of truth) and `DOCs\` (the GDevelop-documentation clone, Phase 7
  input).
- The working tree may carry uncommitted in-progress changes between owner
  commits — run `git status` before assuming a clean slate.

## 3. Non-negotiable rules

A run **fails** if any of these is violated:

1. **Worklog.** After every working session, append an entry to
   `REVIEW/worklog.md` containing all five mandatory items (date, description of
   actions, bugs found, issues found, full list of files worked on). Subagents
   must **not** write worklog entries — only the orchestrating agent writes them,
   one consolidated entry per session. Missing any of the 5 items = failed run.
2. **End-of-session triage.** Alongside the worklog entry, classify everything
   that surfaced but was not done (section 5.2). If nothing new fell into a
   bucket, the worklog entry must say so verbatim: `no OOS`, `no deferred`,
   `no UT`.
3. **Max 5 subagents at once.** The provider rate-limits more. Waves of ≤ 5.
4. **Windows 11, Git Bash.** The agent shell is Git Bash: `ls`, `grep`, `cat`
   and friends work (older docs claiming cmd-only are outdated). Still prefer
   the dedicated Read/Glob/Grep tools over shell text-mangling. Quote paths
   with spaces. npm is the package manager in this checkout.
5. **Every function gets a test.** Co-located `*.spec.js`, same style as
   `AiRequestUtils.spec.js` (small `makeXxx()` factories). DOM-dependent tests
   need `@jest-environment jsdom` docblock. All of `npm test`, `npm run lint`,
   `npm run flow`, `npm run check-format` must pass from `newIDE\app` before you
   declare a step done.
6. **Code is written for humans.** No nested loops, no nested ifs (guard clauses
   and early returns instead), no clever one-liners, longer-but-readable wins.
   Flow-typed (`// @flow`, exact object types), Prettier-formatted, Lingui
   `<Trans>` for every user-visible string. Details in styleguide.md section 5.

## 4. Scope rules

- **New BYOK code goes in `newIDE\app\src\AiGeneration\Byok\`** (plus the small
  handler blocks already added in `newIDE\electron-app\app`, and the audited,
  BYOK-gated touchpoints in shared files recorded in the worklogs). Existing
  files may only be changed at touchpoints justified by the current phase
  document or an owner decision. If you find yourself editing anything else,
  stop and record why in the worklog under "Issues found" before doing it —
  and expect the touch to become a `usertasks.md` budget approval.
- **Documentation only in `/REVIEW`** — except `AGENTS.md` and `styleguide.md`,
  which live at the repo root by owner decision. Never create `.md` files
  anywhere else.
- **No new npm dependencies** without explicit user approval.
- **Never** edit anything under `newIDE\app\src\locales` by hand (Lingui
  pipeline owns it), and never modify files under `Binaries`, `Core`, `GDJS`,
  `Extensions`, `GDevelop.js` for this project — the BYOK feature is IDE-only.
- **Git:** this checkout **is** a git repository (branch `master`). The owner
  reviews diffs and commits at milestones (e.g. `0802d2d21e`); agents do not
  commit unless the owner asks in that session. Keep the tree free of
  unrelated changes: after any `npm install`, restore dirtied
  `package-lock.json` files with `git checkout --`, and never delete or
  "clean up" files you did not create.

## 5. Workflow

### 5.1 Working a step (per-phase loop)

For each step in the current `PhaseN.md`:

1. Read the step, its "Depends on", and every file it references.
2. Implement following the numbered guide. Stay inside the step's
   files-created / files-modified lists.
3. Write the tests the step requires (every function = one test minimum).
4. Run `npm test -- --watchAll=false`, `npm run lint`, `npm run flow`,
   `npm run check-format` from `newIDE\app`. Fix until green.
5. Check every AC of the step. An AC you cannot verify goes in the worklog under
   "Issues found" — never silently skip it.
6. After the phase's last step: run the phase's manual QA checklist (if any),
   then write the worklog entry.

### 5.2 End-of-session triage

After the last gate run, before closing the session, sweep everything you
found but did not fix, and put each item in **exactly one** place:

- **`REVIEW/outofscoped.md`** — it should be tackled, but was outside this
  session's scope/budget (or waits on an owner decision already listed in
  `usertasks.md`). One entry per item: what, where (`file:line`), what blocks
  it. **Remove an entry as soon as it is fixed and verified** (the permanent
  record then lives only in the worklog) — this file is only "to be tackled".
- **`REVIEW/deferred.md`** — you deliberately decided to postpone it. Write it
  human-readable: what it is, why deferred, when it should be tackled, and the
  standing proposal to the owner.
- **`REVIEW/usertasks.md`** — it needs a human decision, action, or other
  assistance: desktop-only QA, real-endpoint runs, budget approvals,
  accept-or-fix calls, wording of user-visible strings.

If nothing new went into a bucket, the worklog entry says so verbatim:
`no OOS`, `no deferred`, `no UT`. Cross-reference instead of duplicating: each
item lives in one triage doc and may be linked from the others.
`audit2209.md` keeps the full findings detail behind the triage docs.

### 5.3 Decision making

- **Decide yourself** anything reversible, in-scope, and covered by the
  current step's ACs — then record the decision in the worklog.
- **Defer deliberately** (→ `deferred.md`) when the right fix belongs to a
  later phase, a mid-phase refactor would churn a file that is still growing,
  or the work depends on upstream GDevelop changes.
- **Escalate to the owner** (→ `usertasks.md`) when it changes scope or
  product behavior: touching upstream files beyond the recorded budget,
  build/backlog/never on a deferred feature, accept-vs-fix on a known flaw,
  anything needing accounts, a real endpoint, or the desktop app.
- **Present decisions as one numbered plain-text chat message**, each item
  with a one-line recommendation — not as interactive multiple-choice prompts.
  After the owner answers: approved work goes to `outofscoped.md` (or gets
  done immediately if in scope); rejections become by-design entries in
  `deferred.md`.
- The owner clears the triage docs between roadmap stretches. When a
  `deferred.md` item is green-lit, plan it like a phase step; when an
  `outofscoped.md` item is picked up, it re-enters the 5.1 loop.

## 6. Environment cheat sheet

```
cd /c/Projects/GDevelop/newIDE/app
npm test -- --watchAll=false               run the Jest suite once (never raw npx jest)
npm run lint                               ESLint, zero warnings allowed
npm run flow                               Flow type check (see quirk below)
npm run check-format                       Prettier diff check
npm run format                             Prettier write
```

- **Fresh-checkout rebuild** (when `node_modules` is missing): in `newIDE\app`
  run `npm install --ignore-scripts` → `npx patch-package` → `npm run
  make-version-metadata` → `npm run build-theme-resources` → `node
  scripts/import-libGD.js` (the HEAD/HEAD~1 S3 objects 404; the HEAD~3
  fallback downloads). Then `git checkout -- package-lock.json` (the install
  always dirties it). `newIDE\electron-app` additionally needs `npm install
  --ignore-scripts` at its root and in `electron-app\app` for its
  check-format/node checks — the Electron binary itself stays undownloaded
  until a desktop session (usertasks Task 1).
- **Flow quirk:** flow clients can hang when their stdout is a pipe; if `npm
  run flow` stalls, kill stale `flow.exe` processes and run
  `node_modules\flow-bin\flow-win64-v0.299.0\flow.exe check` directly. If
  `node`/`npm` are not on PATH, prefix `C:\Program Files\nodejs`.
- Electron main process (`newIDE\electron-app\app`) has **no test runner** —
  keep anything you add there trivial (thin handlers delegating to
  renderer-tested logic) and verify it with the manual checklist in
  `Phase3.md`. Its `check-format` is green (the two upstream files were
  formatted in owner commit `7283b2fc1c`) — all BYOK electron files pass.

## 7. Using subagents

- Use subagents for **read-only mapping and verification** ("find where X
  happens, with file:line evidence"), not for writing code. Code is written by
  the orchestrating agent so the style rules are enforced consistently.
- A subagent prompt must be self-contained: absolute repo path, the question,
  what files/areas to look at, the required output format, and "READ-ONLY, do not
  modify anything".
- Dispatch at most 5 per wave; wait for results before the next wave. Large
  waves can still hit provider rate limits — retry the failed agents, don't
  redo the whole wave.
- After a wave: consolidate findings, then write the single worklog entry for the
  session yourself (the subagents do not).

## 8. When something doesn't match the docs

The repository moves; the phase docs were written on 2026-09-13 (Phases 1–4)
and 2026-09-21 (Phases 5–9). If a line number, function name, or structure has
shifted upstream:

- Re-locate the equivalent spot yourself (search, don't guess).
*Last updated: 2026-09-24.*
  `file:line`.
- Keep the *intent* of the step (the ACs), not the literal line numbers.

This applies to this manual too: if AGENTS.md contradicts reality, fix the
manual in the same session and say so in the worklog.

---

*Last updated: 2026-09-24.*

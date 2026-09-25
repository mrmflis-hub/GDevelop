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
- **Phases 11 + 12 implemented 2026-09-24** (the owner ordered Phase 12 in
  chat; Phase 11 was its unbuilt prerequisite and was built in the same
  session; D11-1…5 and D12-1…8 answered as recommended). The owner
  **committed** both phases on 2026-09-24 in `c62a67e277` (its commit
  message is unrelated noise — the BYOK work is identifiable via
  `git show --stat c62a67e277`), together with the phase planning docs in
  `ed5a5a5432`.
  **Phase 11 (authoring reach, prompt `byok-v7`, 56 advertised tools):**
  the behavior-preserving instance-core extraction
  (`EditorFunctions/InstanceTools.js` — index.js delegates; the scene
  specs stayed green through it), external events + external layouts tools
  (`Byok/ByokExternalSceneTools.js`, over the same EventScript/instance
  pipelines; the event writer's apply step became container-generic in
  `ByokLocalEventWriter.js`), the effect catalog (`list_effects` in
  `Byok/ByokCatalogTools.js`), sprite internals
  (`Byok/ByokSpriteTools.js` — describe/change over animations/directions/
  frames/points/masks, editor wrapper-lifecycle rules encoded),
  `import_project_resources` (`Byok/ByokResourceTools.js` — URL/absolute/
  in-project sources, replace-in-place, desktop-only), and the extension
  internals (parameters add/remove/move, custom-object children with a
  usage guard, extension dependencies, in `ByokExtensionTools.js`).
  **Phase 11 verification + completion pass 2026-09-24 (second session):**
  five read-only subagents verified every AC against the committed tree;
  gaps closed the same day: the seven extended-tool schema fields
  (`parameters_to_add/remove/move`, `children_to_add/remove`,
  `dependencies_to_add/remove`) added to `ByokToolSchema.js` (the handlers
  existed but the model could not discover them), `children_to_add`
  optional initial property values
  (`getConfiguration().updateProperty`), parameter type changes through
  the upstream refactor hook (`WholeProjectRefactorer.changeParameterType`
  with real ProjectScopedContainers), the knowledge-section tool-name
  typo, the sprite polygon partial-apply fix (validate before clear) +
  the required bad-polygon and wrapper-lifecycle tests, a segment-aware
  in-project-folder check in `ByokResourceTools.js`, the
  arg-before-scene error precedence restored in the put2d wrapper, the
  AIflow.md §4.2/§6/§7 stale sections refreshed, and the BYOK executor
  moved from `toolsVersion: null` to `BYOK_TOOLS_VERSION` (`v15`,
  `ByokTypes.js`) — no-ops are successes for the script-based BYOK agent,
  as for the hosted v15 tools. 208 suites / 2284 tests, all gates green.
  **Phase 12 (discovery/runtime, prompt `byok-v8`, 62 default + 2
  no-project tools):** `get_game_starter_summary` over the public examples
  catalog (no-project advertisement), `search_object_asset_store` /
  `search_resource_store` over the auth-free public catalogs (self-contained
  scorer, session-cached, injectable fetchers), the seam store stubs
  replaced by real installs (`byokSearchAndInstallAsset` →
  `getPublicAsset` + required extensions + `addAssetToProject`;
  resources registered by URL with the store origin — "add an enemy"
  installs), the "Open Ask AI" command + default `Ctrl+Alt+A` (the four
  standard palette touchpoints), MCP `prompts`/`resources` primitives
  (skills as prompts; notes + docs as `gdevelop://` resources; all three
  capabilities advertised; `Byok/Mcp/ByokMcpPrompts.js` +
  `ByokMcpResources.js`), `read_project_notes`, and the debugger tools
  (`Byok/ByokDebuggerTools.js` — read_runtime_details/control_runtime/
  profile_runtime over the preview session's TARGETED debugger channel
  with pushed-profiler-output waits; `ByokPreviewSession.js` gained the
  DebuggerId capture, targeted request/response and the stop()
  closeAllPreviews fix). Evals 30 → 41 tasks. QA Tasks 13/14 open.
- **All 12 phases are now implemented and committed.** On top of them, the
  owner approved and the 2026-09-24 second session implemented the
  **external-item live-redraw channel** (usertasks Task 15):
  `onExternalLayoutModifiedOutsideEditor` / `onExternalEventsModifiedOutsideEditor`
  fan-outs through MainFrame → the external editor containers, wired to
  the BYOK tools (and the MCP host) so AI writes to external
  layouts/events redraw open editors — plus the previous session's
  verification fixes (uncommitted, awaiting the owner's review). **QA
  round 1 (2026-09-24, fourth session, uncommitted):** three owner
  findings triaged — the devtools key difference is the safeStorage
  ciphertext (by design) and "chat routes through GDevelop" was disproven
  with the durable transcript (the observed `ai-request-summary` GET is
  the hosted history list); fixed for real: the benchmark sent no `tools`
  and no token cap (failed 4/4, ~1M tokens burned), BYOK `start_preview`
  could never launch (bad `PreviewOptions` shape), and the upstream
  preview-close crash (`ElectronMainMenu` reading destroyed-window
  properties) got destroyed-window guards. **QA round 2 (2026-09-24,
  sixth session, uncommitted):** the owner had the outstanding QA driven
  with Computer Use against real CometAPI keys (two providers; models
  gpt-6-luna, mimo-v2.6-flash, glm-5.3-flash; shared $1.50 pool). All
  four round-1 re-tests PASSED (benchmark fix verified: real tool calls,
  19–25k tokens; `start_preview` opens and round-trips capture/inspect;
  routing sanity clean), Task 8.2 PASSED, large parts of Tasks 6/12/14
  PASSED (full coverage summary in `usertasks.md`). Two new bugs were
  **fixed with specs**: `ByokPreviewSession` registered only 3 of the 6
  debugger fan-out callbacks (uncaught TypeError blanked the editor) and
  the MCP stdio adapter's discovery path used "GDevelop" instead of the
  userData folder "GDevelop 5" (broke all zero-config MCP clients).
  One new bug **filed in `outofscoped.md`**: the benchmark's event-batch
  application crashes the libGD WASM heap for any model and poisons the
  module until reload. Endpoint-compat findings recorded in
  `deferred.md`: gpt-6-luna rejects `tools`+`reasoning_effort` on
  CometAPI chat/completions (needs `none`, which BYOK never sends), and
  glm-5.3-flash returns 200-with-garbage after very large tool outputs.
  Remaining work: the human QA list in `usertasks.md` — **Tasks 1, 2
  PASSED (owner), 8.2 PASSED, 11's 9.3/9.4/9.5 PASSED**; still open:
  Tasks 6 (events headline, stuck loop, refused batch), 7, 9, 10, 13,
  parts of 11 (stall notice, 40+-round compaction) and 12
  (second-instance refusal, stale-takeover, activity-log visual),
  14 (palette, offline) — plus the owner's review of the uncommitted
  sessions' diffs. **Phase 13 IMPLEMENTED 2026-09-25 (uncommitted; the
  owner ordered it in chat), all 8 steps + every phase-gate AC built —
  see the 2026-09-25 Phase-13 worklog entry for the full inventory:**
  13.1 chat panel consolidation (header = green/red BYOK toggle + token
  row hidden when off; effort pill + provider/model dropdown with a
  "Model from settings" default moved to the bottom bar, both persisting
  on the chat record; the Recents rail (AskAiHistory) now lists the
  durable BYOK chats (open/archive/restore/delete inline, persisted
  metas + session chats merged in `useByokChatSeam`) above the hosted
  list; ByokChatHistory.js deleted), 13.2 homepage-form carryover
  (`pickByokChatToSelectOnMount` re-selects the single working chat on
  editor remount), 13.3 the "+" attach button (`ByokAttachments.js`:
  text files extension+NUL-sniffed and 100 KB-capped as fenced blocks,
  images through the BYOK image store, user-message `images` ids replay
  as image_url parts, sidecar + compaction aware; chips + menu gating),
  13.4 the settings tab rebuilt to the owner's layout (three checkboxes,
  PROVIDERS cards with Advanced unrollers holding PER MODEL SETTINGS —
  temperature/max tokens/context window/Run benchmark per provider+model,
  DEFAULT STRONG/FAST as provider+model pairs with
  `migrateByokRoutingProfiles`, WHILE THE AI IS WORKING, CHAT HISTORY
  STORAGE, MCP card unchanged; `ByokProvider.modelSettings` + the router
  overlay + provider-aware context windows), 13.5 the budget pass
  (`BYOK_CORE_TOOL_NAMES` = 27 advertised tools incl. the new
  `search_tools` meta-tool, prompt version **byok-v9**, retrieval map +
  20-entry machine-checked task catalog, prompt budget 5500 with the
  authoring-reach/cheat-sheet/packs degradable;
  `ByokPromptBudget.spec.js` guards ≤15k hard — measured 11.5k worst-case
  with a full 2 KB custom-instructions payload, ~10.5k typical; the
  8–10k band is reported in the spec output), 13.6 EventScript harness
  (non-degradable pinned syntax block + 3 canonical examples;
  `docs/eventscript-examples.json` = 11 tagged examples round-tripping
  through the real writer, merged into search_reference; rejected
  batches carry a targeted `retryHint`), 13.7 on-device RAG
  (`Byok/Rag/`: corpus ~2.4k chunks, lazy Transformers.js embedder
  (`@huggingface/transformers` ^4.3.0, the phase's single approved new
  dep), deterministic in-process index with base64 vectors, `byok-rag-*`
  IPC + IndexedDB backends, `search_knowledge` hybrid search with the
  RAG-off lexical fallback + neighbor reads, eval set 24 queries ≥70%
  top-3 hit-rate with the hashing test embedder), 13.8 the RAG
  preferences tab (status card, embedder picker with size+consent,
  rebuild progress, opt-in docs folder, backend switch, Qdrant card) +
  the permanent Qdrant setup (`ByokQdrantSetupCore.js` pure CJS state
  machine: use-existing/install/spawn/health/fallback;
  `electron-app/app/ByokQdrant.js` downloads the official release,
  loopback-only config, child killed on quit; `ByokRagFiles.js` IPC).
  221 suites / 2428 tests, all four gates green. `REVIEW/FTmodel.md` =
  the local fine-tuned generation track (LoRA/Unsloth, ternary
  Bonsai-class bases) — explicitly long-term, NOT scheduled.

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
  "implement this" order on the presented recommendations), the
  2026-09-24 surface-audit backlog (the owner picked 10 candidates,
  planned as `Phase11.md` + `Phase12.md`), and D11-1…5 + D12-1…8
  (answered 2026-09-24 at implementation, as recommended, when the owner
  ordered Phase 12 in chat).
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
- **Documentation conventions (owner-approved 2026-09-25):** in docs you write
  or rewrite, use one sentence per line (no manual hard-wrapping) so edits and
  diffs stay line-local, and give checklist/triage items stable IDs — e.g.
  `[T12-activity-log]`, `[D13-4]` — with a status token on the line (`[open]` /
  `[done]`). Terse IDs are fine, but the item body must explain in plain words
  what the ID stands for; everything else stays plain human-readable markdown.
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
*Last updated: 2026-09-25.*
  `file:line`.
- Keep the *intent* of the step (the ACs), not the literal line numbers.

This applies to this manual too: if AGENTS.md contradicts reality, fix the
manual in the same session and say so in the worklog.

---

*Last updated: 2026-09-25.*

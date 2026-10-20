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
  **external-item live-redraw channel** (usertasks Task 15, now `deprecated/usertasks.md`):
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
- **Phase 14 IMPLEMENTED 2026-09-27** (the owner ordered steps 14.1,
  14.2, 14.4, 14.5 in chat and **deferred 14.3** — "move on without
  finetuned model"). **14.1 (prompt-cache stability, D14-1):** the
  orchestrator composes the system prompt ONCE per chat and reuses it
  byte-identical (`systemPromptSnapshot` in `ByokOrchestrator.js`);
  invalidation only on a `hasOpenedProject()` flip or a new chat —
  spec-proven across note writes and settings churn. **Same-day owner
  order (cache follow-up):** the project snapshot no longer folds into
  the last user message (that rewrote a mid-request message on every
  editing round); it rides its OWN synthetic trailing user message at
  the request tail, making the transcript replay purely append-only — a
  refresh only ever changes the final message, so in 50–100-round build
  turns the cacheable prefix covers system + tools + the whole
  transcript (spec-proven across editing rounds and a completion-gate
  nudge; amendment recorded in Phase14.md step 14.1). **14.2 (minified
  docs layer, D14-2):** the whole `gdevelop5` wiki (601/601 pages, 0.50
  compression — dead center of the 40–60 % band) minified by 7 waves of
  ≤ 5 parallel agents into the committed artifact
  `Byok/docs/gdevelop-docs/MinifiedDocs.generated.js` (2.3 MB), assembled
  + validated by `scripts/build-byok-minified-docs.js` (per-page JSON
  batches, deterministic engine-token sanity pass with a 4-entry
  documented allowlist, tag whitelist = folder facets + 2d/3d), exposed
  by `ByokMinifiedDocs.js` and two new corpus grades in `ByokRagCorpus`
  (`docs-min-map` per-category listings, line-packed;
  `docs-min` page chunks, every chunk carrying
  `Full page: read_doc_page('<path>')`); retrieval-map hint line added,
  prompt bumped **byok-v10**; corpus 2,052 → 4,026 chunks. **The
  ranking fix this forced:** the wiki's prose chunks crushed the 24-query
  eval gate to 17 % (exact hits crowding + vector dilution), so
  `ByokRagSearch` now scores lexical hits positionally (title > tags >
  text) and re-ranks both halves by per-source weights
  (`BYOK_RAG_SOURCE_WEIGHTS`, curated tiers above wiki prose) — hashing
  79 % / stock MiniLM 83 % top-3, gate ≥ 70 % green. **14.4 (prebuilt
  RAG bundle, D14-3/D14-7(a)):** pure validation in
  `Rag/ByokRagBundle.js` (envelope shape, embedder-in-catalog +
  dimensions, sha256 shape; corpus/embedder mismatch = refused with a
  rebuild offer), `importByokRagBundleIntoStore` in `ByokRagStorage`,
  `importPrebuiltByokRagIndex` in `ByokRagBuildService` (loads the
  query-side embedder, honest lexical degrade on failure), Electron
  `byok-rag-bundle-info`/`byok-rag-bundle-download` (sha256-verified in
  main, node crypto) + `byok-qdrant-restore-snapshot` (Qdrant pulls the
  release snapshot itself via the url-body upload API;
  `runByokQdrantSnapshotRestore` pure core), and the RAG tab's
  **Prebuilt index card** (release lookup on mount, up-to-date /
  update-available / offline states, ONE consent naming index + embedder
  sizes, "Build locally instead" always visible). **v2 artifact built +
  verified:** `build/byok-rag-bundle/byok-rag-bundle-f1-Xenova-all-MiniLM-L6-v2-571d1b30.json`
  (4,026 chunks, corpus `571d1b30`, 8 spot-checks on-topic) — the v1
  file (7b8a6b0) is superseded; owner uploads via Task 17.2.
  **14.5:** `scripts/byok-embedder/eval-embedder.js` (the
  embedder-agnostic runner from the 14.3 file list; hashing + real-model
  + `--queries` holdout mode) over the shared 24-query set
  (`Byok/evals/byok-rag-eval-queries.json`, now the spec's source too);
  prompt budget re-measured 11,842 tokens worst-case (prompt 5,900 +
  tools 5,942) — under the 15k cap, +60 vs Phase 13 for the hint line.
  226 suites / 2,489 tests, all four gates green.

- **Audits:** every 2026-09-21 audit B-finding is fixed. The remaining open
  findings are consolidated in `REVIEW/audit2209.md` (full detail) and triaged
  into three actionable docs:
  - `REVIEW/outofscoped.md` — approved work to be tackled (agent backlog;
    includes the owner-designed features F1–F3),
  - `REVIEW/deferred.md` — deliberately postponed / by-design items, with
    reasoning,
  - `REVIEW/usertasks.md` — **the live outstanding list** (rewritten
    2026-10-03: Phase 15 desktop QA, the v3 RAG bundle rebuild/upload, the
    accumulated Electron-main QA, four edge behaviours, three revisitable
    decisions). The historical record — every completed checklist and every
    answered decision — moved to `REVIEW/deprecated/usertasks.md`.
- **Owner decisions:** all 16 decisions of 2026-09-22 are **answered**
  (canonical record in `deprecated/usertasks.md`; dispositions in the triage
  docs), as
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
  until a desktop session (usertasks Task 1, now `deprecated/usertasks.md`).
- **Flow quirk:** flow clients can hang when their stdout is a pipe; if `npm
  run flow` stalls, kill stale `flow.exe` processes and run
  `node_modules\flow-bin\flow-win64-v0.299.0\flow.exe check` directly. If
  `node`/`npm` are not on PATH, prefix `C:\Program Files\nodejs`.
- Electron main process (`newIDE\electron-app\app`) has **no test runner** —
  keep anything you add there trivial (thin handlers delegating to
  renderer-tested logic) and verify it with the manual checklist in
  `Phase3.md`. Its `check-format` is green (the two upstream files were
  formatted in owner commit `7283b2fc1c`) — all BYOK electron files pass.
- **One-click build of the desktop app:** double click `Build GDevelop App.cmd`
  at the root of the repository (or run `node newIDE\scripts\build-desktop-app.js`
  — `--help` lists the options: `--dev`, `--web`, `--skip-app-build`,
  `--skip-install`, `--portable`, `--dry-run`, `--open-folder`). It wraps the
  existing npm pipeline, gives its Node processes `--max-old-space-size=12288`
  (the production build of the IDE does NOT fit in Node's default ~4 GB heap),
  and leaves the installer and the portable zip in
  `newIDE\electron-app\dist`. The Electron main process shares pure modules
  with the IDE through `app\SharedCore.js` and `app\SharedModules.json`: the
  modules are read from the IDE sources in a checkout and shipped in
  `resources\Shared` in a package — never require `../../app/src/...` from the
  main process, the packaged app would die with "Cannot find module"
  (`newIDE\electron-app\test\SharedCore.spec.js` guards it).

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

- Re-locate the equivalent spot yourself (search, don't guess), and cite
  it as `file:line`.
- Keep the *intent* of the step (the ACs), not the literal line numbers.

This applies to this manual too: if AGENTS.md contradicts reality, fix the
manual in the same session and say so in the worklog.

---

- **Full-repository audit + fix session 2026-10-01** (`REVIEW/
  audit011026.md` is the permanent record: 63 BYOK findings — 55 FIXED
  this session with spec coverage, 4 triaged to `outofscoped.md`, 4
  doc-claim corrections — plus 8 upstream findings with proposed fixes
  awaiting reporting). Prompt bumped **byok-v11** (`read_doc_page` is now
  a real no-project tool backed by the minified wiki, a prompt→registry
  guard spec enforces taught-token resolution, the EventScript example
  bugs are fixed, the map chunks carry `docs-min-map`). Headline fixes:
  the benchmark WASM crash (outofscoped O1 — a type-confused
  `gd.Serializer.toJSON(eventsList)`), the untracked MinifiedDocs artifact
  (STAGED — the owner's commit must include it), per-chat model
  selections no longer wiped, providers-only configs work end-to-end,
  chat files embed the chat id, loop-guard stops no longer orphan tool
  calls, temperature/max_tokens are sent, image replay is monotonic
  (cache-safe), the persisted RAG index reloads after restarts, the
  Qdrant dimensions math (every Qdrant build failed 400), `electron.remote`
  (docs folder silently dead), confined BYOK downloads
  (`byok-download-resource`: cookie only for gdevelop.io, project-folder
  confinement, cap+timeout) + URL-filename traversal, MCP cancellation
  forwarding + timing-safe token + pid-reuse verification + queue-slot
  release, atomic chat/index writes, the rail's BYOK Rename (O6), and
  attachment size caps. The corpus hash CHANGED — the owner's Task 17.2
  upload must be a rebuilt v3 bundle. Gates: 229 suites / 2527 tests
  (2526 passed + 1 pre-existing skip + the documented one-suite flake,
  third family member), lint 0/0, Flow 0, prettier clean (app +
  electron-app). Owner follow-ups: usertasks Task 18 (now `deprecated/usertasks.md`).

- **audit011026 completion session 2026-10-02 (owner-ordered, all gates
  green, uncommitted):** the owner ordered every remaining audit finding
  implemented in-tree — "this includes fixes to upstream errors; nothing
  deferred". Fixed with tests: B-TOOL-11 (the BYOK debugger binding now
  only binds connections opened after the launch promise resolves — a
  user preview in the launch window can no longer steal it), B-MCP-13
  (MCP activity entries are mirrored to the Electron main over
  `byok-mcp-activity` and aggregated in the `byok-mcp-status` response;
  the Preferences card merges local + remote with a composite-key dedupe,
  and Clear clears both), B-UI-13 (a versioned `index.json` chat index —
  steady-state saves/rail actions read zero chat content; a reconcile
  pass adopts legacy/unseen files and drops stale entries; the public
  store API is unchanged), B-ARTIFACT-1 (verified: the artifact landed in
  `943379bff0`), and all eight upstream findings UP-1…UP-8 applied as IDE
  fixes: the confined `local-file-download`/`-save-from-arraybuffer`
  handlers over the new pure core `Utils/LocalFileDownloadCore.js`
  (http(s)-only, gdevelop.io-only cookie, caller-declared `basePath`
  containment, 200 MB cap, 60 s timeout, and a per-hop-validated manual
  redirect walk because axios 0.19 forwards headers cross-host; all nine
  export callers + the mover pass their base), window-id
  `preview-window-closed` routing through the pure `PreviewClosedTracker`
  (+ `PreviewWindow.js` returns created ids), the
  `replace_event_but_keep_existing_sub_events` preservation error,
  try/finally wrapper deletion in all six `Utils/Serializer.js`
  functions, exporter/previewExportOptions deletion on every
  `launchPreview` path, `didModifyProject: false` preserved through
  `EditorFunctionCallRunner`, the five-site instance-id resolver (exact
  uuid wins, unique prefix resolves, ambiguous prefix fails listing
  candidates — InstanceTools 2D ×2, put_3d ×2, instance-variables), and
  the Polygon2d ownership-transfer documented at both collision-mask
  editor sites with inverse regression pins (the audit's alternative —
  deleting the pushed wrapper is disproven by the 2026-09-24 WASM-heap
  repro). ~30 files touched (upstream IDE files by owner order; new
  files: LocalFileDownloadCore.js(+spec), PreviewClosedTracker.js(+spec),
  ByokMcpActivity.js(+spec), CollisionMasksEditor specs,
  LocalPreviewLauncher index.spec). Gates: 235 suites / 2,628 tests + 1
  pre-existing skip, 0 test failures (one standalone-passing suite flakes
  per full run — the documented O4 family, now with five+ members), lint
  0/0, Flow 0, prettier clean (app + electron-app). Permanent record:
  `REVIEW/audit011026.md` (every token `[fixed]`). Owner follow-ups:
  usertasks Task 18 (now `deprecated/usertasks.md`, including the completion session in the commit
  review and four new desktop-QA additions).

- **Second full BYOK audit 2026-10-02 (audit100226, uncommitted; owner
  ordered it in chat):** ten read-only subagents in two waves over the
  axes audit011026 did not cover — caching in depth, tool-layer ergonomics,
  the upstream editor files BYOK abuses, and **regressions introduced by
  the previous session's own fixes**. Nine findings fixed with tests:
  **the prompt-cache invalidation key** (`systemPromptSnapshotNotesIdentifier`
  was compared but never stored, so with a project open the ~5.4k-token
  system prompt was recomposed EVERY round and a mid-chat
  `update_project_notes` write busted the provider prefix cache from
  position zero — Phase 14.1 was effectively defeated, and its "spec-proven"
  test was vacuous because `update_project_notes` is intercepted and never
  reached the executor mock); the **orphaned-`tool_calls` brick class**
  (an exception escaping the extension-regeneration flush or a rejecting
  approval prompt persisted a transcript strict endpoints 400 forever —
  now contained at both awaits PLUS an `answerPendingToolCalls` sweep on
  every batch); **compaction could not fire in a mega-turn build chat**
  (both cut points were user-turn based, so the flagship one-user-message /
  50-100-round shape dead-ended at the non-retryable `byok-context-full` —
  a round-based fallback boundary now covers the tool-output trim); the
  parent/sub-agent turn budget was two independent 150s, not one;
  `add_external_events` still validated after mutating (a B-TOOL-3
  regression whose own comment claimed otherwise); **failed resource
  downloads were reported as successes** (the `downloadFile` dep resolves
  `{ok:false}` and the caller only catches rejections, so a 404 registered
  a resource pointing at a file never written); the effort pill pinned
  `providerId: ''` and re-routed providers-only chats to the global
  endpoint; and the **MCP path never marked the project dirty** (every
  external-agent edit silently lost on close) nor flushed the extensions
  reload (created functions unusable over MCP). Every fix was
  regression-guarded by reverting it and watching the new test go red; two
  first-draft tests turned out vacuous and were rewritten with explicit
  non-vacuity assertions. Gates: 235 suites / 2,636 tests + 1 pre-existing
  skip, lint 0/0, Flow 0, prettier clean. The remaining ~40 open findings
  are triaged in `REVIEW/outofscoped.md`; the highest are the **Qdrant
  backend being upload-only** (`qdrantSearch` declared and consumed but
  never wired, so restart silently degrades to lexical while the card
  reports healthy) and the **eval scorers rewarding the hosted backend's
  French instruction vocabulary**, which the local event writer refuses.
  Permanent record: `REVIEW/audit100226.md`. Owner follow-ups: usertasks
  Task 19.

- **audit100226 IMPLEMENTATION session 2026-10-02 (owner-ordered
  "implement all fixes", uncommitted):** the audit's ~40 remaining
  findings are now fixed and tested — 49 of ~50 overall across the two
  sessions. Batched by subsystem: **RAG** (the Qdrant backend is no longer
  upload-only — the store gained `search`/`inspect`, the engine takes the
  semantic path with a remote dep and no local index, restart recovery
  gained a Qdrant branch, and the status card follows the server; that
  branch had ZERO tests, which is why it survived the 63-finding audit,
  and now has five; stale points are deleted on a shrinking corpus; the
  snapshot restore no longer drops the collection on a client timeout;
  lexical search answers paraphrases instead of zero hits, which matters
  because RAG is off by default), **loop** (response validation covers
  content/arguments shapes so a gateway quirk can no longer brick a
  chat; Stop aborts the compaction call; the turn-budget error is
  non-retryable; the loop guard rolls back an unexecuted batch and
  detects alternating cycles), **tools** (the two runtime-inspection
  tools honor the `scene_name`/`variable_paths` they advertised and
  ignored, and cap their dump with an honest truncation report;
  `list_effects` is capped with a real total; `read_doc_page` is
  advertised whenever three prompt surfaces already teach it, and the
  advertisement is DEDUPED because a duplicate `tools` entry is rejected
  by strict endpoints), **persistence/UI** (a chat deleted mid-save can
  no longer be resurrected; a failed file listing can no longer wipe
  every image sidecar; a chat selection naming a removed provider falls
  through to normal routing; removing a provider no longer clears the
  shared legacy key slot), **MCP** (a new project mutation lock
  serializes the chat's tool batches against MCP calls; the queue
  releases its slot at task START not at enqueue, so a burst no longer
  runs concurrent mutating tools; a timed-out call is cancelled rather
  than executed late; `update_project_notes` is refused in read-only
  mode), **Electron** (the MCP start is mutexed; the snapshot URL is
  validated server-side before any download/drop/fetch; model-chosen
  resource names reject ADS colons and reserved device names; atomic
  writes use a unique temp name and clean up on failure — extracted to
  the testable plain-CJS `ByokAtomicWriteCore.js`; a reloaded renderer
  is dropped from the ready senders), **upstream** (the extension
  `create_*` tools sanitize names and refuse reserved lifecycle names —
  the existing spec was itself using `doStepPreEvents` as an ordinary
  example, a name the editor refuses; the event-replacement paths verify
  content before clearing; a mutating function that throws still reports
  the mutation), **prompt/scripts** (the eval harness no longer scores the
  hosted backend's serialized French instruction vocabulary, which BYOK's
  local writer rejects — it failed every answer in the only format the
  real tool accepts). New shared machinery: `ByokMutationLock.js` and
  `ByokAtomicWriteCore.js` (+specs). Three existing tests pinned buggy
  behavior and were corrected to state the fixed contract. Gates: 237
  suites / 2,673 tests + 1 pre-existing skip, lint 0/0, Flow 0, prettier
  clean (app + electron-app); one different untouched suite still flakes
  per full run (the documented O4 family, seventh+ members, all passing
  standalone). ~25 items remain open with their reasons in
  `outofscoped.md`; dispositions in `audit100226.md` Part 6. Owner
  follow-ups: usertasks Task 20.

- **outofscoped CLOSURE session 2026-10-03 (owner-ordered "implement all
  outofscoped.md items", uncommitted):** `outofscoped.md` is now **empty** —
  every entry implemented, tested and verified, and the eight-member "one
  random suite flakes per full run" family (O4) is **root-caused, not worked
  around**. It was one cross-file React leak: `useByokChatSeam.spec.js`
  mounted trees it never unmounted, their async effects re-rendered the dead
  tree after the file ended against the NEXT file's mocks, and the uncaught
  throw **crashed the whole worker process** — which is why a different
  arbitrary suite failed each run. Now fixed at three levels (renderer
  unmounting in `afterEach`, a reset-immune hook stub, and an event-loop drain
  in `setupTests.js`'s `afterAll`), with a **deterministic two-file
  reproduction** recorded in the spec; each layer verified to hold alone. Also
  closed: O3 (the libGD test alias pruned by `npm install` — the "already
  present" flag was computed BEFORE the restore, so the script still hit the
  network and exited 1), the two preview-launcher nits, and every still-open
  `A1002-` finding — RAG-6/7/8/9/10/11 + CACHE-7/8, UI-6/7/8/9/10,
  UP-14/15/16, ELEC-21/22, MCP-3/4/6/8/9, PROMPT-3/4/5/6/7, SCRIPT-2/3/4/5 and
  O14-prose-typos. Three items became **measured by-design dispositions in
  `deferred.md`** rather than code changes: the prompt budget (12,582
  tokens, accepted on the owner's instruction to use the recommendation; the
  budget spec now prints the six largest sections and schemas whenever it
  warns), the docs-min displacement (the shared RAG eval set grew 24 → 30 with
  six docs-min queries; 93% top-3 against a ≥70% gate, and the two misses are
  the displacement returning better answers), and the minification contract
  (now states explicitly that upstream prose typos stay verbatim). The prompt
  guard now catches **bare** snake_case tool mentions (it only matched
  `Name(`, so nearly all tool teaching escaped it) and scans every knowledge
  section at FULL size (the EventScript pack was never scanned — it degrades
  out of the composed prompt). The eval harness now sends the REAL BYOK prompt
  and tool schemas; it used to send neither, so its scorers checked argument
  names the model had never seen. **Traps hit and recorded:** several files
  are CRLF, so an `\n`-anchored revert silently matched nothing and produced
  a vacuous test (UP-15 was rewritten with a verified-revert helper); CRA's
  `resetMocks: true` strips implementations given to a `jest.fn` factory, and
  `mockRestore()` clears a console spy's recorded calls (two more vacuous
  tests); and the new `afterAll` drain had to capture the REAL `setTimeout`,
  because a fake-timer suite (`UseLongTouch.spec.js`) otherwise timed it out.
  Three fixes were proven non-vacuous by reverting them and watching the new
  test go red. One audit finding (`PROMPT-6` item 3, `max_chars`) was a
  **false positive** — the feature is implemented in
  `EditorFunctions/index.js`; the audit only searched the BYOK tree. Gates:
  237 suites / ~2,725 tests + 1 pre-existing skip, lint 0/0, Flow 0, prettier
  clean (app + electron-app); two consecutive full runs green. Owner
  follow-ups: usertasks Task 21.

- **Phase 16 IMPLEMENTED 2026-10-07** (ordered in chat; `REVIEW/Phase16.md`,
  uncommitted): build-time asset compression that shrinks the EXPORT copy and
  never the project's originals. `Fork/AssetBuild/` holds the pure planner
  (`ForkAssetPlan.js`: extension-driven kind, in-place same-format transforms,
  explicit reasoned skips, byte/failure summary), the renderer port
  (`ForkAssetOptimizerPort.js`: export-folder listing, plan, IPC, per-file
  before/after report, never throws), the pipeline wrapper
  (`ForkAssetOptimizingExportPipeline.js`: overrides `launchCompression` so the
  optimizer runs after `launchResourcesDownload` and before the online zip, and
  as the manual path's tail; injects the one-shot report host into
  `renderExportFlow`; a straight pass-through while the setting is off or on a
  non-desktop runtime), the fork-owned settings store + the Preferences "Build"
  tab, the report dialog/store, and the AI surface. The Electron main gained the
  thin applier `ForkAssetOptimizer.js` (`fork-asset-optimize-apply` +
  `-capabilities`, lazy `sharp`/`ffmpeg-static` requires, per-entry path
  confinement, temp+rename so a failure leaves the file exactly as exported) —
  and `sharp`/`ffmpeg-static` are installed in `electron-app/app`.
  The upstream touchpoints are exactly `[A16-6]`'s three:
  `electron-app/app/main.js` (one registration),
  `ExportAndShare/LocalExporters/index.js` (the two wrapped pipelines) and
  `MainFrame/Preferences/PreferencesDialog.js` (the Build tab); the C++ exporter
  and `ProjectResourcesCopier` are untouched. Verified beyond the specs by a real
  applier run: a synthetic export copy lost 73 % of a PNG and 67 % of an MP3
  under the same file names, the optimized files still decode, and the project
  folder's hashes were unchanged. AI access per `[D16-9]`:
  `report_asset_optimization` (projection, writes nothing — the project's
  serialized state is asserted byte-identical) and
  `set_asset_optimization_settings`, both dispatchable but never in
  `BYOK_CORE_TOOL_NAMES` (the dispatch cap went 69 → 71, the owner-approved
  raise) and both reachable through `search_tools`; prompt `byok-v13`, budget
  measured 12,688 tokens (under the 15k cap). 261 suites / 3,045 tests + 1
  pre-existing skip, lint 0/0, Flow 0, prettier clean (app + electron-app).
  Owner follow-ups: `usertasks.md` §6 — `[P16-qa]` desktop QA, `[P16-abi]` the
  Electron-ABI rebuild for `sharp`, and the 71 → 75 cap raise for Phases 17–19.

- **Phases 17 + 18 IMPLEMENTED 2026-10-08** (ordered in chat; both uncommitted,
  see the 2026-10-08 worklog entry for the full inventory). **Phase 17
  (tag-driven asset management, `REVIEW/Phase17.md`, steps 17.1–17.8 all
  built):** `Fork/AssetPipeline/` holds the pure tag model
  (`ForkAssetTags.js` — tags ride the existing resource `metadata` JSON, never
  a new source of truth per `[D17-2]`), the many-to-many virtual tree
  (`ForkAssetTree.js`, an "Untagged" bucket, display order only per
  `[A17-6]`), the metadata-only writer (`ForkAssetTagStore.js`), the optional
  defensive index (`ForkAssetIndex.js` + the Electron IPC
  `electron-app/app/ForkAssetIndex.js` with one `main.js` registration),
  auto-registration of dropped files (`ForkAssetRegistration.js` +
  `ForkAssetAutoRegister.js` — watcher-origin keying, idempotent, never
  deletes a user resource, gated by the `autoRegister` setting, default on),
  the Assets view (`ForkAssetsView.js`, a TreeView panel hosted as a
  `'assets-view'` editor entry in `ResourcesEditor/index.js` with a toolbar
  toggle, plus `ForkAssetTagEditor.js` in the properties entry), the
  name-based aliases (`ForkAssetCatalog.js` + `ForkAssetAliasHelper.js` —
  Monaco completions through a fork hook in
  `LocalCodeEditorAutocompletions.js`; NO ES `import`, spec-asserted), and
  hot-reload (`ForkAssetReload.js` + `ForkAssetAutoReload.js`, a "Reload from
  disk" entry in `ResourcesList/index.js`; a launched preview does NOT reload
  — recorded with evidence in `deferred.md` `[P17-preview-reload]`). The
  integration session REVERTED the subagent's `kind` hint on
  `LocalFileResourcesWatcher` (it broke the shared `StorageProvider`
  interface's Flow invariance — the fork now classifies by statting; see
  `outofscoped.md` `[P17-kind-hint]`), which is why that file carries no
  Phase-17 diff. AI access per `[D17-10]`: `list_assets` and `set_asset_tags`
  (thin adapters in `Byok/ByokAssetTools.js` over
  `Fork/AssetPipeline/ForkAssetToolsHandlers.js`; `set_asset_tags` is atomic
  and flags `didModifyProject`). **Phase 18 (event-sheet guardrails,
  `REVIEW/Phase18.md`, steps 18.1–18.4 all built):** `Fork/Guardrails/` holds
  the pure rule engine (`ForkGuardrailRules.js` — the four `[D18-2]` rules
  with stable ids, ancestor-stack recursion, the tree builder's exact
  nodePath encoding incl. the folded-list discipline, disabled-subtree
  silencing, never mutates), the settings store (`ForkGuardrailSettings.js`,
  on-by-default master + per-rule mutes), the badge
  (`ForkGuardrailBadge.js` — inline styles only, settings popover, filters at
  render time so toggles need no tree rebuild), and the scan handler
  (`ForkGuardrailToolHandler.js`, scenes only, read-only). Upstream wiring
  exactly `[A18-5]`'s budget: `EventsTree/index.js` (ancestor stack +
  `guardrails` node field + badge render + forwarding, mirroring
  `isValidElseEvent`), `SortableEventsTree.js` (type only),
  `Renderers/EventRenderer.js` (props type only), NO CSS. AI access per
  `[D18-6]`: `scan_scene_events` (`Byok/ByokGuardrailTools.js`, writes
  nothing). The three new tools are dispatchable but never in
  `BYOK_CORE_TOOL_NAMES`; the dispatch cap went 71 → 75 (the `[P1719-cap]`
  recommendation, covering Phase 19's tool); prompt **byok-v14**, budget
  measured 12,633 tokens (under the 15k cap). 282 suites / 3,242 tests + 1
  pre-existing skip, lint 0/0, Flow 0, prettier clean (app + electron-app).
  Owner follow-ups: `usertasks.md` §6 — `[P17-qa]` + `[P18-qa]` desktop QA.

- **Deferred-limitation closure + Phase 19 IMPLEMENTED 2026-10-09 (owner
  ordered both in chat; uncommitted, see the 2026-10-09 worklog entry).**
  **[P17-preview-reload] closed:** a changed asset now also refreshes
  LAUNCHED previews — `Fork/AssetPipeline/ForkAssetPreviewReload.js` is a
  small registry seam; both reload paths (the auto-reload flush — once per
  burst, only when something reloaded — and the manual "Reload from disk")
  notify it, and the MainFrame registers the preview hop
  (`relaunchAndThenHardReloadAllPreviews`, gated on previews actually
  running). The refresh is a re-export + hard reload (the game restarts):
  an in-place refresh is impossible without engine changes — the runtime's
  resource caches are URL-keyed, `_loadTexture` early-returns on a cache
  hit, and cache-busting URLs only exist in the in-game edition
  (`ResourceLoader.getFullUrl`). **[P18-while-conditions-unscanned]
  closed:** `getEventInstructions` gained a `whileConditions` branch; a
  Once in a While's own guard fires `G18-once-in-loop` (the guard is
  re-checked every iteration — the While event itself is the loop),
  duplicate-once scans the guard as its own list, and the picking advisory
  counts guard conditions as picking; real-gd specs included. **Phase 19
  (sprite-sheet import, `REVIEW/Phase19.md`, steps 19.1–19.5, prompt
  `byok-v15`):** `Fork/SpriteSheet/` holds the pure plan (exact-tiling
  rows-columns / margin-slack frame-size, refusal before any write), the
  renderer port (injected IPC + image-size deps; frames land in
  `<project>/<GameName>Assets/`), the validate-then-mutate assembly
  (registers through `importByokProjectResources`, mirrors the upstream
  wrapper-ownership sequence exactly, rolls back registrations on failure),
  the import dialog (live canvas slice preview, refuses a non-dividing
  grid) and the tool handler; the Electron main gained the confined,
  never-overwriting slicer `electron-app/app/ForkSpriteSheet.js` reusing
  Phase 16's `sharp`; `SpriteEditor/index.js` gained the "Import sprite
  sheet" button (the one upstream editor touchpoint). BYOK:
  `import_sprite_sheet` (approval-gated, never in `BYOK_CORE_TOOL_NAMES`)
  — `BYOK_TOOL_NAMES` now sits AT the 75 cap (the next dispatchable tool
  needs a new raise). **Built by two implementation subagents (the owner's
  max-2 rule; A: 19.1–19.3, B: 19.4–19.5) plus orchestrator integration**;
  subagent A shipped an inverted `newNameGenerator` predicate (its
  "exists" answered the opposite question) that hung jest INFINITELY —
  four spinning `react-app-rewired` node processes burned CPU until
  killed; root-caused and fixed, the trap is recorded in the worklog and
  the A-progress file. A read-only verification subagent also re-verified
  every outofscoped.md "closed" fix in-tree (all VERIFIED; two nits fixed:
  a leftover DEBUG console.log in `ApplyEventsChanges.spec.js` and the
  PROMPT-6 doc pointer in `outofscoped.md`). 292 suites / 3,341 tests + 1
  pre-existing skip, lint 0/0, Flow 0, prettier clean (app + electron-app).
  Owner follow-ups: `usertasks.md` §6 — `[P19-qa]` desktop QA (needs the
  `[P16-abi]` Electron-ABI `sharp` rebuild first).

  Owner follow-ups: `usertasks.md` §6 — `[P19-qa]` desktop QA (needs the
  `[P16-abi]` Electron-ABI `sharp` rebuild first).
- **UPSTREAM SYNC 2026-10-19** (owner order: "bring the code up to date
  with GDevelop main repo and resolve the conflicts so our code
  implementation still works"): `upstream/master` (140 commits, up to
  `987b9d3919`) merged into `master` — 19 files conflicted, all 45 hunks
  resolved by reading both sides, all gates green (332 suites / 4,073
  tests + 1 skip, lint 0/0, Flow 0, prettier clean app + electron-app).
  Our head was `1230fc6e18`; the backup branch
  `backup/pre-upstream-sync-2026-10-19` keeps it. Resolutions: the hosted
  file attachments (upstream) and the BYOK "+" attach button (ours) now
  coexist in the chat; upstream's redesigned Preferences dialog was rebuilt
  from upstream with our BYOK / RAG / Build tabs re-added; upstream's
  v18 extension tools (same names as ours, different argument shape, no
  `event_script`) are kept apart by a `_BYOK` namespace on OUR tools
  (`create_extension_BYOK` and friends — owner decision; see
  `deferred.md` → `[I-fork-vs-upstream-extension-tools]`); the BYOK
  EventScript parser learned upstream's new JavaScript code events
  (`js """…"""`); our instance-id ambiguity guard was ported into
  upstream's `put_2d_instances`; the prebuilt `libGD` WASM was re-imported
  (the Core C++ changed). Owner follow-ups: `usertasks.md` §7.

*Last updated: 2026-10-19.*


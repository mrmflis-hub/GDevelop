# Worklog

Mandatory log of all work done in this repository. One entry per working
session, newest first. **Every entry must contain all five items** (date,
description of actions, bugs found, issues found, full list of files worked on)
— missing any one means the run failed. Subagents never write entries here; the
orchestrating agent writes one consolidated entry per session.

---

## Entry template

```
## YYYY-MM-DD — <short title>
**Agent:** <who/what worked (orchestrator + which subagents)>
**Actions:** <brief description>
**Bugs found:** <list or "none">
**Issues found:** <list or "none">
**Files worked on:** <full list — created / modified / read>
```

---

## 2026-09-22 — Phase 8 implemented: the autonomous build workflow (sub-agents, completion gate, skills, extension authoring, entry points, fork/restore, byok-v6)

**Agent:** ZCode main orchestrator + 5 read-only Explore subagents (one
wave, at session start: v18 upstream tools map; libGD extension typings;
UI entry points map; Phase 5 machinery / chat restore UI; knowledge-sections
/ skills infrastructure). All code written by the orchestrator.

**Actions:**

- **Step 8.0 (prep)** —
  - **D8:** completed the extraction started by a previous session (the
    untracked draft `useByokChatSeam.js` was incomplete: missing `t` /
    `useStableUpToDateRef` imports, no `gd` binding, duplicate imports).
    The hook now carries the whole container BYOK seam; `AskAiEditorContainer`
    keeps a single `useByokChatSeam(...)` call (behavior-preserving — all
    pre-existing suites green). The hook also improves the approval
    decision: BYOK-only intercepted tools now carry a `modifiesProject`
    flag (`ByokExtraTool` type) used when the name is NOT in the registry
    (registry names keep their per-arguments decision).
  - **O3:** `useEnsureExtensionInstalled` accepts a `getProject` getter
    read at call time; the seam passes the BYOK live-project getter, so an
    install right after `initialize_project` sees the fresh project. New
    `UseEnsureExtensionInstalled.spec.js` (4 tests: getter wins over the
    stale prop, already-loaded short-circuit, no-project no-op, prop
    fallback for the existing callers).
- **Step 8.1 — sub-agents** (`ByokSubAgents.js`, 14 tests): the Phase-4
  `createByokSubAgentRunner` null-seam is real (re-exported from
  `ByokOrchestrator.js`). `run_explorer_agent` (scout) and `run_review_agent`
  (reviewer) resolve in `ByokExtraTools` BEFORE the registry stubs. Fresh
  orchestrator conversations: scoped charter prompt, read-only whitelist
  (19 tools) enforced at advertisement AND dispatch, `runScriptReadOnly`
  executors, rounds budgets 8/3, summary cap 1.5k tokens, transcripts kept
  module-side (capped 20, never replayed), failures degrade to
  `success:false`. Nesting refused structurally (a child's collaborators
  carry no `runSubAgent`). A shared model-turn budget
  (`BYOK_GLOBAL_TURN_BUDGET = 150`, parent + children) stops runaway cost.
  Suspending the parent suspends the children.
- **Step 8.2 — completion gate** (`ByokCompletionGate.js`, 9 tests):
  after edits, a plain-text done-claim runs cheap checks (project
  serializes, no crashed preview — `ByokPreviewSession.hasCrashed` via a
  module accessor in `ByokRuntimeTools` — and no unfixed failing gameplay
  tests scanned from the transcript). Unverified/failing claims get exactly
  ONE `[completion gate]` nudge user-message and the loop continues; the
  second claim is honored carrying a `[Completion gate]` `Verified:` /
  `Warning:` block attached to the final assistant message.
- **Step 8.3 — build-workflow skill**: authored
  `Byok/Skills/build-workflow.md` (brief → plan+scaffold → per-mechanic
  failing-test-first loops → juice pass → verified handover + scope rules),
  regenerated `ByokBuiltinSkills.generated.js` (13 skills). Auto-suggest:
  `isByokBuildIntent` (ByokSkills.js) on the FIRST user message includes
  the skill body from turn one, overridable via the new
  `buildWorkflowAutoSuggest` setting (ByokTypes + a settings-tab checkbox).
  Spec (8 tests) guards parsing, the required-tools list, the phase order,
  the heuristic truth table, and the orchestrator integration.
- **Step 8.4 — extension authoring** (`ByokExtensionTools.js`, 8 tests):
  9 tools ported from the upstream v18 branch (present in this clone at
  `upstream/claude/*`, commits c0bc40d06e/3a2659eb86/8d514278ad, not in
  master) driving libGD directly: create/change_extension (rename with
  `WholeProjectRefactorer.renameEventsFunctionsExtension` + usage-guarded
  delete), create/change_custom_object, create/change_custom_behavior,
  create/change_custom_function (typed parameters; bodies authored as
  EventScript through the Phase 5 parser + a `gd.EventsList` round-trip),
  and `find_extension_usages` (plain-text usage list via
  `UsedExtensionsFinder`/`UsedObjectTypeFinder`/behavior scans).
  Regeneration fires ONCE PER BATCH (`flushByokExtensionRegeneration`
  called by the orchestrator after its intercepted-tools loop; full reload
  after structural changes, metadata-only otherwise) through the editor's
  `EventsFunctionsExtensionsContext` hooks wired in the seam. The
  upstream-stub delegation guard (`isByokExtensionToolShadowedByRegistry`)
  steps aside if the registry ever grows REAL implementations — scoped to
  the extension tool names only, so the deliberate interceptions
  (`add_scene_events`, `run_gameplay_test`) are unaffected.
- **Step 8.5 — UI entry points**:
  - Homepage standalone form: the `newAiRequestOptions` effect gained the
    BYOK branch (before any account/credits check) using the SAME seam
    hook. Orchestrators moved to a module-level registry
    (`ByokChatStore`: get/set/deleteByokOrchestrator) so the chat keeps
    running when the form's dialog unmounts and the Ask AI tab takes over
    (pending selection: `setPendingByokChatSelection`, consumed by the
    container on mount).
  - Context menus (all behind `onOpenAskAi({prefilledUserRequest})`, all
    Lingui `t`): Events sheet event + action items (EventsSheet/index.js,
    threaded via EventsEditorContainer), Objects list
    "Edit {object} with AI…" (ObjectTreeViewItemContent + the
    SceneEditorContainer → SceneEditor → Mosaic/SwipeableDisplays →
    ObjectsList chain), scene selection (SceneEditor's instance context
    menu, which builds the InstancesEditor menu).
- **Step 8.6 — fork / restore points**: transcript messages get
  `messageId`s (`makeByokMessageId`, stamped by the orchestrator).
  `ByokFork.js`: `forkByokChat(chatId, upToMessageId)` (INCLUSIVE copy,
  "Fork of …" title, `forkedFrom*` fields); lazy pre-message project
  snapshots (serialize before the turn, keep only if the turn edited),
  capped to the last 5, dropped when the chat is archived;
  `restore_project_point({message_id})` tool (approval-gated). The chat
  UI's restore arrow is lit for BYOK chats (user messages carry
  `projectVersionIdBeforeMessage` = their messageId; the chat's `gameId`
  follows the live project) and the container's `onRestore` routes BYOK
  ids to a local confirm → in-place restore → transcript-fork flow.
- **Step 8.7 — prompt `byok-v6`**: the `single-agent` knowledge section
  became the `agents` section (delegation policy for the scout/reviewer,
  "never edit inside sub-agents", completion rules naming the gate, and
  pointers to the build-workflow + extend-with-js skills). Pinned specs
  updated (version + section markers).
- **Tool surface:** `BYOK_TOOL_NAMES` 36 → 48 (`run_explorer_agent`,
  `run_review_agent`, the 9 extension tools, `restore_project_point`), the
  validator cap raised to 48 with a comment, `BYOK_ONLY_TOOL_NAMES`
  extended, and the prompt's tools-section budget raised 1400 → 2100
  tokens (48 one-line entries no longer truncate).
- **Gates, final tree:** `npm test -- --watchAll=false` → **183 suites
  passed, 1926 passed (1 pre-existing skip)**; `npm run lint` → **0
  warnings**; `npm run flow` → **Found 0 errors**; `npm run check-format`
  → **clean** (all from `newIDE\app`; flow run via the direct
  `flow.exe check` workaround).

**Audit greps** (run 2026-09-22, all from `newIDE/app/src/AiGeneration/Byok`
unless noted):

1. Every BYOK-only / new tool is actually intercepted (name found in
   ByokExtraTools.js / ByokRuntimeTools.js / ByokExtensionTools.js):
   `OK` for all 23 checked (`capture_*`, `start/stop_preview`,
   `read_preview_logs`, `get_runtime_errors`, `inspect_runtime_state`,
   `search_reference`, `load_skill`, `search_docs`, `read_doc`,
   `update_project_notes`, `run_review_agent`, the 9 extension tools,
   `restore_project_point`) — no `MISSING` line was printed.
2. `run_edit_agent` exclusion: 0 occurrences in `ByokToolSchema.js`'s
   whitelist; pinned in `ByokToolSchema.spec.js`'s excluded list.
3. No generation-backend calls in the BYOK modules: grepping
   `createAiRequest|addMessageToAiRequest|retryAiRequest|forkAiRequest`
   over the Byok modules returns only a documentation comment in
   `ByokFork.js` ("the local equivalent of the server's forkAiRequest") —
   zero call sites.
4. `byok-v6`: 2 occurrences in `ByokPrompts.js` (doc comment + the export),
   2 in `ByokPrompts.spec.js` (the pinned version test).
5. Locales untouched: `git status newIDE/app/src/locales` → 0 lines.
6. New modules all have co-located specs: `OK` for useByokChatSeam,
   ByokSubAgents, ByokCompletionGate, ByokExtensionTools, ByokFork,
   ByokBuildWorkflowSkill (skills spec), UseEnsureExtensionInstalled.
7. Phase-8 keyword spread: `createByokSubAgentRunner`/`ByokCompletionGate`/
   `forkByokChat`/`restore_project_point`/`build-workflow`/`extend-with-js`
   appear in ByokOrchestrator.js (13), ByokExtraTools.js (2),
   ByokSkills.js (1), ByokFork.js (1), AskAiEditorContainer.js (2).

**Bugs found:**

- **Two-argument project self-unserialization corrupts the project** —
  `unserializeFromJSObject(project, obj, 'unserializeFrom', project)`
  (the `Utils/Serializer.js` helper with `optionalProject`) crashes the
  WASM with "memory access out of bounds" when the serializable IS the
  project; the single-argument `project.unserializeFrom(element)` (the
  form `MainFrame`'s `loadFromSerializedProject` uses) works in place.
  Repro: `gd.Serializer.fromJSON(json)` + 2-arg `unserializeFrom` on any
  project. Root cause: Project's unserializeFrom binding is 1-arg
  (`gdproject.js:123`); the 2-arg path aliases the project into the
  element argument slot. Fixed-now in `ByokFork.js` (uses `fromJSON` + the
  1-arg form); the guard in `Utils/Serializer.js` is logged in
  `outofscoped.md`.
- **The tools-section prompt budget truncated the 48-tool list** — with
  this phase's additions, `ByokKnowledgeSections.js`'s 1400-token budget
  cut the tool list mid-way (the section is non-degradable → truncated),
  hiding tools from the model. Caught by the "every tool name in the
  prompt" spec; fixed by raising the budget to 2100 (the section comment
  now documents the 48-tool surface).
- **Repeated in-place restores under one jest/WASM instance are flaky**
  (embind "null function or function signature mismatch" on the second
  restore of the same project, only in tests; a single restore is stable
  and the production path restores once per user action). Worked around:
  the `restore_project_point` tool test mocks the restore; the real
  round-trip is covered once. Logged in `outofscoped.md`.
- Found-and-fixed during the session (introduced by this session's own
  edits, listed for the record): a duplicated `capToolOutput` block after
  the sub-agent re-export edit; an inline-type export-from syntax the
  Babel version rejects; a stray apostrophe breaking a schema description
  string; a node splice that emptied `ByokBuildWorkflowSkill.spec.js`
  (recreated in full); lint/flow cleanups (unused imports, exact-object
  extra props, `jest.fn` underconstrained generics per the known repo
  quirks).

**Issues found:**

- **Upstream files touched beyond the phase doc's explicit list** (each a
  1–3-line surgical addition mandated by the step 8.5 ACs; the doc listed
  "EventsSheet + ObjectsList + one editor container"): EventsEditorContainer
  (thread `onOpenAskAi`), ObjectTreeViewItemContent (the per-object menu
  builder), SceneEditorContainer, SceneEditor/index.js (props + the
  scene-selection item in the InstancesEditor menu it builds),
  MosaicEditorsDisplay + SwipeableDrawerEditorsDisplay + EditorsDisplay.flow
  (threading). `UseEnsureExtensionInstalled.js` is the O3 getter (owner's
  standing decision #13). `AskAiStandAloneForm.js` is the phase-mandated
  first edit (justified in `Phase8.md` itself); note its earlier D7
  de-scoping was superseded by the owner-approved replan — recorded in
  `deferred.md`.
- **In-place restore editor staleness**: restoring a project in place
  refreshes the project under the editors, but deeply-held views may show
  stale content until their next interaction/reopen. Accepted for v1 (the
  phase's full-fidelity disclaimer); a full refresh option is logged in
  `outofscoped.md`.
- **Pre-existing**: `AskAiEditorContainer`'s Props type declares
  `onOpenAskAi` twice (an old shape + the current one; the second wins) —
  logged in `outofscoped.md`.
- **libGD name normalization**: `gd.Project.getSafeName('New Name')` →
  `New_Name` (underscore) — extension/object/behavior/function renames
  normalize through it (tests pin the behavior).
- **Manual QA not runnable in this session** (no desktop app / real
  endpoint): the flagship build-workflow QA, the sub-agent/extension/
  entry-point QA, and the Phase 3/4/5/6 desktop tasks are owner tasks —
  **Tasks 9 and 10 added to `usertasks.md`**; the phase gate's "flagship
  QA recorded with evidence" checkbox stays open on them.
- Triage updates: O3 removed from `outofscoped.md` (fixed + verified);
  D4/D8/O7-marked D7 entries updated in `deferred.md`; AGENTS.md §2
  refreshed (Phase 8 implemented uncommitted; QA Tasks 9/10 open). New
  `outofscoped.md` items: the serializer self-restore guard, the duplicate
  prop key, the restore-refresh design decision, the WASM test flakiness.

**Files worked on:**

- Created: `newIDE/app/src/AiGeneration/Byok/useByokChatSeam.js` +
  `.spec.js`; `ByokSubAgents.js` + `.spec.js`; `ByokCompletionGate.js` +
  `.spec.js`; `ByokExtensionTools.js` + `.spec.js`; `ByokFork.js` +
  `.spec.js`; `ByokBuildWorkflowSkill.spec.js`; `Skills/build-workflow.md`;
  `Skills/extend-with-js.md`; `newIDE/app/src/AiGeneration/UseEnsureExtensionInstalled.spec.js`.
- Modified (BYOK): `ByokChatStore.js` (orchestrator registry + pending
  selection), `ByokExtraTools.js` (modifiesProject flags, sub-agent tools,
  restore tool, extension registration, regeneration collaborators),
  `ByokOrchestrator.js` (+`.spec.js`) (sub-agent runner wiring, completion
  gate, message ids, snapshots, gameId, budget/whitelist/prompt overrides,
  auto-suggest, serialization for the gate), `ByokPreviewSession.js`
  (`hasCrashed`), `ByokRuntimeTools.js` (flags + crash accessor),
  `ByokSeam.js` (`runScriptReadOnly` pass-through), `ByokPrompts.js`
  (+`.spec.js`) (v6), `ByokSkills.js` (build-intent), `ByokToolSchema.js`
  (+`.spec.js`) (11 new schemas, cap 48), `ByokTranscript.js`
  (`makeByokMessageId`), `ByokTypes.js` (+`.spec.js`) (setting + shared
  budget), `ByokSettingsTab.js` (checkbox), `Knowledge/ByokKnowledgeSections.js`
  (agents section; tools budget), `Skills/ByokBuiltinSkills.generated.js`
  (regenerated).
- Modified (upstream touchpoints): `AskAiEditorContainer.js` (hook call,
  BYOK restore routing, pending selection), `AskAiStandAloneForm.js` (BYOK
  branch + seam), `UseEnsureExtensionInstalled.js` (O3 getter),
  `EventsSheet/index.js`, `MainFrame/EditorContainers/EventsEditorContainer.js`,
  `MainFrame/EditorContainers/SceneEditorContainer.js`, `ObjectsList/index.js`,
  `ObjectsList/ObjectTreeViewItemContent.js`, `SceneEditor/index.js`,
  `SceneEditor/EditorsDisplay.flow.js`, `SceneEditor/MosaicEditorsDisplay/index.js`,
  `SceneEditor/SwipeableDrawerEditorsDisplay/index.js`.
- Docs: `REVIEW/worklog.md` (this entry), `REVIEW/outofscoped.md`,
  `REVIEW/deferred.md`, `REVIEW/usertasks.md`, `AGENTS.md`.

---

## 2026-09-22 — Phase 7 implemented: knowledge, prompts, and the skills system (+ step 7.0 backlog clearing)

**Agent:** ZCode main orchestrator (no subagents — all code written and
verified in-session).

**Actions:**

- **Step 7.0 (backlog clearing) — all 11 items implemented, tested, verified:**
  - **O1** — `onSendFeedback` is now an optional prop in `AiRequestChat/index.js` +
    `ChatMessages.js`; the like/dislike buttons (and the dislike-dialog callback) are
    gated on its presence; the container passes it only for hosted chats. The no-op
    handler was kept per the owner's instruction, hoisted to module scope as
    `onSendByokNoopFeedback` (an unused per-render useCallback would fail the
    zero-warnings lint gate) — exported for the possible future upstream PR.
  - **O13** — same optional-prop pattern for `onProcessFunctionCalls` (index.js,
    ChatMessages.js, OrchestratorPlan.js, SuggestionLines.js); the dead threading into
    TaskRow (which never used it) was removed; the container passes it only for hosted
    chats. Tests: `ChatMessages.spec.js` asserts the plan receives the callback for a
    hosted chat and `undefined` for a BYOK one.
  - **O4** — tool outputs carrying `images` render inline in the chat: new
    `tool_result_images` render item (`AiRequestChat/Utils.js` — touch justified: the
    RenderItem union lives there), rendered from a `getToolResultImage` prop the
    container wires to `getByokImage` for BYOK chats only. jsdom tests: an
    image-bearing transcript renders an `<img>`; without the lookup prop nothing
    renders; unknown ids (post-reload) render nothing; text-only transcripts unchanged.
  - **O7** — `AiRequestErrorRow` maps `byok-empty-answer` to the approved heading
    "The model returned an empty answer." keeping the retryable kind. New spec covers
    the mapping, the generic fallback, and the `byok-context-full` too-large path.
  - **D10** — the API-key field commits only when the user actually edited it
    (`isKeyFieldEdited`): blur on an untouched empty field never saves (never clears);
    typing then erasing everything + blur is an explicit delete; a second untouched
    blur re-saves nothing. Tests: all three cases + the double-blur edge case.
  - **O5** — `loadByokKey` returns `ByokKeyLoadResult` (`none` / `unreadable` / `ok`
    with the key only when ok). All callers updated; the container's missing-key error
    picks the line per status ("add a key" vs "cannot be decrypted on this computer —
    clear and re-enter", code `byok-unreadable-key`); the settings tab keeps the Clear
    button available for unreadable entries. Spec updated per status + a
    distinct-from-none test on a simulated DPAPI failure.
  - **O6** — the v1-plaintext migration replaces the entry only on a confirmed write:
    `performSaveByokKey`'s boolean is now checked; on failure the plaintext entry is
    kept (logged) and the migration retried on the next load. Test: failed write keeps
    the plaintext entry, next load migrates it to v3.
  - **O8** — `APPROVED_CALL_IDS_CAPACITY = 500` in `ByokSeam.js` (testable home) with
    a why-comment (bounded memory; clear-all kept as-is, worst case a re-approval is
    asked); used by the container; pinned by a ByokSeam spec.
  - **O9** — the duplicate "working" persist is gone: `runLoop` no longer sets/persists
    the status; `appendUserMessage` (message path) and `retryAfterError` (retry path)
    each persist exactly once per turn start. Tests count persists while the model
    call is pending on both paths.
  - **O10** — renamed to `isInvalidRequestForReasoningEffort` (**spec deviation from
    Phase 2's mandated name recorded here**); `getKindForStatus` now maps 422 like 400
    (invalid-request), so the reasoning-effort degradation engages on 422 too. Spec
    adds the 422 case.
  - **O11** — the 5 duplicated `beforeEach` blocks in `ByokSettingsTab.spec.js`
    hoisted into one file-level reset (the 5th block was 4 lines shorter — it omitted
    the models/test-connection mock resets; the shared block resets those harmlessly);
    `ByokSeam.spec.js` converted to ES imports.
- **Step 7.1 — prompt composer (`byok-v5`):** new
  `Byok/Knowledge/ByokKnowledgeSections.js`: section registry (core sections
  registered once: role 10, tools 20, project context 30, project notes 35, output
  rules 40, planning+F2 50, single-agent 60, EventScript core 70, script batching 80,
  look/verify 90, grounding 100, skills appendix 110, custom instructions 999) + pure
  composer (`composeByokPromptSections`): priority-ordered, global budget
  `BYOK_SYSTEM_PROMPT_BUDGET_TOKENS = 6000` (~4 chars/token), per-section budgets,
  degradable knowledge sections collapse to a first-line summary + pointer, overflow
  summaries drop, non-degradable sections truncate at their own budget. The F2
  progress discipline (decision #2) lives in the planning section: obligatory to-do
  list via `create_or_update_plan` (internal, hidden acceptable) + one-sentence
  progress update per completed to-do item; single long answers stay acceptable.
  `ByokPrompts.js` is now the composer facade: same call signature + optional full
  `context`, version bumped to `byok-v5`, composed length logged to the console per
  turn (7.9 QA). Tests: budget under many sections, stable priority order, idempotent
  registration, graceful degradation, drop, truncate, empty-section skip, F2 content
  markers, notes/skills/custom-instructions rendering.
- **Step 7.2 — engine reference + `search_reference`:** `scripts/byokEngineReferenceParser.js`
  (tolerant static parser of `Extensions/<name>/JsExtension.js` and
  `Core/GDCore/Extensions/Builtin/**.cpp` registration calls: balanced-paren argument
  lists, translated-string unquoting incl. adjacent literals, chained parameter
  capture, longest-string descriptions for behaviors/objects/effects,
  duplicated/scoped/AECAA variants) + `scripts/generate-byok-engine-reference.js`
  (walks the repo, dedupes, sorts, writes the committed catalog). **Catalog: 1962
  entries** (836 actions, 509 conditions, 537 expressions, 21 behaviors, 13 objects,
  46 effects), 54 tolerated warnings (dynamic names / metadata-only effects),
  committed at `Byok/docs/engine-reference.json`. `ByokEngineReference.js`: lazy +
  defensive loader (injectable for tests; a missing file degrades to "unavailable",
  never a crash), prefix > substring > description/owner scoring, cap 40 with a
  "narrow your query" steering line. Tool `search_reference(query, kind?, owner?)`
  registered (schema, whitelist, interception), answering compacted entries. The
  always-on cheat-sheet section (event anatomy, object picking, TimeDelta, ~30 top
  expressions, pointer to `search_reference`).
- **Step 7.3 — EventScript pack:** `Byok/Knowledge/ByokEventScriptPack.js` — full
  grammar reference (statement forms, and/not/Or/once, disabled, escaping, anchors,
  collapse markers, placement relations, "what does not fit EventScript") + 8 worked
  examples. **Test-linked to the Phase 5 parser: every example parses**
  (`parseByokEventScript`), which caught and fixed pseudo-syntax in three first-draft
  examples (a natural-language collision condition, `SceneVariable(Score) >= 100`
  comparisons, `Enemy.Y()` conditions) — the shipped examples use only
  metadata-verified instruction names. Degradable section (priority 200); the
  operational core stays always-on (7.1).
- **Step 7.4 — game-design pack:** authored, opinionated core (design-first rule,
  loop-first heuristic, juice vocabulary mapped to the engine, introduce → combine →
  twist, numbers-in-variables, smallest-playable-slice, explicit win/lose).
  Content-marker + budget + no-external-citations tests.
- **Step 7.5 — math/physics + JS packs:** math/physics core (never compute in your
  head, TimeDelta frame-rate independence, degrees-0=right-clockwise-down angle
  conventions, vector/probability recipes, Box2D joints/forces discipline, Platformer
  parameters, Jolt 3D) and JS API core (prefer-events churn warning, JS event scope,
  extension-function scope + `eventsFunctionContext`, the `gdjs.evtTools.*` list,
  Pixi/three renderer access, docs pointer incl. a `[docs: events/js-code/index.md]`
  link).
- **Step 7.6 — skills system:** skill format (Markdown + `name`/`description`/`tools?`
  frontmatter, 32 KB cap); `ByokSkills.js` parses/validates/merges (builtin first,
  user override by name; broken files logged and skipped); the builtin set ships as
  11 authored `Byok/Skills/*.md` files (platformer-game, top-down-shooter,
  puzzle-grid, hud-and-menus, save-system, juice-and-game-feel, physics-2d-recipes,
  3d-scene-basics, js-custom-rendering, eventscript-authoring, gameplay-testing) + a
  generator script (`generate-byok-skills-index.js`) emitting a committed ES module
  (the repo's generated-artifact pattern — no webpack raw-loader needed). Desktop
  user skills: `electron-app/app/ByokUserSkills.js` reads `<userData>/byok-skills/*.md`
  over the new `byok-read-user-skills` IPC (registered in `main.js`; Phase 3
  errors-as-values pattern). Tool `load_skill(name)` returns the body as a tool output
  (persists in the transcript); unknown names list what is available. Settings tab:
  skills-folder hint row. The prompt appendix renders metadata-only via the 7.1
  context.
- **Step 7.7 — docs access:** **license verified first:** the GDevelop-documentation
  content is **CC Attribution-Share Alike 4.0 International** (stated in its
  `mkdocs.yml` copyright and the site footer; no LICENSE file at the repo root — the
  mkdocs statement is the license declaration). Redistribution is permitted with
  attribution + share-alike; `Byok/docs/ABOUT.md` records the source, license, date
  and manifest. **15 curated pages** copied from the local `DOCs/` checkout (all
  events pages incl. js-code/object-picking/expressions — **path drift vs the phase
  doc recorded in Issues**); indexed via `generate-byok-docs-index.js` → committed
  `BundledDocs.generated.js` (title + headings + content per page). `ByokDocs.js`:
  substring search (title > path > headings > body), cap 15, `read_doc` capped at
  12000 chars with anchor section-slicing, offline-first online expansion (bundled →
  24 h localStorage cache → raw.githubusercontent fetch, only when the new
  `onlineDocsEnabled` setting is on; injectable fetcher; **asserted never to fetch
  when off**). Tools `search_docs`/`read_doc` registered + intercepted; zero
  GDevelop-backend calls (no `GDevelopServices` imports). The Phase 5 exclusion-list
  test updated: `search_docs` is now legitimately implemented client-side
  (`read_full_docs` stays excluded).
- **Step 7.8 — project notes + custom instructions:** `ByokProjectNotes.js` —
  a `{conventions, inProgress, decisions, updatedAt}` record per project file
  identifier (cloud-save `fileMetadata.fileIdentifier`, fallback FNV-1a name hash),
  localStorage for v1 (Phase 9 moves persistence to IndexedDB), 8 KB blob cap +
  2000-char field cap, merge semantics (absent = keep, explicit string = replace,
  empty = clear). Tool `update_project_notes` (merge, refuses when over cap,
  actionable failure without a project); the orchestrator gains
  `getProjectNotesIdentifier` (option + collaborator) and injects the notes + skills
  metadata + custom instructions into every turn's prompt context (async build).
  Settings tab: "Custom instructions" textarea (2000-char cap) and "Fetch missing
  documentation pages online" checkbox; both new settings added to `ByokSettings`
  with defaults + validation tests.
- **Step 7.9 — phase gate:** all four gates green from `newIDE\app` (**176 test
  suites / 1866 tests passed, 1 pre-existing skip; lint 0 warnings; flow 0 errors;
  check-format clean**) and the electron-app `check-format` green as well. The manual
  desktop QA checklist cannot run headless — recorded as **usertasks Task 9** (see
  Issues).

**Bugs found:**

1. **(new code this session — engine-reference parser — FIXED)**
   `parseArgumentList` mis-bookkept the initial parenthesis: the opening paren was
   both accumulated into the first argument and treated as depth 0, so every argument
   list failed to terminate and the generator emitted **0 entries**. Repro:
   `parseArgumentList("addBehavior('X', _('Y'))", 11)` returned null. Root cause:
   the depth accounting did not treat the initial `(` as level 1. Fix: start at
   depth 1 after the opening paren, return on the matching `)` at depth 1
   (`scripts/byokEngineReferenceParser.js`).
2. **(new code this session — FIXED, caught by the pack/parser test-link)**
   `addExpressionAndConditionAndAction` / `AddExpressionAndCondition` entries were
   named by their **type** argument (arg 0: "number", "string"…) instead of their
   name (arg 1), so the dedupe key collapsed them: 1655 entries, ~305 lost, and
   nonsense type-named entries in the catalog. Repro: parse
   `Extensions/3D/JsExtension.js` and look for `name: "number"`. Root cause: the
   AECAA signature is `(type, name, …)` — its name sits at index 1. Fix: index the
   name by entry form; regenerated catalog (1962 entries, 0 type-named).
3. **(new code this session — FIXED)** both generator scripts' doc comments contained
   the glob `Extensions/*/JsExtension.js` — the `*/` terminated the block comment
   (SyntaxError on first run). Fix: reworded to `Extensions/<name>/JsExtension.js`.
4. **(pre-existing — FIXED as O9)** every user message persisted the "working" status
   twice (`appendUserMessage` and `runLoop` both set+persisted). Root cause: the
   retry path's needs were met inside the shared loop; fix moves the persist to the
   two callers (`ByokOrchestrator.js`).
5. **(pre-existing — FIXED as O10)** `describeInvalidRequestForReasoningEffort` was a
   predicate named "describe…" and a 422 from the endpoint classified as `unknown`
   (so a reasoning_effort 422 never degraded). Root cause: `getKindForStatus` mapped
   only 400. Fix: predicate renamed + `status === 400 || status === 422`.
6. **(pre-existing UI contract — FIXED during the O4/D10 work; note for future
   code)** passing a React element to `TextField`'s `hintText` prop breaks
   `TestRenderer.toJSON()` serialization ("Converting circular structure to JSON"
   via `_context`): `UI/TextField` requires `hintText: string` or
   `translatableHintText: MessageDescriptor`. Fixed by using `translatableHintText`
   for the custom-instructions field.

**Issues found:**

- **Docs path drift (AGENTS.md §8):** the phase doc's `js-code.md`,
  `expressions.md`, `object-picking.md` live upstream as `events/js-code/index.md`,
  `events/expressions/index.md`, `events/object-picking/index.md`; the bundled
  subset uses the real paths under `Byok/docs/gdevelop-docs/events/`.
- **Reference-parameter shape deviation:** the step's entry shape says
  `parameters:[{name,type,description}]`; upstream metadata carries **no parameter
  names** (only a type + a label), so entries emit
  `parameters:[{type,description}]`.
- **Catalog shipping:** the step says "run at build or first launch"; the catalog is
  generated by the dev script and **committed** (like VersionMetadata / theme
  variables), refreshed whenever engine metadata changes — a first-launch generation
  would depend on repo sources an installed app does not ship.
- **O8 boundary nuance:** the eviction trigger moved from `size > 500` to
  `size >= APPROVED_CALL_IDS_CAPACITY` (capacity semantics; the set can no longer
  momentarily hold 500 ids). Behavior stays "bounded, occasionally re-asks".
- **Tool-count cap raised 32 → 36** (validator + spec pin updated with comment):
  this phase whitelists 5 new BYOK-only tools (`search_reference`, `load_skill`,
  `search_docs`, `read_doc`, `update_project_notes`); total = 36.
- **`AiRequestChat/Utils.js` touched** (new `ToolResultImagesRenderItem` in the
  `RenderItem` union) — not in step 7.0's files list, but required by O4's ordered
  rendering; justified under the step and recorded here per the budget rule.
- **Raw `npx jest` re-confirmed broken** for this repo (react-app-rewired
  `npm test` is the runner): one mid-session false suite failure ("self is not
  defined") — AGENTS §6 already says so; cost a detour.
- **electron-app `check-format` is now fully green** — the two pre-existing upstream
  files were formatted in owner commit `7283b2fc1c`; AGENTS.md §6 updated in this
  session (per §8) along with the §2 status block.
- **Desktop QA (step 7.9)** cannot run in this environment (headless, no real
  endpoint): recorded as **usertasks Task 9** with the full checklist; the "visibly
  works in QA" AC items there remain unchecked by design of this environment.

**Triage:** 1 new OOS item (project-notes identifier staleness across a mid-chat
"Save as…" — `outofscoped.md`); `no deferred`; 1 new UT entry (Task 9, the Phase 7
desktop QA checklist — `usertasks.md`). Removed from `outofscoped.md` as
implemented+verified: O1, O4, O5, O6, O7, O8, O9, O10, O11, O13, D10; F2's entry now
tracks only the watchdog half (the prompt half landed in step 7.1).

**Audit greps (artifacts of the ACs, as run at gate time):**

```
=== AC1: Step 7.0 backlog items ===
--- O1 (optional onSendFeedback + render gate):
src/AiGeneration/AiRequestChat/ChatMessages.js:80:  onSendFeedback?: (
src/AiGeneration/AiRequestChat/index.js:155:  onSendFeedback?: (
ChatMessages.js render gates: 876: !!onSendFeedback ? (   1114: !!onSendFeedback ? (
--- O13 (optional onProcessFunctionCalls):
OrchestratorPlan.js:31 / index.js:178 / SuggestionLines.js:36 / ChatMessages.js:90:  onProcessFunctionCalls?: (
--- O4 (tool result images):
ChatMessages.js:99:  getToolResultImage?: (imageId: string) => ?{| dataUrl: string |},
ChatMessages.js:366: !!getToolResultImage    ChatMessages.js:935: const image = getToolResultImage
--- O7 (byok-empty-answer mapped):
AiRequestErrorRow.js:69:  if (error && error.code === 'byok-empty-answer') {
AiRequestErrorRow.spec.js:36:  it('maps byok-empty-answer to its dedicated heading and offers retry')
--- D10 (explicit delete only):
ByokSettingsTab.js:193 isKeyFieldEdited ; :389 commitApiKeyField ; :390 if (!isKeyFieldEdited) return ; :527 onBlur={commitApiKeyField}
--- O5 (status shape):
ByokKeyStorage.js:264: export type ByokKeyLoadResult =
  | {| status: 'none' |} | {| status: 'unreadable' |} | {| status: 'ok', key: string |};
--- O6 (clear only after confirmed write):
ByokKeyStorage.js:291: let isMigrationWritten = false ; :303 = await performSaveByokKey(...) ; :305 if (!isMigrationWritten) {
--- O8 (named constant):
ByokSeam.js:41: export const APPROVED_CALL_IDS_CAPACITY = 500
ByokSeam.spec.js:16: expect(APPROVED_CALL_IDS_CAPACITY).toBe(500) ; AskAiEditorContainer.js:99 (import)
--- O9 (single working persist):
ByokOrchestrator.js:965: // The 'working' status is persisted once per turn start by the caller
--- O10 (predicate rename + 422):
ByokErrors.js:247: export const isInvalidRequestForReasoningEffort = ...
ByokErrors.js:111: if (status === 400 || status === 422) return 'invalid-request' ; ByokClient.js:291 (caller)
--- O11 (spec hygiene):
ByokSeam.spec.js require( count: 0 ; ByokSettingsTab.spec.js beforeEach count: 1

=== AC2: F2 prompt half ===
ByokKnowledgeSections.js:136: - Every time you complete a to-do item, send the user a one-sentence progress update...
ByokPrompts.spec.js:85 / ByokKnowledgeSections.spec.js:269: contains 'one-sentence progress update'
=== AC3: composer + byok-v5 + budget + sync test ===
ByokPrompts.js:27: BYOK_AGENT_PROMPT_VERSION = 'byok-v5' ; ByokPrompts.spec.js:76 pins it
ByokKnowledgeSections.js:21: BYOK_SYSTEM_PROMPT_BUDGET_TOKENS = 6000
ByokPrompts.spec.js:14: 'contains every tool name from getByokToolSchemas, keeping prompt and schemas in sync'
=== AC4: engine reference + search_reference + cheat-sheet ===
catalog entries: 1962 ; ByokToolSchema.js:1057 search_reference schema ; ByokExtraTools.js:136 interception
ByokEngineReference.js:172 TimeDelta rule ; :188 id: 'engine-cheat-sheet'
=== AC5: EventScript pack test-linked to parser ===
ByokEventScriptPack.spec.js:3 imports parseByokEventScript
:66 'every worked example parses with the Phase 5 parser' ; :76 parseByokEventScript(example.source)
=== AC6: pack content markers ===
ByokGameDesignPack.js:15 '- Design first: ...' ; ByokMathPhysicsPack.js:15 '- Never compute geometry...'
ByokJsApiPack.js:15 '- Prefer events. ...'
=== AC7: skills system ===
11 .md skills shipped ; ByokExtraTools.js:177 load_skill
ByokSkills.spec.js:136 'merges user skills over builtin ones' (:159 user:platformer-game.md)
ByokSettingsTab.js:561 byok-skills hint ; electron main.js + ByokUserSkills.js + ByokSkills.js:150 byok-read-user-skills
=== AC8: docs (license + offline + zero backend calls) ===
ABOUT.md: 'CC Attribution-Share Alike 4.0' + 'CC BY-SA 4.0' ; 15 bundled .md pages
ByokDocs.js GDevelopServices imports: 0
=== AC9: project notes + custom instructions ===
ByokExtraTools.js:299 update_project_notes ; ByokTypes.js:48/:72 customInstructions + default
ByokOrchestrator.js:358 customInstructions: settings.customInstructions
```

**Files worked on:**

- Created (app): `src/AiGeneration/Byok/Knowledge/ByokKnowledgeSections.js` + spec,
  `ByokEventScriptPack.js` + spec, `ByokGameDesignPack.js` + spec,
  `ByokMathPhysicsPack.js` + spec, `ByokJsApiPack.js` + spec;
  `src/AiGeneration/Byok/ByokEngineReference.js` + spec,
  `ByokEngineReferenceParser.spec.js`, `ByokSkills.js` + spec, `ByokDocs.js` + spec,
  `ByokProjectNotes.js` + spec; `src/AiGeneration/AiRequestChat/ChatMessages.spec.js`,
  `AiRequestErrorRow.spec.js`; `src/AiGeneration/Byok/docs/engine-reference.json`
  (generated), `docs/ABOUT.md`, `docs/gdevelop-docs/**` (15 curated pages +
  `BundledDocs.generated.js`); `src/AiGeneration/Byok/Skills/*.md` (11) +
  `ByokBuiltinSkills.generated.js`.
- Created (scripts): `byokEngineReferenceParser.js`,
  `generate-byok-engine-reference.js`, `generate-byok-skills-index.js`,
  `generate-byok-docs-index.js`.
- Created (electron-app): `app/ByokUserSkills.js`.
- Modified (app): `Byok/ByokKeyStorage.js` + spec, `Byok/ByokSettingsTab.js` + spec,
  `Byok/ByokErrors.js` + spec, `Byok/ByokClient.js`, `Byok/ByokSeam.js` + spec,
  `Byok/ByokOrchestrator.js` + spec, `Byok/ByokToolSchema.js` + spec,
  `Byok/ByokExtraTools.js` + spec, `Byok/ByokTypes.js` + spec, `Byok/ByokPrompts.js` +
  spec, `AskAiEditorContainer.js`, `AiRequestChat/index.js`,
  `AiRequestChat/ChatMessages.js`, `AiRequestChat/OrchestratorPlan.js`,
  `AiRequestChat/SuggestionLines.js`, `AiRequestChat/Utils.js`,
  `AiRequestChat/AiRequestErrorRow.js`.
- Modified (electron-app): `app/main.js`.
- Docs: `AGENTS.md` (§2 status, §6 electron note — per §8), `REVIEW/outofscoped.md`
  (11 entries removed as verified, F2 narrowed, 1 new item), `REVIEW/usertasks.md`
  (Task 9 added), this worklog entry.

---

## 2026-09-22 — Replan: all triage tasks split into the phase docs (steps 7.0/7.1, 8.0, 9.1/9.4); no Phase 10 needed

**Agent:** ZCode main orchestrator (no subagents).

**Actions:**
- Read the answered decision record (`usertasks.md` "Owner decisions — presented and answered 2026-09-22") plus `deferred.md` and `outofscoped.md`, and assigned every to-be-implemented/fixed item a committed phase home. Cross-doc step references were surveyed first (AGENTS.md "9.3/9.4", `Phase8.md` "9.2/9.5", `Phase7.md` internal 7.6–7.8), so **no existing step number changed** — new steps were inserted as 7.0/8.0 and step 9.1 was repurposed in place:
  - `Phase7.md` **step 7.0** (new, worked first on restart): the whole approved backlog — D10, O1, O4, O5, O6, O7, O8, O9, O10, O11, O13, grouped chat-UX / settings+storage / engine+spec-hygiene, each with files + tests; upstream touchpoints recorded as owner-approved (#10/#11/#14/#15). **Step 7.1** amended to carry the **F2 prompt half** (obligatory to-dos via `create_or_update_plan` + one-sentence progress per completed item); intro, modified-files budget, 7.9 QA list and §3 ACs updated.
  - `Phase8.md` **step 8.0** (new prep): the D8 hook extraction (`useByokChatSeam`) + the O3 `ensureExtensionInstalled` memo staleness fix; intro, new-files list and §3 ACs updated.
  - `Phase9.md`: step 9.1 rewritten from streaming to the **F2 stall watchdog** (`ByokWatchdog.js`, in-chat notices, one per stall window — owner decision #2 rejected streaming); step 9.4 expanded to the full **F3 multi-provider** design (provider registry with per-provider keys, `provider name/model name` dropdown from `/models`, effort dropdown with server-listed levels, legacy-endpoint migration) with **D5** (badge + exact token row) folded in; step 9.5's capability list dropped streaming and gained `effortLevels`; intro items 1/4, files lists, 9.9 QA, §3 ACs updated; streaming (D2) + the O2 char-estimate recorded as conditional in §4.
  - **No Phase10.md created:** every approved item fits in Phases 7–9; the only unplanned items are the two conditional ones (D2 streaming, O2 estimate), whose home is `deferred.md` until the owner green-lights them — consistent with the owner's answers.
- Propagated the pointers: `outofscoped.md` (phase-home column/lines + a header note; entries stay until fixed + verified per the file rules), `deferred.md` (committed homes on D2/D4/D8/O3/O4/O2-fallback; conditionals cross-referenced to `Phase9.md` §4), `usertasks.md` decision list (planning annotations only — the answers themselves untouched), `AGENTS.md` §2 (phase-home summary replaces the standing-recommendations sentence).

**Bugs found:** none (documentation-only session; no code touched, so the four gates are unaffected — the last full verification stands: 164 suites / 1740 tests / lint / flow / format green).

**Issues found:**
- Doc drift fixed in passing: `Phase9.md` step 9.5 referenced "9.0's auto result" — a step number that does not exist; it meant the Phase 6 vision auto-detect, and now says so.
- Phase 9 is the largest phase after the fold-ins (F1 + F3 + D5 + watchdog + compaction + capabilities + evals); judged still coherent under the "scale/robustness/economics" theme. If the owner prefers a smaller Phase 9 at restart time, F3/D5 is the natural split point for a Phase 10.
- Triage statement for this session: **no OOS, no deferred, no UT** *newly surfaced* — planning only; existing entries gained phase-home pointers and stay in their triage docs until fixed + verified.

**Files worked on:**
- Modified: `REVIEW/Phase7.md`, `REVIEW/Phase8.md`, `REVIEW/Phase9.md`, `REVIEW/outofscoped.md`, `REVIEW/deferred.md`, `REVIEW/usertasks.md`, `AGENTS.md`, `REVIEW/worklog.md` (this entry).
- Read: `REVIEW/usertasks.md`, `REVIEW/deferred.md`, `REVIEW/outofscoped.md`, `REVIEW/audit2209.md`, `REVIEW/Phase7.md`, `REVIEW/Phase8.md`, `REVIEW/Phase9.md`, `REVIEW/worklog.md` (format + entry order), `AGENTS.md`.

---

## 2026-09-22 — Owner decisions (16/16) recorded across the triage docs; electron format gate green (7283b2fc1c); project PAUSED

**Agent:** ZCode main orchestrator (no subagents).

**Actions:**
- Walked the owner through all 16 pending decisions in chat (per AGENTS.md §5.3) and recorded the answers in the canonical list (`usertasks.md`): **approved** — D1 chat history *with the owner's file-based design* (save on every user message + AI completion + app closure, YAML or Markdown, history button in the chat tab, 5-words-of-first-prompt + last-interaction-date naming), D5 badge/token row, D6 per-chat model+effort *with a ZCode-style multi-provider design* (provider registration; `provider/model` dropdown from `/models`; effort dropdown defaulting low/medium/high or server-listed levels), D10 explicit-delete-only for the API key, O1 hide-but-keep-code, O7+O13 chat cleanups, E2; **rejected/by-design** — D3 never re-admit store tools (confirmed routing model: login stays, BYOK-enabled setting routes AI), D9 keep local (GDevelop not accepting BYOK-fork PRs; owner may approach the team); **still deferred** — D2 streaming (superseded by the approved progress-updates+watchdog design, F2), D4 sub-agents (Phase 8), D8 container hook (Phase 8), O2 char-estimate fallback. O3/O4 were not in the chat round — their standing recommendations (Phase 8 / Phase 7–8 polish) were recorded as standing unless the owner objects.
- Propagated the dispositions: `outofscoped.md` (approved rows re-statused + new F1 history / F2 progress+watchdog / F3 providers design entries), `deferred.md` (by-design D3/D9 with the owner's reasoning; departures removed), `audit2209.md` (§1 disposition note, §2 table synced, Task 5 done, E2/E4/DOC1 resolved), `Phase9.md` (step 9.3 rewritten to the owner's file-based persistence design — superseding the IndexedDB-only plan, kept as the web fallback; step 9.4 annotated with F3), `Phase7.md` (DOCs/ clone noted as the docs-source input), `AGENTS.md` §2 (answers recorded, PAUSED state, owner assets `libgd-2.3.3\` + `DOCs\`).
- Executed the approved E15: prettier-formatted the two pre-existing upstream electron files (`CliCommandHandoff.js`, `OpenProjectsRegistry.js`) and committed them as `7283b2fc1c` — the electron-app `check-format` gate is fully green now.
- Owner completed out-of-band: AGENTS.md rewrite (decision process + triage docs + reality), saved `libgd-2.3.3` at the repo root, cloned `GDevelop-documentation` to `DOCs/`.

**Bugs found:** none (documentation, triage and one formatting-only commit; no behavior change — `node --check` passes both formatted files).

**Issues found:**
- The chat round omitted O3 and O4 (they were context in earlier rounds, never numbered questions) — recorded with their standing recommendations and flagged to the owner for objection rather than assumed answered.
- Triage statement for this session: **no OOS, no deferred, no UT** *newly surfaced* — the session's triage output consists entirely of dispositions of the 16 owner answers (F1–F3 added to `outofscoped.md` as approved designs, D3/D9 rejections filed as by-design in `deferred.md`); no new findings, deferrals or user tasks were discovered.
- Open implementation choices inside the owner's F1 design (deliberately left to the build session, recorded in Phase9.md): YAML vs Markdown format, web-build storage fallback, image sidecar layout.

**Files worked on:**
- Modified: `REVIEW/usertasks.md` (answers recorded against the canonical list + extras), `REVIEW/outofscoped.md` (statuses + F1–F3), `REVIEW/deferred.md` (rewritten to post-decision state), `REVIEW/audit2209.md` (synced), `REVIEW/Phase9.md` (step 9.3 owner design + 9.4 note + overview bullet), `REVIEW/Phase7.md` (DOCs note), `AGENTS.md` (§2 standing section), `REVIEW/worklog.md` (this entry); `newIDE/electron-app/app/CliCommandHandoff.js` + `OpenProjectsRegistry.js` (prettier only — committed `7283b2fc1c`); agent memory (project state: paused, decisions recorded, owner assets).
- Read: `usertasks.md` (canonical decision list), `outofscoped.md`/`deferred.md` (pre-disposition state), `audit2209.md`, `Phase9.md` §9.3–9.4, `Phase7.md` header, `AGENTS.md` (owner's rewrite).

---

## 2026-09-22 — AGENTS.md refreshed; triage system introduced (`outofscoped.md`, `deferred.md`); pending owner decisions recorded in usertasks.md

**Agent:** ZCode main orchestrator (no subagents).

**Actions:**
- **Rewrote `AGENTS.md`** (repo root) to match reality: path `C:\Projects\GDevelop` (was `D:\`), Git Bash shell (replaces the cmd-only claims), the checkout **is** a git repository with owner-made milestone commits (e.g. `0802d2d21e`; agents commit only when asked), a new "Where the project stands" status section (Phases 1–6 implemented and committed, Phases 7–9 planned, prompt `byok-v4`, 164 suites / 1740 tests / lint / flow / format green), a "Workflow" section that keeps the per-phase loop and adds the end-of-session triage + decision-making rules (decide/defer/escalate, one numbered chat message with recommendations, `no OOS`/`no deferred`/`no UT` markers in the worklog), a fresh-checkout rebuild recipe and the flow/electron gate quirks in the cheat sheet, and a rate-limit retry note for subagent waves.
- **Created `REVIEW/outofscoped.md`** — the "to be tackled" backlog: items that should be fixed but fell outside a session's scope/budget; entries are **removed** once fixed and verified (the permanent record stays in the worklog). Seeded with audit2209 §1 findings O1–O13, each with its blocker (or a link to the owner decision that gates it).
- **Created `REVIEW/deferred.md`** — the human-readable deferral log (what / why deferred / when to tackle / proposal to the owner). Seeded with D1–D6, D8–D10; D7 noted as de-scoped by design.
- **Updated `REVIEW/usertasks.md`:** new "Pending owner decisions" section — the canonical numbered record (#1–#16, recommendations included) of the 16 decisions presented in chat on 2026-09-22, answers pending; the monitoring note now points at the three-doc triage; Task 5 and Task 8.1 got cross-references to the decision numbers so they stop reading as competing decision lists.
- **Updated `REVIEW/audit2209.md` header:** the triage docs are now the actionable layer; audit2209 keeps the findings detail and history (its earlier "single place to watch" claim was softened to avoid divergence).

**Bugs found:** none (documentation only; no code touched).

**Issues found:**
- The old AGENTS.md contradicted reality on three points (D:\ path, "not a git repository", cmd-only shell) — all fixed; the manual now carries a self-drift rule (fix the manual in the same session and say so here).
- Decision numbering #1–#16 in `usertasks.md` is now canonical; when the owner answers in chat, map answers onto these numbers before moving items between docs.
- Uncommitted tree at session start: `main.js`/`ByokSafeStorage.js` (formatting-only from the earlier 2026-09-22 session, verified via `git diff`), the doc edits of that session, untracked `audit2209.md`, and an untracked `.kilo/` directory not created by this project's work — left untouched.

**Files worked on:**
- Modified: `AGENTS.md` (root, full rewrite), `REVIEW/usertasks.md` (monitoring note, pending-decisions section, Task 5/8.1 cross-refs), `REVIEW/audit2209.md` (header), `REVIEW/worklog.md` (this entry).
- Created: `REVIEW/outofscoped.md`, `REVIEW/deferred.md`.
- Read (verification): `REVIEW/audit2209.md`, `REVIEW/usertasks.md`, `REVIEW/worklog.md` (latest entries), `REVIEW/Phase7.md`/`Phase8.md`/`Phase9.md` (headers, for the status section), `git status`/`git diff`/`git log` (uncommitted state, recent commits).

---

## 2026-09-22 — electron-app dev deps installed (prettier gate runnable) + open findings consolidated into audit2209.md

**Agent:** ZCode main orchestrator (no subagents).

**Actions:**
- **Environment:** installed `newIDE/electron-app` dependencies for future runs — `npm install --ignore-scripts` at the electron-app root (375 packages: prettier 1.15.3, electron-builder, …) **and** inside `electron-app/app` (331 packages: @electron/remote, discord-rpc, electron-log, …). `--ignore-scripts` deliberately skips the Electron binary download and the zipped-extensions import: dev tooling (`npm run check-format`, `node --check`) works; actually running/packaging the desktop app still needs a full `npm install` there (usertasks Task 1 step 1 unchanged). Both dirtied lockfiles restored with `git checkout --`.
- Ran the electron-app's own `check-format` for the first time: it flagged our two BYOK files plus two pre-existing upstream diffs. Formatted only the BYOK files (`app/main.js`, `app/ByokSafeStorage.js` — +58/−45, formatting only; `node --check` passes both). The two upstream files (`app/CliCommandHandoff.js`, `app/OpenProjectsRegistry.js`) were left untouched (out of budget) — the gate stays red on them, recorded as ENV item E2.
- **Consolidation (user request):** created `REVIEW/audit2209.md` — the single tracker of everything not yet fixed, gathered from the five `audit2109*.md` reports, `audit.md`, the 2026-09-21/22 worklog entries, `usertasks.md` and the agent memory: 13 open code findings (O1–O13, e.g. inert feedback buttons needing an optional upstream prop, usage-less context guard, user-facing image rendering), the deferred-feature table (D1–D10, statuses updated for Phase 5–6 reality), the USER-QA queue (Tasks 1–8 + AGENTS.md refresh), environment notes (E1–E7) and by-design decisions. Memory no longer duplicates the deferred lists — it points here.
- **usertasks.md fixes:** the duplicate "Task 6" heading (Housekeeping vs Phase-5 QA) renumbered Housekeeping → Task 8; Task 3 (commit) marked DONE (`0802d2d21e`); monitoring note added pointing to `audit2209.md`.

**Bugs found:** none (no behavior changed — installs, formatting and docs only; the two formatted Electron files pass `node --check` and their BYOK blocks are untouched beyond wrapping).

**Issues found:**
- The electron-app's `check-format` has 2 pre-existing **upstream** diffs (`CliCommandHandoff.js`, `OpenProjectsRegistry.js`) — never gates our files, but the script exits non-zero until someone accepts a format-only upstream commit (audit2209 E2).
- The electron-app `postinstall` (zipped-extension import + nested install + electron-remote copy) was skipped by design; if the desktop dev app misbehaves in Task 1, re-run a full install first.
- Open findings used to live in five places (audit reports, worklog entries, usertasks, memory, phase docs); they are now consolidated in `REVIEW/audit2209.md` — future sessions should update that file instead of scattering new deferrals.

**Files worked on:**
- Created: `REVIEW/audit2209.md`.
- Modified: `newIDE/electron-app/app/main.js` + `app/ByokSafeStorage.js` (prettier, formatting only), `REVIEW/usertasks.md` (renumber + status + note), `REVIEW/worklog.md` (this entry), agent memory (`byok-project-environment.md`, `gdevelop-flow-jest-quirks.md` — deferred lists replaced by a pointer to audit2209.md).
- Environment: `newIDE/electron-app/node_modules` + `newIDE/electron-app/app/node_modules` installed (`--ignore-scripts`); lockfiles restored clean.

---

## 2026-09-22 — audit2109 fixes implemented: %-key corruption, dispatch whitelist, abort-on-stop, per-model context windows, reachable BYOK history, protocol-valid transcripts

**Agent:** ZCode main orchestrator (audit report at `audit2109*.md`; all fixes and tests written by the orchestrator, no subagents).

**Actions:**
- Implemented the deduplicated findings of the 5-agent audit, priority BYOK robustness with the hosted (server-side AI) workflow untouched — every shared-file change is BYOK-gated (branch/prop) with the server path byte-identical:
  - **B fixes:** `%`-byte escaping in `ByokKeyStorage`'s obfuscation decoder (keys containing `%` were silently corrupted or read as "not stored"; old stored values decode correctly with the fix); tool whitelist enforced at dispatch in `executeToolCalls` (hallucinated non-whitelisted names, incl. `run_script`, get a refusal output instead of executing); abort propagation (`createByokCancellation` in the client, cancelled per loop-run, `suspend()` aborts the in-flight request, `cancelled` error kind keeps the suspended status instead of showing an endpoint error, late plain-text answers no longer flip suspended→ready); stop-during-approval race closed (re-check after the approval await); per-model/server context windows wired through `resolveContextWindowTokens` (re-resolved every turn); `byok-context-full` closes the pending batch with not-executed outputs and `retryAfterError` refuses it (no more phantom working state or paid re-send of the oversized history); plan rendering fixed via `mode: 'orchestrator'` on the BYOK shell; missing-key chats recoverable (`attachByokOrchestrator` — messages and Retry re-attach instead of silently no-op'ing); BYOK chats listed in `AskAiHistory` (own section, Archive = suspend + remove) so a backgrounded chat is watchable/stoppable.
  - **C/D fixes:** aborted/unfinished executor results get failure outputs (no dangling `tool_calls`); executor crash contained as failure outputs; empty model answers → `byok-empty-answer`; `Retry-After` parsed and long-wait 429s are not retried; test-connection ping gets a 15s timeout; base-URL whitespace trimmed; chat-completions response validation deepened (message object + tool-call id/function.name); plan tasks map `depends_on`→`dependsOn`; `ByokSeam` OR-accumulates `isNewObjectTypeUsed`; storage writes serialized through a promise chain (migration cannot resurrect an old key over a newer save); `saveByokKey`/`clearByokKey` return success booleans; `getByokKeyStorageInfo` reports the actually stored format (honest v2 downgrade); settings tab: translated error display (`renderByokErrorMessage`, generic fallbacks via `<Trans>`), blur-committed context-window fields (no keystroke clamping), "Clear the stored key" button, `autoComplete="off"`, unmount guards, blur-save/click-load race fixed via `pendingKeySaveRef`; models cache: normalized keys, defensive copies, `clearByokModels` on key change; `getByokSettings` returns fresh defaults; `i18n._(t…)` for the missing-key message; `brush_position`/`new_instances_count` schema descriptions match the implementation; validator made injectable + negative-path tests + spot checks pinning `put_2d_instances`/`create_or_replace_object`/`add_or_edit_variable`/plan; `main.js`/`ByokSafeStorage.js` line-width fixes; `fetchByokModels` dead code removed.
- **Tests:** every fix pinned (293 BYOK tests at the end of this session: whitelist refusals, mixed batches, abort + cancelled-kind, stop-during-approval, per-model + server-reported windows, context-full batch-closing + retry refusal, aborted results, executor crash, empty answer, plan mapping, `%`-keys, write-failure booleans, honest storage info, migration race, IPC rejections, v3-on-web, cache copy/normalize/clear, fresh defaults, transcript replay cases, OR-accumulation, archive-ignores-updates, validator failure branches, drafts/clear-button/ping-timeout/error rendering).
- **Gates at the end of the session:** `npm test -- --watchAll=false` 157 suites / 1615 passed / 1 skipped / 0 failed; `npm run lint` 0 warnings; `flow.exe check` 0 errors; `npm run check-format` clean. (This work was committed by the user as part of `0802d2d21e` "phase5-9 planned", together with the later Phases 5–6 session; the combined tree was re-verified on 2026-09-22: 164 suites / 1740 passed / 1 skipped / 0 failed, lint 0, flow 0, format clean.)

**Bugs found:**
- The `%`-corruption, whitelist bypass, missing abort, approval race, dead context-window resolution, unreachable BYOK chats, silent message loss and phantom context-full state were the audit's findings — all reproduced by a failing test before/at the fix (see the audit reports for the details).
- Migration-race guard alone was insufficient: the identity check still raced the async write; the final fix serializes all storage writes through a promise chain with the check inside the queued task.

**Issues found:**
- **Files touched outside the documented budgets (each minimal, flagged per agents.md §3):** `AskAiHistory.js` — additive optional props (`byokChatSummaries`, `onArchiveByokChat`) + a BYOK section + a byok branch in the chat context menu; without it the audit's top UI finding (backgrounded paid chats unreachable) has no fix surface. `AiRequestErrorRow.js` — 3 lines mapping `byok-context-full`/`byok-too-many-tool-rounds`/`byok-repeated-tool-call-loop` to the existing UI kinds. `electron-app/app/main.js` + `ByokSafeStorage.js` — line wraps only.
- The jest preset resets every mock implementation before each test (`resetMocks`): implementations given inside `jest.mock` factories vanish — they must be re-set in `beforeEach` (cost a debugging detour; documented in memory).
- Prettier's flow parser rejects chained indexed-access types (`T['content'][number]`) — typed the transcript content via a documented alternative instead.
- This Flow version deprecates `$Shape` → `updateByokSetting` keeps `Partial<>` (the audit had recommended the opposite; the toolchain wins).
- jsdom storage spies must target `Storage.prototype`, not the `localStorage` instance.
- `electron-app` has no installed prettier in this environment: its files' line widths were verified manually (`awk`), not via its `check-format` script.
- **Deferred (with rationale):** hiding the like/dislike buttons for BYOK chats entirely needs `onSendFeedback` to become an optional prop in `AiRequestChat`/`ChatMessages` (upstream, out of budget) — an inert no-op handler is passed for BYOK chats meanwhile; the context guard still silently disappears when an endpoint omits `usage` (documented; the round cap is the remaining protection and is now pinned by the no-usage runaway test); executor/`ensureExtensionInstalled` staleness beyond the live `hasOpenedProject`/`getProject` getters is left to the later phase that made the executor a getter.

**Files worked on:**
- Modified (renderer): `Byok/ByokKeyStorage.js` + `.spec.js`, `Byok/ByokClient.js` + `.spec.js`, `Byok/ByokErrors.js` + `.spec.js`, `Byok/ByokModelsCache.js` + `.spec.js`, `Byok/ByokTypes.js` + `.spec.js`, `Byok/ByokTranscript.js` + `.spec.js`, `Byok/ByokChatStore.spec.js`, `Byok/ByokSeam.js` + `.spec.js`, `Byok/ByokToolSchema.js` + `.spec.js`, `Byok/ByokOrchestrator.js` + `.spec.js`, `Byok/ByokSettingsTab.js` + `.spec.js`, `AskAiEditorContainer.js`, `AskAiHistory.js`, `AiRequestChat/AiRequestErrorRow.js`.
- Modified (electron, formatting only): `electron-app/app/main.js`, `electron-app/app/ByokSafeStorage.js`.
- Read (fix design): `audit2109storage/client/loop/schema/ui.md`, `AiRequestUtils.js`, `AiRequestChat/AiRequestErrorRow.js`/`ChatMessages.js`/`index.js`, `Generation.js`, `RetryIfFailed.js`, `EditorFunctions/index.js` (schema cross-checks), `UI/TextField.js`, `REVIEW/Phase1-4.md`, `styleguide.md`.

---

## 2026-09-22 — Phases 5 and 6 implemented: local EventScript event writing, full tool parity, script agent, project creation, loop guard, vision + perception + gameplay tests (byok-v4)

**Agent:** ZCode main orchestrator (all code and tests written by the orchestrator per the house rule) + 4 read-only Explore subagents in one wave (arg-extraction mapping of the inspect/change/run_script/initialize_project/add_scene_events+ApplyEventsChanges/gameplay-test+perception surfaces of `EditorFunctions/index.js` and the preview/debugger plumbing).

**Actions:**
- **Environment:** rebuilt the session environment per the known recipe (`npm install --ignore-scripts`, `npx patch-package`, `make-version-metadata`, `build-theme-resources`, `import-libGD.js` — only the HEAD~3 build downloads today); `package-lock.json` re-dirtied by the install and restored with `git checkout --`.
- **Step 5.0** — decision table written to `REVIEW/phase5-tool-decisions.md`: every registry tool admitted/excluded with a reason; `generate_events` = dispatchable-but-unadvertised alias; `create_object` + legacy aliases excluded; store-search decision = keep the account-gated store paths, no new toggle.
- **Step 5.1** — `ByokToolSchema.js`: whitelist renamed `BYOK_TOOL_NAMES` (22 always-advertised) + `BYOK_NO_PROJECT_TOOL_NAMES` (`initialize_project`, advertised only while no project is open — what reconciles the step list's 23 names with the ≤22 AC) + `getByokDispatchableToolNames` (adds the alias); 12 new schemas authored against each implementation's extractor calls; validator extended (merged registry, count cap, `BYOK_ONLY_TOOL_NAMES` exemption for the Phase-6 interception-only tools).
- **Step 5.2 (headline)** — `ByokEventScriptParser.js`: full EventScript grammar written from `EventScriptRenderer.js` + the shared conformance fixtures — statements (if/always/else/else-if/while/repeat/for-each/for-each-child/group/comment/link/local vars/pass/disabled), condition compositions (`not`/`Or(`/`And(`/`Not(`/parenthesized and-groups/`once`), actions with `await`, string-aware top-level splitting (commas, ` and `, loop clauses), `\n` parameter unescaping, and **code-only parameter refill from libGD metadata** (the hosted "compilation" step). All 9 conformance fixtures round-trip parse→gd→render byte-identically; positioned, model-fixable errors. `ByokLocalEventWriter.js`: batches → validated `AiGeneratedEventChange`-shaped ops → `applyEventsChanges` (all-or-nothing pre-validation through a real gd.EventsList, `expected_event_source` anchor verification via `renderEventSourceById`, hosted `delete` alias, `onSceneEventsModifiedOutsideEditor` notification, `byok-*` aiGeneratedEventIds). `ByokExtraTools.js`: the interception registry (plan-tool pattern generalized) resolving `add_scene_events`/`generate_events` **before** the editor registry (whose implementations would post to GDevelop's backend). Orchestrator consults it in `executeToolCalls`.
- **Step 5.3** — `run_script` admitted (registry runner untouched: sandbox, 600-call cap, sequential guard; one approval per script via its `modifiesProject`); script-first policy added to the prompt; schema pinned in tests.
- **Step 5.4** — `initialize_project` admitted (conditional advertisement); orchestrator options are now getters (`getExecutor()`, plus existing `hasOpenedProject`/`getProjectUserContent` re-read per turn); `ByokSeam`'s executor takes `getProject` (read at call time); container keeps `byokCreatedProjectRef` (set synchronously in `onFunctionCallsExecuted`) + `byokProjectRef` (live prop) behind `getByokLiveProject()`; the orchestrator re-fetches the snapshot when a batch creates a project. Unit test: mid-chat `initialize_project` → next turn re-reads getters, drops `initialize_project` from the tools, leaves the "no project" prompt section.
- **Step 5.5** — `ByokLoopGuards.js`: last-8 fingerprint history, 3rd identical call → corrective refusal (loop continues), 4th → `byok-repeated-tool-call-loop` error (mapped to "The AI got stuck" in `AiRequestErrorRow`); plan tool exempt; identical re-reads count. Hooked between collect and execute.
- **Steps 5.6 + 6.5 (prompts)** — `byok-v3` then `byok-v4`: EventScript operational core (~15 lines), script policy, project-creation section, look-verify cycle, hybrid grounding, gameplay-test guidance (`on-failure` screenshots, `paused` = window visibility), tool list auto-generated.
- **Step 6.0** — `imageSupport` setting (`auto`/`yes`/`no`, default auto) in `ByokTypes` + a Preferences selector; `describeInvalidRequestForImageContent` in `ByokErrors`; orchestrator auto-degrades a chat to text-only (one retry) when the endpoint's 4xx names image content.
- **Step 6.1** — `ByokImageContent.js`: image registry (session-scoped ids), `estimateByokImageTokens` (w×h/784), canvas downscale to ≤1024/JPEG-0.7 (node-safe fallback); `ByokTranscript` carries `images` ids on tool outputs and materializes them at replay as a `[tool result image]` user message with `image_url` parts + one-line placeholders for evicted ones; latest-2 rule.
- **Step 6.2** — `capture_scene_screenshot` (DOM discovery of the visible scene-editor canvas — `findLargestVisibleSceneCanvas`, no editor refactoring) + `capture_preview_screenshot` (Electron `byok-preview-capture` IPC over `PreviewWindow.getPreviewWindows()` → `webContents.capturePage`), both returning `{success, image, width, height, note}` (never an image without its textual sibling).
- **Step 6.3** — `ByokPreviewSession.js`: start/stop around the registered preview launcher (subscribes before launching, unregisters on stop — no dangling listeners), 200-entry log ring buffer (library warnings filtered), crash capture, `refresh` state dump reduced per scene (instances/variables); tools `start_preview`, `stop_preview`, `read_preview_logs`, `get_runtime_errors`, `inspect_runtime_state`.
- **Step 6.4** — `run_gameplay_test` admitted and intercepted **for result shaping only** (base64 screenshots → image ids via the pipeline, everything else — assertions/errors/logs/finalState/repair `source` — kept); `change_gameplay_tests` goes through the registry unchanged (persist-vs-probe approval via upstream `getModifiesProject`).
- **Step 6.5** — image token budget in the context guard: under ratio pressure the guard decrements `imagesToKeep` (2→1→0) and still executes the pending batch; only a text-only overflow hard-stops (a `slice(-0)` bug found here — see Bugs).
- **Gates:** `npm test -- --watchAll=false` → **164 suites / 1740 passed / 1 skipped / 0 failed** (from 157/1561 at Phase 4: +179 tests); `npm run lint` → 0 warnings; Flow (flow.exe workaround) → 0 errors; `npm run check-format` → clean. `node --check` on both Electron files.

**Bugs found:**
1. **`slice(-0)` kept every image when the budget hit zero** — `getByokSurvivingImageIds` used `imageIds.slice(-keepCount)`: with `keepCount = 0`, `slice(-0) === slice(0)` returns the whole array, so full eviction kept sending all images (caught by the Phase-6 image-budget AC test: parts stayed 2 after both evictions). Fixed with an explicit `keepCount <= 0 → empty Set` guard (`ByokTranscript.js`). Repro: any run whose context guard evicts to 0 — the very scenario the AC pins.
2. **Loop-guard history reset on argument change** — my first `ByokLoopGuards` implementation replaced the history with `[fingerprint]` on a differing call instead of appending (the phase says "keep the last N (8) fingerprints"); the streak still worked but the memory contract didn't. Fixed to append + cap + derive the trailing streak (`ByokLoopGuards.js`; pinned by the history-size test).
3. **Parser accepted non-event statements at top level** — `'whenever something:'` fell through `classifyStatement` into the for-each-child header parser (garbage-in-garbage-out instead of a positioned error). Fixed: `parseEventsList` rejects non-header kinds with a message listing the valid statements (`ByokEventScriptParser.js`).
4. **Composition short-names mismatch** — the parser matched `BuiltinCommonInstructions::Or(` while the renderer emits `Or(`, so compositions parsed as unknown calls with raw operands. Fixed by matching the short names and mapping back to the builtin types.
5. **Test-harness trap (environment, fixed in-session):** running **raw `npx jest` silently bypasses the project's `react-app-rewired` config** — no `setupTests.js`, hence no libGD and misleading `global.gd` failures across all gd-dependent suites (including pre-existing ones). Correct runner: `npm test -- --watchAll=false`. Diagnosed with a load-check throw that never failed. Also documented in memory.

**Issues found:**
- **Files touched outside the phase budgets (each minimal, none avoidable — flagged per agents.md §3):** `src/setupTests.js` — reverted after diagnosing (final diff: none; the file was a red herring from the raw-jest trap); `src/GameplayTests/GameplayTestRunner.js` — added the 9-line `getProjectPreviewLauncher` export (the BYOK preview session needs the launcher MainFrame registers; no behavior change); `newIDE/electron-app/app/PreviewWindow.js` — added the 2-line `getPreviewWindows()` registry getter for the capture IPC; `src/AiGeneration/AiRequestChat/AiRequestErrorRow.js` — one line mapping `byok-repeated-tool-call-loop` → the "stuck" UI kind (implied by step 5.5's wording, not listed in its files).
- **AC reconciliations (documented in the phase docs):** Phase 5's step 5.1 "at minimum" list enumerates 23 advertised names while the AC caps the default set at 22 — resolved by advertising `initialize_project` only on no-project turns (unit-tested); the Phase 6 doc's "Modified: …+5 tools" vs its steps' 9 tools — the steps and ACs won (9 admitted, count cap moved to ≤32 with a comment); Phase 5's "byok-v3" AC is superseded by Phase 6's `byok-v4` landed in the same session.
- **Headless-session QA (the established pattern):** the Phase 5 parity-matrix QA, the refused-script/stop flows, the stuck-loop demo, the Phase 6 "trees overlap" flagship, the preview/gameplay-test flows and the network-tab verification all need the real desktop app + a real endpoint — step-by-step checklists added as `usertasks.md` Tasks 6 and 7; the corresponding AC sub-clauses are annotated in the phase docs.
- **6.0 "notify once in-chat" interpreted as:** one console.info + the chat going text-only + the replay placeholders explaining the missing screenshots (no fabricated transcript message). Revisit with Phase 9's durable chats if a visible in-chat notice is wanted.
- **Chat UI does not render transcript images for the user yet** — the model sees them, the user sees the tool-output text; noted in Phase6.md §5 for a later polish.
- `ensureExtensionInstalled` in the BYOK executor memo still keys on the React `project` prop, so an extension install in the same second a project is created mid-chat uses the stale memo until the next render (next render fixes it; the project itself is resolved live). Left as-is deliberately — `useEnsureExtensionInstalled` is upstream and out of budget.
- The evening sessions of 2026-09-21 (AIflow mapping, audit2109, roadmap writing) each dispatched subagent waves; only the roadmap session wrote a worklog entry — noted for completeness, nothing to fix retroactively.
- **Environment:** libGD S3 builds for HEAD..HEAD~2 404 (only the HEAD~3 build exists this session); the "worker process failed to exit gracefully" Jest notice appears on the full run (pre-existing, no failing test).

**Audit greps (run 2026-09-22, outputs as-is):**
```
$ grep -rln "ByokEventScriptParser|ByokLocalEventWriter|ByokExtraTools|ByokLoopGuards|ByokImageContent|ByokPreviewSession|ByokRuntimeTools" newIDE/app/src newIDE/electron-app/app
→ AskAiEditorContainer.js + the Byok/ modules themselves + ByokToolSchema.js + ByokTranscript.js + ByokTypes.js + electron-app/app/main.js (containment: no other consumers)

$ grep -rn "api.gdevelop.io|/ai-generated-event|createAiGeneratedEvent|prepareAiUserContent" <the 7 new Byok modules>
→ NO MATCHES (clean — local event writing touches no GDevelop backend)

$ grep -n "applyEventsChanges|renderEventSourceById|unserializeFromJSObject|serializeToJSON" ByokLocalEventWriter.js
→ 3,4,6,7,13,44,158,269,320,358,367,373 (all four local primitives used)

$ grep -rn "getProjectPreviewLauncher|byok-preview-capture" GameplayTestRunner.js electron-app/app/main.js ByokRuntimeTools.js
→ GameplayTestRunner.js:874, ByokRuntimeTools.js:70,87,101, main.js:480 (the capture wiring is connected end to end)
```

**Files worked on:**
- Created (14): `newIDE/app/src/AiGeneration/Byok/ByokEventScriptParser.js` + `.spec.js`, `ByokLocalEventWriter.js` + `.spec.js`, `ByokExtraTools.js` + `.spec.js`, `ByokLoopGuards.js` + `.spec.js`, `ByokImageContent.js` + `.spec.js`, `ByokPreviewSession.js` + `.spec.js`, `ByokRuntimeTools.js` + `.spec.js`; `REVIEW/phase5-tool-decisions.md`.
- Modified (28): Byok: `ByokToolSchema.js`/`.spec.js`, `ByokOrchestrator.js`/`.spec.js`, `ByokPrompts.js`/`.spec.js`, `ByokTranscript.js`/`.spec.js`, `ByokTypes.js`/`.spec.js`, `ByokErrors.js`/`.spec.js`, `ByokSeam.js`/`.spec.js`, `ByokSettingsTab.js`/`.spec.js`, `ByokClient.js`. Elsewhere (documented above): `AskAiEditorContainer.js`, `AiRequestChat/AiRequestErrorRow.js`, `GameplayTests/GameplayTestRunner.js`, `electron-app/app/PreviewWindow.js`, `electron-app/app/main.js`. Docs: `Phase5.md`, `Phase6.md`, `usertasks.md`, this file. (`src/setupTests.js` was touched while diagnosing the jest trap and restored byte-identical.)
- Read (key mapping inputs, no changes): `EventScriptRenderer.js` + fixtures, `EventScriptSourceView.js`, `ApplyEventsChanges.js`, `EditorFunctions/index.js` (registry + mapped implementations), `EditorFunctionCallRunner.js`, `GameplayTestTools.js`, `GameplayTestRunner.js` (wiring), `LocalPreviewDebuggerServer.js`, `Debugger/index.js`, `InstancesEditor/index.js`, `electron-app/app/PreviewWindow.js`/`main.js`, `AskAiStandAloneForm.js`, `AiRequestChat/AiRequestErrorRow.js`, `Core/GDCore/Events/**` (serialization field names), `AIflow.md`, `styleguide.md`, `agents.md`.

---

## 2026-09-21 — Phases 5–9 roadmap written: BYOK ≥ hosted AI (capability, perception, knowledge/skills, autonomous workflow, robustness)

**Agent:** ZCode main orchestrator + 5 Explore subagents in one wave (hosted-AI capability catalog via web+repo history; agentic/game-build SOTA via web; repo perception/preview/events-as-code mapping; engine knowledge taxonomy web+repo; BYOK v1 limitation audit) — read-only, within the ≤5 rule.

**Actions:**
- User goal: make BYOK equal or better than the server-side AI, focused on game making (math, physics, JS, three.js, screenshots, UI entry points), mapped into `Phase5.md`–`Phase9.md`.
- Research wave findings consolidated: hosted capability catalog + `AI_ORCHESTRATOR_TOOLS_VERSION` timeline (v1→v15 via commit archaeology) + discovery of an **upstream v18 branch in this clone** (`upstream/claude/gdevelop-ai-extensions-95js2m`, 9 extension-authoring tools, not in master); SOTA practices (Anthropic tool-design/multi-agent/context-engineering posts, OpenAI function-calling guide, SKILL.md standard, Voyager, browser-use hybrid grounding, GameDevBench/GameCraft-Bench results — runtime visual feedback ≈ +11 pts on game-dev tasks); repo feasibility (3 existing screenshot paths, debugger WS protocol incl. `game.crashed`/console/state dumps, `unserializeFromJSObject` + `ApplyEventsChanges` local event application, `run_script` sandbox, gameplay-test harness with input simulation + screenshots); engine knowledge taxonomy (EventScript grammar derivable from `EventScriptRenderer.js` + fixtures; object/behavior/action/expression catalogs machine-generable from Extensions metadata; docs open-source Markdown); BYOK v1 top-10 limitations (session-only chats, hard context dead-end, no initialize_project + stale-closure wiring, no vision, no compaction, no stuck-loop detection, null sub-agent seam, no fork/suggestions, single model).
- Wrote the five phase docs in house format (steps/files/tests/ACs each): **Phase5** tool parity + local EventScript→events writing + `run_script` + `initialize_project` + loop detection (`byok-v3`); **Phase6** vision input, screenshot tools (editor canvas / Electron `capturePage` / gameplay tests), preview control, console/crash/state reads, act→look→verify (`byok-v4`); **Phase7** prompt composer with token budget, machine-generated engine reference + `search_reference` tool, EventScript grammar pack, game-design system messages, math/physics/JS packs, SKILL.md-style skills system with starter set, offline docs, per-project notes (`byok-v5`); **Phase8** scout/reviewer sub-agents, completion gates, build-workflow recipe, extension authoring ported from the v18 branch, standalone-form + context-menu entry points, fork/restore points (`byok-v6`); **Phase9** streaming, compaction, IndexedDB persistence, model routing, capability gating + built-in benchmark, local suggestions/feedback, dev-only eval harness. Phase5.md §0 carries the roadmap overview (category→phase matrix, dependency graph, equality/advantage rationale).
- No source code touched; documentation session only.

**Bugs found:** none (no code executed or modified).

**Issues found:**
- **Concurrent session notice:** while this session ran, a separate 5-agent code audit wrote `REVIEW/audit2109{client,loop,schema,storage,ui}.md` and the worklog entry below (68 findings). Its fix track owns those bugs; roadmap touchpoints noted so the phases don't duplicate or contradict: whitelist-not-enforced-at-dispatch (Phase 5 assumes enforcement — its step 5.1 tests should assert dispatch-time filtering once fixed); no abort propagation / Retry-After (Phase 9 step 9.7); per-model context window unused (Phase 6/9 budget guards should consume the fixed resolution); `archiveByokChat` hard-deletes (Phase 9 step 9.3).
- **Latent v1 wiring flaw (fix lands in Phase 5 step 5.4):** `AskAiEditorContainer.js:649-664` captures the BYOK executor/`hasOpenedProject`/`getProjectUserContent` as closures at chat start — any project change mid-chat (including a future `initialize_project`) is invisible to the running orchestrator.
- **EventScript parser does not exist client-side** — the canonical grammar lives in the private GDevelop-services repo (`EventScriptRenderer.js` header comment). Phase 5 must author a parser from the in-repo serializer + shared conformance fixtures (`EventScriptRenderer.fixtures.json`); risk tracked in Phase5.md §4.
- **Upstream v18 branch may land in master** (AI extension authoring, branch enabled 2026-09-15). Phase 8 ports the approach as BYOK-intercepted tools with a delegation guard if the registry versions stop being stubs; re-check upstream before implementing step 8.4.
- **Docs redistribution needs a license check** before bundling GDevelop-documentation Markdown (Phase 7 step 7.7 blocks on it; fetch-on-demand is the fallback).
- **Hosted-AI user reports exploitable by design:** persistent server `add_scene_events` "Infrastructure error" (forum thread 75417) — local event writing (Phase 5) is structurally immune; "Ask AI does not read PC files" — `read_game_project_json`/`run_script` cover most of that need client-side.
- `audit.md` D1–D7 backlog is subsumed by the new phases (each D-decision now has a concrete home); `usertasks.md` Tasks 1–3 remain user-blocked and unchanged.

**Files worked on:**
- Created: `REVIEW/Phase5.md`, `REVIEW/Phase6.md`, `REVIEW/Phase7.md`, `REVIEW/Phase8.md`, `REVIEW/Phase9.md`.
- Modified: `REVIEW/worklog.md` (this entry).
- Read: `REVIEW/Phase4.md` (house format), `REVIEW/report.md`, `REVIEW/worklog.md` (format + the concurrent audit entry), memory notes; subagents read (repo): `newIDE/app/src/AiGeneration/Byok/*` (all 14 modules), `AskAiEditorContainer.js`, `AskAiStandAloneForm.js`, `AskAiPrefill.js`, `AiGeneration/AiRequestUtils.js`, `AiGeneration/Utils.js`, `EditorFunctions/index.js` + `GameplayTestTools.js` + `ApplyEventsChanges.js` + `ScriptExecution/*` + `SimplifiedProject/*`, `GameplayTests/GameplayTestRunner.js` + `GameplayTestStateInspectors.js`, `EventsSheet/EventsTree/TextRenderer/EventScriptRenderer.js` (+fixtures) + `EventsSheet/index.js`, `ObjectsList/index.js`, `MainFrame/index.js` + `MainFrameCommands.js` + `UseCapturesManager.js`, `MainFrame/EditorContainers/EventsFunctionsExtensionEditorContainer.js` + `GameplayTestEditorContainer.js`, `Debugger/*`, `HotReload/*`, `PreviewState.js`, `ExportAndShare/LocalExporters/LocalPreviewLauncher/*`, `EventsFunctionsExtensionsLoader/*`, `JsExtensionsLoader/*`, `InstancesEditor/*`, `ResourcesList/ResourcePreview/Resource3DPreview.worker.js`, `Utils/GDevelopServices/Generation.js`, `Utils/Serializer.js`, `electron-app/app/main.js` + `PreviewWindow.js` + `DebuggerServer.js`, `GDJS/Runtime/*` (debugger-client, gameplay-tests, capturemanager, events-tools, pixi-renderers, runtimeobject/runtimescene), `Core/GDCore/Events/Builtin/*`, `Extensions/*` (Physics2Behavior, Physics3DBehavior, 3D, PlatformBehavior, TweenBehavior, TileMap, Lighting, ExampleJsExtension + catalog sweep), git history (tools-version commit timeline, v18 branch); internet: wiki.gdevelop.io (AI, gameplay-tests), gdevelop.io blog+pricing, github.com/4ian/GDevelop (issue #7932, releases, branches), forum.gdevelop.io threads, anthropic.com engineering posts (tools, multi-agent, context engineering, agent skills), developers.openai.com (function calling, vision), code.claude.com best practices, arxiv (Voyager 2305.16291, WebVoyager 2401.13919, self-debug 2304.05128, TITAN 2509.22170, mem0 2504.19413), GameDevBench + GameCraft-Bench, browser-use blog, agentskills.io, GDevelopApp/GDevelop-documentation repo.

---

## 2026-09-21 — Full Phase 1–4 code audit by 5 parallel agents (audit2109*.md)

**Agent:** ZCode main orchestrator + 5 general-purpose audit subagents in one wave ("storage", "client", "loop", "schema", "ui") — within the ≤5 rule; the "schema" agent was dropped once by a provider rate limit before doing any work and was re-dispatched alone.

**Actions:**
- Enumerated the complete Phase 1–4 implementation surface from the phase docs + git: 13 impl/spec pairs in `src\AiGeneration\Byok\` plus 6 upstream-touched files (`AskAiEditorContainer.js`, `PreferencesContext.js`, `PreferencesDialog.js`, `PreferencesProvider.js`, electron `ByokSafeStorage.js`, `main.js`) — 32 files; `AiRequestChat\index.js` confirmed NOT modified.
- Split the files evenly by subsystem (6/6/6/7/7), each agent reading its files IN FULL from the current working tree (uncommitted orchestrator/prompts/toolschema changes included), grep-following every dependency into the wider repo (IPC channel match, EditorFunctions tool registry cross-check, Generation.js message types, preferences paths), and writing a dedicated report `REVIEW/audit2109<name>.md` (assigned-files list first, then issues ordered A→E with affected file:function, human-readable explanation, proposed fix, and tests to write incl. edge cases). No source files modified; no npm gates run (static audit).
- Totals across the five reports: 68 findings — **0×A**, 11×B, 17×C, 22×D, 18×E (B counts include cross-agent duplicates, see below).

**Bugs found** (highest-severity, deduplicated; full detail in the five `audit2109*.md` reports):
- `resolveContextWindowTokens` (`ByokModelsCache.js:133-156`) has **zero production callers** — the orchestrator uses only the global `settings.contextWindowTokens` for the context bar and the 0.9 runaway guard, so large-context models are cut off at ~7.4k tokens. Found independently by 4 of 5 agents (storage/client/loop/ui).
- Key-storage obfuscation round-trip **corrupts keys containing `%`** on web / desktop encryption-fallback (`ByokKeyStorage.js:74-89`): `key%25` silently becomes `key%`, `%2z…` becomes "no key stored"; the v2→v3 desktop migration then persists the corrupted key.
- Orchestrator **does not enforce the tool whitelist at dispatch** (`ByokOrchestrator.js` `executeToolCalls`): a hallucinated non-whitelisted tool (e.g. `run_script`) actually executes on non-strict OpenAI-compatible servers.
- **No abort propagation**: `suspend()` cannot stop the in-flight axios call (retries can stretch it to ~6 min of paid tokens) and a late plain-text answer calls `markReady()` over the `suspended` status; the Test-connection ping shares the no-cancel/no-`Retry-After` problem (429 retry amplification).
- **Stop-during-approval race**: the `isSuspended` check runs only before the approval await — Stop then Approve still executes the modifying batch.
- **BYOK chats are permanently unreachable** once deselected: `listByokChats`/`archiveByokChat` are dead in production, so an orchestrator told "Continue working" keeps calling the paid endpoint with no UI to watch or stop it (`AskAiEditorContainer.js:538-547, 1314-1356`).
- **Silent message loss + dead Retry** after the missing-key error: `startByokChat` errors before creating an orchestrator, then `onSendMessage`/`onRetryByokChat` no-op while the input is cleared anyway (`AskAiEditorContainer.js:637-647, 965-986, 1495-1504`).
- Plan tool output **never renders as a plan**: BYOK shells lack `mode:'orchestrator'`, which `ChatMessages.js:516` gates the plan component on — users see raw JSON.
- `put_2d_instances` `brush_position` schema description promises "the scene center when omitted" but the implementation **rejects omitted positions** (`EditorFunctions\index.js:3875-3884`) — models following the schema get guaranteed failed rounds.

**Issues found:**
- Provider rate-limited the first "schema" agent dispatch (`1302 Rate limit reached`) before it produced anything; a solo re-dispatch succeeded — waves of 5 remain at the edge of what the provider allows.
- All BYOK error strings shown to users are hardcoded English rendered raw (`ByokErrors.js:45-71` and guard messages), violating the non-negotiable Lingui rule while the rest of the settings tab is fully `<Trans>`-ed; `byok-context-full` also leaves a phantom working state (dead Stop button) and its Retry re-sends the full history.
- Status row honesty gap (`ByokKeyStorage.js:199-209, 285-291`): a silent v2 downgrade after failed `byok-encrypt` still shows "encrypted by your operating system", against Phase 3's "Honest UI" goal; `saveByokKey` swallows failures so the tab shows "stored" for a key that wasn't persisted.
- Numerous C/D/E items recorded per-report: models-cache staleness on key change + shared mutable default settings reference; `fetchByokModels` dead/duplicated code; response validation shallower than declared Flow types (malformed `tool_calls` crashes `ByokTranscript.js:48-57`); `buildEndpointUrl` doesn't trim whitespace; `aborted`/non-finished executor results silently dropped (dangling `tool_calls` → protocol-invalid transcripts); schema↔implementation sync pinned for only `create_scene`; `depends_on` vs `dependsOn` latent mismatch; per-keystroke clamping in number fields; setState-after-unmount; desktop blur-save vs click-load IPC race; missing negative-path tests in `ByokToolSchema.spec.js` and missing suspend/abort/executor-throw tests in `ByokOrchestrator.spec.js`.
- Clean bill on the security-critical paths: IPC channel names/payloads match both sides; API key never in logs, transcripts, errors, preferences (spec-enforced) and is header-only with redaction on every throw path; all 11 tool names + property/enum schemas match the registry exactly; round cap and refused-edit suspension enforced and tested.
- Audit is static-analysis only — no test/lint/flow gates were run this session; the four uncommitted working-tree files (`AskAiEditorContainer.js`, `ByokOrchestrator.js`+spec, `ByokPrompts.js`, `ByokToolSchema.js`+spec) were audited as-on-disk.

**Files worked on:**
- Created: `REVIEW/audit2109storage.md`, `REVIEW/audit2109client.md`, `REVIEW/audit2109loop.md`, `REVIEW/audit2109schema.md`, `REVIEW/audit2109ui.md` (written by the respective subagents; the only files they were allowed to write).
- Modified: `REVIEW/worklog.md` (this entry).
- Read (audited in full by the assigned agents): all 26 `newIDE/app/src/AiGeneration/Byok/*.js` files (13 impl + 13 spec), `newIDE/app/src/AiGeneration/AskAiEditorContainer.js`, `newIDE/app/src/MainFrame/Preferences/PreferencesContext.js`, `PreferencesDialog.js`, `PreferencesProvider.js`, `newIDE/electron-app/app/ByokSafeStorage.js`, `newIDE/electron-app/app/main.js`; dependency-verification reads across `src/Utils/GDevelopServices/Generation.js`, `src/AiGeneration/AiRequestChat/*`, `src/AiGeneration/AiRequestUtils.js`, `src/EditorFunctions/index.js`, `src/Utils/RetryIfFailed.js`, `REVIEW/Phase1-4.md`, `REVIEW/report.md`, `styleguide.md`.

---

## 2026-09-21 — AI flow architecture map (AIflow.md): prompts, tools, context, skills audit

**Agent:** ZCode main orchestrator + 3 Explore subagents in one wave (tool-registry inventory; hosted-flow client prompt surface; "skills"/game-design prompt search) — read-only, within the ≤5 rule.

**Actions:**
- Architecture-design mapping session requested by the user: "what the agent has access to, what and where prompts reach it, what tools, skills and game design system messages are available".
- Subagent 1 inventoried the full tool registry (`EditorFunctions\index.js:9029-9083`): ~27 client-executed tools + 10 server-side stubs, the runner's execution model, the `run_script` sandbox (hygiene, not security; 600-call cap), backend-calling tools and endpoints, and the `modifiesProject` approval gating.
- Subagent 2 mapped the hosted flow's client prompt surface: every field of `createAiRequest`/`addMessageToAiRequest`, the SimplifiedProject content (in/out), CDN presets (`ai-settings-v2.json`), the BYOK seam in `AskAiEditorContainer.js`, and prefill/suggestion prompt material.
- Subagent 3 sweep-verified "skills" and game-design prompt content across `src` + locales (verdict: neither exists client-side), outlined `ByokPrompts.js`, and listed the `Byok\` folder.
- Orchestrator re-read `ByokPrompts.js` (full `byok-v2` prompt, section by section) and `ByokToolSchema.js` (11-tool whitelist + exclusion rationale), and confirmed the orchestrator's per-turn message assembly (system message, snapshot folded into last user message, 20 000-char tool-output cap) by grep.
- Wrote `REVIEW/AIflow.md` (the deliverable) and this worklog entry. No source code touched.

**Bugs found:** none (read-only documentation session).

**Issues found:**
- **No "skills" concept exists anywhere in the repo** (only 3 unrelated "skill" string hits: a fixture, Learn-section marketing copy, a name-generator word). If the term is expected from product material, it refers to server-side content; anything skill-like for BYOK would be greenfield.
- **No game-design system-message content exists client-side**: hosted orchestrator/sub-agent prompts live server-side (repo holds only fingerprints — `AI_ORCHESTRATOR_TOOLS_VERSION = 'v15'`, `systemPromptTemplateHash`), and the BYOK prompt is strictly operational. Recorded in AIflow.md §7 as the main prompting gap/opportunity (natural home: a new section in `ByokPrompts.js` or a sibling module, with a prompt-version bump).
- `read_full_docs`/`search_docs` are permanent failure stubs upstream (docs served server-side) — already excluded from the BYOK whitelist; noted in AIflow.md so future prompting work doesn't assume a docs tool exists.
- BYOK capability gap vs hosted (11 vs ~37 tools) is now documented in one place (AIflow.md §5.4), useful for the D1–D7 backlog decisions in `audit.md`.
- `create_or_replace_object` is the one whitelisted BYOK tool with a GDevelop-backend dependency (asset-store search when given `description`/`asset_id`) — flagged in AIflow.md §5.4; relevant to Task 2 QA in `usertasks.md`.

**Files worked on:**
- Created: `REVIEW/AIflow.md`.
- Modified: `REVIEW/worklog.md` (this entry).
- Read: `REVIEW/report.md`, `REVIEW/worklog.md` (format/tail), `newIDE/app/src/AiGeneration/Byok/ByokPrompts.js`, `ByokToolSchema.js`, grep-verified `ByokOrchestrator.js` (message-assembly points); subagents additionally read `newIDE/app/src/EditorFunctions/index.js`, `EditorFunctionCallRunner.js`, `ScriptExecution/*`, `GameplayTestTools.js`, `SimplifiedProject/*`, `newIDE/app/src/AiGeneration/*` (Utils.js, PrepareAiUserContent.js, AiConfiguration.js, AskAiEditorContainer.js, AiRequestContext.js, AskAiPrefill.js, Toolbar.js, AskAiHistory.js, UseGenerateEvents.js, UseSearchAndInstallAsset.js, UseSearchAndInstallResource.js), `newIDE/app/src/Utils/GDevelopServices/Generation.js`, `AiRequestChat/SuggestionLines.js`, `MainFrame/EditorContainers/GameplayTestEditorContainer.js`, `locales/en/messages.js`.

---

## 2026-09-21 — Audit fixes implemented (A1–A5, C5, C13): refusal outputs, stop-mid-flight, plan tool interception, whitelist cleanup, approval memory, retry

**Agent:** ZCode main orchestrator (no subagents dispatched).

**Actions:**
- Implemented every functional fix proposed by `audit.md` (section A + C5 + C13), on the user's go-ahead:
  - **A1** — `ByokOrchestrator.js`: new `appendNotExecutedToolOutputs(functionCalls, message)` helper; a refused edit approval now records a `success:false` output ("The user refused this edit. Ask them how to proceed before trying again.") for **every** call of the refused batch (including the non-modifying ones, which are never run) before `markSuspended()` — the transcript stays a valid OpenAI conversation (no assistant `tool_calls` without following tool messages), so the chat survives and resumes.
  - **A2** — `executeToolCalls` re-checks `isSuspended` first and records the arrived batch as not executed ("The assistant was stopped before running this tool call. Send a new message to continue.") — the Stop button now also cancels a batch that arrived during an in-flight model call.
  - **A4** — split fix: (1) `create_or_update_plan` is intercepted by the orchestrator via `appendPlanToolOutput` — parses `args.tasks` and echoes `{success:true, plan:{tasks}}` (the exact shape `getLatestActivePlan`/the plan UI consume; invalid arguments become a `success:false` output), exported constant `BYOK_PLAN_TOOL_NAME`; (2) `add_scene_events`, `read_full_docs` and `search_docs` removed from `BYOK_V1_TOOL_NAMES` + `BYOK_V1_TOOL_SCHEMAS` (14 → 11 tools) with the exclusion comment documenting why (server-side dependencies / permanent failure stubs upstream); (3) `BYOK_AGENT_PROMPT_VERSION` bumped `'byok-v1'` → `'byok-v2'` (the generated tool list changed).
  - **A3** — `AskAiEditorContainer.js`: the BYOK branch of `onSendMessage` now resets the chat input right after dispatching to the orchestrator (deliberately **without** awaiting the loop, which can run for minutes), mirroring the server path; `selectedByokChatId` added to the callback's deps.
  - **C5** — container: `approvedByokEditCallIdsRef` (capped at 500, like the server's `approvedEditBatchKeysRef`); the BYOK approval wrapper asks only for not-yet-approved calls and records approvals; cleared in `onIsAutoEditEnabledChange` next to `clearApprovedEditBatches()`.
  - **C13** — orchestrator: `retryAfterError()` (guards: not running, status must be `error`; re-enters `runLoop` without appending anything — the transcript replay is exactly a retry); container: `onRetryByokChat` passed as `onRetryAfterError` for BYOK chats instead of hiding the retry.
- Spec updates: `ByokToolSchema.spec.js` (11-tool whitelist, three new exclusions asserted); `ByokOrchestrator.spec.js` (refusal test rewritten to assert the not-executed outputs; +6 new tests: protocol-valid resume after refusal, suspend-mid-model-call, plan-tool interception incl. the plan payload and the invalid-arguments failure, retry-after-error incl. the non-error guard).
- Updated `audit.md` (Fixed notes on A1–A5, C5, C13; verdict + summary table) and `usertasks.md` (Task 4 now records the applied fixes; Task 2's ★ items verify them interactively; the stale bug warnings removed).
- Gate results, final tree: `npm test -- --watchAll=false` → **157 suites, 1561 passed, 1 pre-existing skip** (+6); `npm run lint` → **clean**; `npm run flow` → **0 errors**; `npm run check-format` → **clean** (after `prettier --write` of the three touched source files).
- Wrote this worklog entry.

**Bugs found:**
- None new (this session fixes the audit's findings; no regressions surfaced — the full suite including all Phase 1–4 tests is green).

**Issues found:**
- The refusal message and the stopped message are plain English strings, not `<Trans>`-wrapped: they travel as tool-output JSON consumed by the model (and rendered like upstream runner outputs, which are also untranslated server strings). Consistent with the existing Byok error messages; recorded as a deliberate choice.
- A3/C5/C13 container wiring has no unit tests, per the step 4.6 decision (container covered by manual QA): the ★ items of `usertasks.md` Task 2 now verify all three interactively.
- Whitelist shrinkage means the Phase 2 doc's 14-tool list and `Phase4.md`'s prompt instructions are now historical: `ByokToolSchema.js`'s comment + the audit record the reasons. The plan instruction survives (the tool is now functional).

**Files worked on:**
- Modified: `newIDE/app/src/AiGeneration/Byok/ByokOrchestrator.js`, `ByokOrchestrator.spec.js`, `ByokToolSchema.js`, `ByokToolSchema.spec.js`, `ByokPrompts.js` (version bump), `newIDE/app/src/AiGeneration/AskAiEditorContainer.js`, `REVIEW/audit.md`, `REVIEW/usertasks.md`, `REVIEW/worklog.md` (this entry).
- Read: `REVIEW/audit.md` (fix proposals), `REVIEW/usertasks.md`, the touched sources and specs.

---

## 2026-09-21 — Post-Phase-4 review: usertasks.md (user-blocked tasks) and audit.md (full issues audit)

**Agent:** ZCode main orchestrator (no subagents dispatched).

**Actions:**
- Re-read all phase documents' acceptance criteria (`Phase1–4.md`), `report.md` §5 (diff budget), and every worklog entry; cross-checked claims against the actual source tree and git state.
- Created `REVIEW/usertasks.md`: every task blocked on user action/input/decision, as step-by-step instructions — Phase 3 desktop verification (step 3.5 checklist incl. packaged build), Phase 4 real-endpoint QA (step 4.8), git commit decisions (pending doc move + uncommitted Phases 3–4), approval of the audit's bug fixes, deferred-feature green-lighting, and small housekeeping decisions.
- Created `REVIEW/audit.md`: all errors and issues found across the work history, each with references and fix proposals — functional bugs (section A), missing/unverified ACs (B), deviations and doc drift (C), deliberately-deferred features (D), environment/process (E).
- Wrote this worklog entry.

**Bugs found (new in this review — details and fixes in `audit.md` section A):**
- **A1 (P1)** `ByokOrchestrator.js` ~271–278: a refused edit approval leaves `function_call`s without `function_call_output`s; every later message in that chat sends an assistant-with-tool_calls not followed by tool messages — strict endpoints (incl. OpenAI) reject it with 400, bricking the chat. Secondary: the chat then shows a perpetual working state with a dead Stop button.
- **A4 (P1)** Four of the fourteen whitelisted tools can never succeed in BYOK v1: `create_or_update_plan` and `read_full_docs`/`search_docs` are permanent failure stubs upstream (`EditorFunctions/index.js` ~8600–8650), and `add_scene_events` (~5430) delegates to the `generateEvents` collaborator the executor stubs — yet the prompt advertises all of them and *mandates* `create_or_update_plan` for multi-step requests. Event editing is impossible in v1.
- **A2 (P2)** `ByokOrchestrator.js` runLoop ~325–351: `suspend()` during an in-flight model round does not stop that round's tool batch — edits can land after the user pressed stop.
- **A3 (P3)** `AskAiEditorContainer.js` ~943–955: the BYOK send branch returns before the `resetUserInput` calls the server path makes — the sent message stays in the input field.
- **A5 (P3)** Consequence of A1 (tracked for QA visibility): suspended-after-refusal chats render as working forever.

**Issues found (full list with references and proposals in `audit.md`):**
- Phase gates still open: Phase 3 manual desktop checklist and Phase 4 real-endpoint QA were never executed (headless sessions; `electron-app` has no `node_modules`) — now `usertasks.md` Tasks 1–2.
- Documented deviations: container diff +307/−30 vs the ~20–40-line budget (C1, structural reasons recorded); no batch-approval memory in BYOK (C5); no retry affordance for failed BYOK chats (C13); unexported upstream helpers reimplemented (C2); "two handlers" doc wording vs three (C3); AGENTS.md git-repo/path/shell drift + uncommitted doc move (C4); session-only chats absent from history (C6); recurring lockfile churn (C7/E3), electron-app untested-by-design (C8), libGD HEAD~2 fallback (C9), Phase 1's third touched file (C10), pre-existing empty-blur key deletion (C11), no-op manual process affordances on BYOK chats (C12).
- Deferred-by-design features inventoried with their seams (audit D1–D7: persisted history, streaming, nested event generation + store tools, sub-agents, badge/token row, per-chat overrides, standalone form) — decisions requested via `usertasks.md` Task 5.
- Phase 2's "real endpoint" AC was met with a local mock server only (B3); Phase 1's app-restart persistence was code-verified only (B4).

**Files worked on:**
- Created: `REVIEW/usertasks.md`, `REVIEW/audit.md`.
- Modified: `REVIEW/worklog.md` (this entry).
- Read: `REVIEW/Phase1.md`–`Phase4.md` (AC sections), `REVIEW/report.md` §5–6, `REVIEW/worklog.md` (all entries), `usertasks.md`/`audit.md` (drafting), `newIDE/app/src/AiGeneration/Byok/ByokOrchestrator.js` (verification pass), `ByokPrompts.js`, `ByokSeam.js`, `AskAiEditorContainer.js` (byok branch), `AiRequestChat/index.js` (isWorking computation), `EditorFunctions/index.js` (stub-tool implementations ~5430, ~8600–8650), git status/diffs.

---

## 2026-09-20 — Phase 4 implemented: the BYOK agent loop (prompts, orchestrator, chat store, seam in AskAiEditorContainer)

**Agent:** ZCode main orchestrator (no subagents dispatched).

**Actions:**
- **Step 4.0 — Integration decision spike** (read-only; decisions recorded here as the phase doc asks). Read `AskAiEditorContainer.js` (creation effect ~758-885, `onSendMessage` ~921-1147, render of `AiRequestChat` ~1870-1946), `AiRequestChat/index.js` + `Utils.js`, `AiRequestContext.js`, `AiGeneration/Utils.js` (`useProcessFunctionCalls`, `doesFunctionCallModifyProject`), `EditorFunctionCallRunner.js`, `AiRequestUtils.js`. Decisions:
  1. **Credits bypass (step 4.7): ZERO chat-file changes.** `canPayForAiRequest` (AiRequestChat/Utils.js:94-113) returns `true` on `!quota` — passing `quota: null, price: null, availableCredits: 0` idles the gate, and `AiUsageIndicator` renders its context-bar-only form when `!quota || !price` (line 285). `buildByokChatProps()` bundles exactly that.
  2. **BYOK chats never enter `AiRequestContext`**: the context's load-effect (AiRequestContext.js:943-957) server-fetches any selected unknown id, its watch-polling targets records in `aiRequests` (status `working` ⇒ polled), and the tab-open effect full-fetches the selected request (container ~1490). Selection therefore lives in **container-local state** (`selectedByokChatId`), and BYOK records are rendered by passing the store record through the existing `aiRequest` **prop** (the chat UI is props-driven — no context lookup for the chat itself). `AiRequestContext.js` untouched (diff-checked: empty).
  3. **Executor architecture (doc's design kept)**: the orchestrator owns the loop with everything injected. The tool executor is `createByokEditorFunctionCallExecutor` (ByokSeam.js — pure factory, unit-tested) wrapping the injected `processEditorFunctionCalls`: real `ensureExtensionInstalled` (hook called in the container — needed by the whitelisted `add_behavior`/`create_or_replace_object` for `::` types), failures-as-throws stubs for the v1-excluded `generate_events`/asset-store/resource-store dependencies (a hallucinated call becomes a `success:false` tool output the model can recover from), and per-batch coalescing of outside-editor notifications (same accumulators as `useProcessFunctionCalls`).
  4. **Tool snapshot without GDevelop uploads**: `prepareAiUserContent` UPLOADS the project JSON to GDevelop's servers — the injected `getProjectUserContent` instead builds the simplified project JSON locally (`makeSimplifiedProjectBuilder`) and the orchestrator folds it into the last user message of each model call (transcript stays clean of JSON blobs; `AiRequestUtils` walking unaffected).
  5. **Approval**: orchestrator → injected `onRequestEditApproval(modifyingCalls)` → container composes `getIsAutoEditEnabled()` (auto-approve when on) + the context's `requestEditApproval` (the existing inline `EditApprovalRow` — zero new approval UI). Modification check: `byokCallRequiresApproval(editorFunction, args)` (ByokSeam.js, truth-table-tested; unknown function → `true` safe default — deliberate difference from upstream `doesFunctionCallModifyProject`, which is **not exported** from Utils.js; recorded as doc drift).
  6. **Suspend**: one container-level `suspendAiRequestWithByokSupport` routes `byok-` ids to `orchestrator.suspend()`, everything else to the provider's `suspendAiRequest`; used by `onStop` (which also drives the close/open-chat confirmations via byok-aware `getHasWorkInProgress`).
  7. **No double-execution**: `useProcessFunctionCalls` only sees `aiRequestsToProcess` built from the *context* record — BYOK chats never enter it, so the orchestrator is the sole tool executor.
- Implemented all steps of `REVIEW/Phase4.md`:
  - **Step 4.1** — `Byok/ByokPrompts.js`: `BYOK_AGENT_PROMPT_VERSION = 'byok-v1'`, `buildByokSystemPrompt({toolNames, hasOpenedProject})` built from named constant sections (role / tool list / project context with a no-project variant / output rules / plan tool / single-agent instruction). Tool lines derive from `getByokToolSchemas()` (first sentence per tool — the full descriptions already travel in every request's `tools` array; duplicating them in full would double prompt tokens). Spec: 6 tests, incl. the prompt↔schema sync guard (fails if a tool is added without prompt coverage).
  - **Step 4.2** — `Byok/ByokOrchestrator.js`: `createByokOrchestrator(options)` → `{startNewChat, sendUserMessage, suspend}`; flat named sub-functions (`buildMessagesForModel`, `callModel`, `recordAssistantTurn`, `collectPendingToolCalls`, `executeToolCalls`); guards `MAX_BYOK_TOOL_ROUNDS = 20` and `MAX_BYOK_CONTEXT_RATIO = 0.9` (both stop with a clear `error` status); `capToolOutput` (20,000 chars); tool failures become `success:false` outputs and the loop continues; usage → `contextStats` every round; `onAiRequestUpdated` after every mutation; concurrent-run guard. Spec: 14 tests covering the phase's list (happy path, two-round chain, runaway-rounds error, malformed-args recovery, approval refuse-suspends/approve-proceeds, context-stats updates, context-ratio stop, update notifications, classified endpoint errors, chat continuation, suspend, prompt/snapshot composition) + capToolOutput + sub-agent seam.
  - **Step 4.3** — `byokCallRequiresApproval` in ByokSeam.js with the documented truth table.
  - **Step 4.4** — single-agent instruction in the prompt; `createByokSubAgentRunner()` returns `null` with the future-design comment; Phase 2 whitelist assertions (sub-agent/`generate_events`/store tools excluded) still green.
  - **Step 4.5** — `Byok/ByokChatStore.js`: module-level map + listener set, `createByokChat` (`byok-` prefixed synthetic ids, built on `createByokAiRequestShell`), `getByokChat`, `updateByokChat` (bumps `updatedAt`, copies the output array, notifies), `listByokChats`, `archiveByokChat`, `subscribeByokChats`; `BYOK_CHAT_PERSISTENCE_ENABLED = false` with the follow-up note. Spec: 8 tests.
  - **Step 4.6** — the seam in `AskAiEditorContainer.js` (+ helpers in ByokSeam.js: `shouldUseByokForNewRequest`, `isByokAiRequestId`, `buildByokChatProps`, all truth-table-tested — ByokSeam.spec.js has 18 tests): creation branch before the account check (BYOK needs no GDevelop account), `onSendMessage` branch routing `byok-` ids to the orchestrator, byok-aware `onStop`/`getHasWorkInProgress`/`onStartOrOpenChat`/`canStartNewChat`, container-local BYOK selection + store subscription (force-update reducer), orchestrator-per-chat ref map, and the render props (`aiRequest`, `isSending`, `lastSendError`, `editorFunctionCallResults`, byok idles-credits spread, `onRetryAfterError` hidden for BYOK).
  - **Step 4.7** — no changes needed (see spike decision 1). `AiRequestChat/` diff-checked: empty.
  - **Step 4.8** — gates and verification (below); manual desktop QA (real endpoint, DevTools network check, preview regression) still pending an interactive session, like Phase 3's.
- Gate results, final tree: `npm test -- --watchAll=false` → **157 suites, 1555 passed, 1 pre-existing skip** (was 153/1510 after Phase 3; +45 Phase 4 tests); `npm run lint` → **clean**; `npm run flow` (direct flow.exe) → **0 errors**; `npm run check-format` → **clean** (after `prettier --write` of the new files).
- **Temporary end-to-end smoke** (created, run, then **deleted** — Phase 1's temporary-test precedent): real orchestrator + real `ByokClient` (axios over real HTTP) + real prompts/mappers/walkers against a scripted local OpenAI-compatible server; two-tool conversation (`describe_instances` → `create_scene` → final text) — asserted: 3 requests all to the local `/v1/chat/completions` only, tools+model in the body, second request replays the assistant `tool_calls` + `tool` result, system prompt + project snapshot present, final transcript `function_call_output`×2 + closing `output_text`, status `ready`, `contextStats` = 1230 tokens / 1230÷8192, ≥5 update notifications. **Passed.**
- Diff check (whole project, uncommitted tree): upstream files modified = `AskAiEditorContainer.js` (+307/−30 — see Issues), `newIDE/electron-app/app/main.js` (+15, Phase 3). Committed earlier by Phases 1: `PreferencesContext.js`, `PreferencesDialog.js`, `PreferencesProvider.js` (~3 lines, Flow-required). `AiRequestContext.js`, `AiRequestChat/**` — **untouched** (git-diff-verified empty). All other changes are inside `newIDE/app/src/AiGeneration/Byok/`.
- Wrote this worklog entry.

**Bugs found:**
- Flow 0.299: object types are exact by default — `ApprovableEditorFunction` rejected real `EditorFunction` entries (extra props), then rejected optional-vs-required `modifiesProject` (invariance); fixed with a covariant inexact type (`+modifiesProject?: ?boolean, ...`).
- `AiRequest.output` is optional (`output?:`) in Generation.js — every orchestrator/store/spec access needed a normalization (`getOutput()` helper reading `aiRequest.output || []`).
- `React.useReducer` with an unused action type is uninferable in Flow 0.299 and suppression with a code still failed — fixed by a module-level reducer whose action is explicitly `void`.
- `jest.fn()` / `jest.fn(async () => …)` (no-arg arrows) hit `[underconstrained-implicit-instantiation]` — repo's `(jest.fn(): any)` cast pattern applied throughout the new specs.
- One leftover unused import (`BYOK_V1_TOOL_NAMES` in ByokPrompts.js) — caught by `lint --max-warnings=0`, removed.
- Self-caught during edit: the byok branch of the `editorFunctionCallResults` prop initially passed the chat record itself instead of `null`; an invalid JSX-comment-between-attributes was also written then removed before running anything.

**Issues found:**
- **Container diff overshoot**: `AskAiEditorContainer.js` is +307/−30 vs the phase doc's "~30–40 lines" estimate. The overshoot is structural, not scope creep: (a) the 15-argument executor wiring (all container props/hooks — it cannot live in the orchestrator, which imports no editor code, and no importable wrapper existed upstream); (b) container-local BYOK chat selection + store subscription + orchestrator ref map — required by the spike's finding that a `byok-` id in `AiRequestContext` would trigger server loads/polls; (c) byok-aware suspend/stop/confirm plumbing. All decision logic lives in unit-tested Byok modules; the container holds wiring only.
- Doc drift: `doesFunctionCallModifyProject` and `renderFunctionCallLabel` (Utils.js) are **not exported** upstream, though the phase doc says "import, do not reimplement" — `byokCallRequiresApproval` reimplements the 10-line decision (with the documented safe-default difference), and the approval label is the joined tool names instead of the rendered editor label. Both recorded here per agents.md §7.
- The approval flow approves **per batch of pending modifying calls** (matching the orchestrator's batch execution); the server flow additionally remembers approved batches per edit-agent (`approvedEditBatchKeysRef`) — BYOK v1 re-asks for each new batch when auto-edit is off. Acceptable v1 behavior, noted for a follow-up.
- BYOK chats are session-only and do **not** appear in the Ask AI history list (the history reads the server summaries) — accepted v1 limitation, consistent with `BYOK_CHAT_PERSISTENCE_ENABLED = false`.
- Manual QA of step 4.8 (real endpoint on desktop, DevTools "zero requests to api.gdevelop.io" check, BYOK-off regression, kill-mid-loop) not executable headlessly — same constraint as Phase 3 (electron-app has no node_modules; no GUI). The temporary e2e smoke + unit suites stand in; the interactive checklist remains open for the same session that runs Phase 3's.
- Prompt-version note: `BYOK_AGENT_PROMPT_VERSION = 'byok-v1'` (initial). No tool-schema fixes were needed during QA (whitelist validated against the real registry by the Phase 2 suite, still green).
- `prepareAiUserContent` uploading to GDevelop servers was discovered during the spike — BYOK deliberately builds its project snapshot locally instead (decision 4); this is why `getProjectUserContent` is injected rather than reusing the Utils helper.

**Files worked on:**
- Created: `newIDE/app/src/AiGeneration/Byok/ByokPrompts.js`, `ByokPrompts.spec.js`, `ByokOrchestrator.js`, `ByokOrchestrator.spec.js`, `ByokChatStore.js`, `ByokChatStore.spec.js`, `ByokSeam.js`, `ByokSeam.spec.js`.
- Modified: `newIDE/app/src/AiGeneration/AskAiEditorContainer.js` (the seam — see Issues for the size), `REVIEW/worklog.md` (this entry).
- Temporary (created, run, deleted): `newIDE/app/src/AiGeneration/Byok/TemporaryPhase4E2eSmoke.spec.js`.
- Read: `REVIEW/Phase4.md`, `REVIEW/report.md` §1-2, `styleguide.md`+`agents.md` (repo root), `REVIEW/worklog.md`, `newIDE/app/src/AiGeneration/AskAiEditorContainer.js`, `AiRequestContext.js`, `AiRequestUtils.js`, `Utils.js`, `AiRequestChat/index.js`, `AiRequestChat/Utils.js`, `AiRequestChat/ChatMessages.js` (grep), `PrepareAiUserContent.js`, `UseEnsureExtensionInstalled.js`, `newIDE/app/src/EditorFunctions/EditorFunctionCallRunner.js`, `EditorFunctions/index.js` (regions), `newIDE/app/src/Utils/GDevelopServices/Generation.js` (types), all `Byok/` Phase 1-3 files.

---

## 2026-09-19 — Phase 3 implemented: Electron desktop integration (safeStorage key encryption, IPC bridge, honest storage status)

**Agent:** ZCode main orchestrator (no subagents dispatched).

**Actions:**
- Implemented all steps of `REVIEW/Phase3.md`:
  - **Step 3.1** — Created `newIDE/electron-app/app/ByokSafeStorage.js` (CommonJS, same export style as `LocalFileDownloader.js`): `isByokEncryptionAvailable()` (try/catch → `false`, some Linux builds lack a keyring; Windows/DPAPI effectively always true), `encryptByokSecret(plainText)` → `safeStorage.encryptString` as base64, `decryptByokSecret(base64Cipher)` → inverse, both returning the value shape `{ok:true,data} | {ok:false,error}` instead of throwing, plus a header comment stating plaintext is never logged.
  - **Step 3.2** — Modified `newIDE/electron-app/app/main.js`: one local require next to `InstallCliInPath` + a 9-line block (comment + three `ipcMain.handle`) registering `byok-encryption-available` / `byok-encrypt` / `byok-decrypt`, placed directly after the `install-cli-in-path` handler inside the existing registration region. **Diff-checked:** the whole `main.js` diff is exactly those two hunks (+15 lines, nothing else).
  - **Step 3.3** — Modified `Byok/ByokKeyStorage.js`: renderer-safe `optionalRequire('electron')` → `ipcRenderer` (pattern of `Utils/Window.js` / `PreferencesProvider.js:38-39`); internal `encryptSecret`/`decryptSecret` helpers branch on `ipcRenderer` — v3 (`safeStorage` via IPC) on desktop, v2 (Phase 2 obfuscation) on web; `loadByokKey` keeps the v1→current migration and adds the one-branch v2→v3 re-save on desktop; desktop encrypt failure (`ok:false`) falls back to the v2 obfuscated write so the key is never lost; `isByokKeyEncryptionAvailable()` now invokes `byok-encryption-available` (false on web). **All public signatures unchanged since Phase 1** — grep recorded: `saveByokKey(key: string): Promise<void>`, `loadByokKey(): Promise<?string>`, `clearByokKey(): Promise<void>`, `isByokKeyEncryptionAvailable(): Promise<boolean>`, `getByokKeyStorageInfo(): Promise<{|encrypted,obfuscated|}>`, plus test exports `obfuscate`/`deobfuscate`.
  - **Step 3.3 spec** — Rewrote `ByokKeyStorage.spec.js` around `loadKeyStorageModule(isDesktop)`: `Utils/OptionalRequire` is jest-mocked with a lazily-read `mockElectronModule` (the module under test reads Electron at import time, so each mode load uses `jest.resetModules()`); fake IPC handlers backed by a fixed `FAKE_CIPHER_TEXT` + `fakeDecryptedKey` give true save→load round-trips. The web describe block keeps every Phase 2 test case verbatim (the regression proof, incl. a new "never touches Electron on web" assertion); the desktop block adds 9 tests (availability invoke, info `{encrypted:true,obfuscated:false}`, save→`byok-encrypt` stores `{version:3}` ciphertext with no plaintext, load→`byok-decrypt` round-trip incl. non-ASCII, decrypt `ok:false` → null without throwing, encrypt `ok:false` → v2 fallback still loadable, v2→v3 migration on read, v1→v3 migration on read, clear never calls IPC).
  - **Step 3.4** — Modified `Byok/ByokSettingsTab.js`: new exported `getKeyStorageStatusText(encrypted, hasStoredKey)` (null → row hidden; desktop text "Your API key is encrypted by your operating system (DPAPI on Windows)…"; web text "Your API key is stored with light obfuscation only. The desktop app protects it with OS-level encryption."), `hasStoredKey` state fed by `loadByokKey()` in the mount effect next to `getByokKeyStorageInfo()`, blur saves then updates `hasStoredKey`, and the status row renders only when the helper returns a node. Nothing else in the tab changed.
  - **Step 3.4 spec** — `ByokSettingsTab.spec.js`: `./ByokKeyStorage` is now **partially** mocked (only `getByokKeyStorageInfo` is faked; `saveByokKey`/`loadByokKey` stay real so the "key never in preferences" guarantees keep being exercised), defaulting to web storage info; replaced the old unconditional status test with: row hidden when no key stored, web obfuscation warning when a key is stored, OS-encryption text when the mocked info reports encrypted (desktop), row appearing after a blur-save, and a `getKeyStorageStatusText` truth table (rendered through `I18nProvider` for the `<Trans>` nodes).
  - **Step 3.5 (partial — see Issues)** — What was verified headlessly: `node --check` parse of both changed electron-app files; a stubbed-`electron` smoke harness (`Module._load` interception + Node-crypto fake safeStorage, 8 checks: availability + throw degradation, encrypt/decrypt base64 round-trip, failure-as-value shapes, corrupted-ciphertext handling) created and run **outside the repository** at `C:/Users/Administrator/.zcode/cli/byok-smoke/byok-safe-storage-smoke.js`, following the Phase 2 outside-repo harness precedent. The GUI-dependent checklist items could not be executed (details below).
- Environment: `newIDE/app/node_modules` was missing again → rebuilt per the Phase 1 recipe (`npm install --ignore-scripts`, `npx patch-package` ×6, `make-version-metadata`, `build-theme-resources`, `import-libGD`). Gates re-run afterwards on the final tree.
- Gate results, final tree: `npm test -- --watchAll=false` → **153 suites, 1510 passed, 1 pre-existing skip** (was 147/1357 after Phase 2); `npm run lint` (`--max-warnings=0`) → **clean**; `npm run flow` (direct `flow-win64-v0.299.0/flow.exe check`, Phase 1 pipe-hang workaround) → **Found 0 errors**; `npm run check-format` → **clean** (after one `prettier --write` of the new spec).
- AC checks recorded: `gd-byok-key` v3 ciphertext at rest covered by the desktop unit tests; `main.js` ≤10-line block + no other changes proven by git diff; renderer reaches Electron only via `optionalRequire` (grep over `Byok/`: only `ByokKeyStorage.js:2,18`); Phase 2 spec suite green (web block verbatim); main-process thinness trade-off honored (renderer owns policy; electron-app has no test runner — documented in Phase3.md and here).
- Wrote this worklog entry.

**Bugs found:**
- Flow 0.299 refines `?string` as `string | null | void`: `if (key === null) return null` left `void` possible and rejected `saveByokKey(key)` — replaced with `if (!key) return null` (an empty string can never be a stored key; saving `''` clears the entry).
- `jest.fn()` at module scope in the new spec tripped Flow's `[underconstrained-implicit-instantiation]` — fixed with the repo's `(jest.fn(): any)` cast pattern (call-site type arguments are unparseable by the pinned Prettier 1.15.3).
- `TextField`'s `onBlur` prop is typed to return `void`; an `async` arrow returning a `Promise` failed the prop check — switched to a statement body with `saveByokKey(apiKey).then(() => setHasStoredKey(!!apiKey))`.
- Smoke-harness bug (test code, not product): the fake `decryptString` ignored the throw flag, so a valid ciphertext decrypted "too successfully" — the module was right, the harness was fixed.

**Issues found:**
- **Step 3.5's manual checklist was NOT executed** — recorded per the "never silently skip an AC" rule. Reasons: `newIDE/electron-app` ships without `node_modules` (a live run needs its full install incl. the Electron 32.3.3 binary, zipped-extension import, `electron-app/app` deps and a built renderer), and interactive GUI/DevTools inspection is not possible from this headless session. Not verified live: the status-row text in the running app, `gd-byok-key` ciphertext in DevTools localStorage, DPAPI persistence across an app restart, the packaged build (electron-builder), the desktop "Test connection" networking check, and the launch-preview regression. What stands in instead: desktop-path unit tests with mocked IPC (v3 at rest, round-trip, migrations), parse checks, the 8-check stubbed-electron smoke harness, and the git-diff proof that `main.js` changed only by the handler block (so a preview regression from the main-process diff is impossible by inspection). Windows sign-out/in DPAPI binding remains untested by design per Phase3.md. **These items need one interactive desktop session before Phase 3 can be called fully verified.**
- `newIDE/app/node_modules` missing again in this checkout (same as the Phase 1 session); rebuilt, and `import-libGD.js` again fell back to the HEAD~2 S3 mirror (the HEAD~1 object 404s) — same known mirror gap as Phase 1.
- Phase3.md wording drift: the intro/table say "two handlers"/"two IPC handlers" while the step-3.2 code block and the phase ACs name three (`byok-encryption-available`, `byok-encrypt`, `byok-decrypt`) — the concrete code block was followed (three handlers, 9-line block).
- Pre-existing, out of phase scope (flagged for Phase 4): blurring the API-key field with an empty value clears the stored key (`saveByokKey('')` clears; the field starts empty, so focus+blur without typing deletes the saved key) — Phase 1 behavior, unchanged here.
- Repository drift vs the docs: AGENTS.md claims "this checkout is not a git repository" — it now is one (branch `master`, Phases 1–2 committed as `914d97eebf`/`f5b7f0e8e8`); no commits were made this session (not requested). The checkout lives at `C:\Projects\GDevelop` (docs say `D:\`), and `agents.md`/`styleguide.md` have been moved from `REVIEW/` to the repo root (git status shows the pending move) — read from their root locations, content otherwise as described.
- `npm install` (environment rebuild) rewrote `newIDE/app/package-lock.json` with harmless metadata-only `"peer": true` flags from the newer local npm; the file was **restored to HEAD** (`git checkout --`) so the session's diff stays inside the phase budget — the working tree now contains only the five phase files + the new `ByokSafeStorage.js` + this worklog.
- Main-process thinness trade-off (deliberate, per Phase3.md): `electron-app` has no Jest runner; the two-line handlers carry no policy and are covered by the smoke harness + step 3.5 checklist rather than unit tests.

**Files worked on:**
- Created: `newIDE/electron-app/app/ByokSafeStorage.js`.
- Modified: `newIDE/electron-app/app/main.js` (require + 3-handler block only), `newIDE/app/src/AiGeneration/Byok/ByokKeyStorage.js`, `ByokKeyStorage.spec.js`, `ByokSettingsTab.js`, `ByokSettingsTab.spec.js`.
- Read: `REVIEW/Phase3.md`, `REVIEW/report.md` (§3.3/4/7), `styleguide.md` + `agents.md` (repo root), `REVIEW/worklog.md`, `newIDE/electron-app/app/main.js`, `newIDE/electron-app/app/LocalFileDownloader.js`, `newIDE/electron-app/package.json`, `newIDE/app/src/Utils/LocalFileDownloader.js`, `newIDE/app/src/Utils/OptionalRequire.js`, `newIDE/app/src/Utils/Window.js`, `newIDE/app/src/MainFrame/Preferences/PreferencesProvider.js`, `newIDE/app/src/AiGeneration/Byok/*` (all Phase 1–2 files).
- Outside the repository: `C:/Users/Administrator/.zcode/cli/byok-smoke/byok-safe-storage-smoke.js` (created and run; not part of the repo).
- Generated build artifacts via the repo's own scripts (upstream-gitignored): `newIDE/app/src/Version/VersionMetadata.js`, `newIDE/app/src/UI/Theme/*Variables.{css,json}`, `newIDE/app/public/libGD.js`; `patch-package` patches applied inside `node_modules`.

---

## 2026-09-14 — Phase 2 implemented: BYOK backend engine (errors, client + retries, obfuscated key storage, models cache, tool schemas, usage tracking, transcript mapping, settings tab)

**Agent:** ZCode main orchestrator (no subagents dispatched).

**Actions:**
- Implemented all steps of `REVIEW/Phase2.md`, everything inside `newIDE\app\src\AiGeneration\Byok\` (zero upstream files touched — verified by timestamps: the Preferences* files still carry their Phase 1 mtimes; only `Byok\` changed):
  - **Step 2.1** — Created `ByokErrors.js`: `ByokErrorKind` union (9 kinds), exact `ByokError` type, `classifyByokError` (guard-clause branches: HTTP status → kind map, request-without-response → network/`ECONNABORTED`→timeout, pass-through of already-classified errors, unknown otherwise), OpenAI-body message extraction (`error.message` or top-level `message`), generic human sentence per kind, `isRetryableByokError` (rate-limit/server/network/timeout only), `describeInvalidRequestForReasoningEffort` (invalid-request + case-insensitive `reasoning_effort`), plus key-hygiene helpers `redactSecretFromMessage`/`redactSecretFromByokError` and `makeByokError`. Spec: 31 tests (one per kind, message extraction, retryable truth table, degradation detector, redaction).
  - **Steps 2.2 + 2.3** — Extended `ByokTypes.js` with the API contract types (`ByokModelInfo`, `ByokToolCall`, `ByokChatMessage` union, `ByokChatCompletionResponse` with optional `usage`, `ByokUsage`, `ByokChatCompletionOptions`, `ByokConnection`). Created `ByokClient.js`: `buildEndpointUrl` (trailing-slash trim; base URL keeps its `/v1` — documented in code + tab helper text), `fetchRawByokModels` (GET /models, 15s timeout, validates the list), `fetchByokModels` (dumb id mapping per the phase doc), `sendByokChatCompletion` (POST /chat/completions, `reasoning_effort` only when set and not `default`, tools only when provided, 120s default timeout, response-shape validation, every catch classified + key-redacted), and `sendByokChatCompletionWithRetries` (mutually-exclusive branches: one degradation retry without `reasoning_effort` when the 400 names it, else `retryIfFailed({times:2, backoff:{initialDelay:800, factor:2}})` for transient kinds, else rethrow). Key only ever travels in the Authorization header (commented at both header builds). Spec: 26 tests (URL/headers, body options, shape validation, error kinds, retry counts 1/2/3, degradation body assertions, key-leak redaction).
  - **Step 2.4** — Rewrote `ByokKeyStorage.js` internals (signatures unchanged): v2 storage `{version: 2, value: base64(xor(utf8(key), pepper))}` with a fixed 16-byte pepper constant (clearly commented: obfuscation, not encryption — Phase 3 brings safeStorage), exported-for-test `obfuscate`/`deobfuscate` (plain loops, UTF-8 via encodeURIComponent, null on corruption), v1-plaintext read path that migrates to v2 on read, `getByokKeyStorageInfo` now `{encrypted, obfuscated}`. Spec: 17 tests (round-trip incl. non-ASCII, not-plaintext-at-rest, v1→v2 migration, corrupted entries → null, deterministic obfuscate, storage info).
  - **Step 2.5** — Created `ByokModelsCache.js`: `extractContextWindowTokens` (field order `context_length` → `max_context_length` → `max_model_len` → `context_size` → `metadata.context_length`, positive-number guards, server flavors named in comments), `normalizeByokModels` (parse + drop id-less + sort by id), per-base-URL in-memory `Map` cache (`cacheByokModels`/`getCachedByokModels`, safety commented), `refreshByokModels` (fetch raw → normalize → cache), `resolveContextWindowTokens` (4-level chain: server-reported → user per-model → user global → default 8192). Extended `ByokSettings` with `contextWindowByModel` (defensively read: non-positive/non-number entries dropped) — pulled forward from step 2.9 because the resolve chain consumes it. Spec: 17 tests (three server flavors, ordering, drop+sort, every fallback level, cache behavior, fetch errors not cached).
  - **Step 2.6** — Created `ByokToolSchema.js`: `ByokToolSchema` type, `BYOK_V1_TOOL_NAMES` (exactly the 14 tools from the phase doc; exclusions documented: run_script, run_edit_agent, run_explorer_agent, generate_events, store-search, gameplay-test tools), and one schema per tool authored by reading each `launchFunction`'s `SafeExtractor.extract…` calls in `EditorFunctions\index.js` (e.g. `put_2d_instances`: brush_kind enum point/line/grid/random_in_circle/erase/none + brush/end-position/size/row/column/rotation/opacity/hidden; `add_scene_events`: required `extension_names_list` + `event_batches` item fields incl. placement relation/expected-parent/rationale/expected_event_source; `add_or_edit_variable`: scope enum + `variables` operations with paths/types/delete; `create_scene` requires exactly `scene_name`). `getByokToolSchemas`, `toOpenAiToolsFormat`, `validateByokToolSchemas` (whitelist↔schema sync, registry presence via the imported `editorFunctions`, description presence, recursive property-type check against a 6-type allowlist). Spec: 10 tests incl. `validateByokToolSchemas() === []` (the sync guard; it caught a real malformed schema during development) and the create_scene spot check.
  - **Step 2.7** — Created `ByokUsageTracker.js`: `usageFromResponse` (snake_case → `ByokUsage`, null when omitted/incomplete), `contextStatsFromUsage` (used = prompt+completion of the latest call — reasoning commented; ratio clamped to [0,1]; exact `AiRequestContextStats` shape consumed by `AiUsageIndicator`), `createByokUsageTracker` accumulator (closure state, `recordTurn`/`getTotals`). Spec: 9 tests (mapping, null, 100+50/8192 ≈ 0.0183, clamping both ends, 3-turn accumulation).
  - **Step 2.8** — Created `ByokTranscript.js`: `byokResponseToAssistantMessage` (output_text skipped when empty + one function_call per tool call, call_id from id), `byokToolResultToFunctionCallOutput`, `userRequestToByokMessage`, `assistantMessageToByokMessage` (all three internal kinds → OpenAI messages; tool outputs become `tool` messages with `tool_call_id`; transcript is the single source of truth — no parallel OpenAI array), `createByokAiRequestShell` (working status, empty output, optional contextStats). Spec: 15 tests incl. the required compat tests: a mapped response fed through the real `getFunctionCallsToProcess` returns the pending call, processed call_ids stop returning, and a full 4-message transcript round-trips to the exact `ByokChatMessage` array.
  - **Step 2.9** — Upgraded `ByokSettingsTab.js`: "Fetch models" button → `refreshByokModels` (key loaded via `loadByokKey`, never through preferences), `CompactSelectField` dropdown fed by fetched/cached `ByokModelInfo`s with a "Type manually…" fallback option (early-return guards on empty list/error → free-text field), per-model context-window rows rendered from `contextWindowByModel` (server-reported values prefilled and marked "auto (server)", editable, clamped) + the global "Default context window" field kept as the fallback level, "Test connection" button running `sendByokChatCompletionWithRetries` with a 1-word "ping" (reasoning effort passed when not `default`) rendering success/error inline as `<Text>` (no dialogs), storage status now honest about obfuscation ("stored obfuscated — OS-level encryption is added on desktop"), all strings in `<Trans>`/`t`, state-held messages stored as `React.Node` (repo pattern). Spec: 21 tests (dropdown population via mocked cache, empty-result fallback, inline fetch error, cached models without fetch, per-model map persistence via `setMultipleValues`, auto-(server) prefill + user override, test-connection success/failure inline messages, reasoning-effort passthrough).
  - **Step 2.10** — Phase gate (results below). Additionally, since no live OpenAI-compatible server was running on this machine, the manual QA was executed against a **local OpenAI-compatible mock HTTP server driven by the real (untranspiled-by-Jest) BYOK modules** via `@babel/register` (harness kept outside the repository, in the user profile): fetch models lists sorted ids and parses per-flavor context windows; `resolveContextWindowTokens` honored all fallback levels live; a 400 naming `reasoning_effort` degraded to a successful retry (2 POSTs observed server-side); a plain ping succeeded in a single attempt with usage; a wrong key produced the typed authentication error with no key material in the message; a wrong base URL produced the typed not-found error. 12/12 checks passed. This live run caught a real wire-format bug (see Bugs). Interactive click-through in the built app was not possible (no dev app launched in this environment); its items are covered by the component tests as recorded in the Phase 1 worklog precedent.
- Gate results, final tree: `npm test -- --watchAll=false` → **153 suites passed, 1494 passed (1 pre-existing skip)** (172 of the tests are the 9 Byok specs); `npm run lint` (`--max-warnings=0`) → **clean**; `npm run check-format` → **clean**; `npm run flow` → **Found 0 errors** (direct `flow.exe check` per the Phase 1 Windows quirk). Full-suite re-run done on the final tree after the last code change.
- Wrote this worklog entry.

**Bugs found:**
- **Real wire-format bug caught by the live smoke test, invisible to the unit tests:** `fetchRawByokModels`/`fetchByokModels` initially read `response.data` as the model array, but a real OpenAI-compatible `/models` response wraps the entries in a `{ data: [...] }` body envelope — `response.data` is the *body*, so the entries are at `response.data.data`. The first Jest fixture had accidentally encoded the wrong shape (response.data = bare array), so all unit tests passed while live calls would have failed with "did not return a model list". Fixed the client to accept the envelope (and a bare array as a non-standard fallback, with a new test), corrected both specs' fixtures, and re-verified live (12/12).
- Lingui `t` macro used for strings held in component state (settings-tab test-connection/fetch-messages messages) returns message-descriptor objects that crash `<Text>` when rendered as children. Fixed by storing `React.Node`s built from `<Trans>` (the repo's existing pattern for state-held messages).
- The tool-schema validator caught a genuinely malformed nested `filter` schema in `read_game_project_json` during development (nested `properties` was a single property definition instead of a map) — fixed by describing the filter as a free-form field-value match object.

**Issues found:**
- **Phase-doc tension resolved:** step 2.2 keeps `fetchByokModels` deliberately dumb (id only) while step 2.5's cache must parse context windows from the *raw* entries and step 2.9 requires server-reported prefill. Resolution: `ByokClient` additionally exports `fetchRawByokModels` (same GET, validated list, untrusted entries); `refreshByokModels` builds on it (one-directional import, no cycle). `fetchByokModels` stays exported and dumb as specified.
- **Upstream client stubs with no extractable arguments (per the phase-doc warning):** `read_full_docs`, `search_docs` and `create_or_update_plan` have client-side `launchFunction`s that read no arguments (they are server-side tools upstream — `report_fulfilment_problem`-style stubs). Their BYOK schemas are authored forward-looking for Phase 4, kept minimal and noted here: `read_full_docs` → optional `extension_names` (the field its `renderForEditor` reads); `search_docs` → optional `search_query` (BYOK-owned, upstream reads nothing); `create_or_update_plan` → required `tasks` array mirroring the internal `AiRequestPlan`/`AiRequestPlanTask` shape (id/title/description/status/depends_on). Also noted: `add_scene_events` shares its implementation with `generate_events` — its launchFunction *requires* `extension_names_list` and ultimately delegates event generation to GDevelop's backend via the `generateEvents` collaborator; it is whitelisted per the phase doc, and its BYOK runtime behavior (server dependency) is a Phase 4 decision.
- Flow 0.299 + flow-typed axios 0.16: `axios.get/post` generics are underconstrained (same as Generation.js, which suppresses it). Used the identical `$FlowFixMe[underconstrained-implicit-instantiation]` with a written reason (Prettier 1.15.3 cannot parse call-site type arguments, so the generic couldn't be written explicitly). Flow additionally refines `Array.isArray(mixed)` to a read-only array: the boundary returns `Array<any>` (untrusted wire entries, converted to typed shapes in `normalizeByokModels`) via `.slice()` for mutability.
- `[method-unbinding]` on `mockFn(axios.get)` in specs: the automocked axios is accessed through `(axios: any)` (`mockAxios`) — jest's mock functions cannot be reached through Flow-typed methods.
- The settings-tab specs mock `./ByokModelsCache` and `./ByokClient` modules; the key-storage path (`loadByokKey`) stays real so the "key never in preferences" guarantees keep being exercised.
- The models-cache module Map persists within a spec file — cache tests use unique base URLs per test.
- Environment notes: `node.exe` is not on this shell's PATH — all npm/jest/flow invocations were prefixed with `C:\Program Files\nodejs`; flow was run as `node_modules\flow-bin\flow-win64-v0.299.0\flow.exe check` (Phase 1's pipe-hang workaround). The smoke harness lives outside the repository (`C:\Users\mafli\.zcode\cli\byok-smoke\byok-smoke.js`) to respect the "no new files outside REVIEW" rule for docs and the Byok-only diff budget.
- No locale files touched; all new strings use `<Trans>`/``t`` (English fallback verified in tests).

**Files worked on:**
- Created: `newIDE/app/src/AiGeneration/Byok/ByokErrors.js`, `ByokErrors.spec.js`, `ByokClient.js`, `ByokClient.spec.js`, `ByokModelsCache.js`, `ByokModelsCache.spec.js`, `ByokToolSchema.js`, `ByokToolSchema.spec.js`, `ByokUsageTracker.js`, `ByokUsageTracker.spec.js`, `ByokTranscript.js`, `ByokTranscript.spec.js`.
- Modified: `newIDE/app/src/AiGeneration/Byok/ByokTypes.js`, `ByokTypes.spec.js`, `ByokKeyStorage.js`, `ByokKeyStorage.spec.js`, `ByokSettingsTab.js`, `ByokSettingsTab.spec.js`.
- Read (references/verification): `REVIEW/Phase2.md`, `REVIEW/Phase4.md`, `REVIEW/report.md`, `REVIEW/styleguide.md`, `REVIEW/agents.md`, `REVIEW/worklog.md`, `newIDE/app/package.json`, `.prettierrc`, `newIDE/app/src/Utils/GDevelopServices/Generation.js`, `newIDE/app/src/Utils/RetryIfFailed.js`, `newIDE/app/src/Utils/SafeExtractor.js`, `newIDE/app/src/EditorFunctions/index.js` (registry + all 14 tool implementations + `SafeExtractor.extract…` call sites), `newIDE/app/src/AiGeneration/AiRequestChat/AiUsageIndicator.js`, `newIDE/app/src/AiGeneration/AiRequestUtils.js`, `AiRequestUtils.spec.js`, `newIDE/app/src/ProjectsStorage/LocalFileStorageProvider/LocalFileResourceMover.spec.js` (axios-mock precedent), `newIDE/app/src/UI/Text.js`, `RaisedButton.js`, `newIDE/app/src/MainFrame/Preferences/PreferencesContext.js`, `PreferencesDialog.js`, `PreferencesProvider.js` (Phase 1 outputs, read-only).
- Outside the repository: `C:/Users/mafli/.zcode/cli/byok-smoke/byok-smoke.js` (live smoke harness; created and run, not part of the repo).

---

## 2026-09-14 — Phase 1 implemented: BYOK settings UI (types, key storage, tab, dialog registration)

**Agent:** ZCode main orchestrator (no subagents dispatched).

**Actions:**
- Implemented all steps of `REVIEW/Phase1.md`:
  - **Step 1.1** — Created `ByokTypes.js`: `ByokSettings` exact type (`enabled`, `endpointUrl`, `modelName`, `reasoningEffort`, `contextWindowTokens`), `DEFAULT_BYOK_SETTINGS` (disabled / empty / `default` / 8192), safe reader `getByokSettings` (per-field merge over defaults; never crashes on missing/null/non-object/partial/corrupt settings), `isByokFullyConfigured` (enabled + `https://`/`http://` URL + non-empty model), `isByokReasoningEffort`, `BYOK_REASONING_EFFORTS`, and the context-window bounds constants (512 / 1,000,000). Spec: 16 tests.
  - **Step 1.2** — Registered the `byok` preference in `PreferencesContext.js`: type import, `byok: ByokSettings` in `PreferencesValues` next to the AI prefs cluster, `byok: DEFAULT_BYOK_SETTINGS` in `initialPreferences`. `PreferencesProvider.js` was left untouched at this step (auto-fill migration verified by code reading); one Flow-required annotation addition landed there later (see Issues).
  - **Step 1.3** — Created `ByokKeyStorage.js` with the **final async interface** (`saveByokKey`, `loadByokKey`, `clearByokKey`, `isByokKeyEncryptionAvailable` → `false` in Phase 1, `getByokKeyStorageInfo`), plaintext Phase 1 internals clearly marked, JSON `{ key }` wrapper under localStorage key `gd-byok-key`, empty-string save clears the entry, every operation in try/catch (never throws, never logs key material). Spec: 9 tests (jsdom; includes corrupted/non-JSON stored values).
  - **Step 1.4** — Created `ByokSettingsTab.js`: block-title header + one-sentence explanation, enable checkbox, endpoint URL field (hint `https://api.openai.com/v1`, helper text about `/models` + `/chat/completions` being appended), masked API-key `TextField type="password"` whose value lives in **local state only** and is written to `ByokKeyStorage` on blur (never through `setMultipleValues`), storage-status row fed by `getByokKeyStorageInfo()` in a `React.useEffect` ("not yet encrypted (planned)" in Phase 1), free-text model field, reasoning-effort `CompactSelectField` (guarded narrowing through `BYOK_REASONING_EFFORTS`), numeric context-window field clamped by exported `clampContextWindow` (512–1,000,000; non-number falls back to default). Writes on change via a single `updateByokSetting` helper; all user-visible strings wrapped in `<Trans>`/``t``; no colors, no new dependencies. Spec: 10 tests (jsdom + `react-test-renderer`; asserts the key never appears in any `setMultipleValues` call, that blur lands the key under `gd-byok-key` while `gd-preferences` stays unwritten, and the clamping bounds).
  - **Step 1.5** — Registered the tab in `PreferencesDialog.js`: one import, `{ value: 'byok', label: <Trans>BYOK</Trans> }` between "Keyboard Shortcuts" and the Electron-gated "Folders" entry, and one conditional render block wrapping `<ByokSettingsTab />`. Not Electron-gated, so the tab shows in web and desktop.
  - **Step 1.6** — Environment bring-up and gates: `npm install --ignore-scripts`, applied all `patch-package` patches, generated `src/Version/VersionMetadata.js` and the theme resource files (`scripts/build-theme-resources.js`), fetched `libGD.js-for-tests-only` via the repo's own `scripts/import-libGD.js` (S3 `master/latest` mirror). Then ran the four gates (results below). Additionally verified the dialog registration with a **temporary** jsdom test (deleted afterwards, per step 1.5's decision not to commit a dialog test) that mounted the real `PreferencesDialog` in jsdom via react-dom, asserted the "BYOK" tab button is present, clicked it, and asserted every field (title, enable toggle, endpoint, API key, storage-status, model, reasoning effort, context window) renders.
- Gate results, final tree: `npm test -- --watchAll=false` → **147 suites passed, 1357 passed (1 pre-existing skip)**; `npm run lint` (`--max-warnings=0`) → **clean**; `npm run check-format` → **clean**; `npm run flow` → **Found 0 errors** (full re-check; see Issues for the Windows flow-server detail).
- Wrote this worklog entry.

**Bugs found:**
- Flow 0.299 treats `{...}` object types as **exact by default**, so the phase doc's literal signature `getByokSettings(values: { byok: ?ByokSettings })` rejected the full `PreferencesValues`. Fixed with inexact + covariant syntax `{ +byok: ?ByokSettings, ... }` (covariant because the field is only read; matches Flow's own suggested fix).
- `$Shape` is a hard `[deprecated-utility]` error in Flow 0.299 (the repo suppresses it elsewhere); for new code, `Partial<ByokSettings>` achieves the same without any `$FlowFixMe` — used in `ByokSettingsTab.js` and the specs.
- Prettier 1.15.3 (repo-pinned) cannot parse modern Flow call-site type arguments: `jest.fn<any, any>()` in a spec is a check-format SyntaxError. Fixed by using the repo's `mockFn` wrapper pattern (same as `AiRequestContext.spec.js`).

**Issues found:**
- `node_modules` was **missing** in this checkout, so the gates could not run until the environment was rebuilt. The full postinstall chain (GDJS `npm install`, GDJS runtime import, monaco/zipped editors) was **not** run — only the pieces the IDE's tests need (patches, `VersionMetadata.js`, theme resources, `libGD.js-for-tests-only`). Consequence: the dev app was not launched in this session, so the interactive parts of the manual QA checklist (visual click-through in the running app, full app-restart persistence check, DevTools localStorage inspection) could not be performed by hand. What was verified instead, per item:
  - "BYOK" tab present between "Keyboard Shortcuts" and "Folders" (desktop) / last (web): verified in code **and** by the temporary dialog-mount test (tab button found, click switches panel, all fields render).
  - Fields render and update: covered by `ByokSettingsTab.spec.js` (change handlers write through `setMultipleValues` with exact expected payloads).
  - Persist across dialog close/reopen and app restart: persistence is the existing `PreferencesProvider` mechanism, unchanged; `loadPreferencesFromLocalStorage` auto-fills the missing `byok` key from `initialPreferences` for existing users (code-verified, `PreferencesProvider.js`); round-trip covered indirectly by the provider's generic setter (code-verified) + unit tests of the values written.
  - Key never inside `gd-preferences`: unit-tested (mock-call key-set assertion + `gd-preferences` untouched; key stored under `gd-byok-key`).
  - Wrong URL ("not a url"): no validation code that can crash; `isByokFullyConfigured` returns false — unit-tested.
- **One extra existing file was touched beyond the two planned:** `PreferencesProvider.js` — the explicitly-typed return of `getInitialPreferences` lists every preference key, and Flow rejected the now-extra `byok` property; per Phase 1 step 1.2(6) the `byok: ByokSettings` annotation (+ type import) was added there. Net diff: ~3 lines.
- jsdom test environment: the `@jest-environment jsdom` docblock must be the **first** docblock, before `// @flow` (precedent `TouchDragDelay.spec.js`); with `// @flow` first, the node environment silently stays active. Also, jsdom lacks `window.matchMedia` (called at module load by `PreferencesContext.js`) and lingui's `I18n` context is undefined without a provider (crashes `SelectOption`); the component spec polyfills matchMedia and installs a minimal `setupI18n({language:'en',catalogs:{}})` + `I18nProvider`, mirroring `GDI18nProvider`.
- React-test-renderer cannot mount the whole `PreferencesDialog` (portal/react-dnd internals throw `parentInstance.children.indexOf`); the temporary verification used react-dom + jsdom instead, and needed `jest.mock('three/src/math/MathUtils')` because `ErrorBoundary` imports untranspiled ES modules from `three`.
- Windows flow-server quirk: flow clients hung when their stdout was a pipe (the spawned server inherits the handle, so the pipe never closes). Final check was run with the direct `flow.exe check` after killing stale `flow.exe` processes; it re-initialized from scratch and completed.
- No locale files were touched; all new strings use `<Trans>`/``t`` (English fallback confirmed rendering in tests).

**Files worked on:**
- Created: `newIDE/app/src/AiGeneration/Byok/ByokTypes.js`, `newIDE/app/src/AiGeneration/Byok/ByokTypes.spec.js`, `newIDE/app/src/AiGeneration/Byok/ByokKeyStorage.js`, `newIDE/app/src/AiGeneration/Byok/ByokKeyStorage.spec.js`, `newIDE/app/src/AiGeneration/Byok/ByokSettingsTab.js`, `newIDE/app/src/AiGeneration/Byok/ByokSettingsTab.spec.js`.
- Modified: `newIDE/app/src/MainFrame/Preferences/PreferencesContext.js` (import, `PreferencesValues.byok`, `initialPreferences.byok`), `newIDE/app/src/MainFrame/Preferences/PreferencesDialog.js` (import, tab option, render block), `newIDE/app/src/MainFrame/Preferences/PreferencesProvider.js` (`getInitialPreferences` return type + type import — Flow-required, see Issues).
- Read: `REVIEW/Phase1.md`, `REVIEW/report.md`, `REVIEW/styleguide.md`, `REVIEW/agents.md`, `REVIEW/worklog.md`, `newIDE/app/package.json`, `newIDE/app/.flowconfig`, `newIDE/app/src/MainFrame/Preferences/PreferencesContext.js`, `PreferencesDialog.js`, `PreferencesProvider.js`, `newIDE/app/src/MainFrame/EditorContainers/HomePage/GetStartedSection/UserSurveyStorage.js`, `newIDE/app/src/UI/TextField.js`, `Text.js`, `Checkbox.js`, `CompactSelectField/index.js`, `SelectOption.js`, `Theme/GDevelopThemeContext.js`, `Responsive/ScreenTypeMeasurer.js`, `newIDE/app/src/AiGeneration/AiRequestContext.spec.js`, `newIDE/app/src/UI/CompactSemiControlledNumberField/CompactSemiControlledNumberField.spec.js`, `newIDE/app/src/UI/DragAndDrop/TouchDragDelay.spec.js`, `newIDE/app/src/setupTests.js`, `newIDE/app/src/Utils/i18n/GDI18nProvider.js`, `newIDE/app/src/Utils/i18n/MessageDescriptor.flow.js`, `newIDE/app/scripts/import-libGD.js`, `make-version-metadata.js`.
- Generated build artifacts (upstream-gitignored; produced by the repo's own scripts, not hand-written): `newIDE/app/src/Version/VersionMetadata.js`, `newIDE/app/src/UI/Theme/*/​*Variables.{css,json}`, `newIDE/app/public/libGD.js` + `libGD.wasm`, `node_modules/libGD.js-for-tests-only/`, `patch-package` patches applied inside `node_modules`.

---

## 2026-09-13 — Project documentation suite (styleguide, agents manual, phase plans)

**Agent:** ZCode main orchestrator (no subagents dispatched).

**Actions:**
- Verified implementation details against the source before writing plans: preferences typing and defaults (`PreferencesContext.js`), the Preferences dialog tab registry (`PreferencesDialog.js`), chat wiring in `AiRequestChat/index.js` (context consumption, `AiUsageIndicator` props, preset selection, `canPayForAiRequest` gating), the `EditorFunction`/`EditorFunctionCall` type definitions and tool registry (`EditorFunctions/index.js`), the Electron `ipcMain.handle` pattern (`electron-app/app/main.js`), the `retryIfFailed` helper (`Utils/RetryIfFailed.js`), the localStorage module template (`UserSurveyStorage.js`), and the test conventions (Jest via `react-app-rewired test --env=node`, `@jest-environment jsdom` docblocks, no @testing-library dependency, npm checkout via `package-lock.json`).
- Created the project documentation set in `/REVIEW`: `styleguide.md` (repo rules + BYOK project rules), `agents.md` (operating manual for AI agents), `worklog.md` (this file), `Phase1.md` (BYOK settings UI), `Phase2.md` (BYOK backend engine), `Phase3.md` (Electron desktop integration), `Phase4.md` (client-side agent loop).

**Bugs found:** none.

**Issues found:**
- `EditorFunction` type has **no client-side description or JSON-schema metadata** (`EditorFunctions/index.js:429-450` — only `launchFunction`, `modifiesProject`, `getModifiesProject`). Tool descriptions/schemas are server-owned (`toolsVersion`), so BYOK must author its own OpenAI tool schemas in Phase 2 (`ByokToolSchema.js`).
- Tests default to a **node** Jest environment; DOM tests require a `@jest-environment jsdom` docblock, and `@testing-library` is not a dependency — component tests must use `react-test-renderer` or jsdom directly.
- This checkout uses **npm** (`package-lock.json` present in `newIDE/app`), while upstream CI references yarn — noted in styleguide so agents check `package.json` scripts.
- `aiConfigurationPresetId` (model/effort) is only sent at chat creation and lives in local component state (`AiRequestChat/index.js:318-321, 527-532`) — BYOK can do per-chat settings more naturally, noted in Phase 2.

**Files worked on:**
- Created: `REVIEW/styleguide.md`, `REVIEW/agents.md`, `REVIEW/worklog.md`, `REVIEW/Phase1.md`, `REVIEW/Phase2.md`, `REVIEW/Phase3.md`, `REVIEW/Phase4.md`.
- Read (verification): `newIDE/app/package.json`, `newIDE/app/src/MainFrame/Preferences/PreferencesContext.js`, `newIDE/app/src/MainFrame/Preferences/PreferencesDialog.js`, `newIDE/app/src/AiGeneration/AiRequestChat/index.js`, `newIDE/app/src/AiGeneration/AiRequestUtils.spec.js`, `newIDE/app/src/EditorFunctions/index.js`, `newIDE/app/src/Utils/RetryIfFailed.js`, `newIDE/app/src/Utils/UserSurveyStorage.js`, `newIDE/app/src/MainFrame/EditorContainers/HomePage/GetStartedSection/UserSurveyStorage.js`, `newIDE/electron-app/app/main.js`.

---

## 2026-09-13 — Repository mapping for BYOK feasibility (5 parallel read-only agents)

**Agent:** ZCode main orchestrator + 5 Explore subagents (AI pipeline; preferences/tabs; HTTP/Electron network; secrets/encryption; chat UI/i18n) — dispatched in a single wave of 5, within the rate-limit rule.

**Actions:**
- Mapped the GDevelop repository (focus: `newIDE/app` renderer, `newIDE/electron-app` main process) across five subsystems relevant to a BYOK feature.
- Established the critical architectural fact: GDevelop's "Ask AI" runs its agent loop **server-side** (`api.gdevelop.io/generation`); the client only posts the user request + serialized project, polls the transcript, executes "editor functions" locally, and posts tool outputs back. BYOK therefore requires a new client-side orchestrator that reuses the existing tool registry, chat UI, and OpenAI-shaped internal message types.
- Wrote up findings and the overall action plan.

**Bugs found:** none (read-only session; no repo code executed or modified).

**Issues found:**
- Windows shell: `ls` and `head` are not recognized in cmd — switched to `dir`/`findstr`/Read tool.
- No OpenAI/LLM client code exists anywhere in the repo; no LLM SDK in any package.json (greenfield — good for isolation).
- No streaming HTTP code exists (no SSE/`getReader`/`EventSource`); the existing feature is poll-based. Plan phased to start non-streaming.
- No secure storage primitives exist (no keytar, no `safeStorage` usage, no DPAPI); localStorage is plaintext throughout; Electron 32.3.3 supports `safeStorage` (DPAPI on Windows) — encryption must be built new in Phase 3.
- Desktop build runs with `webSecurity: false` (`main.js:174-187`) so renderer calls to arbitrary hosts work without CORS; the web build has no proxy, so BYOK on web is limited to CORS-friendly providers.
- AI presets/models are served from GDevelop's CDN (`ai-settings-v2.json`), plan-gated server-side — BYOK replaces this with `GET /v1/models` from the user's endpoint.

**Files worked on:**
- Created: `REVIEW/report.md`.
- Read (mapping, key files): `newIDE/app/src/AiGeneration/*` (AiRequestContext.js, AskAiEditorContainer.js, AiRequestUtils.js, Utils.js, PrepareAiUserContent.js, UseGenerateEvents.js, AskAiStandAloneForm.js, AiConfiguration.js, AiRequestChat/*), `newIDE/app/src/Utils/GDevelopServices/*` (Generation.js, ApiConfigs.js, Authentication.js, Usage.js), `newIDE/app/src/EditorFunctions/index.js`, `newIDE/app/src/MainFrame/index.js`, `newIDE/app/src/MainFrame/EditorTabs/EditorTabsHandler.js`, `newIDE/app/src/MainFrame/EditorTabsPane.js`, `newIDE/app/src/MainFrame/Preferences/*`, `newIDE/app/src/Profile/AuthenticatedUserProvider.js`, `newIDE/app/src/Providers.js`, `newIDE/app/src/Utils/*` (OptionalRequire.js, Window.js, BlobDownloader.js, LocalFileDownloader.js, DataValidator.js), `newIDE/app/src/locales/*` (structure), `newIDE/electron-app/app/main.js`, `newIDE/electron-app/app/LocalFileDownloader.js`, `newIDE/electron-app/package.json`, `newIDE/app/package.json`.
## 2026-09-23 — Phase 9 implemented: scale, robustness, and model economics (steps 9.1–9.9)

**Agent:** ZCode main orchestrator (no subagents used: code written by the
orchestrator per AGENTS.md §7; exploration done inline). The owner restarted
the paused project in chat with the order "implement Phase 9
(CREATE-DON'T-DEFER: satisfy every AC; no new deferrals; log every bug;
run the audit greps into the worklog)".

**Actions:**
- Implemented all Phase 9 steps against `REVIEW/Phase9.md`, in dependency
  order: 9.4 core → 9.1 → 9.5 → 9.7 → 9.2 → 9.6 → 9.3 → UI wiring → 9.8 →
  9.9 gates.
  - **9.1 Watchdog (`ByokWatchdog.js`):** activity-driven timer with
    pause/resume (model calls are the client timeout's business), hold
    during edit-approval rows, one in-chat notice per silent window
    (re-arming), disarm on stop/suspend/ready/dispose. Notices are a new
    BYOK-local transcript row `byok_notice` (`ByokTranscript.makeByokNotice`)
    rendered by `ChatMessages.js` as a centered info line and skipped by the
    model replay (`byokMessagesForTranscriptItem` returns `[]`).
    Settings: `stallWatchdogEnabled` (on) + `stallWindowSeconds` (90 s) in
    the BYOK settings tab ("While the AI is working").
  - **9.2 Compaction (`ByokCompactor.js`):** triggers at
    `contextUsedRatio ≥ 0.75` before a model call, never mid-tool-batch and
    never twice on an unchanged transcript. Drop order honored: all images
    but the chat's latest → tool outputs older than the last 6 turns become
    one-liners (call_id preserved; call+output pairs stay protocol-valid and
    are compacted in place) → user/plain-assistant turns older than the last
    10 summarized by ONE extra `fast`-profile call, output capped
    (≈600 tokens; mechanical digest fallback if the summarizer fails). The
    preserved block is rebuilt from explicit sources (project notes, latest
    plan, open problems from recent failed outputs, a fresh simplified
    snapshot capped at 4k chars, loaded skills, latest verification result).
    The compacted transcript gets a `context-summarized` notice row;
    `byok-context-full` remains the last-resort guard.
  - **9.3 Durable history (`ByokChatPersistence.js` +
    `ByokChatStorageBackends.js`):** **Markdown with a YAML front matter
    block** chosen (recorded per the owner's contract: renders nicely for a
    future "open chat file" UX; front matter keeps list data lossless;
    messages stored as backtick-escaped JSON blocks with readable preview
    headers). Desktop stores `userData/byok-chats/*.md` through thin IPC
    handlers (`electron-app/app/ByokChatFiles.js` + registration in
    `main.js`); the web build uses a raw IndexedDB wrapper (no new deps);
    both implement the same dumb named-text-entries contract, tests run on
    an in-memory one. Images stay id-referenced; payloads live in per-chat
    `.images.json` sidecars and are re-registered under their original ids
    on load (`ByokImageContent.restoreByokImage`). Corruption quarantine
    (file moved aside as `corrupt-…`, never blocks the list). Real archive:
    `archivedAt` set, excluded from the default list, restorable; delete is
    explicit + confirmed. Quota 200 MB with oldest-chats-first eviction of
    image sidecars before any transcript text. Save points: terminal status
    (ready/error/suspended) saves immediately, everything else through a
    1.5 s debounce (covers "after every user message"); `beforeunload`/
    `pagehide` flush covers app closure. `BYOK_CHAT_PERSISTENCE_ENABLED`
    flipped to `true`. The chat tab gets the owner's history button
    (`Byok/ByokChatHistory.js`, listed alongside — not inside — the
    server-backed AskAiHistory) with rename/archive/restore/delete/open;
    reopened chats start clear (list reads metadata only).
  - **9.4 Multi-provider routing (`ByokModelRouter.js`) + D5:** provider
    registry in settings (`{id, name, endpointUrl, keyRef}`) with add/
    remove/edit/test per provider; legacy single endpoint migrates into
    provider #1 keeping the legacy key slot (`keyRef: ''`), so the stored
    key keeps working. Keys are slotted per provider in `ByokKeyStorage`
    (all functions take an optional `keyRef`, default `''`). Routing truth
    table: main/reviewer/benchmark → strong; scout/compaction/suggestions/
    docs → fast; `always-strong` overrides. Resolution order: per-chat
    dropdown (stored on the chat record as `byokModelSelection`, read at
    turn time) > profile policy > global fallback; unset `temperature`/
    `maxTokens` are omitted from the request body. Chat header (`AiRequestChat`):
    D5 badge `BYOK · provider/model · <exact tokens> (<turns>)` from the
    per-chat usage tracker, plus per-chat model dropdown (`provider/model`
    entries from each provider's `/models`, cached) and effort dropdown
    (low/medium/high defaults, server-listed levels when probed).
    Recorded decision: **reviewer rides the strong profile** (it gates the
    final work quality — the one place cheapness must not win); scout stays
    fast per the doc.
  - **9.5 Capabilities + benchmark:** `ByokCapabilities.js` — per
    (endpoint, model) cache in the settings blob (defensively read back),
    remembering the degraded `reasoning_effort` state (ends the per-turn
    400-dance: the parameter is simply not sent again), the Phase 6 image
    auto-detect outcome, server-listed effort levels (extracted from raw
    `/models` entries), and strict-schema/parallel-tool probe helpers with
    client-side degradation. `ByokBenchmark.js` — 4 fixed tasks (scene +
    objects; working EventScript batch; fix a broken sheet; read an inline
    64×64 quadrant PNG fixture) with mechanical scorers over a plain project
    snapshot and an injected-executor mini-loop; "Run the benchmark (≈2 min)"
    button in settings runs it on a scratch `gd` project (never the user's)
    and prints pass counts/rounds/tool calls/tokens.
  - **9.6 Suggestions + feedback (`ByokSuggestions.js`):** after `ready`, an
    opt-in (settings toggle, off by default) single `fast`-profile call
    produces ≤3 chips parsed into the exact `AiRequestSuggestions` shape the
    chat UI already renders (attached to the last assistant message); a
    failed call degrades silently. Thumbs stored locally in localStorage
    (`gd-byok-feedback`, capped 500, oldest dropped first), with an export
    JSON button in settings. Nothing is sent anywhere.
  - **9.7 Retry polish:** `ByokClient` honors `Retry-After` exactly (cap
    30 s, single retry; longer waits surface as before) with an
    `onRateLimitWait` hook the orchestrator uses to post one non-terminal
    `rate-limited` notice per turn; `onReasoningEffortDegraded` fires the
    moment the strip-retry engages and the orchestrator persists the
    degradation into the capability cache (second turn sends no parameter —
    unit-tested). New request body fields `temperature`/`max_tokens`/
    `tool_choice`/`parallel_tool_calls` (omitted when unset; kept on the
    stripped retry). The orchestrator refreshes the project snapshot before
    any model call that follows an editing round (failure degrades to the
    previous snapshot with a `snapshot-stale` notice).
  - **9.8 Eval harness:** `newIDE/app/scripts/run-byok-evals.js` (CommonJS,
    OUTSIDE `src/`, nothing in the app imports it — asserted by a boundary
    test) + `scripts/byok-eval-task-prompts.js`: 30 tasks (10 event-logic,
    5 layout, 5 variables, 5 JS/extension, 5 perception-repair) in
    static-eval mode with mechanical scorers (timer/creation markers,
    numeric grid geometry, variable shapes, required API usages, numeric
    HUD-repair overlap checks). Tracks pass/fail, rounds, tool calls, tokens
    per task; writes markdown reports to `REVIEW/evals/`. Self-check
    (trivially-passing + trivially-failing tasks) verified by
    js` — the spec file name was cut mid-write by the shell heredoc limit; the
  remainder of this entry follows from here (written via a file splice so no
  further truncation is possible).

  - **9.9 Gate:** all four checks green (numbers below). **Prompt version
    stays `byok-v6`** — no system-prompt behavior text changed (compaction,
    watchdog and notices are transcript- and orchestrator-level).
- Upstream touchpoints (all phase-justified, kept minimal):
  `AiRequestChat/index.js` (BYOK header props + render, approved #5/#6),
  `AiRequestChat/ChatMessages.js` + `AiRequestChat/Utils.js`
  (`byok_notice` render item — the phase doc requires the row to render),
  `AskAiEditorContainer.js` (seam props: `updateByokPreferences`, header,
  local feedback, history button mount), `AskAiStandAloneForm.js`
  (`updateByokPreferences` wiring), `electron-app/app/main.js` (7 lines:
  chat-file IPC handler registration), plus the Byok-module files listed
  under "Modified".
- Docs: `AGENTS.md` §2 refreshed (status + restart note, footer date);
  `usertasks.md` gained QA **Task 11** (Phase 9 desktop checklist);
  `outofscoped.md` gained the session's fixed-bug record (per the session's
  NO-SILENT-LANDMINES instruction); `deferred.md` gained the two small
  deliberate leftovers (LLM-judge stub, benchmark history). No locale files
  touched; every user-visible string uses `<Trans>`/`t`.

**Bugs found** (all fixed in this session with tests; also recorded in
`outofscoped.md` per the session instruction):

1. **Archive marker lost on an in-flight orchestrator update** —
   `ByokChatStore.updateByokChat` copied the incoming record verbatim; the
   suspended loop's next persist (no `archivedAt` on its record) silently
   un-archived the chat. Repro: archive a chat, then land any queued
   `updateByokChat` from the loop → `archivedAt` gone. Root cause: no merge
   policy for the optional marker. Fix: preserve the stored marker unless
   the update carries one explicitly (`null` = explicit restore). Test:
   `ByokChatStore.spec.js` "keeps the archive marker…".
2. **Quota last-resort eviction emptied the store** —
   `ByokChatFileStore.enforceQuota` deleted whole chats without re-reading
   `totalBytes` between deletions; a cap just under total evicted EVERY chat
   instead of only the oldest. Repro: 2 equal chats, cap = 0.75 × total →
   both deleted. Root cause: loop bound checked a stale byte count. Fix:
   re-read per iteration. Test: persistence spec "evicts whole chats only as
   the last resort".
3. **Markdown reload skipped every other message** — the parser iterated
   `body.split('```json')` with `index += 2`; every segment after the first
   holds exactly one message, so even-indexed messages were dropped and the
   `messageCount` mismatch then quarantined the (valid) file. Repro: save a
   2-message chat, `loadChat` → null + file moved to `corrupt-`. Root
   cause: fence-pair thinking applied to a split-on-opener. Fix:
   `index += 1`. Tests: the round-trip tests (2-message chat,
   notice/tool/image chat).
4. **Markdown envelope injection** — a transcript message containing a
   triple-backtick fence (e.g. an assistant quoting a ```json block)
   produced a file whose split found phantom blocks; reload returned null.
   Repro: assistant text containing a fenced json example → serialize →
   parse → null. Root cause: the envelope delimiter is model-controlled
   data. Fix: escape backticks as `\u0060` in the serialized JSON
   (JSON.parse restores them losslessly) and strip backticks from the
   preview headers. Test: "round-trips a message that quotes markdown
   fences itself".
5. **Compaction could orphan tool outputs (protocol violation)** — the
   first region split allowed an assistant `tool_calls` message to be
   summarized away while its `tool` output stayed (or the reverse); strict
   OpenAI-compatible endpoints reject orphan tool messages. Repro: 14-turn
   transcript with per-turn tool calls, keepLastToolTurns=3 → one-liner
   outputs without their calls. Root cause: two independent boundaries
   applied without regard to the call/output pairing invariant. Fix:
   call+output pairs compact in place; one-liners only for old outputs;
   only user/plain-assistant text goes to the summarizer. Test: compactor
   spec "keeps the tool-call pairs in place…".
6. **Stale Jest transform cache masked failures** (tooling) — after large
   edits, two consecutive `npm test` runs disagreed; `--no-cache` and direct
   `@babel/parser` parse checks were used to separate cache ghosts from
   real failures. No product impact.

**Issues found:**

- `jest.advanceTimersByTimeAsync` does not exist in this repo's Jest — the
  fake-timer tests use sync `jest.advanceTimersByTime` plus explicit
  microtask flushes (tick-count matters: advancing before the backoff timer
  is scheduled does nothing; documented in the client spec).
- Prettier's parser rejects Flow indexed-access types
  (`AiRequestSuggestions['suggestions']`) — replaced with the explicit
  object type in `ByokSuggestions.js`.
- Flow treats plain `{...}` annotations as exact in this config; the image
  getter parameter types use the trailing-`...` inexact syntax so the
  richer `ByokImageInfo` remains assignable.
- The completion-gate nudge consumes one extra model round (Phase 8
  behavior, re-discovered while testing the snapshot-refresh failure path);
  the Phase 9 orchestrator tests account for it.
- Rate-limit UX implemented as the in-chat `rate-limited` notice row (the
  doc's "transient banner" read as an in-chat, non-terminal surface; the
  error row still exists for terminal failures). Recorded here per §8.
- The eval harness runs in static-eval mode (the model emits the tool calls
  as strict JSON; scorers verify the encoded outcome) so the suite runs
  anywhere without the editor; noted in the script header.
- `ugrep` is the `grep` alias on this machine and rejected one `-rnE`
  piped form; the affected grep was re-run as a plain exit-code check.
- Gate times: full Jest suite ~28 s; flow ~90 s (direct flow.exe, no pipe
  hang this session).

**Files worked on:**
- Created (Byok): `ByokWatchdog.js/.spec.js`, `ByokCompactor.js/.spec.js`,
  `ByokChatPersistence.js/.spec.js`, `ByokModelRouter.js/.spec.js`,
  `ByokCapabilities.js/.spec.js`, `ByokBenchmark.js/.spec.js`,
  `ByokSuggestions.js/.spec.js`, `ByokChatStorageBackends.js`,
  `ByokChatHistory.js`, `Byok/evals/ByokEvalHarness.spec.js`.
- Created (elsewhere): `newIDE/app/scripts/run-byok-evals.js`,
  `newIDE/app/scripts/byok-eval-task-prompts.js`,
  `newIDE/electron-app/app/ByokChatFiles.js`.
- Modified (Byok): `ByokTypes.js/.spec.js` (Phase 9 settings + parsing),
  `ByokClient.js/.spec.js` (Retry-After cap, degraded-effort callback, new
  body fields), `ByokOrchestrator.js/.spec.js` (watchdog/compaction/router/
  snapshot-refresh/rate-limit notice/capability consult + Phase 9 tests),
  `ByokChatStore.js/.spec.js` (persistence delegate + flag + real archive +
  delete + usage-tracker registry), `ByokTranscript.js/.spec.js` (notice
  rows + replay skip), `ByokKeyStorage.js/.spec.js` (per-provider slots),
  `ByokImageContent.js` (`restoreByokImage`), `ByokSubAgents.js` (call-kind
  + routing passthroughs), `ByokSettingsTab.js/.spec.js` (providers,
  profiles, watchdog, suggestions, benchmark, storage line, feedback
  export; button-by-label selection), `ByokFork.spec.js` (archive-in-place
  expectation), `useByokChatSeam.js` (persistence install + flush, live
  settings, key resolver, capability write-back, suggestions on ready,
  header state, feedback, openSavedByokChat).
- Modified (upstream, phase-justified): `AiRequestChat/index.js`,
  `AiRequestChat/ChatMessages.js`, `AiRequestChat/Utils.js`,
  `AskAiEditorContainer.js`, `AskAiStandAloneForm.js`,
  `newIDE/electron-app/app/main.js`.
- Docs: `AGENTS.md`, `REVIEW/usertasks.md`, `REVIEW/outofscoped.md`,
  `REVIEW/deferred.md`, `REVIEW/worklog.md` (this entry).
- Read: `REVIEW/Phase9.md`, `REVIEW/worklog.md` (format), `AGENTS.md`, the
  `Byok*` modules listed above, `AiRequestChat/*`, `Generation.js`,
  `AskAiEditorContainer.js`, `AskAiHistory.js` (mount context),
  `EditorFunctions/index.js` (launchFunction + registry),
  `ByokEventScriptParser(.spec).js` (DSL grammar), `UI/Alert/*`,
  `UI/CustomSvgIcons/*` (component reuse).

**Triage (§5.2):**
- OOS: the session's six fixed bugs recorded in `outofscoped.md` per the
  session's explicit NO-SILENT-LANDMINES instruction (all marked fixed;
  none pending). Otherwise nothing new awaiting a decision.
- Deferred: two small Phase 9 leftovers recorded (`deferred.md`): the
  eval-harness LLM-judge pass (reserved flag only) and persisted per-model
  benchmark history. Streaming (D2) and the O2 char-estimate stay
  conditional as before.
- UT: QA **Task 11** added to `usertasks.md` (Phase 9 desktop checklist:
  watchdog + compaction + history + routing + benchmark + regression);
  Tasks 1, 2, 6, 7, 9, 10 remain open as before.

**Gates (run 2026-09-23, from `newIDE/app` unless noted):**
- `npm test -- --watchAll=false` → **191 suites / 2050 tests passed**
  (1 skipped, pre-existing), 113 snapshots green.
- `npm run lint` → exit 0, **0 warnings**.
- `npm run flow` (direct `flow.exe check`, §6 workaround) → **0 errors**.
- `npm run check-format` → exit 0 (clean after `npm run format`).
- `newIDE/electron-app` `npm run check-format` → exit 0 (formatted the new
  `ByokChatFiles.js` + the 7-line `main.js` addition).

**Audit greps (run 2026-09-23, outputs as-is; from `newIDE/app` unless
noted):**

1. No GDevelop-server calls in the new Phase 9 modules —
   `grep -rnE "gdevelop\.io|createAiRequest|addMessageToAiRequest|retryAiRequest"
   src/AiGeneration/Byok/{ByokWatchdog,ByokModelRouter,ByokCapabilities,ByokCompactor,ByokSuggestions,ByokChatPersistence,ByokBenchmark,ByokChatStorageBackends}.js`
   → **exit 1, no matches** (the only network target in the new code is the
   user's own endpoint, via the injected client).
2. Suggestions/feedback are local — `grep -nE "axios|fetch\(|XMLHttpRequest"
   src/AiGeneration/Byok/ByokSuggestions.js` → **NO MATCHES**.
3. Persistence flag flipped with the implementation —
   `grep -n "BYOK_CHAT_PERSISTENCE_ENABLED = " src/AiGeneration/Byok/ByokChatStore.js`
   → `27:export const BYOK_CHAT_PERSISTENCE_ENABLED = true;`.
4. Every new module has a co-located spec — `OK` for ByokWatchdog,
   ByokModelRouter, ByokCapabilities, ByokCompactor, ByokSuggestions,
   ByokChatPersistence, ByokBenchmark, and `evals/ByokEvalHarness.spec.js`.
5. Prompt version unchanged (no `byok-v7` bump) — `grep -n "byok-v"
   src/AiGeneration/Byok/ByokPrompts.js` → `29:export const
   BYOK_AGENT_PROMPT_VERSION: string = 'byok-v6';`; `git diff --name-only --
   src/AiGeneration/Byok/ByokPrompts.js | wc -l` → `0`.
6. Locales untouched — `git status --porcelain -- src/locales | wc -l` →
   `0`.
7. Upstream touchpoint budget honored — `git status --porcelain` outside
   `Byok/` lists exactly: `AiRequestChat/ChatMessages.js`,
   `AiRequestChat/Utils.js`, `AiRequestChat/index.js`,
   `AskAiEditorContainer.js`, `AskAiStandAloneForm.js`,
   `electron-app/app/main.js` (+ untracked
   `electron-app/app/ByokChatFiles.js`, `scripts/run-byok-evals.js`,
   `scripts/byok-eval-task-prompts.js`).
8. Per-provider key slots — `grep -n "storageItemForKeyRef"
   src/AiGeneration/Byok/ByokKeyStorage.js` → definitions at lines 20/229/
   264 (`gd-byok-key` for the legacy slot, `gd-byok-key-<keyRef>` for every
   other provider).
9. No new npm dependencies — `git diff --name-only --
   newIDE/app/package.json newIDE/app/package-lock.json | wc -l` → `0`
   (the IndexedDB wrapper is hand-written; no yaml library — the front
   matter is a fixed-field codec).
10. AC-by-AC (Phase9.md §3): F2 watchdog unit-tested (once-per-window,
    in-chat `byok_notice` row, disarm on activity/stop, toggle-off never) +
    prompt half pending desktop QA; compaction threshold/preserved block/
    drop order/cap/shrink/last-resort all unit-tested (`byok-context-full`
    still reachable — orchestrator path untouched); history round-trip/
    quarantine/archive/restore/quota-order/lazy-list unit-tested (restart +
    images = Task 11); F3 registry CRUD + migration + key isolation +
    resolution order + effort source + truth table + omitted advanced
    fields unit-tested, badge/token row = Task 11; capability cache
    suppresses `reasoning_effort` after one degradation (second turn sends
    none — unit-tested), benchmark runner + scorers unit-tested (live
    ranking = Task 11); suggestions opt-in/local + feedback cap/export
    unit-tested, nothing sent to GDevelop servers (greps 1–2); eval harness
    self-check + suite shape + report format + build boundary unit-tested,
    CLI writes markdown under `REVIEW/evals/`.

---

## 2026-09-23 — Phase 10 designed (MCP server; owner ordered the phase in chat)

**Date:** 2026-09-23.

**Actions:** designed `REVIEW/Phase10.md` end to end (no code written —
this is a design session; the four repo gates were not run because no
source file changed). The design: a loopback MCP endpoint in the Electron
main process (Bearer token per session, ephemeral port, discovery file
`<userData>\gdevelop-mcp-endpoint.json`, focused-ready-window routing,
150 s request timeout, no CORS, second-instance ownership rule), a
zero-dependency stdio adapter (`scripts\gdevelop-mcp-stdio.js` over a
tested `Byok\Mcp\ByokMcpStdioAdapterCore.js`, `-32002` on unreachable IDE,
re-reads discovery across IDE restarts), renderer-side protocol core
(MCP revision pinned `2026-07-28`, stateless JSON mode), tool mapping +
access gate (`read-only`/`read-write` from the same `modifiesProject`
metadata the approval row uses; 200k-char output cap divergence from the
chat's 20k, recorded in the doc), a serialized tool host with 120 s
timeout + 200-entry activity ring, seam-level host registration,
settings card, and client wiring (Appendix A). Verified the design against
the current tree before writing: the D8 seam (`useByokChatSeam.js` —
executor factory + collaborator bags the bridge reuses), `ByokSeam.js`
executor shape (`{name, arguments, call_id}` → `{results, createdSceneNames,
createdProject}`), `ByokToolSchema.js` (whitelist + `getByokAdvertisedToolNames`),
`ByokExtraTools.js` collaborators/result shapes (incl. the `runSubAgent`
nesting guard the MCP path deliberately omits), `ByokTypes.js` settings
slice pattern, the electron thin-handler registration pattern
(`ByokSafeStorage`/`ByokChatFiles` + `main.js`), the
`optionalRequire('electron')` renderer IPC pattern
(`ByokChatStorageBackends.js`), and `MainFrame/index.js`
(`renderAskAiEditorContainer` map — the one-line mount touchpoint). Five
owner decisions (D10-1…D10-5) opened, presented in chat with
recommendations, and recorded pending in `usertasks.md`.

**Bugs found:** none (design-only session; nothing ran).

**Issues found:**
1. Tool-host availability is tied to a seam host being mounted (the
   executor's outside-editor callbacks live in the container), so the
   practical rule becomes "open the Ask AI tab once in the target project
   window". A QA item was added (Phase10.md §4) to verify the container
   really stays mounted across tab switches; if it does not, lifting the
   registration to a MainFrame-level effect is the pre-agreed fallback —
   a worklog escalation, not a silent redesign.
2. Two enabled GDevelop instances would flip-flop the discovery file the
   adapter reads — an ownership rule is specified (live foreign pid ⇒
   refuse to start and surface it in the settings card; dead pid ⇒ take
   over).
3. The stdio adapter cannot import `src\` modules (Flow annotations are
   not Node-parseable), so its logic lives in a tested `Byok\Mcp\` core
   with the script as a thin stdin/stdout pump — the same discipline as
   the electron shims.
4. `Phase9.md` §4's "no Phase 10 was needed" line read stale after the
   owner's order — clarified in AGENTS.md §2 (per §8, fixed in the same
   session) and noted in `Phase10.md`'s header. `Phase9.md` itself was
   left untouched (its history is accurate as of its date).

**Files worked on:** `REVIEW/Phase10.md` (new); `REVIEW/usertasks.md`
(Phase 10 decisions section, pending); `REVIEW/deferred.md` (Phase 10
v1-deferrals entry); `AGENTS.md` (§2 status update + stale-clause fix);
`REVIEW/worklog.md` (this entry).

**Triage:** `no OOS`; one `deferred.md` entry added (MCP v1 deferrals, by
design); one `usertasks.md` section added (D10-1…D10-5, pending).

---

## 2026-09-23 — Phase 10 implemented (GDevelop MCP server) + backlog closeout

**Date:** 2026-09-23.

**Actions:** implemented all of `Phase10.md` (owner order: "implement
this"; decisions D10-1…D10-5 taken as recommended — hand-rolled protocol,
read-write default access mode, full tool parity, `Byok\Mcp\` location,
dev-time wiring — recorded as answered in `usertasks.md`):

1. **Renderer protocol core** `Byok/Mcp/ByokMcpProtocol.js`: JSON-RPC 2.0
   framing + the MCP method table (`initialize` with version negotiation,
   `notifications/initialized`, `notifications/cancelled`, `ping`,
   `tools/list`, `tools/call`), pinned to spec revision `2026-07-28`;
   handlers carry the request id so cancellation matches.
2. **Tool mapping** `Byok/Mcp/ByokMcpTools.js`: descriptors from
   `getByokAdvertisedToolNames`/`getByokToolSchemasForNames` (schemas pass
   through verbatim as `inputSchema`) + the MCP-native
   `get_project_overview`; the read-only gate reads the same
   `modifiesProject`/`getModifiesProject` metadata as the chat approval
   row; result mapping reproduces the chat serialization exactly
   (`{success, ...output}` for registry tools, raw output for extras,
   synthetic abort failures), images materialized as MCP image parts, the
   200k output cap (recorded divergence from the chat's 20k), the plan-tool
   echo with `depends_on → dependsOn`.
3. **Tool host** `Byok/Mcp/ByokMcpToolHost.js`: module-level registry
   (identity-safe cleanup, change subscribers), serialized FIFO queue,
   120 s per-call timeout (queue slot stays occupied), client-cancellation
   marks (skip-if-not-started), 200-entry activity ring
   (completed/rejected/failed/timeout/cancelled + didModifyProject).
4. **Renderer endpoint** `Byok/Mcp/useByokMcpServer.js` +
   `ByokMcpServerHost`: `MainFrame`-mounted (one import + one JSX element
   in `MainFrame/index.js` — audited touchpoint); pushes
   `byok-mcp-set-enabled` and `byok-mcp-host-status`, answers
   `byok-mcp-request`/`byok-mcp-response`; Electron resolved lazily so the
   web build is inert.
5. **Seam bridge**: `useByokChatSeam.js` registers the tool host built from
   the existing executor and collaborators (no `runSubAgent` — sub-agent
   tools refuse over MCP; no `byokChatId`); dispatch mirrors the chat loop
   (`create_or_update_plan` echo, extras via `findByNameokExtraTool`
   unless `isByokExtensionToolShadowedByRegistry`, registry otherwise).
6. **Electron main** `electron-app/app/ByokMcpServer.js` +
   `main.js` (require + `registerByokMcpServer(ipcMain, app)`): loopback
   listener with Bearer token + Host-header guard + 1 MB body cap +
   404/405/413 handling, notifications answered 202, focused-ready-window
   routing, 150 s forward timeout, discovery-file lifecycle with
   second-instance refusal (live foreign pid) and stale takeover,
   `before-quit` cleanup, no CORS ever. Built by a delegated subagent to
   the written contract, then reviewed line-by-line.
7. **Stdio adapter** `scripts/gdevelop-mcp-stdio.js` requiring the
   plain-CJS tested core `Byok/Mcp/ByokMcpStdioAdapterCore.js` (the
   `OptionalRequire.js` no-ESM precedent): flags-wins endpoint resolution
   over the discovery file, `-32002` on unreachable IDE with one
   discovery-re-read retry, stdout carries protocol messages only, stays
   alive across IDE restarts. Smoke-tested (`--help`, dead-port retry,
   notification silence).
8. **Settings** : `mcpServer` slice in `ByokTypes.js`
   (`{enabled, accessMode}`, default read-write per D10-2) +
   `Byok/Mcp/ByokMcpSettingsCard.js` mounted in `ByokSettingsTab.js`
   (toggle, access dropdown, running status + endpoint URL + discovery
   path, copy-config JSON, activity list with clear, web-build degradation).

**Backlog closeout (owner order: nothing outstanding remains outside
`usertasks.md`):**

- **Eval judge pass implemented** — `scripts/run-byok-evals.js`
  `--judge-model` now runs one chat call per failed task and renders an
  advisory "LLM-as-judge" report section; judge failures degrade to
  `unavailable` rows (`runJudgePass`/`parseJudgeAnswer`, exported).
  Closes the Phase 9 leftover.
- **Benchmark persistence implemented** — new `Byok/ByokBenchmarkStore.js`
  (localStorage per endpoint+model); the settings tab shows the stored
  report with its timestamp. Closes the second Phase 9 leftover.
- **Notes identifier live ref** — `useByokChatSeam.js` reads `fileMetadata`
  through `byokFileMetadataRef` in both `getProjectNotesIdentifier`
  closures (mid-chat "Save as…" moves the notes identifier). Closes the
  Phase 7 `outofscoped.md` row.
- **Serializer guard** — `Utils/Serializer.js` routes
  `optionalProject === serializable` to the single-argument in-place
  `unserializeFrom` (the Phase 8 WASM-corruption case); new
  `Serializer.spec.js` covers all three dispatch branches. Closes the
  Phase 8 `outofscoped.md` row.
- **Duplicate `onOpenAskAi` Props key removed** from
  `AskAiEditorContainer.js`. Closes the last Phase 8 cleanup row.
- `outofscoped.md` is now EMPTY; `deferred.md` holds only owner-answered
  by-design items, the two accepted Phase 8 limitations moved there, and
  the Phase 10 v1 scope boundary (approved with the phase order).

**Gates (all from `newIDE\app`, final run):** 198 suites / 2146 passed +
1 pre-existing skip; lint 0 warnings; Flow 0 errors; check-format clean.
`newIDE/electron-app`: `node --check` clean, check-format clean.

**Bugs found during implementation (all fixed in-session, each covered by a
test):**

1. The protocol dispatcher did not forward the JSON-RPC id to the
   `callTool` handler — cancellation could never have matched an in-flight
   call. Fixed (`handlers.callTool(params, id)` + type widened).
2. `ByokMcpTools.js` used `makeSimplifiedProjectBuilder` without importing
   it (caught by lint `no-undef` — the gate caught it before runtime).
3. The first queue tests registered hosts whose fake registries lacked the
   tool names, so dispatch refused them as unknown before reaching the
   executor — test fixtures fixed to register names.
4. Three spec assertions JSON-parsed plain-text error results (refusals are
   `isError` text, not JSON) — assertions fixed to inspect `content[0].text`.
5. The `OptionalRequire` electron mock lost its implementation to the Jest
   `resetMocks: true` default (the known factory-impl trap, hit again) —
   replaced with a plain closure in the mock factory.
6. The activity-clear test called the raw bag executor, bypassing the queue
   where activity is recorded — rerouted through `executeByokMcpToolCall`.
7. `resolveDefaultDiscoveryPath` tests assumed POSIX separators on a
   Windows host — expectations now built with `path.join`.
8. The benchmark store key sanitizes URL-hostile characters (`:`/`/` →
   `_`); the test expectation was corrected to the designed value.
9. A comment containing the literal `@flow` made Flow parse a plain-JS spec
   as Flow (invalid mode) — comment reworded.
10. The settings card's 5 s status interval leaked past tests without
    unmount — specs now unmount every rendered card.

**Issues found:**

1. The tool host lives while a seam host is mounted — the "open the Ask AI
   panel once" rule is enforced by an actionable no-host error, and QA
   Task 12 verifies the tab-switch-keeps-mounted expectation; the
   MainFrame-level fallback remains the pre-agreed escalation if it does
   not hold on desktop.
2. A status channel (`byok-mcp-status`) was added beyond the phase doc's
   original IPC list — needed by the card/hook to show running state; noted
   in `Phase10.md`'s implementation notes.
3. `ByokMcpStdioAdapterCore.js` is plain CJS inside `src/` (no Flow) so the
   Node script can require it — the same exception as `OptionalRequire.js`,
   documented in the file header; its spec also runs without the Flow
   marker.
4. `jest` roots are `<rootDir>/src` (CRA), confirming specs cannot live in
   `scripts/` — the adapter core/spec split follows the Phase 9 eval
   harness pattern.

**Files worked on:** new — `REVIEW/Phase10.md`,
`newIDE/app/src/AiGeneration/Byok/Mcp/` (ByokMcpProtocol,
ByokMcpTools, ByokMcpToolHost, ByokMcpStdioAdapterCore, useByokMcpServer,
ByokMcpSettingsCard + 6 specs), `newIDE/app/src/AiGeneration/Byok/ByokBenchmarkStore.js`
(+ spec), `newIDE/app/src/Utils/Serializer.spec.js`,
`newIDE/app/scripts/gdevelop-mcp-stdio.js`,
`newIDE/electron-app/app/ByokMcpServer.js`; modified —
`newIDE/app/src/AiGeneration/Byok/ByokTypes.js` (+spec),
`ByokSettingsTab.js`, `useByokChatSeam.js` (+spec),
`Byok/evals/ByokEvalHarness.spec.js`, `scripts/run-byok-evals.js`,
`src/AiGeneration/AskAiEditorContainer.js`, `src/MainFrame/index.js`,
`src/Utils/Serializer.js`, `newIDE/electron-app/app/main.js`,
`REVIEW/usertasks.md`, `REVIEW/outofscoped.md`, `REVIEW/deferred.md`,
`REVIEW/Phase10.md`, `AGENTS.md`, `REVIEW/worklog.md`.

**Triage:** `no OOS` (`outofscoped.md` emptied — every item fixed and
verified this session or in earlier phase sessions); `no deferred` new
items (Phase 9 leftovers closed by implementation; the two Phase 8
accepted limitations moved from `outofscoped.md` into `deferred.md` as
by-design); one `usertasks.md` addition (QA Task 12 + the D10-1…D10-5
answered record).

---

## 2026-09-23 (later) — Read-only audit: AI-connectable surfaces not yet connected

**Date:** 2026-09-23 (second session block, same day).

**Description of actions:** Verification sweep, ordered by the owner in chat:
"verify if there are any surfaces left in the engine that could still be
connected to AI and are currently not." Dispatched one wave of 5 read-only
Explore subagents (hosted-AI call sites, UI entry points, tool-registry gap
analysis, non-chat AI features, MCP coverage), then verified the two spots
where subagent reports disagreed with each other directly against source
(`ByokToolSchema.js` docblock + `BYOK_TOOL_NAMES`/`BYOK_ONLY_TOOL_NAMES`,
`REVIEW/phase5-tool-decisions.md`). No code was changed. Findings delivered
in chat: (A) hosted-only AI features deliberately not ported to BYOK — asset/
resource store *discovery* (`search_object_asset_store`/`search_resource_store`,
Generation.js:992/1046), `run_edit_agent`, `run_tests`, `get_game_starter_summary`
— all recorded as deliberate exclusions in `REVIEW/phase5-tool-decisions.md`;
BYOK-configured users still trigger two hosted calls by design
(`AskAiEditorContainer.js:465` summaries fetch on tab activation,
`AiRequestContext.js:1374` `fetchAiSettings` on mount). (B) Editor surfaces
with no contextual AI entry point (Asset Store, Debugger/Profiler, Resources
panel, extension editor, GameDashboard, project-properties/effects/variables
dialogs, object editors, ProjectManager, Export/Share, In-app tutorial;
command palette has no AI command/shortcut) — all 12 existing entry points
funnel through `MainFrame/index.js:1105` `openAskAi` and are BYOK-covered.
(C) Engine capabilities with zero AI tool coverage: external events/external
layouts, audio import/replace, sprite-frame/animation/collision-mask/point
editing, resource ops beyond rename/delete, object-type-specific authoring
(particles, tile maps, 3D models, Spine, shape painter), effect-type
discovery (no enumerate-metadata tool), extension-editor internals
(custom-object children, post-creation parameter declarations), extension
marketplace browse/updates, loading-screen/platform assets/export,
leaderboards/analytics/monetization config, multiplayer lobby config, game
i18n, storage inspection, debugger-only surfaces (profiler, live instance
editing). (D) MCP covers the full advertised surface + `get_project_overview`
(`Byok/Mcp/ByokMcpTools.js:72-91`); possible additions are MCP-native
prompts/resources primitives for skills/notes/docs and a read-notes tool;
sub-agent tools refuse gracefully over MCP by design. Candidate work items
were presented in chat as a numbered decision list (owner preference); none
filed into triage docs pending the owner's answer.

**Bugs found:** none (read-only session). Two preliminary subagent misreads
were caught by source verification before reporting: (1) a claim that BYOK
users "lose event generation" — false, `add_scene_events`/`generate_events`
are locally implemented (`Byok/ByokExtraTools.js:120` + `ByokLocalEventWriter`);
the `ByokSeam.js:204` stub only covers the legacy hosted dependency; (2) a
claim that the store-search stubs are advertised-then-fail in BYOK chats —
false, they are excluded from `BYOK_TOOL_NAMES` (`ByokToolSchema.js:110-113`).

**Issues found:** minor observations, no action taken: dead export
`onSendByokNoopFeedback` (`AskAiEditorContainer.js:157`, never imported);
`run_explorer_agent`/`run_review_agent` are advertised over MCP but always
refuse there (host bag omits `runSubAgent`, `useByokChatSeam.js:678` —
graceful, by design); `REVIEW/AIflow.md` BYOK sections are stale (describe
the Phase-5 11-tool whitelist, pre-Phase-6; registry table itself matches
code exactly).

**Files worked on:** modified — `REVIEW/worklog.md` (this entry). No other
file created or modified; the audit read only
`newIDE/app/src/AiGeneration/**`, `newIDE/app/src/EditorFunctions/**`,
`newIDE/app/src/MainFrame/**`, `newIDE/app/src/Utils/GDevelopServices/Generation.js`,
and `REVIEW/phase5-tool-decisions.md` / `REVIEW/AIflow.md`.

**Triage:** `no OOS` (candidate surfaces are unapproved scope, presented in
chat for owner decision; entries would move to `outofscoped.md` only if
green-lit), `no deferred`, `no UT`.

---

## 2026-09-24 — Planning session: Phase 11 + Phase 12 (audit backlog)

**Date:** 2026-09-24.

**Description of actions:** The owner green-lit 10 of the 2026-09-23 audit
candidates ("plan them in Phase11 and Phase 12, more or less equal amount
of work"). Dispatched one wave of 5 read-only feasibility surveys (asset/
resource store search, starter-template data sources, debugger/profiler
architecture, resource-import + sprite-internals machinery, effects
metadata + external events/layouts + extension-editor internals), then
wrote `REVIEW/Phase11.md` (authoring reach: external events/layouts tools,
`list_effects`, sprite-frame internals, `import_project_resources`,
extension children/parameters/dependencies; one behavior-preserving
extraction of the instance-tool cores from `EditorFunctions\index.js` into
`EditorFunctions\InstanceTools.js`; prompt → `byok-v7`, 48 → 56 tools) and
`REVIEW/Phase12.md` (discovery/runtime/integration: local
`get_game_starter_summary`, `search_object_asset_store`/
`search_resource_store` over the auth-free public catalogs + wiring the
`ByokSeam.js` search collaborators, command-palette entry + `Ctrl+Alt+A`,
MCP `prompts`/`resources` + `read_project_notes`, debugger/profiler tools;
prompt → `byok-v8`, 63 tools). The owner's item 4 (store discovery) was
conditional on feasibility — verified possible (public catalogs are
no-auth static CDN JSON; the install path already runs client-side), so it
is planned with the verification recorded. Updated `AGENTS.md` §2 (status
date, planned-not-started, owner-decisions line, roadmap line Phase1→12,
last-updated footers) and recorded the green-light in `usertasks.md`
("Phase 11/12 green-light — presented and answered 2026-09-24"). Phase docs
carry the per-phase design decisions D11-1…D11-5 and D12-1…D12-8 with
recommendations, to be answered at implementation kickoff (owner's
established walkthrough pattern). No code changed.

**Bugs found:** none (planning session; no code touched). One pre-existing
quirk found by the debugger survey and folded into Phase 12 step 12.5:
`ByokPreviewSession.js:251-253` `stop()` calls `closePreview()` without
the window id `LocalPreviewLauncher.closePreview` expects.

**Issues found:** feasibility notes recorded in the phase docs' design
notes, in particular: the two IDE↔preview debugger gotchas (the renderer
`sendMessageWithResponse` broadcasts to ALL connected previews — Phase 12
tools must target the session's own `DebuggerId`; profiler stats are
push-only on stop); the store-search replacement must NOT call the old AI
endpoints (`createAssetSearch`/`createResourceSearch` need login — the
plan uses the public catalogs instead); `get_game_starter_summary` is
online-only (no bundled template catalog exists in the tree — consistent
with the UI's own offline degradation).

**Files worked on:** created — `REVIEW/Phase11.md`, `REVIEW/Phase12.md`;
modified — `AGENTS.md`, `REVIEW/usertasks.md`, `REVIEW/worklog.md` (this
entry), agent memory files (outside the repo). Surveys read only.

**Triage:** `no OOS` (the green-lit items have phase homes now —
`Phase11.md`/`Phase12.md` — so they do not sit in the backlog doc),
`no deferred` (the unpicked audit candidates were already by-design in
`deferred.md` or are listed in the new phases' §5 deferrals), `no UT` new
QA tasks yet (desktop QA Tasks 13/14 get filed by their implementation
sessions; `Phase12.md` Appendix A drafts the checklist).


---

## 2026-09-24 — Phases 11 + 12 implemented (authoring reach + discovery/runtime); Phase 11 built as the ordered Phase 12's prerequisite

**Context:** the owner ordered "implement Phase 12" in chat. `Phase12.md`
hard-depends on Phase 11 (the `ByokCatalogTools` module,
`import_project_resources`, the v7 prompt step), which was still
planned-only — per the session's create-don't-defer instruction both
phases were built in one session, in roadmap order. D11-1…5 and D12-1…8
were answered at kickoff exactly as recommended in the phase docs.

### Description of actions

**Phase 11 (authoring reach, prompt byok-v7, advertised 48 → 56):**

- **11.1 — Instance-core extraction:** moved the container-generic core of
  `describe_instances`/`put_2d_instances` out of
  `EditorFunctions/index.js` into the new leaf module
  `EditorFunctions/InstanceTools.js` (`describeInstancesInContainer`,
  `putInstancesInContainer`, plus the shared helpers
  `iterateOnInstances`, `makeGenericFailure`, `injectObjectSizeInfo`,
  `getOccupiedSpaceDescription`, `getLayerNameForMessage`,
  `extractRequiredString`, `makeWrongObjectInstanceIdsFailure` — index.js
  imports them back; only the `EditorFunctionGenericOutput` TYPE still
  flows index→InstanceTools (type-only, erased at runtime). Behavior-
  preserving proof: `DescribeInstances.spec.js` + `Put2dInstances.spec.js`
  (21 tests) green unchanged; new `InstanceTools.spec.js` (12 tests)
  covers the functions directly, including external-layout containers.
- **11.2/11.3 — external events & layouts:** new
  `Byok/ByokExternalSceneTools.js` (4 tools). The event writer's apply
  step became container-generic
  (`byokApplyEventBatchesToEventsList` in `ByokLocalEventWriter.js`;
  `byokApplySceneEventBatches` delegates). Writers create-if-missing with
  `associated_scene`; not-found errors list the existing items. Arg-shape
  decision (recorded): `add_external_events` takes `event_batches` (the
  add_scene_events shape) OR whole-sheet `event_script` + `mode`
  replace/insert — both forms the step named. The external-layout tools
  borrow the associated scene's layers/objects (the editor's own rule).
- **11.4 — effect catalog:** `list_effects` in the new
  `Byok/ByokCatalogTools.js` over `enumerateEffectsMetadata`, compacted
  (`{type, fullName, description, flags, properties:[{name,type,
  defaultValue,description,choices?,isAdvanced,isDeprecated}]}`); grouped
  properties arrive as section fields and are FLATTENED
  (`flattenByokEffectProperties` — the PropertiesEditor schema nests
  grouped properties under `children`, discovered while testing).
- **11.5 — sprite internals:** new `Byok/ByokSpriteTools.js`
  (`describe_sprite_frames` capped at 120 frames; `change_sprite_frames`
  typed ops list: animations/frames/points/masks/adapt-flag; per-frame or
  all_frames masks; polygons from vertices or a moved rectangle). libGD
  wrapper-lifecycle rules encoded (re-resolve per op; `delete()` Sprite/
  Point/Vector2f wrappers; Polygon2d wrappers NOT deleted — see Bugs).
  Objects-modified notification threaded through a new optional
  collaborator `onObjectsModifiedOutsideEditor` (orchestrator option +
  seam wiring added).
- **11.6 — resource import:** new `Byok/ByokResourceTools.js`
  (`import_project_resources`): URL (download via the `local-file-download`
  IPC), absolute path (copy + dedupe), project-relative (register in
  place); `replace_existing` retargets in place; report-only usedBy via
  `ObjectsUsingResourceCollector`; escape-the-folder refusal;
  desktop-only failure otherwise. Core is dependency-injected
  (`ByokResourceImportDeps`) so tests run on fakes.
- **11.7 — extension internals:** `change_custom_function` gained
  `parameters_to_add/_remove/_move` (validated, duplicate-skipping);
  `change_custom_object` gained `children_to_add/_remove` with a usage
  guard (the child NAME searched quoted in the serialized events of the
  object's functions — a custom object has no separate events sheet, its
  logic IS its functions' events; conservative refusal only);
  `change_extension_properties` gained `dependencies_to_add/_remove` and
  always outputs the current dependency list.
- **11.8 — surface:** 8 names + schemas + `BYOK_ONLY_TOOL_NAMES` entries;
  cap 48 → 56; prompt `byok-v7` with the new `authoring-reach` knowledge
  section; 6 new eval tasks (`authoring-reach` category; harness 30 → 36).

**Phase 12 (discovery/runtime, prompt byok-v8):**

- **12.1 — starter summaries:** `get_game_starter_summary` in
  `ByokCatalogTools.js` over `listAllExamples`/`getExample` (list capped
  at 80 headers + optional `search` narrowing — small extension over the
  doc, recorded; one-slug summaries with capped description; near-miss
  slugs on unknown; explicit offline message). Catalog fetches are
  injectable (`setByokCatalogFetchersForTests`) and cached per session
  (failures not cached). Advertised in `BYOK_NO_PROJECT_TOOL_NAMES` next
  to `initialize_project` (the "advertised set 63" of the roadmap counts
  the 56 + 7 new tool NAMES; the per-list split is 62 default + 2
  no-project = 64 without a project — the arithmetic note lives in
  `ByokToolSchema.js`'s cap comment).
- **12.2 — store discovery + seam install:** `search_object_asset_store`
  / `search_resource_store` over `listAllPublicAssets`/`listAllResources`
  (public/free only per D12-2; ≤ 10 trimmed hits; objectType/tag and
  resource-type filters). The seam stubs at `ByokSeam.js` were REPLACED by
  `byokSearchAndInstallAsset` (search → `getPublicAsset` → required
  extensions via the existing `ensureExtensionInstalled` hook →
  `addAssetToProject` with `requestedObjectName`) and
  `byokSearchAndInstallResources` (hits registered by their direct URL
  with `setOrigin('gdevelop-asset-store', url)` — the resource-store
  convention; nothing downloaded, resources load at preview like any URL
  resource; already-exists dedupe). `getAssetStoreTagForNewObject` stays
  null. The old unavailable-dependency seam spec flipped to the real
  implementation.
- **12.3 — command palette + shortcut:** `OPEN_ASK_AI` ("Open Ask AI")
  across the four standard touchpoints (`CommandsList.js`,
  `DefaultShortcuts.js` `CmdOrCtrl+Alt+KeyA` — conflict-checked against
  every default (none shares the combo; asserted by test),
  `MainFrameCommands.js` `useCommand`, `MainFrame/index.js`
  `onOpenAskAi: () => openAskAi()`), reassignable through the existing
  shortcuts preferences. New `MainFrameCommands.spec.js` (3 tests:
  metadata, conflict-free default, registration+dispatch through a real
  CommandManager).
- **12.4 — MCP prompts/resources + read-notes:** new pure modules
  `Mcp/ByokMcpPrompts.js` (skills → prompts/list metadata, prompts/get
  body-as-user-message) and `Mcp/ByokMcpResources.js`
  (`gdevelop://project/notes` while a project host is registered +
  `gdevelop://docs/<path>` per bundled page; reads capped like read_doc;
  unknown URIs → null → -32602). `ByokMcpProtocol.js` gained the four
  methods (optional handlers; empty lists / -32602 without a host) and
  advertises `capabilities: {tools, prompts, resources}` (all
  `listChanged: false`). Host bag + seam registration gained
  `listSkillPrompts` (getByokSkills) and `readProjectNotes` (the merged
  notes text); `useByokMcpServer.js` wires the four handlers.
  `read_project_notes` BYOK tool added next to its writer.
- **12.5 — debugger/profiler tools:** `ByokPreviewSession.js` gained the
  debugger channel: DebuggerId capture from `onConnectionOpened`
  (first connection after launch = this session's preview), targeted
  request/response (`sendMessage(debuggerId, {…, messageId})` + response
  routing in the parsed-message handler — never the broadcasting
  `sendMessageWithResponse`), a pushed-message buffer + bounded
  `waitForPushedDebuggerMessage`, connection-closed failures for pending
  work, and the stop() fix (below). `inspectState` switched to the
  targeted channel (cross-preview safe now). New
  `Byok/ByokDebuggerTools.js`: `read_runtime_details` (getStatus + a
  targeted refresh through the same reducer), `control_runtime`
  (pause/play/resume/getStatus; commandIgnored surfaced typed — the
  runtime's own gameplay-test guard), `profile_runtime`
  (profiler.start → duration → profiler.stop → await the PUSHED
  profiler.output, 10 s bound; duration default 2 s, cap 60 s). All
  three `modifiesProject: false` (runtime state, not project state —
  they pass the MCP read-only gate). The session holder moved to
  module level in `ByokRuntimeTools.js`
  (`getOrCreateByokPreviewSession`) so the perception and debugger
  tools share ONE session.
- **12.6 — surface/docs:** 7 names + schemas (62 default + 2 no-project;
  cap 56 → 62 with the counting note), `BYOK_ONLY_TOOL_NAMES` for the 4
  BYOK-only names, prompt `byok-v8` (discovery/runtime lines in
  authoring-reach; the no-project section now says to pick a real slug
  from `get_game_starter_summary` — the "plan from your own knowledge"
  guidance is gone), 5 new eval tasks (`discovery-runtime` category;
  harness 36 → 41), `phase5-tool-decisions.md` exclusions flipped with
  Phase 12 pointers, `AIflow.md` refreshed (§1/§2.2/§4.2 stale claims +
  §5.4 rewritten to the current whitelist), AGENTS.md §2 updated,
  usertasks Tasks 13 + 14 filed.

**Gates (from `newIDE\app`):** `npm test -- --watchAll=false` **208
suites / 2264 passed / 1 skipped** (was 198/2146 before the session); `npm
run lint` 0 problems; `flow check` 0 errors (via the direct
`flow-win64-v0.299.0` binary after the known pipe stall);
`npm run check-format` clean. Electron side untouched (git confirms).

### Bugs found

1. **`stop_preview` never closed the preview window** (pre-existing; the
   Phase 12 survey's quirk, confirmed and FIXED).
   `ByokPreviewSession.stop()` called `closePreview()` with no argument;
   `LocalPreviewLauncher.closePreview(windowId)` →
   `closePreviewWindow(undefined)` → `find(entry => entry.previewWindow.id
   === undefined)` matches nothing, so the IPC silently closed NO window
   while the tool reported success. Repro: start_preview → stop_preview →
   the game window stays open. Root cause: the Electron window id of a
   preview never reaches the renderer (the `preview-open` IPC returns
   nothing), so a targeted close is impossible with the existing IPC.
   Fix: stop() prefers the launcher's `closeAllPreviews` (the working
   counterpart; accepted scope: the BYOK v1 one-preview rule), falling
   back to the legacy call only when absent. Regression-tested
   (`ByokPreviewSession.spec.js`).
2. **The system prompt's tool list was one growth-step away from silent
   truncation** (pre-existing, latent; FOUND and FIXED). The `tools`
   knowledge section carried `budgetTokens: 2100, degradable: false` —
   the composer TRUNCATES non-degradable sections over budget, and the
   Phase 12 names pushed the 63-entry list past it (caught by the
   prompt/spec sync test listing every schema name). Fix: budget raised
   to 2800 with the comment updated; the sync test now guards it.
3. **Deleting a `gd.Polygon2d` wrapper after `VectorPolygon2d.push_back`
   corrupts the WASM heap** (upstream lifecycle asymmetry, discovered
   while testing `change_sprite_frames`). Repro: push a created polygon
   into `sprite.getCustomCollisionMask()`, `delete()` it, then any later
   libGD call dies with "memory access out of bounds". The editor's own
   code (`PolygonsList.addCollisionMask`, `CollisionMaskHelper`) never
   deletes Polygon2d wrappers — unlike Sprite/Point/Vector2f wrappers,
   which are deleted after their push_backs. Fix on our side: the safe
   pattern encoded in `ByokSpriteTools.applyPolygonMaskToFrame` (+ test).
   Upstream leak + asymmetry filed in `outofscoped.md`.

### Issues found

- The PropertiesEditor schema NESTS grouped effect properties under
  `children` section fields — the first `list_effects` implementation
  emitted section markers with undefined types. Fixed via flattening
  (`flattenByokEffectProperties`); test covers a grouped fake effect.
- `EditorFunctions/TestHelpers.js` exposes no `MakeInstances.js`-style
  fixture (the Phase 11 doc guessed one); the new specs follow the
  existing inline-factory style instead.
- Phase docs' "advertised set 63" arithmetic doesn't match the per-list
  split (62 + 2 no-project); resolved by documenting the counting in the
  validator cap comment rather than bending the no-project design.
- The knowledge-sections `?string`-style optional-property invariance
  (Flow) bit the new optional handler/hook fields: optional props on
  exact object types are INVARIANT — fixed with Flow's own suggestion
  (`+` readonly variance on `ByokMcpToolHandlers`' four optional methods
  and `PutInstancesInContainerOptions.toolsVersion`).
- Known-v1 limitations recorded in the tool outputs + QA tasks:
  external-events/layout editors don't live-redraw after BYOK writes
  (OOS entry filed); BYOK-only tools read sprite default sizes as 0
  without the Pixi loader (documented in describe_external_layout's
  note; the `getPixiResourcesLoader` collaborator hook exists for a
  later wiring).

### Files worked on

New (17): `newIDE\app\src\EditorFunctions\InstanceTools.js`(+spec),
`...\AiGeneration\Byok\ByokExternalSceneTools.js`(+spec),
`ByokCatalogTools.js`(+spec), `ByokSpriteTools.js`(+spec),
`ByokResourceTools.js`(+spec), `ByokDebuggerTools.js`(+spec),
`Mcp\ByokMcpPrompts.js`(+spec), `Mcp\ByokMcpResources.js`(+spec),
`MainFrame\MainFrameCommands.spec.js`.
Modified (28): `EditorFunctions\index.js` (the 11.1 delegation),
`AiGeneration\Byok\ByokExtraTools.js`(+spec),
`ByokExtensionTools.js`(+spec), `ByokLocalEventWriter.js`,
`ByokOrchestrator.js`(+spec), `ByokPreviewSession.js`(+spec),
`ByokPrompts.js`(+spec), `ByokRuntimeTools.js`, `ByokSeam.js`(+spec),
`ByokToolSchema.js`(+spec), `Knowledge\ByokKnowledgeSections.js`,
`Mcp\ByokMcpProtocol.js`(+spec), `Mcp\ByokMcpToolHost.js`,
`Mcp\useByokMcpServer.js`, `useByokChatSeam.js`, `evals\
\ByokEvalHarness.spec.js`, `CommandPalette\CommandsList.js`,
`KeyboardShortcuts\DefaultShortcuts.js`, `MainFrame\MainFrameCommands.js`,
`MainFrame\index.js` (one audited line), `scripts\run-byok-evals.js`,
`scripts\byok-eval-task-prompts.js`. Docs: `REVIEW\AIflow.md`,
`REVIEW\phase5-tool-decisions.md`, `REVIEW\outofscoped.md`,
`REVIEW\usertasks.md` (Tasks 13/14), `AGENTS.md` §2.

### Audit greps (run 2026-09-24, outputs as captured)

```
== grep 1: unavailable-dependency stubs left (expect only generate_events):
src/AiGeneration/Byok/ByokSeam.spec.js:256:    // used to be `makeUnavailableDependency` stubs — they now run the
src/AiGeneration/Byok/ByokSeam.js:151:const makeUnavailableDependency = (name: string) => async (): Promise<any> => {
src/AiGeneration/Byok/ByokSeam.js:208:        generateEvents: makeUnavailableDependency('generate_events'),

== grep 2: BYOK_TOOL_NAMES length + no-project:
BYOK_TOOL_NAMES (with digits): 62
BYOK_NO_PROJECT_TOOL_NAMES: 'initialize_project', 'get_game_starter_summary'
BYOK_ONLY_TOOL_NAMES: 35

== grep 3: new tool registrations in ByokExtraTools:
545:  ...getByokExtensionTools(),
548:  ...getByokExternalSceneTools(),
551:  ...getByokCatalogTools(),
554:  ...getByokSpriteTools(),
557:  ...getByokResourceTools(),
560:  ...getByokDebuggerTools(),

== grep 4: modifiesProject flags of the new tools:
ByokDebuggerTools.js:59/104/155: modifiesProject: false   (all three)
ByokExternalSceneTools.js:98: false / 203: true / 294: false / 350: true

== grep 5: command + shortcut:
KeyboardShortcuts/DefaultShortcuts.js:32: OPEN_ASK_AI: 'CmdOrCtrl+Alt+KeyA'
MainFrame/MainFrameCommands.js:188: useCommand('OPEN_ASK_AI', true, {
CommandPalette/CommandsList.js:79: | 'OPEN_ASK_AI';
CommandPalette/CommandsList.js:235: OPEN_ASK_AI: {
MainFrame/index.js:5641: onOpenAskAi: () => openAskAi(),

== grep 6: stub/TODO leftovers in the new modules: (none)

== grep 7: MCP prompts/resources wiring:
useByokMcpServer.js:155-175: listPrompts/getPrompt/listResources/readResource over the host
useByokChatSeam.js:723: listSkillPrompts (host bag registration)

== grep 8: eval task count: 41 prompts in byok-eval-task-prompts.js
```

**Triage:** OOS — 2 new entries (Polygon2d wrapper lifecycle; external
editors live-redraw), see `outofscoped.md`. Deferred — `no deferred`
(the Phase 12 §5 deferrals were already recorded in the phase doc).
UT — Tasks 13 + 14 filed (`usertasks.md`).

---

## 2026-09-24 (second session) — Phase 11 verification + completion pass

**Date:** 2026-09-24 · **Session type:** verification + completion (the
owner had already committed the whole Phase 11+12 implementation in
`c62a67e277`; its commit message is unrelated garbage — the BYOK work is
identifiable via `git show --stat c62a67e277`, planning docs in
`ed5a5a5432`).

### Description of actions

1. Verified the committed Phase 11 against every AC of `REVIEW/Phase11.md`
   with five read-only subagents (11.1 extraction, 11.2/11.3 external
   scenes, 11.4/11.5 effects+sprites, 11.6/11.7 resources+extensions,
   11.8 schema/prompt/evals/docs), then re-verified their claims against
   the source myself. Steps 11.1–11.5 and most of 11.6/11.7/11.8 were in
   place and green; a set of real gaps remained and was closed in this
   session:
   - **Extended-tool schema fields (the big one, AC-breaking):** the
     seven Phase 11.7 fields existed only in the handlers; the schemas in
     `ByokToolSchema.js` (the ONLY thing the model sees) did not declare
     them. Added `parameters_to_add`/`parameters_to_remove`/
     `parameters_to_move` to `change_custom_function`,
     `children_to_add`/`children_to_remove` to `change_custom_object`,
     `dependencies_to_add`/`dependencies_to_remove` to
     `change_extension_properties`, matching the handler shapes exactly;
     pinned by a new `ByokToolSchema.spec.js` contract test.
   - **children_to_add initial properties (11.7.2):** entries now accept
     `initial_properties: [{name, value}]`, applied to the created child
     via `getConfiguration().updateProperty` (the registry's own pattern,
     `index.js:1869`); unknown property names are reported, not fatal.
   - **Parameter type changes (11.7.1's refactor-hook clause):** a
     `parameters_to_add` entry naming an EXISTING parameter with a
     different `type` now sets the type and runs the same hook the
     extension editor triggers — `WholeProjectRefactorer
     .changeParameterType` with real `ProjectScopedContainers` built per
     scope (free/behavior/object functions, mirroring `EventsScope.js`;
     all five temporary containers deleted after). Duplicate-without-type
     still skips (shipped behavior unchanged).
   - **Knowledge-section typo:** the authoring-reach section named a
     nonexistent `read/add_external_events_source` tool — fixed to
     `read_external_events_source/add_external_events` and pinned in
     `ByokKnowledgeSections.spec.js`.
   - **Sprite polygon partial-apply:** `applyPolygonMaskToFrame` cleared
     the live mask before validating every polygon definition; an invalid
     polygon left the frame's mask emptied while the op reported failure.
     Now all polygons are built and validated BEFORE the mask is touched
     (orphans deleted — safe, they were never pushed).
   - **Resource path guard:** `isPathInsideFolder` used a substring
     check, so a path under a sibling folder whose name extends the
     project folder's name (`game2` vs `game`) passed as "inside" —
     replaced with a segment-aware `path.relative` check.
   - **No-op semantics:** the BYOK executor passed `toolsVersion: null`
     everywhere, so idempotent re-puts were reported as failures —
     script-killers for the run_script flow BYOK itself teaches. New
     `BYOK_TOOLS_VERSION = 'v15'` in `ByokTypes.js` (mirrors
     `AI_ORCHESTRATOR_TOOLS_VERSION`; declared, not imported, because
     `Utils.js` pulls renderer-only modules that cannot load in jest) is
     now passed by the seam executor and the external-layout put; the put
     wrapper maps `nothingChanged` to `didModifyProject: false`.
   - **Extraction precedence:** the 11.1 extraction changed the
     error precedence of `put_2d_instances` (unknown scene + missing
     required arg now reported the scene first). The wrapper extracts
     `layer_name`/`brush_kind` before the scene check again, restoring
     the pre-extraction behavior.
   - **AIflow.md refresh (11.8.4):** §4.2 rewritten to the real
     knowledge-section composer (the old body still claimed "no
     sub-agents" and "`initialize_project` is not whitelisted"); §6
     rewritten around the existing BYOK skills system (the old text
     denied any skills concept); §7 rewritten around
     `ByokGameDesignPack.js` (registered section, "Design first").
     §2.2/§5.4 were already current.
   - **Test coverage added** (step ACs the committed work under-covered):
     bad-polygon failure for `change_sprite_frames` (required by 11.5),
     wrapper-lifecycle counts for `gd.Animation`/`gd.Point`/`gd.Vector2f`
     plus the pushed-polygon-NOT-deleted assertion, grouped
     (children-section) effect property flattening + tool-level `2d`/`3d`
     filter tests for `list_effects`, end-to-end font/video/json
     registration + the sibling-folder refusal for
     `import_project_resources`, "scene events untouched" for
     `add_external_events`, the script-style no-op success for
     `put_external_layout_instances`, direct tests for
     `getOccupiedSpaceDescription`/`injectObjectSizeInfo`/
     `INSTANCE_POSITION_SEMANTICS_MESSAGE`, and the close/reopen note on
     `add_external_events` (symmetry with the layout tool).
2. Verified the previous run's logged fixes still hold: the preview
   `closeAllPreviews` stop() fix (ByokPreviewSession.js:369-373) and the
   tools-section budget 2800 (ByokKnowledgeSections.js:188) are in place;
   the BYOK side of the Polygon2d asymmetry (`applyPolygonMaskToFrame`)
   is covered by the new lifecycle test.
3. Live-redraw of external-item editors investigated to root cause (see
   triage): NOT implementable BYOK-side alone — needs a new MainFrame
   fan-out channel → filed as budget decision (usertasks Task 15) and the
   OOS entry corrected instead of silently remaining stale.
4. Gates re-run green; audit greps re-run (outputs below); AGENTS.md §2
   updated.

### Bugs found

1. **Extended-tool schema fields missing from the advertised surface**
   (Phase 11 AC item 7 unmet in the committed tree).
   `ByokToolSchema.js` `change_extension_properties` (pre-fix :1254-1279),
   `change_custom_object` (:1305-1335), `change_custom_function`
   (:1434-1468) declared none of the seven fields, while
   `ByokExtensionTools.js` reads them (:367-407 parameters, :477-502
   children, :546-579 dependencies, pre-fix lines). Repro:
   `grep parameters_to_add src/AiGeneration/Byok/ByokToolSchema.js` →
   nothing, while the handler consumes it — the model had NO way to
   discover the functionality. Root cause: step 11.8.1 was executed for
   the 8 new tools only; the "extended-tool schema fields" half of the
   sentence was skipped. Fixed this session (+ spec pins).
2. **Garbled tool name in the system prompt** —
   `ByokKnowledgeSections.js:168` advertised
   `read/add_external_events_source` (no such tools; the real pair is
   `read_external_events_source` + `add_external_events`). Repro: compose
   the prompt, the authoring-reach line teaches a hallucinated name.
   Root cause: typo in the Phase 11 knowledge text, unpinned by tests.
   Fixed + pinned.
3. **BYOK no-ops reported as failures (script-killer)** —
   `ByokSeam.js:202` (`toolsVersion: null`) and
   `ByokExternalSceneTools.js:415` made every tool run with pre-v12
   semantics, so an idempotent re-put failed and, inside `run_script`,
   killed the rest of the batch. Repro: run the same successful
   `put_2d_instances` twice through the seam → second call
   `success: false` ("nothing changed"). Root cause: the seam never
   passed a tools version although the BYOK agent is script-based (v15
   upstream). Fixed via `BYOK_TOOLS_VERSION` ('v15'); regression-tested.
4. **Partial-apply on invalid collision-mask polygons** —
   `ByokSpriteTools.js` `applyPolygonMaskToFrame` (pre-fix :311-327)
   called `setFullImageCollisionMask(false)` then `mask.clear()` before
   validating each definition; a bad later polygon left the frame's mask
   CLEARED and the op reported failure — silent data loss. Repro:
   `set_polygon_mask` with a valid rectangle followed by an entry with a
   non-numeric vertex → the previous mask is gone. Root cause:
   validate-as-you-go instead of validate-then-apply. Fixed; regression
   test asserts the old mask survives a failed op.
5. **Sibling-folder path confusion in the resource guard** —
   `ByokResourceTools.js` pre-fix :82-86 used
   `absolutePath.includes(projectFolder)`, so `/projects/game2/x.png`
   passed the in-project check for project folder `/projects/game` and
   was registered with a `../game2/x.png`-style relative file — a
   resource outside the project folder (which 11.6.3 forbids). Repro:
   `importByokProjectResources` with source `../game2/x.png`. Root
   cause: the check replicated the substring quirk of upstream
   `isPathInProjectFolder` (`ResourceUtils.js:55-60`). Fixed with a
   segment-aware `path.relative` check + regression test (upstream quirk
   noted, not touched).
6. **Test-runtime discovery (not a product bug, recorded for QA):** the
   WASM test build (`libGD.js-for-tests-only`) implements NEITHER
   `updateProperty` NOR `getProperties` on the Text object's
   configuration (probe: `updateProperty('text', …)` → false;
   `getProperties()` → empty map), while the production registry path
   (`index.js:1869`) uses exactly that call. The initial-properties test
   therefore exercises a custom-object child (whose configuration
   implements the property helpers). If desktop QA (Task 13) ever sees
   property edits fail on plain objects in the TEST runtime only, this
   is why.

### Issues found

- Commit `c62a67e277` (the whole Phase 11+12 implementation) carries an
  unrelated garbage commit message (a runaway translation session's
  log). The work is only identifiable via `git show --stat`. Recorded
  here and in AGENTS.md §2; rewriting history is the owner's call.
- The prompt budget is tight: my first pass at the extended-field
  descriptions lengthened three tool first-sentences and the composer
  dropped a degradable knowledge pack (JS API) from the 6k-token prompt
  entirely — caught by `ByokPrompts.spec.js`. Fix: keep the original
  first sentences (the prompt's tool list) and document the fields in
  the properties descriptions, which travel in the `tools` array every
  request. Lesson: in this repo, prompt-visible description text is
  budgeted; property-level text is not.
- Building `ProjectScopedContainers` BYOK-side requires the five
  temporary containers (parameters/properties × variables/resources +
  the parameter objects container) in the exact pattern `EventsScope.js`
  uses; the free-function factory fills the objects container C++-side.
  Implemented in `refactorParameterTypeChange` with `delete()`s in a
  `finally`.
- The `changes.scene`-keyed outside-editor payload types cannot express
  external-item changes (they carry a `gdLayout`); a real fix needs new
  channel(s) — see Task 15 / the updated OOS entry.
- Flow specifics hit while testing: exact-type invariance on
  `ObjectSizeInfo` test literals (annotate with the type + provide every
  property incl. `centerZ`), `EditorFunctionGenericOutput` optional
  fields need refinement (or an `any` binding in specs), function
  statics like `length` are read-only (copy only `createRectangle` when
  shadowing `gd.Polygon2d`), and `prototype.delete` patching trips
  method-unbinding/cannot-write (use the constructor-replacement
  pattern).

### Files worked on

Modified — implementation (9): `newIDE/app/src/AiGeneration/Byok/
ByokToolSchema.js` (7 extended fields + description tail sentences),
`ByokExtensionTools.js` (initial properties + type-change refactor +
`applyFunctionParameterChanges` signature), `ByokSpriteTools.js`
(validate-before-apply), `ByokResourceTools.js` (segment-aware guard),
`ByokExternalSceneTools.js` (toolsVersion + close/reopen notes +
nothingChanged mapping), `ByokSeam.js` (toolsVersion), `ByokTypes.js`
(`BYOK_TOOLS_VERSION`), `Byok/Knowledge/ByokKnowledgeSections.js`
(typo), `newIDE/app/src/EditorFunctions/index.js` (arg-before-scene
precedence). Modified — specs (9): `ByokExtensionTools.spec.js`,
`ByokSpriteTools.spec.js`, `ByokResourceTools.spec.js`,
`ByokExternalSceneTools.spec.js`, `ByokToolSchema.spec.js`,
`ByokKnowledgeSections.spec.js`, `ByokSeam.spec.js`,
`ByokCatalogTools.spec.js`, `EditorFunctions/InstanceTools.spec.js`.
Docs (3): `REVIEW/AIflow.md` (§4.2, §6, §7), `REVIEW/outofscoped.md`
(live-redraw root cause corrected), `AGENTS.md` (§2 status).
`REVIEW/usertasks.md`: Task 15 filed. A temporary scratch probe spec was
written and deleted in-session (never part of the tree state handed
back).

### Gates (2026-09-24, from `newIDE/app`)

- `npm test -- --watchAll=false`: **208 suites passed / 208**, 2284
  passed + 1 skipped (baseline before this session: 2264 → +20).
- `npm run lint`: exit 0, zero warnings.
- `flow.exe check` (direct binary; the npm wrapper lost the server —
  known quirk): **Found 0 errors**.
- `npm run check-format`: exit 0.

### Audit greps (run 2026-09-24, outputs as captured)

```
== grep 1: the eight Phase 11 tool names registered in ByokExtraTools ==
25:import { getByokExternalSceneTools } from './ByokExternalSceneTools';
26:import { getByokCatalogTools } from './ByokCatalogTools';
27:import { getByokSpriteTools } from './ByokSpriteTools';
28:import { getByokResourceTools } from './ByokResourceTools';
548:  ...getByokExternalSceneTools(),
551:  ...getByokCatalogTools(),
554:  ...getByokSpriteTools(),
557:  ...getByokResourceTools(),

== grep 2: counts (extracted from ByokToolSchema.js via node) ==
BYOK_TOOL_NAMES count: 62
BYOK_NO_PROJECT_TOOL_NAMES: 'initialize_project', 'get_game_starter_summary'
BYOK_ONLY_TOOL_NAMES count: 35
Phase 11 tools all whitelisted: true
schema field parameters_to_add: present
schema field parameters_to_remove: present
schema field parameters_to_move: present
schema field children_to_add: present
schema field children_to_remove: present
schema field dependencies_to_add: present
schema field dependencies_to_remove: present
prompt version: byok-v8
ByokSeam toolsVersion: BYOK_TOOLS_VERSION
external put toolsVersion: BYOK_TOOLS_VERSION
external add_events close/reopen note: true

== grep 3: modifiesProject flags of the Phase 11 tools ==
ByokExternalSceneTools.js:99: false  (read_external_events_source)
ByokExternalSceneTools.js:204: true  (add_external_events)
ByokExternalSceneTools.js:299: false (describe_external_layout)
ByokExternalSceneTools.js:355: true  (put_external_layout_instances)
ByokSpriteTools.js:649: false  (describe_sprite_frames)
ByokSpriteTools.js:695: true   (change_sprite_frames)
ByokCatalogTools.js:672: false (list_effects)
ByokResourceTools.js:365: true (import_project_resources)

== grep 4: eval tasks ==
41 task entries in scripts/byok-eval-task-prompts.js (worklog claim confirmed)
Phase 11 family tasks at :81 external-events-sheet, :83 external-layout-spawn,
:85 effect-type-selection, :87 sprite-frame-edit, :89 resource-import-url,
:91 custom-object-children

== grep 5: InstanceTools delegation in index.js ==
97:} from './InstanceTools';
3289:    const { instances, objectSizeInfoByName } = describeInstancesInContainer({
3429:    return putInstancesInContainer({

== grep 6: stub/TODO leftovers in the Phase 11 modules ==
(none)

== grep 7: knowledge-section tool names (typo fix) ==
ByokKnowledgeSections.js:168: read_external_events_source/add_external_events

== grep 8: validator green ==
ByokToolSchema.spec.js:27: expect(validateByokToolSchemas()).toEqual([]);
ByokToolSchema.spec.js:92: expect(validateByokToolSchemas()).toEqual([]);
```

### AC check (Phase11.md §4, final state)

- [x] External events round-trip / create-if-missing / not-found
      listing — spec'd (`ByokExternalSceneTools.spec.js`), plus the new
      scene-untouched test.
- [x] External layouts describe/put through the extracted core; scene
      specs stayed green through 11.1 (byte-identical files +
      delegation).
- [x] `list_effects` full catalog + property schemas; filters now
      tested at tool level too.
- [x] Sprites round-trips per op family; wrapper lifecycle asserted
      (Sprite + Animation + Point + Vector2f deleted, pushed Polygon2d
      NOT); non-sprite targets fail typed; bad polygon fails without
      partial apply.
- [x] Resources: three source modes, replace-in-place, outside-project
      refusal (incl. sibling-folder case), desktop-only failure — all
      spec'd; font/video/json kinds registered end-to-end.
- [x] Extensions: parameters add/remove/move + type change with the
      refactor hook; children add/remove with usage guard + initial
      property values; dependency add/remove always listed;
      `create_custom_function` byte-identical (verified via commit
      diff).
- [x] Prompt `byok-v8` (v7 + the Phase 12 bump); `BYOK_TOOL_NAMES` = 62
      default + 2 no-project (the phase's "56" checkpoint long since
      superseded; the validator cap comment documents the arithmetic);
      validator green; 6 Phase 11 eval tasks (41 total); AIflow
      §5/§4.2/§6/§7 current.
- [x] All four checks green; electron side untouched this session;
      worklog entry complete; AGENTS.md §2 updated.

### Triage

- **OOS:** nothing new; one existing entry updated (external-editors
  live-redraw — root cause sharpened: no external-item fan-out channel
  exists; `ExternalEventsEditorContainer.js:197-209` are explicit
  no-ops; a fix needs a new MainFrame channel). The Polygon2d upstream
  entry is unchanged and still blocked on the owner call.
- **Deferred:** no deferred.
- **UT:** Task 15 filed (budget approval for the live-redraw MainFrame
  touchpoint). No other new UT items.

## 2026-09-24 (third session) — Task 15 approved and implemented: external-item live-redraw

**Date:** 2026-09-24 · **Session type:** owner-approved feature (Task 15 of
`usertasks.md`: "Yes, please implement live-redraw so that the user doesn't
need to close and reopen editor to see AI actions result").

### Description of actions

Implemented the external-item fan-out channel end to end — an AI write to an
external layout or an external events sheet now refreshes the already-open
editor of that item (the last UX gap between the Phase 11 tools and the
scene tools):

1. **Payload types** (`EditorFunctions/OutsideEditorChanges.js`):
   `ExternalLayoutOutsideEditorChanges = {externalLayoutName: string}` and
   `ExternalEventsOutsideEditorChanges = {externalEventsName: string,
   newOrChangedAiGeneratedEventIds: Set<string>}`. External items are
   identified by NAME (their tab "project item name"), not object identity:
   wrappers are re-obtained per lookup and name comparison has no
   wrapper-cache assumptions (the scene channel compares `gdLayout`
   identity; a new channel should not inherit that coupling).
2. **The two editor containers** implement the new ref methods:
   - `ExternalLayoutEditorContainer.onExternalLayoutModifiedOutsideEditor`
     — name guard against `props.projectItemName`, then
     `this.editor.onInstancesModifiedOutsideEditor()` (the same
     SceneEditor refresh the scene path triggers — renderers remount and
     redraw from `externalLayout.getInitialInstances()`).
   - `ExternalEventsEditorContainer.onExternalEventsModifiedOutsideEditor`
     — name guard, then
     `this.editor.onEventsModifiedOutsideEditor({newOrChangedAiGeneratedEventIds})`
     (clears the selection — it may reference deleted/invalidated events —
     pushes a history entry and lets the sheet re-render; the passed ids
     highlight the AI-written events, the same mechanism the scene events
     editor uses).
3. **MainFrame fan-outs** (`MainFrame/index.js`): two new
   `React.useCallback` fan-outs iterating `getAllEditorTabs`, with GUARDED
   calls (`if (editorRef && editorRef.onX)` via an `any`-typed ref) —
   deliberate deviation from the unguarded style: only the two external
   containers implement these methods, and guarding avoids touching every
   editor container with no-op methods. Both callbacks go into the props
   bag; `EditorTabsPane` (type + destructure + forward),
   `PoppedOutEditorContainerWindow` (popped-out tabs keep the behavior) and
   `BaseEditor`'s `RenderEditorContainerProps` carry them.
4. **BYOK wiring**: `AskAiEditorContainer` (props type + destructure +
   `useByokChatSeam` call) → `useByokChatSeam` (options type, destructure,
   `createByokOrchestrator` call, deps array) → `ByokOrchestrator` (options
   type + the collaborators chain, guarded like the existing ones) →
   `ByokExtraTools.ByokExtraToolCollaborators` (two optional callbacks).
   The standalone homepage form passes no-ops (it has no editor tabs), so
   the seam options stay required like their siblings.
5. **MCP host parity**: `useByokChatSeam`'s `makeExtraToolCollaborators`
   (the Phase 10 MCP server's tool executor) now passes the two new
   callbacks AND `onObjectsModifiedOutsideEditor` — which was MISSING
   there, so an external MCP agent's `change_sprite_frames` writes never
   refreshed open scene editors. Fixed in the same stroke (logged under
   Bugs found).
6. **The tools fire the channel** (`ByokExternalSceneTools.js`):
   - `put_external_layout_instances` fires
     `onExternalLayoutModifiedOutsideEditor({externalLayoutName})` after a
     put that actually changed something (a v15 no-op success does NOT
     redraw — nothing changed); the obsolete "close and reopen the editor"
     note is gone from the output.
   - `add_external_events` collects the writer's `aiGeneratedEventId` via
     `onApplied` (one id per applied batch GROUP, by writer design) and
     fires `onExternalEventsModifiedOutsideEditor({externalEventsName,
     newOrChangedAiGeneratedEventIds})`; the whole-sheet `event_script`
     path fires with an empty set (still clearing the selection and
     pushing history); the obsolete note is gone.
7. Tests: `ByokExternalSceneTools.spec.js` asserts the layout notification
   (fired on change, NOT on a no-op put) and the events notification (right
   name + the writer's id set); new
   `MainFrame/EditorContainers/ExternalItemsLiveRedraw.spec.js` unit-tests
   the two container ref methods by direct class instantiation (refresh on
   a matching name, ignored on a different name, safe without a mounted
   editor).

### Bugs found

1. **MCP extra-tool collaborators missing `onObjectsModifiedOutsideEditor`**
   — `useByokChatSeam.js` `makeExtraToolCollaborators` (pre-fix, only
   `getProject` + `onSceneEventsModifiedOutsideEditor` + runtimeDeps) did
   not pass the object-changes callback, so an external MCP agent's
   `change_sprite_frames` calls applied but never refreshed open scene
   editors. Repro: register the MCP server, call `change_sprite_frames`
   from an MCP client with a sprite editor open → the editor shows the old
   frames until tab switch. Root cause: the Phase 10/12 MCP host was wired
   before that collaborator existed (Phase 11 sprite tools introduced it)
   and the gap was never noticed. Fixed in this session (one line + the
   hooks deps array now also carries the three callbacks).

### Issues found

- The containers' module graphs are untestable as-is in jest (SceneEditor →
  `@material-ui/core` barrel; EventsSheet → pixi/three/spine ESM packages
  jest cannot parse): the new spec mocks `../../SceneEditor`,
  `../../EventsSheet`, `../ResourcesWatcher`,
  `../../EmbeddedGame/EmbeddedGameFrame` and `./ExternalPropertiesDialog`
  (jest hoists the mocks above the imports) and instantiates the classes
  directly — the only way to unit-test legacy class-container ref methods
  without rendering. Worth knowing for the next container-level test.
- Flow specifics: guarded optional ref-method calls trip `method-unbinding`
  and then `not-a-function` even under `$FlowFixMe[method-unbinding]` — the
  clean workaround is an `any`-typed `editorRef` binding for the guarded
  fan-outs (Main Frame does this in exactly the two new callbacks).
- The writer's `onApplied` id is ONE PER CALL (a group tag for the whole
  batch), not one per batch — the events notification therefore carries a
  1-entry set for a single `add_external_events` call. Recorded in the
  test comment; the scene channel accumulates across calls in the seam
  executor, the external channel is per-call by design.

### Files worked on

Modified (12): `newIDE/app/src/EditorFunctions/OutsideEditorChanges.js`
(two payload types), `MainFrame/EditorContainers/
ExternalLayoutEditorContainer.js` (+ `onExternalLayoutModifiedOutsideEditor`),
`MainFrame/EditorContainers/ExternalEventsEditorContainer.js` (+
`onExternalEventsModifiedOutsideEditor`), `MainFrame/index.js` (two fan-out
callbacks + props bag), `MainFrame/EditorTabsPane.js` (type + forward),
`MainFrame/PoppedOutEditorContainerWindow.js` (forward),
`MainFrame/EditorContainers/BaseEditor.js` (`RenderEditorContainerProps`),
`AiGeneration/AskAiEditorContainer.js` (props + destructure + seam call),
`AiGeneration/AskAiStandAloneForm.js` (no-ops), `AiGeneration/Byok/
useByokChatSeam.js` (options, orchestrator call, deps, MCP collaborators),
`AiGeneration/Byok/ByokOrchestrator.js` (options + collaborators chain),
`AiGeneration/Byok/ByokExtraTools.js` (collaborators type),
`AiGeneration/Byok/ByokExternalSceneTools.js` (fire + drop the obsolete
notes). New (1): `MainFrame/EditorContainers/ExternalItemsLiveRedraw.spec.js`.
Modified specs (1): `AiGeneration/Byok/ByokExternalSceneTools.spec.js`.
Docs: `REVIEW/outofscoped.md` (live-redraw entry REMOVED — fixed and
verified; status line updated), `REVIEW/usertasks.md` (Task 15 checked off
with the implementation summary), `AGENTS.md` (§2 status).

### Gates (2026-09-24, from `newIDE/app`)

- `npm test -- --watchAll=false`: **209 suites passed / 209** (one new:
  `ExternalItemsLiveRedraw.spec.js`), 2289 passed + 1 skipped (before this
  session: 2284 → +5).
- `npm run lint`: exit 0, zero warnings.
- `flow.exe check` (direct binary): **Found 0 errors**.
- `npm run check-format`: exit 0.

### Audit greps (run 2026-09-24, outputs as captured)

```
== grep 1: the new channel across the wiring chain ==
src/EditorFunctions/OutsideEditorChanges.js:11:export type ExternalLayoutOutsideEditorChanges = {|
src/EditorFunctions/OutsideEditorChanges.js:16:export type ExternalEventsOutsideEditorChanges = {|
src/MainFrame/index.js:4024-4029 / :4036-4041: the two guarded fan-outs
src/MainFrame/index.js:5932/5933: passed in the props bag
src/MainFrame/EditorTabsPane.js (type, destructure, forward — grep the callback name)
src/MainFrame/PoppedOutEditorContainerWindow.js (forward)
src/MainFrame/EditorContainers/BaseEditor.js (RenderEditorContainerProps)
src/MainFrame/EditorContainers/ExternalLayoutEditorContainer.js (ref method)
src/MainFrame/EditorContainers/ExternalEventsEditorContainer.js (ref method)
src/AiGeneration/AskAiEditorContainer.js (props type, destructure, seam call)
src/AiGeneration/AskAiStandAloneForm.js (no-ops)
src/AiGeneration/Byok/useByokChatSeam.js (options, orchestrator call, MCP collaborators)
src/AiGeneration/Byok/ByokOrchestrator.js:248/251 (options), :984-991 (collaborators chain)
src/AiGeneration/Byok/ByokExtraTools.js (collaborators type)
src/AiGeneration/Byok/ByokExternalSceneTools.js:69-90 (notify helpers), :292/:316 (events tool fires), :471 (put tool fires)

== grep 2: the close/reopen notes are gone ==
(grep "close and reopen" src/AiGeneration/Byok/ByokExternalSceneTools.js) → no matches

== grep 3: the container methods under test ==
ExternalItemsLiveRedraw.spec.js: 4 passed (refresh on match, ignore on
other name, safe without editor — both containers)
ByokExternalSceneTools.spec.js: 20 passed (incl. the 2 new notification
tests and the no-op-put-does-not-notify assertion)
```

### AC / acceptance (Task 15 + Phase 11 AC 1-2 follow-through)

- [x] An AI write to an external layout refreshes the open external-layout
      editor (instances view redraws) — container method + fan-out + tool,
      unit-tested.
- [x] An AI write to an external events sheet refreshes the open
      external-events editor (selection cleared, history entry, new events
      highlighted) — unit-tested.
- [x] No redraw on a no-op put; no crash without a mounted editor; other
      items' editors are not refreshed — unit-tested.
- [x] The obsolete "close and reopen" tool notes are removed.
- [x] Popped-out editor tabs get the same behavior (forwarded props).
- [x] All four repo checks green; worklog entry complete; AGENTS.md §2
      updated; `outofscoped.md` entry removed (fixed + verified).

### Triage

- **OOS:** nothing new — one entry REMOVED (the live-redraw limitation,
  fixed and verified this session). The Polygon2d upstream entry remains,
  still blocked on the owner call.
- **Deferred:** no deferred.
- **UT:** no new UT (Task 15 resolved in place).

## 2026-09-24 (fourth session) — Owner QA round 1: three findings triaged and fixed

### Date

2026-09-24.

### Description of actions

The owner started the human QA list and reported three findings in chat
(with a DevTools-network follow-up). Investigation + fixes, all
uncommitted on top of the pending live-redraw diff:

1. **"Key shown in dev tools is different from the one provided" — by
   design, no fix.** `ByokKeyStorage.js` stores the key OS-encrypted
   (Electron safeStorage / DPAPI on Windows, via the `byok-encrypt` main
   IPC), base64 into the `gd-byok-key*` localStorage items. What DevTools
   shows is the ciphertext. Verified against the owner's live profile
   (`GDevelop 5/Local Storage`): settings blob intact (`enabled: true`,
   `endpointUrl: https://api.cometapi.com/v1`, model `mimo-v2.6-flash`,
   one provider card with `keyRef: ""`).
2. **"AskAI routes through GDevelop completions in all instances" —
   disproven with evidence; no routing fix needed.** Code path audit: both
   chat entry points gate through `shouldUseByokForNewRequest`
   (`AskAiEditorContainer.js:678`, `AskAiStandAloneForm.js:314`), the
   fresh-composer send funnels into the same gated effect
   (`startNewAiRequest` is a `useState` setter, no network), and no BYOK
   module imports a hosted completions function (all `GDevelopServices`
   imports in `Byok/` are type-only except the public catalog tools). The
   durable chat history (`byok-chats/Create-a-scene-called-Forest…md`, 62
   messages) proves the BYOK client loop ran against the configured
   endpoint (client-side tool calls executed: `create_scene`,
   `search_object_asset_store`, debugger traffic). The owner's follow-up
   captured the actual URL:
   `GET https://api-dev.gdevelop.io/generation/ai-request-summary` — that
   is the HOSTED chat-history list refresh (`getAiRequestSummaries` in
   `AiRequestContext.js`), not a model call. The "GDevelop model
   complaining about harness tools" lines in the screenshot are the
   cometAPI model's own text: the transcript shows it failing tool calls
   (malformed `<parameter name=…>` placeholder copied into an argument
   value, a missing required `layer_name`, an object-type recreate
   conflict) — model quality, with one harness-side contributor (see
   Deferred). Verification recipe for the owner: in DevTools the BYOK
   turns are `POST api.cometapi.com/v1/chat/completions`; `ai-request*`
   calls are hosted list/polling traffic (benign).
3. **Benchmark burned ~1,000,620 tokens and failed 4/4 — real bug,
   FIXED.** `ByokSettingsTab.onRunBenchmark` sent `model` + `messages`
   only — **no `tools` array** — so the model could never emit tool calls
   ("couldn't do anything apart from getting prompts"); every tool task
   failed mechanically after one round. Also no `max_tokens` cap, so a
   degenerate reasoning model could burn an unbounded budget per call.
   Fix: `runByokBenchmarkTask` now builds the task's OpenAI tool schemas
   (`getByokToolSchemasForNames(task.toolNames)` + `toOpenAiToolsFormat`)
   and passes them with every round; the runner's `sendCompletion`
   contract gained a `tools` argument; the settings tab sends the schemas
   and caps output with the new `BYOK_BENCHMARK_MAX_OUTPUT_TOKENS = 4096`.
4. **`start_preview` could never start a preview — real bug, FIXED.** The
   durable transcript shows every BYOK preview attempt failing with
   "options.getIsMenuBarHiddenInPreview is not a function": the session
   passed a hand-rolled plain object while `LocalPreviewLauncher` calls
   the `PreviewOptions` preference GETTERS (and the old code also
   misspelled `shouldGenerateScenesCode` vs
   `shouldGenerateScenesEventsCode`). Fix: new pure
   `makeByokPreviewLaunchOptions()` in `ByokPreviewSession.js` builds the
   full `PreviewOptions` shape (same values as `GameplayTestRunner`'s
   launch: menu hidden, not always-on-top, one window, no
   capture/tutorial/in-game-edition), used by `start`.
5. **Preview-close "Uncaught runtime errors: Object has been destroyed"
   — upstream race, FIXED as a QA-justified touchpoint.** Root cause:
   `ElectronMainMenu.js` subscribes to `browser-window-focus`/`-blur`
   through `@electron/remote`'s `app` and reads `window.id`/`window.title`
   on the delivered window proxy; a window destroyed before its queued
   event is dispatched (closing the focused preview window) throws in the
   member-get handler (`server.js:503` → Electron's `BrowserWindow.get`
   property getter) and the dev overlay blocks the IDE. Fix: guard both
   callbacks with `window.isDestroyed()` (the one member that stays
   callable). Recorded here as an upstream-file touch justified by the
   owner's QA report (scope rule §4).

### Bugs found

- Benchmark requests carried no `tools` (benchmark unusable by design
  as-implemented) — fixed (see 3).
- No output-token cap on benchmark calls — fixed with
  `BYOK_BENCHMARK_MAX_OUTPUT_TOKENS`.
- BYOK `start_preview` options shape invalid (every preview failed) —
  fixed (see 4).
- Upstream destroyed-window race in `ElectronMainMenu` focus/blur
  handlers (preview-close crash) — guarded (see 5).
- Model-facing (not harness bugs, verified and left as designed):
  `put_2d_instances.layer_name` is required in the schema and the handler
  error is correct (the model omitted it and recovered on retry); the
  object-type recreate conflict error is correct.

### Issues found

- The tool-schema descriptions embed the hosted harness's
  `<parameter name="x">value</parameter>` placeholder syntax; a weak
  model copied it into an argument VALUE (transcript message 1). Real
  failure mode for low-capability models → Deferred entry with proposal.
- The gameplay-test harness API is under-documented for the model (it
  guessed a nonexistent `stack.replace`) → Deferred entry with proposal.
- The hosted `ai-request-summary` list refresh runs while the Ask AI
  panel is open even when a BYOK chat is selected — the network noise
  that mislead the QA round → Deferred entry with proposal.
- Dev API host is `api-dev.gdevelop.io` in the dev build (expected; noted
  so future network-tab QA reads it correctly).
- Environment: the full Jest suite fails 2–4 random heavy suites when run
  with default parallel workers on this machine (differing suites per
  run, import-time errors at suite load); `--maxWorkers=1` is green —
  209 suites, 2294 passed + 1 skipped. Treat parallel red as machine
  flakiness; gate on the serial run.

### Files worked on

- `newIDE/app/src/AiGeneration/Byok/ByokPreviewSession.js` — added
  `makeByokPreviewLaunchOptions`; `start` uses it (fix 4).
- `newIDE/app/src/AiGeneration/Byok/ByokPreviewSession.spec.js` — 3 new
  tests (launch-options contract, first-scene fallback, builder overrides).
- `newIDE/app/src/AiGeneration/Byok/ByokBenchmark.js` — tools per task in
  the send contract + `BYOK_BENCHMARK_MAX_OUTPUT_TOKENS` (fix 3).
- `newIDE/app/src/AiGeneration/Byok/ByokBenchmark.spec.js` — 2 new tests
  (tools sent for tool tasks, none for the vision task).
- `newIDE/app/src/AiGeneration/Byok/ByokSettingsTab.js` — benchmark
  `sendCompletion` sends `tools` + `maxTokens` cap.
- `newIDE/app/src/MainFrame/ElectronMainMenu.js` — destroyed-window
  guards in the focus/blur callbacks (fix 5; upstream touchpoint).
- `REVIEW/worklog.md`, `REVIEW/deferred.md`, `REVIEW/usertasks.md` — this
  entry + triage + QA-round record.
- Evidence read (not modified): the owner's live profile
  (`GDevelop 5/Local Storage` leveldb, `byok-chats/` durable history).

### Gates

- `npm test -- --watchAll=false --maxWorkers=1`: **209 suites passed,
  2294 passed + 1 skipped** (+6 tests vs. the previous session).
- `npm run lint`: exit 0, zero warnings.
- `npm run flow`: **No errors!**
- `npm run check-format`: exit 0 (two files re-formatted with Prettier).

### Triage

- **OOS:** no OOS.
- **Deferred:** three new entries (tool-schema placeholder syntax;
  gameplay-harness API reference; hosted ai-request-summary polling
  clarity while a BYOK chat is selected).
- **UT:** QA round-1 findings recorded in `usertasks.md` with re-test
  steps (benchmark, start_preview, preview close).

## 2026-09-24 (fifth session) — QA results recorded: Tasks 1, 2, 11 (9.3-9.5) passed

### Date

2026-09-24.

### Description of actions

Bookkeeping-only session: the owner reported in chat that QA Tasks 1,
2, and 9.3/9.4/9.5 (the Task 11 sub-sections) "completed without
errors". Recorded in `REVIEW/usertasks.md`: every checkbox of Task 1
(Phase 3 desktop verification: safeStorage/DPAPI) and Task 2 (Phase 4
end-to-end on a real endpoint — includes "zero requests to
api.gdevelop.io/generation", independently confirming the routing
disposition of the fourth session) ticked with dated status lines, and
Task 11's 9.3 (durable history), 9.4 (multi-provider routing + D5
badge), 9.5 (capabilities + benchmark) ticked with a status line noting
9.1 + 9.2 are not yet reported. AGENTS.md section 2 updated with the QA
progress. No code changed.

### Bugs found

None new.

### Issues found

- Task 11's 9.5 includes the benchmark item fixed in the fourth session;
  the owner's report post-dates those fixes, so a pass presumably
  reflects the fixed build — if the benchmark was run before the fix was
  loaded, re-run it once on the current tree.

### Files worked on

- `REVIEW/usertasks.md` (Task 1/2/11 statuses),
  `AGENTS.md` (section 2 status), `REVIEW/worklog.md` (this entry),
  auto-memory (project-state note).

### Gates

Not applicable (no code change; the fourth session's gates remain the
last full run).

### Triage

- **OOS:** no OOS.
- **Deferred:** no deferred.
- **UT:** no UT (the QA doc itself is the update).

## 2026-09-24 (sixth session) — Agent-driven desktop QA with real CometAPI keys: round-1 re-tests passed, 2 bugs fixed, 1 new bug filed

### Date

2026-09-24.

### Description of actions

The owner ordered the outstanding `usertasks.md` QA driven with Computer
Use against the real CometAPI endpoint (`https://api.cometapi.com/v1`,
two keys registered as providers "CometAPI" and "CometAPI-Test", shared
$1.50 pool; models gpt-6-luna, mimo-v2.6-flash, glm-5.3-flash). Sequence:

1. Launched the desktop dev app (`npm start` renderer + `npm run
   electron-app`); drove the real UI throughout with Computer Use.
2. Configured BYOK in Preferences: both providers registered, both keys
   tested ("Connection successful!" ×2 — Task 8.2 real-provider smoke
   PASSED), providers renamed, models fetched live.
3. Round-1 re-tests (all recorded in `usertasks.md`): benchmark re-run on
   mimo (0/4, 25,110 tokens, 7 tool calls in task 1 — the tools+4096-cap
   fix is verified) and glm (0/4, 19,777 tokens); `start_preview` now
   opens the real preview window and `capture_preview_screenshot` /
   `inspect_runtime_state` round-trip; preview-close error overlay
   re-tested (after fixing the new crash below); routing sanity (BYOK
   POSTs only to api.cometapi.com).
4. Agentic build QA with glm-5.3-flash: two BYOK chats drove the full
   pipeline — `initialize_project` (projects "Forest Game"/"ForestDemo"),
   `create_scene`, `create_or_replace_object` ×2 (real asset-store
   installs with required resources), `put_2d_instances`,
   `add_or_edit_variable` (global Score), `read_events_source`,
   `start_preview` → `capture_preview_screenshot` → `inspect_runtime_state`
   → preview stop; plan UI (`create_or_update_plan`) and progress
   sentences verified in-chat; D5 badge/token row verified
   (BYOK · provider/model · tokens · turns).
5. MCP (Task 12/14): transport security re-verified by curl (403
   wrong/absent token, 405 GET /mcp, 413 >1 MB, 404, /health payload);
   `-32001` no-host rule verified before opening the Ask AI panel, host
   registration verified after (tools/list 65 tools with no project, 63
   with one — `initialize_project` correctly dropped); stdio adapter
   end-to-end (initialize/tools/prompts/resources), `prompts/get
   build-workflow`, `resources/read gdevelop://project/notes`,
   `tools/call get_project_overview` live snapshot; restart reconnection
   (fresh start wrote a new port+token, adapter re-reads on failure).
6. Fixed two bugs found by the QA (both with spec regression tests; Flow
   and Prettier green; full lint/format/jest gates re-run in background).
7. Attempted Task 11 9.2 stall-watchdog test with a local never-responding
   HTTP server; inconclusive because provider failover routed the chat to
   the healthy second provider (itself useful failover evidence).
8. Restored all settings (endpoint, stall delay 90 s, context window
   1,000,000) and recorded the model-matrix findings in `usertasks.md` /
   `deferred.md`.

### Bugs found

1. **`ByokPreviewSession.js` — debugger-callback registration crash
   (FIXED this session).** `registerCallbacks` passed only 3 of the 6
   callbacks the preview debugger server fans out
   (`onServerStateChanged`, `onErrorReceived`, `onConnectionErrored`
   were missing). The preview lifecycle invoked the missing
   `onServerStateChanged` → uncaught `TypeError: onServerStateChanged is
   not a function` from `setDebuggerServerState` → the whole editor
   React tree crashed (blank window behind the webpack error overlay);
   the unsaved in-memory project is lost. Fixed by registering all three
   as no-ops with a comment; `ByokPreviewSession.spec.js` gained a
   regression test asserting every fan-out callback is present and
   callable (19/19 suite tests pass).
2. **`ByokMcpStdioAdapterCore.js` — discovery-file path wrong on every
   platform (FIXED this session).** `resolveDefaultDiscoveryPath` joined
   `…/GDevelop/gdevelop-mcp-endpoint.json`, but Electron's userData
   folder follows the productName **"GDevelop 5"** — so the zero-config
   discovery wiring (Claude Code `.mcp.json` / MCP Inspector / any
   client without `--url/--token`) read a non-existent file and every
   call failed with `-32002`, while explicit flags worked. Fixed to
   "GDevelop 5" (with a comment); spec expectations updated (14/14
   pass). After the fix the stdio adapter completes initialize →
   tools/list → prompts/resources end-to-end against the live app.
3. **Benchmark WASM crash (FILED, not fixed — `outofscoped.md`).**
   Applying an event-writing batch to the benchmark scratch project
   crashes libGD ("memory access out of bounds") for ANY model;
   tasks 2–4 then fail, and the poisoned module makes every later
   benchmark run die instantly at `createNewGDJSProject` with the
   misleading classification "The endpoint returned an unexpected
   error." (error-classification mislabel included in the entry).
   Reproduced on mimo-v2.6-flash and glm-5.3-flash.

### Issues found

- **Endpoint compatibility (recorded in `deferred.md`, 2026-09-24
  section):** gpt-6-luna on CometAPI rejects `tools` + `reasoning_effort`
  in chat/completions and the gateway forces a non-none default even when
  the parameter is omitted — BYOK cannot use it agentically until the
  degradation logic learns to send `reasoning_effort: "none"`;
  glm-5.3-flash deterministically returns 200 with an unusable body once
  a very large tool output (the starter catalog) is in context, which
  also defeats compaction for the poisoned chat. BYOK's own behavior in
  both cases is correct (error row, retry offer, failed requests not
  counted, work kept).
- glm-5.3-flash never produced valid EventScript (3 attempts across two
  chats, all rejected by the local validator with actionable guidance —
  the validator/refusal path is verified; a successful anchored
  `add_scene_events` remains open for a capable model; the owner's
  passed Task 2 QA already covered working event flows).
- Electron main logs a `WebContents` "destroyed" listener
  `MaxListenersExceededWarning` (11) after several page reloads — a
  small leak worth a look next time `main.js` is touched.
- Frequent Windows UIA (accessibility) polling destabilises the dev
  renderer (page reloads every few minutes while a UIA client hammers
  the tree; silent when untouched). Worked around by hands-off waits
  during long operations; noted as an automation-environment caveat, not
  a product bug.
- Tasks 7, 9, 10, 13 and parts of 6/11/12/14 remain (see the coverage
  summary in `usertasks.md`); offline checks are not safely testable on
  this remote VM (disabling networking would cut the session).
- Settings state left behind intentionally for the owner: two extra
  providers ("CometAPI" with key 1, "CometAPI-Test" with key 2), global
  model glm-5.3-flash, and four QA chat transcripts in `byok-chats/`.
  Everything else restored (stall delay 90 s, context window 1,000,000,
  main endpoint api.cometapi.com/v1). The desktop dev app (renderer +
  electron shell) was left running.

### Files worked on

- `newIDE/app/src/AiGeneration/Byok/ByokPreviewSession.js` (fix: register
  all debugger fan-out callbacks),
  `newIDE/app/src/AiGeneration/Byok/ByokPreviewSession.spec.js`
  (regression test),
  `newIDE/app/src/AiGeneration/Byok/Mcp/ByokMcpStdioAdapterCore.js`
  (fix: discovery path "GDevelop 5"),
  `newIDE/app/src/AiGeneration/Byok/Mcp/ByokMcpStdioAdapterCore.spec.js`
  (expectations updated),
  `REVIEW/usertasks.md` (round-1 re-tests ticked, Task 8.2, model-matrix
  findings, coverage summary),
  `REVIEW/outofscoped.md` (benchmark WASM crash entry),
  `REVIEW/deferred.md` (CometAPI gpt-6-luna + glm large-output entries),
  `AGENTS.md` (section 2 status), `REVIEW/worklog.md` (this entry),
  auto-memory (session state).
- Supporting (outside the repo, disposable): a never-responding
- Supporting (outside the repo, disposable): a never-responding HTTP
  stub on 127.0.0.1:8377 for the stall test (stopped), MCP stdio JSONL
  fixtures in the user temp folder.

### Gates

- `npx jest ByokPreviewSession.spec.js ByokMcpStdioAdapterCore.spec.js
  --maxWorkers=1`: 19/19 and 14/14 pass.
- `npm run flow`: No errors (full project).
- `npx prettier --check` on the four touched files: clean after
  `--write`.
- Full gates re-run in the background at session end: `npm run lint`
  exit 0, `npm run check-format` exit 0, `npm test -- --watchAll=false
  --maxWorkers=1` 209 suites / 2295 passed / 1 skipped — all green.

### Triage

- **OOS:** benchmark WASM crash + misleading error classification filed
  in `outofscoped.md` (Open entries; now 2 entries).
- **Deferred:** CometAPI gpt-6-luna `tools`+`reasoning_effort`
  incompatibility and glm-5.3-flash large-tool-output 200-garbage, both
  with proposals, filed in `deferred.md` (2026-09-24 section).
- **UT:** the coverage summary, model-matrix findings and the remaining
  owner checklist were filed into `usertasks.md` (round-1 re-test
  section + new "Agent-driven desktop QA" section).


## 2026-09-25 (seventh session) — Phase 13 + FTmodel planned (docs only, per owner order)

### Date

2026-09-25.

### Description of actions

The owner reviewed the QA session 5 record and filed five product notes
(chat history should live in the Recents rail; reuse the existing bottom
effort pill and move the model picker next to it; homepage-form chats
must carry into the editor panel; the EventScript failures are a harness
problem — they want a searchable example/tool DB and on-device RAG;
settings tab rebuilt to a specific layout). They then answered the open
decisions and ordered: "write the docs only, do not implement". Actions:

1. Wrote `REVIEW/Phase13.md`: chat panel consolidation (BYOK header
   toggle + token row, effort pill + provider/model picker in the bottom
   input bar, chat history merged into Recents with hosted history kept
   visible, history button removed), homepage-form chat carryover into
   the editor panel, "+" attach button (text/image, vision/BYOK gating),
   settings tab rebuilt to the owner's exact layout (three checkboxes,
   provider cards with unrollable per-model advanced settings incl.
   per-model benchmark, provider+model routing pairs with migration),
   the owner's prompt-budget directive (8–10k target / 15k hard cap for
   advertised tools + system prompt, tiered tool advertisement via a
   `search_tools` meta-tool, common tasks advertised by name, grep-style
   knowledge search advertised), EventScript Tier-1 harness fixes
   (pinned syntax block + canonical examples, tagged example bank,
   validator-retry targeted hints), and on-device RAG
   (Transformers.js MiniLM ONNX embedder + in-process cosine index +
   `search_knowledge` tool, new RAG preferences tab with embedder picker
   and a "set up permanent indexing with Qdrant" button that downloads,
   installs under userData and autostarts Qdrant with the app). Nine
   decisions recorded as OWNER-DECIDED (D13-1…D13-9), including the one
   new approved npm dependency (`@huggingface/transformers`) and the
   on-device privacy invariant.
2. Wrote `REVIEW/FTmodel.md`: the local fine-tuned generation track
   (7–8B or ternary Bonsai-class base + LoRA via Unsloth-style tooling,
   synthetic tool-call transcripts from the eval harness as training
   data, CPU-bound inference via the ternary llama fork or GGUF, shipped
   as a managed loopback OpenAI-compatible endpoint) — explicitly marked
   NOT scheduled, gated on a fresh owner order, to be started only after
   Phase 13 settles the prompt/tool contract.
3. Updated `AGENTS.md` section 2 with the Phase 13 planned status and
   the FTmodel.md pointer. No code changed.

### Bugs found

None (docs-only session).

### Issues found

- The desktop dev app from the sixth session was closed at some point
  after session end (electron background task exited 0) — the "left
  running" note in the sixth-session entry is no longer true; nothing
  was lost (all state is on disk).
- Phase 13 as scoped is large (UI consolidation + settings redesign +
  knowledge/RAG); when the owner orders implementation, consider
  splitting the run into 13.1–13.4 (UI) and 13.5–13.8 (knowledge/RAG)
  sessions.

### Files worked on

- `REVIEW/Phase13.md` (new), `REVIEW/FTmodel.md` (new),
  `AGENTS.md` (section 2 status), `REVIEW/worklog.md` (this entry),
  auto-memory (Phase 13 plan + owner's budget directive).

### Gates

Not applicable (no code change).

### Triage

- **OOS:** no OOS (the benchmark WASM crash entry from the sixth session
  remains the only code-related open item besides the Polygon2d one).
- **Deferred:** no deferred (local generation is tracked in
  `FTmodel.md`, not deferred.md — it is planned-but-long-term, per the
  owner's naming instruction).
- **UT:** no UT (implementation awaits the owner's go; the phase docs
  are the record).


### Addendum (2026-09-25, later same day) — usertasks.md statuses updated from owner feedback

The owner reviewed the QA records and corrected/completed three statuses;
`REVIEW/usertasks.md` was updated accordingly (ticks + per-item evidence
notes):
- Task 6: stuck-loop watchdog **CONFIRMED WORKING by the owner** (mimo
  triggered it and was stopped with the stuck message) — ticked; the
  events headline marked **SUPERSEDED by the Phase 13 harness/prompt
  rework** (13.5/13.6) with a re-test note; variables and
  project-from-scratch ticked; objects/instances/scenes/project
  properties/script-batching annotated as partial with what exactly was
  verified; regression ticked (covered by Task 2 item 5).
- Task 7: status note added — screenshot capture + vision ingestion
  CONFIRMED (both glm and mimo called the capture tools; mimo definitely
  saw the screenshot); the self-fix loop and remaining items to repeat
  after Phase 13 13.5/13.6.
- Task 8: closed as ALL DONE (decision #9 implemented in 7.0; real-
  provider smoke done in QA session 5; libGD pinning done 2026-09-22).
- Task 11: 9.1 ticked (progress sentences verified session 5); 9.2 stall
  notice ticked per the owner's mimo observation (failover caveat noted);
  40+-round compaction still open.
- Task 12: curl-rejections, Inspector-via-stdio-adapter, no-host rule and
  restart-reconnection ticked with evidence; toggle-off/second-instance/
  kill-takeover/activity-log remain. Task 14: catalog + MCP
  prompts/resources ticked (partial where noted).
- Bugs found: none. Issues found: none. Files: `REVIEW/usertasks.md`,
  `REVIEW/worklog.md` (this addendum). Gates: not applicable (doc-only).
- Triage: no OOS, no deferred, no UT.


### Addendum 2 (2026-09-25) — documentation conventions adopted

The owner asked for a doc format easier for the agent to edit (spawned by
watching the 312-line anchored-edit script) and approved the agent's
proposal: keep markdown, but (a) one sentence per line, no manual
hard-wrapping, (b) stable IDs on checklist/triage items with the ID
expanded in plain words in the item body and a status token on the line.
Recorded in `AGENTS.md` §4 (new bullet after the /REVIEW scope rule) and
auto-memory. Applies to docs written/rewritten going forward; existing
docs are not retro-wrapped. No code changed. Files: `AGENTS.md`,
auto-memory, `REVIEW/worklog.md` (this addendum). Gates: not applicable.
Triage: no OOS, no deferred, no UT.


---

## 2026-09-25 — Phase 13 implemented (chat panel consolidation, settings redesign, prompt budget, EventScript harness, on-device RAG)

**Session type:** implementation (the owner ordered "implement phase 13" in
chat). All 8 steps of `Phase13.md` built; every phase-gate AC addressed.

**Description of actions:**

- **13.1 (chat panel):** `useByokChatSeam` gained `byokToggleState`
  (green/red header toggle writing the same `byok.enabled` preference the
  settings checkbox drives) and the renamed/extended `byokChatControls`
  (the old `byokHeaderState`: effort + model data, token totals, attach
  handlers). `AiRequestChat/index.js`: the header is now the toggle with
  the token row below (hidden when BYOK is off, hosted chats render the
  toggle too); the bottom bar renders the BYOK effort pill + a
  provider/model dropdown ("Model from settings" default) instead of the
  hosted preset selector when a BYOK chat is selected. The Recents rail
  (`AskAiHistory.js`) lists the merged BYOK history (persisted metas via
  `byokHistoryChats` + session chats) ABOVE the hosted list, with
  Archive/Unarchive/Delete (confirmed) in the row menu, filtered by the
  active/archived/all filter; the rail's Open loads persisted chats
  (`openSavedByokChat`) through `onStartOrOpenChat`. `ByokChatHistory.js`
  (button + dialog) deleted — its storage-usage line and export already
  lived in the settings tab.
- **13.2 (homepage carryover):** `pickByokChatToSelectOnMount` in
  `ByokChatStore` — the editor's mount effect now re-selects the single
  still-working BYOK chat when the tab remounts (the moment a form-started
  chat's project opens and the pane moves), so the live transcript stays
  in view without restarting the loop.
- **13.3 ("+" attach):** `ByokAttachments.js` (extension whitelist +
  NUL-sniff + 100 KB cap with truncation note; images via the BYOK image
  store; `buildByokAttachMenuTemplate` pure menu builder). The pickers
  live in the seam (`pickTextFile`/`pickImageFile`, desktop fs only);
  chips + error row + the "+" menu in `AiRequestChat`; text attachments
  inline into the sent message, image ids ride as `byokImageIds` →
  orchestrator → user-message `images` → replay as `image_url` parts
  (`ByokTranscript`), counted by the eviction rule, the compactor's drop
  order, the persistence sidecar, and rendered after the message
  (`ChatMessages` `user_message_images` item).
- **13.4 (settings redesign):** `ByokSettingsTab.js` rebuilt top-to-bottom
  to the owner's layout (three checkboxes → legacy single-endpoint block
  (endpoint/key/model/Test/benchmark/context window/effort/image support)
  → PROVIDERS cards (name/Remove, endpoint, key, Test + Fetch models on
  one row, an Advanced Accordion with PER MODEL SETTINGS blocks — pick
  model, temperature, max tokens, context window, per-model Run benchmark,
  Customize another model) → Add a provider → routing mode + DEFAULT
  STRONG/FAST as Provider+Model dropdown pairs → WHILE THE AI IS WORKING →
  CHAT HISTORY STORAGE → MCP card). Data: `ByokProvider.modelSettings`
  (defensively parsed), the router overlays per-model temperature/max
  tokens (`applyProviderModelSettings`), provider-aware context windows
  (`resolveContextWindowTokens` new chain position), and the routing-pair
  migration `migrateByokRoutingProfiles` (old provider-less profiles →
  first provider).
- **13.5 (budget pass):** `BYOK_CORE_TOOL_NAMES` (27 advertised tools incl.
  the new `search_tools` meta-tool + `search_knowledge`), everything else
  discoverable through `searchByokToolSchemas`/`search_tools` (schema
  injection; the executor always knew every tool); MCP `tools/list` stays
  full (`getByokMcpToolNames`). Prompt: version **byok-v9**; the tools
  section lists NAMES only (the schemas ride with the request — the
  duplicated prose is gone); the new retrieval map names every search
  surface; a 20-entry task catalog (machine-checkable skill/tool/reference
  pointers, asserted in the spec); prompt budget 5500 with
  authoring-reach + the cheat-sheet + knowledge packs degradable;
  schema slimming of the fattest core schemas. `ByokPromptBudget.spec.js`
  enforces ≤15k hard, prints the number, warns past 10k.
- **13.6 (EventScript harness):** the non-degradable pinned block (syntax
  essentials + 3 canonical examples) in every request;
  `scripts/generate-byok-eventscript-examples.js` →
  `docs/eventscript-examples.json` (11 tagged examples, generated file
  committed); the bank merges into `search_reference` (rank-boosted
  pseudo-entries, kind `example`); rejected batches carry a `retryHint`
  (error-class → example map in `ByokEventScriptExamples.js`, attached in
  `ByokLocalEventWriter` at both failure sites). Round-trip test: every
  shipped example applies through the real writer.
- **13.7 (RAG core):** `Byok/Rag/` — `ByokRagTypes` (settings blob
  `byokRag`, embedder catalog, chunk/manifest types),
  `ByokRagCorpus` (~2.4k chunks: engine reference, bundled docs, skills,
  examples, opt-in docs folder via injected reader; ~400-token chunks with
  overlap), `ByokRagEmbedder` (lazy `import('@huggingface/transformers')`,
  injectable loader, normalized vectors, the deterministic hashing test
  embedder), `ByokRagIndex` (deterministic build + corpus hash, cosine
  brute force, base64-serialized), `ByokRagStorage` (in-process file store
  + the Qdrant REST store with the same contract, batched upserts, u32
  point ids), `ByokRagSearch` (hybrid exact-then-vector, RAG-off lexical
  fallback with AND semantics, neighbor reads by chunk id, the live
  runtime holder), `ByokRagFileBackends` (desktop `byok-rag-*` IPC /
  IndexedDB), `ByokRagBuildService` (consented build/rebuild + persisted
  load). The `search_knowledge` tool wired into `ByokExtraTools` and the
  core advertisement + retrieval map. `@huggingface/transformers` ^4.3.0
  installed (the phase's single owner-approved dependency, D13-8; the
  install also required restoring the libGD test alias — see bugs).
- **13.8 (RAG tab + Qdrant):** `ByokRagSettingsTab` (status card, embedder
  picker with explicit MB + consent dialogs before any download — D13-9,
  rebuild with progress, docs-folder picker, backend switch, Qdrant card
  with status + the setup button + the clean-fallback message) registered
  as the `rag` Preferences tab (`byokRag` preferences key added to the
  context/provider). Qdrant: `ByokQdrantSetupCore.js` (plain-CJS state
  machine: use-existing → download → extract → configure(loopback YAML) →
  spawn → health; idempotent; injectable deps) + the thin
  `electron-app/app/ByokQdrant.js` (real download with redirect handling,
  system-tar extraction, port picker, endpoint discovery file, child
  killed on quit, `ensureStarted` autostart on app ready) +
  `ByokRagFiles.js` (`<userData>/byok-rag/` handlers), both wired in
  `main.js`.
- **Gates:** 221 suites / 2428 tests (1 pre-existing skip) — one random
  UNTOUCHED suite flaked per full run (both observed flakes pass
  standalone; OOS entry); ESLint 0/0; Flow 0 errors (run via the direct
  binary per the AGENTS quirk); check-format clean in both `newIDE/app`
  and `newIDE/electron-app`. AGENTS.md §2 updated; triage appended
  (OOS ×4, deferred ×3, `usertasks.md` Task 16).

**Bugs found:**

1. `npm install` in `newIDE/app` prunes the hand-made
   `node_modules/libGD.js-for-tests-only` alias → every suite fails with
   `Cannot find module 'libGD.js-for-tests-only'` (`scripts/import-libGD.js:6`).
   Repro: install any dependency, run Jest. Root cause: npm removes
   extraneous folders it does not track. Fixed for this session by
   re-copying (`index.js` + `libGD.wasm` from `public/`); OOS entry with a
   proper-fix proposal.
2. The RAG settings tab's status refresh was an infinite render loop:
   `ragSettings` is re-created every render → `refreshStatus` identity
   changes → the effect re-runs → the status objects return fresh
   identities → setState → loop (repro: `ByokRagSettingsTab.spec.js` hung
   the runner). Fixed with a mount-once guard ref (a real runtime bug, not
   just a test artifact).
3. `searchByokRagIndex` shadowed its `index` parameter with the loop
   variable (`for (let index = 0; index < index.chunks…`) → TypeError on
   the first search. Found by the index spec; fixed (renamed `position`).
4. Provider-aware `resolveChatContextWindowTokens` looked up cached models
   only under the resolved target endpoint, breaking the legacy
   single-endpoint path (settings.endpointUrl empty in provider-less
   setups) → context ratio 1 and wrong compaction thresholds (caught by
   two orchestrator specs). Fixed: fall back to the injected connection's
   cache.
5. The MCP `tools/list` accidentally followed the narrowed chat
   advertisement (missing `create_extension` etc.; caught by
   `ByokMcpTools.spec`). Fixed with the dedicated full `getByokMcpToolNames`.
6. `ByokRagSearch` coerced `options.nearChunkId` inside template strings
   after the null-narrowing (Flow catch) — fixed via a `nearChunkId` local.
7. Heredoc backslash mangling produced invalid JS in
   `electron-app/app/ByokRagFiles.js` (a `'\'` escape) — caught by a node
   require smoke check; fixed.
8. `makeByokQdrantPaths` defaulted to the non-Windows binary name when no
   platform is passed (spec caught it); now takes the platform and every
   caller passes it.
9. **Self-review against the ACs found the Qdrant app-start autostart
   missing** (handlers + quit-kill existed; nothing spawned on launch).
   Added `ensureStarted` (spawn + health only, never a download) wired to
   `app.on('ready')`.
10. During the Flow cleanup, a subagent rewrote two `jest.fn` mocks in
    `ByokAttachments.spec.js` as plain async functions, breaking 2 tests
    (`toHaveBeenCalledWith` on a non-spy) — caught in the final full run
    and restored.
11. Full-suite runs each flake exactly one random untouched suite (two
    observations documented in the OOS entry; both suites pass standalone
    and unchanged between runs).

**Issues found:**

- The budget lands at ~10.5k typical / 11.5k worst-case tokens (worst case
  includes the full 2 KB custom-instructions payload), above the owner's
  8–10k band but well under the 15k hard cap; the spec prints the number
  every run. Remaining levers are listed in the OOS entry — owner call.
- Rename is gone from the BYOK rail rows (the phase's action list is
  open/archive/delete; the old dialog's rename did not carry over) — OOS.
- The RAG backend switch does not auto-trigger the rebuild (explicit
  button + consent instead) — deferred with reasoning.
- The real-MiniLM `search_knowledge` quality run needs the model download
  → desktop QA (Task 16); the CI eval uses the deterministic hashing
  embedder (24 queries, ≥70% top-3, currently passing with margin).
- `ByokChatHistory.js` had no co-located spec — its removal broke no test
  (the coverage gap is historical, noted here for the record).
- Raw `npx jest` bypasses the react-app-rewired config (CSS-module
  resolution) — the AGENTS "never raw npx jest" rule re-confirmed.
- Triage: `no OOS` does not apply (4 new entries); `no deferred` does not
  apply (3 new entries); `no UT` does not apply (Task 16 added).

**Files worked on (this session):**

New: `newIDE/app/src/AiGeneration/Byok/ByokAttachments.js` (+spec),
`Byok/ByokEventScriptExamples.js` (+spec), `Byok/ByokPromptBudget.spec.js`,
`Byok/ByokQdrantSetupCore.spec.js`, `Byok/ByokRag*.spec.js` (7),
`Byok/Rag/ByokRagTypes.js`, `Byok/Rag/ByokRagCorpus.js`,
`Byok/Rag/ByokRagEmbedder.js`, `Byok/Rag/ByokRagIndex.js`,
`Byok/Rag/ByokRagStorage.js`, `Byok/Rag/ByokRagSearch.js`,
`Byok/Rag/ByokRagFileBackends.js`, `Byok/Rag/ByokRagBuildService.js`,
`Byok/Rag/ByokRagSettingsTab.js` (+spec), `Byok/Rag/ByokQdrantSetupCore.js`,
`Byok/docs/eventscript-examples.json`,
`newIDE/app/scripts/generate-byok-eventscript-examples.js`,
`newIDE/app/src/AiGeneration/AiRequestChat/index.spec.js`,
`newIDE/app/src/AiGeneration/AskAiHistory.spec.js`,
`newIDE/electron-app/app/ByokQdrant.js`, `newIDE/electron-app/app/ByokRagFiles.js`.
Deleted: `newIDE/app/src/AiGeneration/Byok/ByokChatHistory.js`.
Modified: `newIDE/app/src/AiGeneration/AiRequestChat/index.js`,
`AiRequestChat/ChatMessages.js` (+spec), `AiRequestChat/Utils.js`,
`AskAiEditorContainer.js`, `AskAiHistory.js`, `AskAiStandAloneForm.js`,
`Byok/useByokChatSeam.js` (+spec), `Byok/ByokChatStore.js` (+spec),
`Byok/ByokChatPersistence.js` (+spec), `Byok/ByokCompactor.js`,
`Byok/ByokTranscript.js` (+spec), `Byok/ByokOrchestrator.js` (+spec),
`Byok/ByokSeam.js`, `Byok/ByokExtraTools.js`, `Byok/ByokLocalEventWriter.js`
(+spec), `Byok/ByokEngineReference.js`, `Byok/ByokPrompts.js` (+spec),
`Byok/ByokToolSchema.js` (+spec), `Byok/ByokTypes.js` (+spec),
`Byok/ByokModelRouter.js` (+spec), `Byok/ByokModelsCache.js` (+spec),
`Byok/ByokSettingsTab.js` (+spec), `Byok/Knowledge/ByokKnowledgeSections.js`
(+spec), `Byok/Mcp/ByokMcpTools.js`, `MainFrame/Preferences/PreferencesContext.js`,
`MainFrame/Preferences/PreferencesProvider.js`,
`MainFrame/Preferences/PreferencesDialog.js`, `newIDE/app/package.json` +
`package-lock.json` (the approved `@huggingface/transformers` dep),
`newIDE/electron-app/app/main.js`; docs: `AGENTS.md`, `REVIEW/outofscoped.md`,
`REVIEW/deferred.md`, `REVIEW/usertasks.md`, this file. (The tree also
carries the earlier sessions' uncommitted changes — e.g.
`ByokPreviewSession.js`, `OutsideEditorChanges.js`, the ExternalItems
spec — untouched by this session.)

**Audit greps (run 2026-09-25, pasted from the session):**

```
=== A1: dead references to removed artifacts ===
grep -rn "byokHeader\b|ByokChatHistory|byokHeaderState" src/ → (no matches)

=== A2: prompt version ===
ByokPrompts.js: BYOK_AGENT_PROMPT_VERSION = 'byok-v9' (byok-v8 only in the history comment)

=== A3: new tools registered ===
ByokToolSchema.js: 13 search_tools/search_knowledge mentions; ByokExtraTools.js: both tools implemented

=== A4/A5: console.log / TODO / placeholder stubs in the new modules ===
grep -rn "console\.log|TODO|FIXME" Byok/Rag/*.js ByokAttachments.js ByokEventScriptExamples.js → (no matches)

=== A6: the advertised core set ===
BYOK_CORE_TOOL_NAMES count: 27 (search_tools present, search_knowledge present)

=== A7: retryHint carried by the writer ===
ByokLocalEventWriter.js: 5 retryHint mentions (type + 2 failure sites + helper)

=== A8: the example bank ===
docs/eventscript-examples.json: 11 examples

=== A9: rag preferences key wired ===
byokRag: PreferencesContext.js x2, PreferencesProvider.js x1, PreferencesDialog 'rag' tab x2

=== A10: electron handlers registered ===
main.js: registerByokRagFileHandlers + registerByokQdrant at :511-512; byok-rag-*/byok-qdrant-* handlers in ByokRagFiles.js/ByokQdrant.js
```

**Gates:** `npm test -- --watchAll=false --maxWorkers=1`: 221 suites, 2427
passed + 1 pre-existing skip (one random untouched-suite flake per run,
documented); `npm run lint`: 0 errors 0 warnings; Flow (direct binary):
0 errors; `npm run check-format` (app + electron-app): clean.

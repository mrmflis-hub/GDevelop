# Phase 8 — The Autonomous Build Workflow

**Status:** planned · **Depends on:** Phase 5 (full tool surface),
Phase 6 (perception + gameplay tests), Phase 7 (knowledge + skills);
**9.2 (compaction) strongly recommended first** for the longest recipes ·
**Read first:** [Phase5.md](Phase5.md) §0 · [styleguide.md](styleguide.md)

---

## 1. Introduction — what this phase delivers

This phase assembles everything before it into the product goal: **a
desktop user says "build me X", and a BYOK agent designs, scaffolds, builds,
tests, looks at, and polishes a game — then hands it over with evidence.**
The hosted agent cannot do the "look" half, doesn't publish its design
knowledge, and stops at v15's toolset; we also port the one thing it has in
its v18 branch that master lacks: **AI extension authoring**.

Concretely:

1. **Local sub-agents** — the Phase-4 `createByokSubAgentRunner` null-seam
   becomes real: scout (read-only fan-out), reviewer (fresh-context
   requirement check), each a nested orchestrator conversation whose result
   is summarized back as a 1–2k-token `function_call_output` (orchestrator-
   worker, context isolation — the Anthropic multi-agent pattern; token
   economics say sub-agents are for **reads/review**, not sequential edits).
2. **Completion gates** — "done" must be earned: project serializes, preview
   boots, no runtime errors, gameplay test passes when applicable, screenshot
   sanity — prompt-enforced plus an orchestrator-side one-shot nudge if the
   model claims done without evidence.
3. **The build workflow recipe** — a shipped skill
   (`build-workflow.md`) that turns "make me a game about X" into a
   disciplined pipeline: design brief → plan → scaffold (`initialize_project`
   or empty project) → per-mechanic build+test loops → polish pass (juice) →
   final verification + summary. Prompt-driven, not hard-coded.
4. **JS & extension authoring** — JS code events via EventScript (already
   flowing from Phase 5); full **events-based extension authoring** tools
   (`create_extension`, `change_extension_properties`,
   `create_custom_object/behavior/function`, …) driving libGD's
   `EventsFunctionsExtension` API + regeneration — ported from the upstream
   `v18` branch present in this clone (`upstream/claude/gdevelop-ai-extensions-95js2m`,
   commits c0bc40d06e, 3a2659eb86, 8d514278ad — "Enable v18", 2026-09-15;
   not in master). BYOK can ship this **before** the hosted feature lands.
5. **UI entry points** — the model reachable from where the user is: the
   homepage standalone form wired to BYOK ("make me a game" from the start
   page), right-click "Ask AI about this event/object/selection" (the
   `onOpenAskAi({prefilledUserRequest})` plumbing already reaches every
   editor container), and the existing gameplay-test "Edit with AI" template
   joined by siblings.
6. **Fork / restore points for BYOK** — local "rewind to message N" on the
   transcript + automatic pre-message project snapshots (the cloud flow has
   restore points; local projects deserve the same safety).
7. **Prompt bump to `byok-v6`** (agents policy section replaces the
   single-agent section; workflow skill referenced).

### Existing machinery this phase builds on

| Existing piece | File | Use |
|---|---|---|
| Sub-agent seam (null today) | `Byok\ByokOrchestrator.js:80` `createByokSubAgentRunner` | implement |
| Read-only script flag | `EditorFunctions\index.js:8960-8969` (`runScriptReadOnly`) | scout safety |
| Extension authoring blueprint | upstream v18 branch tools + `EventsFunctionsExtensionEditorContainer.js:155-190` (regeneration calls) + `EventsFunctionsExtensionsLoader\index.js` (code-gen/write) | port the approach into BYOK-intercepted tools |
| JS code events | `gd.JsCodeEvent.setInlineCode` (`EventsSheet\EventsTree\Renderers\JsCodeEvent.js:92-105`) | author JS via the Phase 5 event writer (JSON with a JsCodeEvent) |
| Standalone form | `AskAiStandAloneForm.js:312-331, 496-520` (server calls; `editorCallbacks.onCreateProject` at 116-156; no BYOK branch at 249-417) | wire the same seam pattern as the editor container |
| Entry-point plumbing | `onOpenAskAi` prop on every editor (`BaseEditor.js:118`, threaded `MainFrame\index.js:5842`); prefill listener `AskAiEditorContainer.js:1359-1368`; context menus `EventsSheet\index.js:838,1104`, `ObjectsList\index.js:1423-1438`; template `GameplayTestEditorContainer.js:218-229` | add "Ask AI about this…" items |
| Fork precedent | `forkAiRequest` (`AskAiEditorContainer.js:1846-1860`) | local equivalent |

### New files created in this phase

```
Byok\ByokSubAgents.js / .spec.js            scout/reviewer sub-agent runner (nested orchestrators)
Byok\ByokCompletionGate.js / .spec.js       done-claim verification + nudge
Byok\ByokExtensionTools.js / .spec.js       extension/custom-object/behavior/function authoring (libGD-driven)
Byok\ByokFork.js / .spec.js                 transcript fork + project snapshot restore points
Byok\Skills\build-workflow.md               the flagship recipe (content)
Byok\Skills\extend-with-js.md               JS events & extension authoring guide (content)
```

Modified: `Byok\ByokOrchestrator.js` (sub-agents + gates + fork ids),
`Byok\ByokToolSchema.js` (+sub-agent & extension tools),
`Byok\ByokPrompts.js` (`byok-v6`), `AskAiEditorContainer.js` (fork UI hook,
snapshot callback), `AskAiStandAloneForm.js` (BYOK seam — first edit to this
file, justified by feature parity), `EventsSheet\index.js` +
`ObjectsList\index.js` + one editor container (context-menu items — small,
surgical, each behind the existing prefill mechanism).

---

## 2. Steps

### Step 8.1 — Sub-agents: scout and reviewer

**Goal:** context isolation for reads and final checks — the two places it
pays (token economics: implementation stays single-context).

**How to implement:**

1. `Byok\ByokSubAgents.js`: `runSubAgent({kind, instructions, budgetRounds})`
   builds a **fresh** orchestrator conversation: its own system prompt
   (scoped role), its own transcript; scout runs with `runScriptReadOnly`
   executor variants (read-only tool subset = the inspect/read tools +
   read-only `run_script`); reviewer gets the original request + final
   artifacts (event source, screenshot) and a "flag gaps, don't propose
   edits" charter.
2. Interception: `run_explorer_agent` (aliased scout) and a new
   `run_review_agent` resolve in `ByokExtraTools` **before** the registry
   (whose implementations are server stubs). `run_edit_agent` stays
   **excluded** — sequential edits in the main context remain the policy
   (documented; revisit only with evidence).
3. Result discipline: the sub-agent's final message is capped to 1.5k tokens
   (`capToolOutput` reuse) and returned as the `function_call_output`;
   its full transcript is stored on the chat record (renderable in UI later
   if wanted) but **never replayed** into the parent context. Sub-agent
   rounds budget: 8 (scout) / 3 (reviewer); failures degrade to a
   `success:false` output the parent can ignore.
4. Nested-loop guards: sub-agents cannot spawn sub-agents (one level only);
   a global turn budget across parent+children prevents runaway cost.

**Files:** `Byok\ByokSubAgents.js` + spec.
**Tests:** fresh-context assertion (sub-agent messages list disjoint from
parent); summary cap; read-only executor actually filters modifying tools
(truth table); nesting refused; failure → parent continues.
**Depends on:** Phase 5 (executor getters — the sub-agent reuses them).

---

### Step 8.2 — Completion gates (`ByokCompletionGate.js`)

**Goal:** "done" means verified.

**How to implement:**

1. When the model produces a final plain-text turn after edits were made in
   the chat, the orchestrator runs cheap local checks:
   project-serializes (`serializeToJSON` on a clone — already how snapshots
   are built), no crashed previews pending (`ByokPreviewSession` state),
   un-fixed failing gameplay test results in transcript (scan tool outputs).
2. If a check fails or the model claimed done **without any verify-type call
   (screenshot/test/preview/log read) since its last edit**, the orchestrator
   does not mark ready: it appends a one-shot nudge turn ("You haven't
   verified your work: run a preview or gameplay test / capture a screenshot,
   then confirm") and continues (max one nudge — never a loop; the second
   claim is honored with a warning line in the final message).
3. Gate results attach to the final message as a small
   `{verified: […]}` block — visible evidence in the chat (and the worklog
   QA uses it).

**Files:** `Byok\ByokCompletionGate.js` + spec; orchestrator hook.
**Tests:** nudge fires exactly once (no verify call → nudge; verify call
present → none); failing test in transcript → nudge mentions it; double
claim honored with warning.
**Depends on:** Phase 6.

---

### Step 8.3 — The build-workflow recipe (`build-workflow.md` skill)

**Goal:** "make me a game" is a pipeline, not a vibe.

**How to implement:**

1. Author the skill content (Phase 7 system loads it):
   1. **Brief** (design pack core): core loop, verbs, win/lose, feel — shown
      to the user via `create_or_update_plan` before any edit.
   2. **Scaffold**: `initialize_project` (template or empty) or current
      project; declare variables up front (`add_or_edit_variable`) per the
      "numbers are tunables" rule.
   3. **Per-mechanic loop**: build mechanic → `run_gameplay_test` (write the
      test first when feasible — failing-test-first is the SOTA
      self-debugging pattern) → fix → look (`capture_preview_screenshot`) →
      next.
   4. **Polish pass**: juice vocabulary sweep (design pack).
   5. **Final verification**: preview boot + logs clean + tests green +
      screenshot; summary with what was built + what to try.
2. The skill also carries scope rules (one mechanic at a time; ask when
   ambiguous about scope; never delete user content without saying so).
3. Optionally auto-suggest the skill: the orchestrator detects
   build-intent regexes ("make/build/create a game") in the first user
   message and includes the skill body from turn one (heuristic, cheap,
   overridable in settings).

**Files:** `Byok\Skills\build-workflow.md` (+ a spec asserting it parses and
names the required tools — keeps the recipe and registry in sync).
**Depends on:** 7.6, 8.2.

---

### Step 8.4 — JS & events-based extension authoring

**Goal:** full-code expressiveness: JS events inline, custom
objects/behaviors/functions as project extensions.

**How to implement:**

1. **JS code events** (small): the Phase 5 event writer already materializes
   event JSON — teach (pack, not code) that a `JsCodeEvent` carries
   `inlineCode` + `parameterObjects`; author via `add_scene_events` batches.
   The `extend-with-js.md` skill documents scope (`runtimeScene`, `objects`,
   `gdjs`) and when JS beats events.
2. **Extension tools** (`Byok\ByokExtensionTools.js`, intercepted in
   `ByokExtraTools`): port the v18 surface, driving libGD directly like the
   extension editor does:
   - `create_extension({name, full_name?, description?})`,
     `change_extension_properties({extension, …})` (rename/version/description);
   - `create_custom_object` / `change_custom_object` (child objects,
     properties, variants);
   - `create_custom_behavior` / `change_custom_behavior` (properties,
     functions);
   - `create_custom_function` / `change_custom_function` (free
     function/condition/action/expression with typed parameters & sentences);
   - functions' **content is authored as EventScript via the Phase 5 writer**
     (events-based functions) — or as JS code events inside them; both paths
     already work through the same pipeline.
   - after each change batch: trigger regeneration
     (`onLoadEventsFunctionsExtensions` /
     `onReloadEventsFunctionsExtensionMetadata` — exactly what
     `EventsFunctionsExtensionEditorContainer.js:155-190` calls), once per
     batch (v18 lesson: the editor regenerates once per batch, not per call).
   - deletion safety: a `find_usages` helper output before destructive
     changes (v18 ports usage checks; ours returns plain text usage list).
3. Schemas authored from the libGD typings
   (`GDevelop.js\types\gdeventsfunctionsextension.js`, `gdeventsfunction.js`)
   and validated by a spec that round-trips create→change→delete on fake
   gd objects (electron-mocking / libGD-for-tests pattern from memory).
4. **Upstream-tracking note:** master may gain v18 tools upstream; our
   BYOK-intercepted copies must then delegate to the registry versions when
   they appear (guard: if the registry implementation stops being a stub,
   prefer it). Record the check in the worklog when landed.

**Files:** `Byok\ByokExtensionTools.js` + spec; schemas; skill
`extend-with-js.md`.
**Tests:** create→change→regenerate-call-order asserted; usage check blocks
unsafe delete; stub-detection guard.
**Depends on:** 5.2 (EventScript writer), Phase 7 packs.

---

### Step 8.5 — UI entry points

**Goal:** BYOK at every point of use.

**How to implement:**

1. **Standalone form** (`AskAiStandAloneForm.js`): add the
   `shouldUseByokForNewRequest` branch in its `newAiRequestOptions` effect
   (249-417) + a `startByokChat` mirroring the container's (625-735) — the
   form already has `editorCallbacks.onCreateProject` (116-156) and function
   call processing (584-609), so `initialize_project` works from message one
   (this is the homepage "make me a game" flow).
2. **Selection-aware context actions** (each = one menu item calling
   `onOpenAskAi({prefilledUserRequest})`; prompts are 1–2 line templates
   including the selected names):
   - Events sheet: in `_buildEventContextMenu` (`EventsSheet\index.js:1104`)
     and `_buildInstructionContextMenu` (:838): "Ask AI about this event" /
     "…this action". Thread `onOpenAskAi` through `EventsEditorContainer`
     (it already rides `EditorTabsPaneCommonProps`).
   - Objects list: in `buildContextMenuTemplate`
     (`ObjectsList\index.js:1423-1438`): "Edit {object} with AI…".
   - Scene editor: reuse the gameplay-test template pattern
     (`GameplayTestEditorContainer.js:218-229`) for the current selection
     (small addition to `InstancesEditor` context wiring).
3. All templates are Lingui'd `<Trans>` strings; every item works for hosted
   AI too (they only prefill — no BYOK-specific behavior in the menu layer).

**Files modified:** the four listed files (+ spec for any extractable
helpers — menu builders are React-internal, so manual QA covers them).
**Depends on:** Phase 5 (the seam helpers exist).

---

### Step 8.6 — Fork / restore points for BYOK

**Goal:** safety nets the cloud flow has and local BYOK lacks.

**How to implement:**

1. `ByokTranscript`: assign `messageId`s to BYOK transcript items (the fork
   UI keys on them).
2. `Byok\ByokFork.js`: `forkByokChat(chatId, upToMessageId)` — copy the
   output array up to the message (local fork, trivial — audit §7); the
   forked chat opens as a new BYOK chat titled "Fork of …".
3. **Project restore points**: before each user message that precedes edits,
   snapshot the serialized project (`serializeToJSON`, the same call
   snapshots use) into the chat record, capped to the **last 5** snapshots
   (size-guarded; full-fidelity restore of older points is explicitly not
   promised — that's undo-history's job, not ours). Tool
   `restore_project_point({messageId})` (approval-gated — it overwrites the
   current project) + the chat UI's existing "restore to message" entry
   point routed for BYOK ids.
4. Cap discipline: snapshots are lazy (only when the chat actually edited
   something) and dropped when the chat closes (no disk growth) — persistence
   of snapshots lands with Phase 9 storage if wanted.

**Files:** `Byok\ByokFork.js` + spec; `ByokTranscript.js` (ids);
container hook (restore routing).
**Tests:** fork copy semantics (up-to exclusive/inclusive decision tested);
snapshot cap (6th evicts 1st); restore requires approval.
**Depends on:** Phase 5.

---

### Step 8.7 — Prompt `byok-v6` + phase gate

1. Prompt: replace SINGLE_AGENT_SECTION with AGENTS_SECTION (main agent does
   edits; `run_explorer_agent`/`run_review_agent` for reads/review; never
   edit inside sub-agents); reference the workflow + JS skills; completion
   rules ("claim done only after verification; the gate will nudge you").
2. Full gates + the **flagship manual QA** (real endpoint, recorded in the
   worklog, screenshots of the run): from the homepage form with BYOK on —
   *"Build me a small platformer: 3 short levels, coins, one enemy type,
   HUD, menu, save best score, and make it feel juicy."* Expect: brief +
   plan shown; scenes/objects/events built; at least one gameplay test
   written and green (or visibly repaired); a screenshot captured and
   discussed; extension or JS event used somewhere sensible; final summary
   with the `verified` block. Zero `api.gdevelop.io/generation` calls
   (network tab).
3. Regression: hosted AI unaffected (BYOK off); all Phase 5–7 QA scenarios
   still pass.

**Depends on:** 8.1–8.6.

---

## 3. Phase 8 acceptance criteria (phase gate)

- [ ] Scout/reviewer sub-agents run with fresh contexts and capped summaries; nesting refused; read-only scout enforced (all unit-tested).
- [ ] Completion gate: unverified done-claims get exactly one nudge; verified completions carry the `verified` block (unit + QA).
- [ ] The build-workflow skill parses, names its required tools (spec-guarded), and drives the flagship QA end-to-end from the homepage form with BYOK.
- [ ] Extension tools create/modify/regenerate a custom object/behavior/function in tests; usage check guards deletion; the upstream-stub delegation guard exists.
- [ ] Context-menu entry points work in Events sheet, Objects list, and scene selection (manual QA each); all strings Lingui'd.
- [ ] BYOK fork + restore points work; snapshots capped at 5; restore approval-gated (unit-tested).
- [ ] Prompt `byok-v6`; all four checks green; flagship QA recorded with evidence; worklog entry complete.

---

## 4. Deferred (do not build in this phase)

- `run_edit_agent` (editing sub-agents) — revisit only with eval evidence
  that isolated edit contexts beat the main loop.
- Verified-skill banking (green-run snippets → skills) → Phase 9 with the
  eval harness.
- Parallel multi-preview workflows; headless/offscreen preview mode beyond
  what the gameplay-test frame already provides.
- Batch/queue UI ("build these 5 mechanics overnight") — needs Phase 9
  persistence + resume.

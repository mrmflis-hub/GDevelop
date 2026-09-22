# Phase 5 — Tool Parity: the Full Editor Surface

**Status:** planned · **Depends on:** Phases 1–4 (all ACs green) ·
**Read first:** [AIflow.md](AIflow.md) (the flow + registry map) ·
[report.md](report.md) · [styleguide.md](styleguide.md) · [agents.md](agents.md)

---

## 0. Roadmap overview (Phases 5–9, the BYOK ≥ hosted program)

Goal: **a robust, fully working AI-automated game design & build workflow for
desktop BYOK users — equal to GDevelop's hosted agent, then better.** The
program is divided into five phases by capability category; each phase doc
follows the house format and lists its own steps/ACs.

| Phase | Category | What it delivers | Equality / advantage |
|---|---|---|---|
| **5** | **Capability surface** | Every client-executable tool admitted to BYOK; **local event writing** (no GDevelop backend); `run_script` script agent; project creation from a BYOK chat; stuck-loop detection | *Equality* with hosted v15's edit surface |
| **6** | **Perception** | Vision input; screenshot tools (scene editor, live preview, gameplay tests); preview control; console/crash/state reads; the act→look→verify loop | *Advantage* — the hosted AI has no screenshots in the main loop |
| **7** | **Knowledge & skills** | Prompt architecture; game-design system messages; machine-generated engine reference (objects/behaviors/actions/expressions); EventScript grammar pack; math/physics/JS/three.js packs; **skills system** (SKILL.md-style progressive disclosure); docs access; per-project notes | *Advantage* — hosted prompts are invisible; ours are versioned, user-visible, extensible |
| **8** | **Autonomous workflow** | Local sub-agents (scout/edit/reviewer/tester); completion gates; the idea→plan→build→test→polish recipe; JS & events-based-extension authoring; UI entry points (standalone form, right-click "Ask AI about this"); BYOK fork/restore points | *Advantage* — a full automated build workflow, user-owned |
| **9** | **Scale & economics** | Streaming; context compaction (no more dead-ends); durable chat history; multi-model routing; capability gating + built-in mini-benchmark; local suggestions/feedback; eval harness | *Advantage* — unlimited by credits; tunable by model |

Dependency graph: **5 → 6 → 7 → 8**, with **9** mostly independent but
**9.2 (compaction) is a prerequisite for Phase 8's longest workflows** —
either land it early or keep Phase 8 sessions per-task. SOTA evidence for the
split and the ordering: runtime visual feedback is worth ~+11 points on
game-dev benchmarks (GameDevBench, 2026), tool-surface discipline matters
(<~15–20 tools per turn), and skills/compaction/sub-agents are the three
context-engineering levers (Anthropic engineering posts, 2025–2026).

Evidence base for the whole program (2026-09-21 research wave, see worklog):
repo mapping (`AIflow.md`), hosted-capability catalog + tools-version timeline
(v1→v15, plus an **upstream v18 branch present in this clone** adding 9
extension-authoring tools), engine-knowledge taxonomy, BYOK limitation audit
(top-10 ranked), and agentic-SOTA research (tool design, vision loops,
skills, multi-agent, context engineering, LLM game-code failure modes).

---

## 1. Introduction — what this phase delivers

Phase 4 shipped an 11-tool whitelist. The hosted agent (toolsVersion v15)
exposes ~26 client-executed tools plus server-side event generation. This
phase closes that gap **without any call to GDevelop's backend**:

1. **Full whitelist** — every client-executable tool from
   `EditorFunctions/index.js` gets a BYOK schema (or an explicit, documented
   exclusion).
2. **Local event writing** — the headline item. The hosted agent's
   `add_scene_events` posts to `POST /ai-generated-event` server-side; BYOK
   replaces it with a **client-side EventScript → events-JSON →
   `applyEventsChanges`** pipeline using only code that already ships in the
   IDE (`unserializeFromJSObject`, `ApplyEventsChanges.js` placement ops).
3. **Script agent** — `run_script` admitted: the model writes one JS script
   that batch-drives the other tools (hosted v12–v13 rationale: "replaces N
   discrete tool calls by one"), executed by the existing sandboxed
   `ScriptRunner` (600-call cap, sequential enforcement, console capture).
4. **Project creation** — `initialize_project` admitted plus the container
   fix that makes a mid-chat project creation actually work (today the
   orchestrator captures stale `project: null` closures at chat start).
5. **Stuck-loop detection** — parity with the hosted `repeated-tool-call-loop`
   protection the server applies and BYOK lacks.
6. **Prompt bump to `byok-v3`** — new tool list, EventScript authoring
   guidance, script-first policy.

### What "local event writing" builds on (all already in the client)

| Existing piece | File | Role |
|---|---|---|
| EventScript serializer (events → text) | `EventsSheet\EventsTree\TextRenderer\EventScriptRenderer.js` (+ shared conformance fixtures `EventScriptRenderer.fixtures.json`) | The grammar we must parse back; per its header the canonical parser lives in the private GDevelop-services repo — we write our own from the renderer + fixtures |
| Filtered/anchored source views | `EventScriptSourceView.js`, `EventScriptIdentifiers.js` | `read_events_source` already emits `# event-N.M` path anchors our writer can target |
| Events set-from-JSON | `Utils\Serializer.js:177` (`unserializeFromJSObject`), `gd.EventsList` | How parsed events materialize |
| Placement operations | `EditorFunctions\ApplyEventsChanges.js` (insert_at_end / insert_and_replace_event / replace_entire_event_and_sub_events / replace_event_but_keep_existing_sub_events / delete_event, `event-N.M` + `aiGeneratedEventId` targeting) | The exact semantics of the hosted `AiGeneratedEventChange` schema (`Generation.js:212-243`) |
| Script sandbox | `EditorFunctions\ScriptExecution\ScriptRunner.js`, `ExposedFunctions.js`, `NonScriptableFunctionNames.js` | `run_script` execution as-is |
| Project creation | `EditorFunctions\index.js:8697-8783` (`initialize_project` → `editorCallbacks.onCreateProject`) | Works when whitelisted; the container wiring is what's broken (audit §8) |

### New files created in this phase

```
Byok\ByokEventScriptParser.js / .spec.js      EventScript text → events-JSON (grammar from renderer + fixtures)
Byok\ByokLocalEventWriter.js / .spec.js       event batches (EventScript) → AiGeneratedEventChange[] → applyEventsChanges
Byok\ByokExtraTools.js / .spec.js             BYOK-intercepted tools registry (add_scene_events local impl; grows in Phases 6–8)
Byok\ByokLoopGuards.js / .spec.js             repeated-call-loop fingerprint detection
```

Modified: `Byok\ByokToolSchema.js` (full whitelist + schemas),
`Byok\ByokPrompts.js` (`byok-v3`), `Byok\ByokOrchestrator.js` (extra-tools
interception + guards + live re-injection seam),
`AskAiEditorContainer.js` (inject getters instead of closures for
executor/snapshot; `createdProject` handling). All other existing files:
import only.

---

## 2. Steps

### Step 5.0 — Tool-dependency audit spike (decide the exact whitelist)

**Goal:** one decision table, no surprises later.

**How to implement:**

1. For every tool in `editorFunctions` + `editorFunctionsWithoutProject`
   (`EditorFunctions\index.js:9029-9083`), classify: (a) pure client —
   admit; (b) hits GDevelop backend but only with a logged-in account
   (asset/resource search) — admit **conditionally** (see 3); (c) pure
   server-side stub (docs, sub-agents, `report_fulfilment_problem`,
   `get_game_starter_summary`) — keep excluded, delegate to
   Phases 7 (docs) and 8 (sub-agents).
2. Legacy aliases (`inspect_object_properties`, `change_object_property`,
   `remove_behavior`) stay **excluded** — BYOK has no old requests to honor;
   canonical names only. Record this in the table.
3. Store-search decision: `create_or_replace_object` with a
   `description`/`asset_id` **already** calls the asset store from a BYOK chat
   (AIflow.md §5.4). Decide once, apply consistently: store-backed paths stay
   available when a GDevelop account is logged in, and the prompt says asset
   search needs an account; without one, the tool's failure output already
   explains. Alternatively add a settings toggle "Allow GDevelop account
   services (asset/resource search)" default on — pick in this spike and note
   it in the worklog.

**Files created:** none · **Depends on:** Phase 4.

---

### Step 5.1 — Full tool whitelist + schemas (`ByokToolSchema.js`)

**Goal:** every admitted tool has a validated schema; the model sees the
whole edit surface.

**How to implement:**

1. Extend `BYOK_V1_TOOL_NAMES` → `BYOK_TOOL_NAMES` adding at minimum:
   `put_3d_instances`, `inspect_object_properties_effects`,
   `change_object_properties_effects`, `inspect_behavior_properties`,
   `inspect_scene_properties_layers_effects`, `change_scene_properties_layers_effects_groups`,
   `inspect_project_properties_resources`, `change_project_properties_resources`,
   `read_events_source`, `describe_instances` (already in), plus the
   Phase-5-local `add_scene_events` (5.2) and `run_script` (5.3) and
   `initialize_project` (5.4).
2. Author one schema per tool in the established style (checked against each
   implementation's `SafeExtractor.extract…` calls — the file's own
   maintenance rule). `run_script` takes `{js_code}`; `add_scene_events`
   takes the hosted shape (`scene_name`, `event_batches[]` with
   `event_script`, `placement` ops, `expected_event_source` anchors) so our
   prompt can teach exactly one format.
3. Keep the total **≤ ~20 tools in the default set** (SOTA guidance: fewer,
   consolidated tools; tool definitions are billed as input tokens every
   turn). Mitigations if the count grows in later phases: concise
   descriptions here; Phase 7's skills can scope per-task tool subsets
   (`allowed_tools`-style filtering at request build time).
4. `validateByokToolSchemas` stays the guard (registry drift fails tests).

**Files modified:** `Byok\ByokToolSchema.js`, `Byok\ByokToolSchema.spec.js`
**Tests:** every admitted name exists in the upstream registry; count cap
assertion (≤ 22); no excluded name sneaks in (`read_full_docs`, `search_docs`,
`run_explorer_agent`, `run_edit_agent`, `run_tests`, `search_object_asset_store`,
`search_resource_store`, `get_game_starter_summary`,
`report_fulfilment_problem`, legacy aliases).
**Depends on:** 5.0.

---

### Step 5.2 — Local event writing (the headline)

**Goal:** `add_scene_events` works in BYOK with **zero** requests to
`api.gdevelop.io` — parity with the hosted agent's most important tool.

**How to implement:**

1. `Byok\ByokEventScriptParser.js` — EventScript text → events-JSON
   (`gd.Serializer`-shaped objects, i.e. what `unserializeFromJSObject`
   consumes). The grammar is fully derivable in-repo:
   - statements: `if <conds>:` / `always:`, `else` / `else if`, `while`,
     `repeat N times`, `for each`, `for each child in`, `group "…"`,
     `comment "…"`, `link "…"`, local variables
     (`local <type> Name = <JSON>`), `pass`;
   - conditions: `Type(args)`, `and`/`not`/`Or(…)` composition, `once`,
     inverted via `not`, `disabled` prefix;
   - actions: `Type(args)`, `await` prefix for async;
   - literal escaping (`\"`, `\\`, `\n`), trailing-empty-arg trimming rules,
     `# event-N.M` path comments (ignored by the parser, used by placement).
   Validate against **both directions** of `EventScriptRenderer.fixtures.json`
   (parse fixture source → serialize → byte-identical where the fixture
   marks round-trip stability). Parse errors must carry line/column and the
   offending line — they become tool failures the model can fix.
2. `Byok\ByokLocalEventWriter.js` — batches → changes:
   `{scene_name, event_batches: [{event_script, placement, expected_event_source?}]}`
   → parse each `event_script` → build `AiGeneratedEventChange`-shaped objects
   (the schema at `Generation.js:212-243` minus server-only fields) → call
   the existing `applyEventsChanges` (imported from
   `EditorFunctions\ApplyEventsChanges.js`) with the project. Reuse its
   anchors (`event-N.M` paths, `expected_event_source` replace-anchors) so
   edits are surgical, not append-only.
3. `Byok\ByokExtraTools.js` — the BYOK interception registry (the plan-tool
   pattern from Phase 4, generalized): `{ name, run(args, collaborators) }`.
   `add_scene_events` resolves here **before** the editor registry (whose
   implementation posts to the backend — never reachable from BYOK).
   `generate_events` maps to the same implementation (hosted parity of
   names). Output shape mirrors the editor runner's
   (`{success, summary…}`), and `meta.didModifyProject: true` so approval
   gating keeps working.
4. Orchestrator: consult `ByokExtraTools` in `executeToolCalls` before the
   registry lookup (early return, no nesting).

**Files created:** the three modules above + specs.
**Files modified:** `Byok\ByokOrchestrator.js` (interception point).
**Tests:** parser: every fixture round-trips; malformed inputs produce
line-numbered errors. Writer: batch with `insert_at_end`,
`insert_and_replace_event` with `expected_event_source` anchor, `delete_event`
by path — asserted against a fake `gd.Project`/`EventsList` (the
`ApplyEventsChanges` test seam — reuse whatever fakes its own spec uses, or
jest-mock libGD as prior specs do). Interception: `add_scene_events` never
reaches the registry; approval still required (modifies project).
**Depends on:** 5.1.

---

### Step 5.3 — Script agent (`run_script`)

**Goal:** the model can batch many operations into one authored script —
hosted v12–v13 capability, and our REPL for math/computation (Phase 7 leans
on it: "never do physics math in your head, compute it in a script").

**How to implement:**

1. Admit `run_script` (5.1). No interception needed: the runner already
   executes it (`ScriptRunner.js`: shadowed globals, sequential-call guard,
   600-call cap, console capture, capped result).
2. `runScriptReadOnly` stays false for the main BYOK agent (edit scripts
   allowed); Phase 8's explorer sub-agent will set it true.
3. Approval: `run_script` declares `modifiesProject: true` — one approval
   covers the whole script (existing behavior). The prompt must warn: a
   refused script means **nothing** in it ran.
4. Prompt (5.5): script-first policy — "for 5+ related operations or any
   arithmetic/geometry computation, write one `run_script` instead of many
   tool calls".

**Files modified:** `Byok\ByokToolSchema.js` (schema), `Byok\ByokPrompts.js`.
**Tests:** schema presence; a spec-level script round-trip using the real
`ScriptRunner` with a fake exposed-function set (precedent:
`ScriptExecution` specs); approval classification (script ⇒ requires
approval).
**Depends on:** 5.1.

---

### Step 5.4 — Project creation + live re-injection

**Goal:** "make me a game from scratch" works in one BYOK chat — including
the standalone form flow that Phase 8 wires up.

**How to implement:**

1. Admit `initialize_project` (schema: `{name, template_slug?, also_read_existing_events?}`).
   Keep `get_game_starter_summary` excluded (server-side stub); the prompt
   tells the model to plan from its own knowledge (Phase 7's game-design
   packs make this good).
2. Fix the stale-closure bug the audit found (`AskAiEditorContainer.js:649-664`
   captures `executeFunctionCalls`, `hasOpenedProject`,
   `getProjectUserContent` once): the orchestrator's injected options become
   **getters** (`getExecutor()`, `getHasOpenedProject()`,
   `getProjectUserContent()`) called per turn; the container memo wiring
   (`:569-604`) already re-creates executors when `project` changes — the
   orchestrator just has to look.
3. Handle `createdProject`: the container's post-execution callback must open
   the created project (reuse `onCreateProject`'s existing path —
   `AskAiStandAloneForm.js:116-156` is the reference implementation) and the
   next turn's snapshot then reflects it.
4. Prompt: replace NO_PROJECT_SECTION's "cannot create one" text with
   initialize_project instructions (auto-detect: the section picks based on
   `hasOpenedProject` **at turn time**, so the same chat transitions).

**Files modified:** `Byok\ByokOrchestrator.js` (getters),
`AskAiEditorContainer.js` (pass getters; `createdProject` handling),
`Byok\ByokPrompts.js`, `Byok\ByokToolSchema.js`.
**Tests:** orchestrator spec: mid-chat `initialize_project` result causes the
next turn to call `getHasOpenedProject()`/`getProjectUserContent()` again
(getter mocks assert re-read); container-level wiring is manual QA (5.6).
**Depends on:** 5.1.

---

### Step 5.5 — Stuck-loop detection (`ByokLoopGuards.js`)

**Goal:** parity with the hosted `repeated-tool-call-loop` protection.

**How to implement:**

1. Fingerprint each call as `name + JSON.stringify(parsedArgs)`; keep the
   last N (8) fingerprints. Three consecutive identical fingerprints (same
   name+args, regardless of output) → do not execute; return a corrective
   tool output ("You already called this exact tool with these arguments and
   it did not advance the task. Change your approach or ask the user.") and
   continue the loop — the model gets one chance to self-correct.
2. A fourth consecutive identical fingerprint → stop with error kind
   `byok-repeated-tool-call-loop` (message mirrors the hosted UI wording
   "The AI got stuck", `AiRequestErrorRow.js:54` mapping).
3. Exempt by design: `create_or_update_plan` (re-running with updated tasks
   is normal), `describe_instances`/`read_scene_events`/screenshot tools once
   Phase 6 adds them (re-inspection after edits is normal) — the fingerprint
   check ignores outputs-only re-reads **only** if args differ; identical
   re-reads still count.

**Files created:** `Byok\ByokLoopGuards.js`, `Byok\ByokLoopGuards.spec.js`
**Files modified:** `Byok\ByokOrchestrator.js` (hook between collect and
execute), `Byok\ByokErrors.js` (new kind).
**Tests:** 3-identical → corrective output, loop continues; 4th → error
status; plan tool never triggers it.
**Depends on:** Step 4.2 architecture (existing loop).

---

### Step 5.6 — Prompt `byok-v3` + phase gate

**Goal:** the prompt teaches the new surface; the phase proves parity.

**How to implement:**

1. `ByokPrompts.js` bump to `byok-v3`: new tool list (auto-generated from
   schemas, unchanged mechanism); **EventScript authoring section** — a
   compact grammar reference + "target edits with `expected_event_source`
   anchors / `event-N.M` paths from `read_events_source`; read before
   writing"; **script policy** (5.3); **project creation** (5.4); keep
   smallest-edit + one-batch rules. (The full grammar *pack* with examples is
   Phase 7's job — here only the operational core, ~15 lines.)
2. Full gates from `newIDE\app` (test/lint/flow/check-format).
3. Manual QA (desktop, real endpoint), recorded in the worklog:
   - **Parity matrix run-through:** one chat per tool family — objects
     (create/replace/change properties/delete), behaviors, instances 2D+3D,
     scenes (create/change/delete), project properties/resources, variables,
     events (read → anchored replace → delete), script batching,
     project-from-scratch. Each succeeds with **zero** requests to
     `api.gdevelop.io/generation` (network tab).
   - Refused script approval → nothing applied, chat suspended cleanly.
   - Stuck model (use a deliberately dumb local model or a scripted fake) →
     corrective output then `byok-repeated-tool-call-loop` error.
   - Regression: hosted Ask AI still works with BYOK off.

**Files modified:** `Byok\ByokPrompts.js`, `Byok\ByokPrompts.spec.js`
**Depends on:** 5.1–5.5.

---

## 3. Phase 5 acceptance criteria (phase gate)

- [x] Every client-executable editor tool is either admitted with a validated schema or excluded with a documented reason in the 5.0 decision table; default tool count ≤ 22. *(2026-09-22: decision table in `phase5-tool-decisions.md`; 22 always-advertised + `initialize_project` conditional.)*
- [x] `add_scene_events` performs anchored insert/replace/delete edits entirely client-side (unit-tested against fixtures; network-tab-verified in QA) — **BYOK can write game logic without GDevelop's backend**. *(2026-09-22: unit side done — conformance fixtures + anchored-replace refusal tests; the network-tab QA is desktop-only, tracked with the Phase 5 QA items.)*
- [x] `run_script` executes model-authored scripts through the existing sandbox with the 600-call cap intact; one approval gates a whole script. *(2026-09-22: admitted, upstream runner untouched (`modifiesProject: true` ⇒ one approval); script round-trip pinned by the ByokToolSchema/ByokOrchestrator suites.)*
- [x] A single BYOK chat can go from no project → `initialize_project` → editing the new project (getters re-read per turn; unit-tested). *(2026-09-22: `ByokOrchestrator.spec.js` — "re-reads the project getters after initialize_project creates a project mid-chat".)*
- [x] Repeated identical calls produce a corrective output then a clean `byok-repeated-tool-call-loop` stop (unit-tested).
- [x] Prompt version is `byok-v3`; prompt↔schema sync test still passes. *(2026-09-22: shipped as byok-v3, then superseded by Phase 6's `byok-v4` in the same session — the sync test covers the final version.)*
- [x] All four checks green from `newIDE\app`; the parity matrix QA is recorded; worklog entry has all five items. *(2026-09-22: test/lint/flow/check-format all green (164 suites / 1740 tests); the desktop parity-matrix QA cannot run in this headless session — see the worklog "Issues found" and `usertasks.md`.)*

---

## 5. Implementation notes (appended 2026-09-22)

- Step 5.0's decision table lives in [`phase5-tool-decisions.md`](phase5-tool-decisions.md)
  (store-search decision: keep the account-gated store paths, no new toggle).
- The step 5.1 "at minimum" list enumerates 23 advertised names; the ≤22 AC is
  met by advertising `initialize_project` only on no-project turns
  (`getByokAdvertisedToolNames`) — the dispatch set keeps it always legal.
- `generate_events` is dispatchable but unadvertised (exact upstream alias of
  `add_scene_events`, intercepted by `ByokExtraTools`).
- The loop-guard history keeps the last 8 fingerprints (`ByokLoopGuards`),
  plan calls are exempt, identical inspection re-reads count.
- Parser grammar derived from `EventScriptRenderer.js` + the shared
  conformance fixtures (both directions re-verified in
  `ByokEventScriptParser.spec.js`); hidden code-only parameters are refilled
  from libGD metadata like the hosted compilation does.

---

## 4. Deferred (do not build in this phase)

- Docs search (`read_full_docs`/`search_docs`) → Phase 7.
- Sub-agent tools → Phase 8. Gameplay tests → Phase 6.
- `strict: true` schemas / `parallel_tool_calls` control → Phase 9 (capability
  gating); descriptions stay concise here.
- EventScript parser edge-features beyond the fixtures (exotic escaping) —
  extend when a real model actually emits them; record gaps in the worklog.

# Phase 18 — Event-sheet guardrails: a fork-owned diagnostics layer over the events tree

Status: planned 2026-10-06.
Decisions D18-1…D18-9 are **proposals awaiting the owner's answer** (§2); the steps below assume the recommended answers.
Depends on: the committed tree — the events-tree renderer and the `isElseEventValid` precedent. No Core change, no WASM rebuild, no new dependency.
Runs on desktop and browser alike (pure renderer JS).

## 1. Background — what the owner asked for vs. what the tree already has

The owner's list of worst workflow complaints names three traps: object-picking confusion (an action hits every instance because nothing "picked" a subset), "Trigger Once inside a For Each" (it stops the whole loop after the first object), and over-reliance on `Wait`. The proposal: flag them in the editor instead of leaving users to discover them by debugging.

**What already exists and is reused as shipped:**

1. **A single wrapper around every event type.** `EventContainer` (`newIDE/app/src/EventsSheet/EventsTree/index.js:172-364`) resolves the per-type renderer at `:251` and renders it at `:293-354`. `[load-bearing]` A badge added just before `:293` decorates **every** event of every type with one edit — no per-renderer change. `_renderEvent` (`:857-864`), the node title assigned at `:1039`, is the second all-event site.
2. **Warning rendering to imitate.** `Instruction.js:491-495` applies the warning class and `:531-560` renders a `<Warning/>` icon inside a `<Tooltip>`, colored by `theme.message.warning` (`:222`); class names live in `EventsTree/ClassNames.js:16` (`warningInstruction`) and `:21` (`invalidElse`); the CSS is in `UI/Theme/Global/EventsSheet.css:144-145` and `:268`.
3. **A pure-JS rule precedent, end to end.** `isElseEventValid(eventsList, index)` (`EventsTree/helpers.js:133-147`) is computed while building the tree (`EventsTree/index.js:1019-1022`), stored on the node (`:1048`), forwarded to the renderer (`:349`, `:950`) and consumed as a class + tooltip (`Renderers/ElseEvent.js:33,45,50-62`; field typed at `Renderers/EventRenderer.js:57`). `[load-bearing]` A guardrail rule is exactly this shape — a pure predicate over `gd` events — so **no C++ and no new engine API** is involved.
4. **The instruction/event type strings already exist.** `BuiltinCommonInstructions::Once` (`GDJS/GDJS/Extensions/Builtin/CommonInstructionsExtension.cpp:406`; read in JS at `OnceInstructionSanitizer.js:12,16,25`), `::While` (`:422`), `::Repeat` (`:696`), `::ForEach` (`:780`). Reading them is `event.getType()` / `instruction.getType()` — no registration needed.

**What does not exist, and is the real work:**

- **No ancestor context.** `buildEventsTreeData` (`EventsTree/index.js:990-999`) carries `depth`, `parentDisabled` and path arrays but **no ancestor-event stack**, and `EventContext` (`EventsSheet/SelectionHandler.js:33-38`) has no parent reference. `[load-bearing]` "A `Once` whose event has a `ForEach`/`Repeat`/`While` ancestor" therefore needs the builder's recursion to carry the ancestor chain (a signature extension; the derived path form already exists as `nodePath` at `:1052-1053` and `isDescendant` at `helpers.js:69-77`).
- **No rule registry or logic-advice engine.** The `Hints` module (`newIDE/app/src/Hints/index.js:6-10`) feeds the instruction-edit dialog, not the sheet, and the C++ `DiagnosticReport` is an export-time asset/type check. Both are orthogonal, so the rule engine is entirely ours.
- **Nothing that reads a scene as *diagnostics* for the AI.** `read_scene_events` (`EditorFunctions/index.js:4305-4369`, registered `:8192`) renders events as text; it does not evaluate rules.

## 2. Decisions (proposed 2026-10-06 — awaiting owner)

- `[D18-1]` **Namespace: `newIDE/app/src/Fork/Guardrails/`, AI exposure through a BYOK tool.** Consistent with Phases 16/17: the rule engine is a non-AI fork module; the AI reaches it through a thin `Byok` adapter.
  **Recommended: yes.** `[proposed]`
- `[D18-2]` **The v1 rule set** (each a stable rule id used in the tooltip and the AI output):
  - `[G18-once-in-loop]` **warning** — a `BuiltinCommonInstructions::Once` condition on an event that has a `ForEach`/`Repeat`/`While` ancestor: the loop halts after the first object.
  - `[G18-wait-in-loop]` **warning** — a `Wait` action inside a `ForEach`/`Repeat` ancestor: waits stack and desync the loop.
  - `[G18-action-without-picking]` **info** — an action references object `X` while **no condition in the same event** references `X`: the action applies to *every* instance of `X`. This is the object-picking trap; it is advisory (a valid pattern exists), hence info, not warning.
  - `[G18-duplicate-once]` **warning** — two `Once` conditions in the same conditions list (`OnceInstructionSanitizer` silently repairs some of these; the guardrail explains it).
  **Recommended: as stated** (the picking rule deliberately ships as info to avoid noise). `[proposed]`
- `[D18-3]` **Severity is a first-class field** (`warning` | `info`), rendered with the existing colours (warning = `theme.message.warning`; info = muted) so it reads as GDevelop already does.
  **Recommended: yes.** `[proposed]`
- `[D18-4]` **The primary surface is the inline badge + tooltip; the aggregate surface is the AI tool plus a scene count.** No dedicated issues panel in v1.
  A panel is a nice-to-have that risks becoming a second events view; the badge explains in place, and the AI can list every issue on request.
  **Recommended: inline-first.** `[proposed]`
- `[D18-5]` **Rules are fork-owned pure JS; no C++ `DiagnosticReport` change.** The export-time diagnostic machinery stays untouched.
  **Recommended: yes.** `[proposed]`
- `[D18-6]` **AI tool `scan_scene_events`** returns the diagnostics for a scene (rule id, severity, event path, message) and writes nothing.
  **Recommended: yes.** `[proposed]`
- `[D18-7]` **On by default, with a setting** to disable the layer and to toggle individual rules (some projects may find the info-level picking advisory noisy).
  **Recommended: on by default.** `[proposed]`
- `[D18-8]` **v1 explains; it does not auto-fix.** Quick-fixes (e.g. hoisting `Once` out of a loop) are deferred — they mutate user logic and deserve their own design.
  **Recommended: explain-only in v1.** `[proposed]`
- `[D18-9]` **Dispatch-cap raise.** The `scan_scene_events` tool pushes `BYOK_TOOL_NAMES` past the 69 cap (`ByokToolSchema.js:2421`); the raise covers the tools of Phases 16–19 together (see `usertasks.md` §6).
  **Recommended: yes.** `[proposed]`

## 3. Steps

> Files named below are today's locations; per AGENTS.md §8, re-locate anything that moved.
> New fork code goes to `newIDE/app/src/Fork/Guardrails/` (D18-1); the AI adapter is a BYOK-only tool (no `EditorFunctions` change).

### Step 18.1 — Core: the pure rule engine

**Goal:** given `gd` events, produce diagnostics — with no React, no project, no filesystem — so every rule is unit-testable.

Depends on: nothing.

Files created:
- `newIDE/app/src/Fork/Guardrails/ForkGuardrailRules.js` — pure functions:
  - `analyzeEventGuardrails({ event, ancestors, indexInList, conditions, actions })` returns `Array<{ ruleId, severity, message }>` for one event, where `ancestors` is the chain of `{ event, indexInList }` (the D18-2 rules read it).
  - `collectForkGuardrailDiagnostics(eventsList)` — walks `eventsList` recursively (`getSubEvents()`), threading the ancestor stack, and returns `Array<{ ruleId, severity, message, nodePath }>`; `nodePath` uses the same absolute-path encoding the tree builds (`EventsTree/index.js:1052-1053`) so a diagnostic can be mapped back to a row.
  - Rule predicates isolated per rule id (so a rule can be toggled and tested alone); the object-picking rule reads condition/action object parameters via the instruction's parameter objects.
- `newIDE/app/src/Fork/Guardrails/ForkGuardrailRules.spec.js` — one spec per rule (positive + negative case), plus the recursion/ancestor tests.

Upstream touchpoints: none.

Acceptance criteria:
- `once-in-loop` fires for a `Once` under a `ForEach`, and does **not** fire for a top-level `Once` or a `Once` in a non-loop sub-event — spec-proven.
- `action-without-picking` fires only when the action's object is absent from every condition of the same event — spec-proven (both directions).
- The analyzer terminates on deeply nested sheets and returns a `nodePath` per diagnostic — spec-proven.

### Step 18.2 — Wiring: ancestors in the tree builder + the inline badge

**Goal:** the diagnostics appear on the right rows, computed once per tree rebuild.

Depends on: 18.1.

Files created:
- `newIDE/app/src/Fork/Guardrails/ForkGuardrailBadge.js` — a small presentational component: the `<Warning/>`/info icon in a `<Tooltip>` listing the rule messages, styled with the existing warning colour and adopting an inline style rather than a new CSS class (keeps the upstream diff to zero CSS edits).

Upstream touchpoints (small, additive):
- `newIDE/app/src/EventsSheet/EventsTree/index.js` — extend `buildEventsTreeData` (`:990-1055`) so its recursion threads an **ancestor stack** through the existing `getSubEvents()` call (`:1024-1036`), run `analyzeEventGuardrails` per event, and attach a `guardrails` field to the node (beside `isValidElseEvent` at `:1048`); render `ForkGuardrailBadge` in `EventContainer` just before the event component (`:293`), and forward the field the way `isValidElseEvent` is forwarded (`:349`, `:950`).
- `newIDE/app/src/EventsSheet/EventsTree/SortableEventsTree.js` — only the `SortableTreeNode` type (`:15-30`), if the new node field is typed. Row rendering already delegates to `node.title` (`:348`), so no render change is needed there.
- The `EventsContainerProps`/`EventRendererProps` types (`EventRenderer.js`) gain the optional `guardrails` field, exactly as `isValidElseEvent` did (`:57`).

Acceptance criteria:
- A Once-in-loop and a wait-in-loop show a badge with the right tooltip; a clean event shows none — spec-proven at the analyzer/node level and confirmed visually (18.4).
- Toggling the D18-7 setting removes the badges without touching event data — spec-proven.
- Event data is never mutated by analysis (hash the events list before/after) — spec-proven.

### Step 18.3 — AI access: the BYOK tool and prompt

**Goal:** a user can ask the AI to scan a scene and explain the traps.

Depends on: 18.1.

Files created / modified:
- `Fork/Guardrails/ForkGuardrailToolHandler.js` (new) — `scanSceneEvents(project, { sceneName, ruleIds? })` over 18.1, returning the diagnostics (rule id, severity, message, nodePath) and writing nothing.
- `Byok/ByokGuardrailTools.js` (new) — the thin `ByokExtraTool` adapter (`ByokExtraTools.js:126-137`), `modifiesProject: false`, delegating to the handler; registered by spreading a `getByokGuardrailTools()` into `BYOK_EXTRA_TOOLS` (`ByokExtraTools.js:706-744`).
- `Byok/ByokToolSchema.js` (modified, appended entries only) — the `scan_scene_events` schema, its addition to `BYOK_TOOL_NAMES` (`:115`) and to `BYOK_ONLY_TOOL_NAMES` (`:2284`, since it has no registry entry), and the D18-9 cap raise.
- `Byok/Knowledge/ByokKnowledgeSections.js` (modified) — a `BYOK_TASK_CATALOG` row (`:193-317`) so `search_tools` reaches the tool (it is not a core tool).
- `Byok/ByokPrompts.js` (modified) — prompt bump (`:47`).
- Specs for the handler and the schema/registry guard.

Upstream touchpoints: none (the tool is BYOK-only; `read_scene_events` is untouched).

Acceptance criteria:
- `scan_scene_events` resolves, validates, and is reachable through `search_tools` but absent from `BYOK_CORE_TOOL_NAMES` (budget unchanged) — spec-proven.
- It writes nothing and returns the same diagnostics the engine produces — spec-proven.

### Step 18.4 — Verification round

Depends on: 18.1–18.3.

How to implement:
1. `npm test -- --watchAll=false`, `npm run lint`, `npm run flow`, `npm run check-format` from `newIDE/app`.
2. Open a scene containing each trap by hand; confirm the badges, the tooltips, and that a clean scene is clean.
3. Confirm the events sheet still edits/undoes normally (no data touched).
4. Run the manual QA in §4.

## 4. Phase 18 acceptance criteria (phase gate)

- `[A18-1]` A `Once` inside a `ForEach`/`Repeat`/`While` shows a warning whose tooltip states the loop-stops-after-the-first-object trap; a top-level `Once` does not.
- `[A18-2]` The picking advisory fires only when an action's object is referenced by no condition of the same event, and never when it is.
- `[A18-3]` The AI can scan a scene and return the same diagnostics, writing nothing.
- `[A18-4]` Rules are pure fork JS; no Core/WASM/`DiagnosticReport` change; the on/off and per-rule settings work.
- `[A18-5]` The upstream touchpoint budget is `EventsTree/index.js` (mandatory) plus optionally `SortableEventsTree.js` (type only) and the renderer props type; each is recorded in the worklog. No CSS file is edited (inline styles).
- `[A18-6]` Every new function has a spec; all four gates are green.
- `[A18-7]` Manual desktop QA passes: the badges render and explain on a hand-built trap scene (owner).

## 5. Explicitly not in this phase

- **Auto-fixes** — v1 explains only (D18-8).
- **A dedicated issues panel / a second events view** — the badge + the AI tool cover v1 (D18-4).
- **Extending the C++ `DiagnosticReport`** or the export-time diagnostics — a separate, WASM-rebuild path.
- **Rules that need whole-project analysis** (cross-scene variable/behavior checks) — v1 is per-scene.
- **Rules that require runtime knowledge** (actual picking results at play time) — the picking rule is a static advisory, not a simulator.

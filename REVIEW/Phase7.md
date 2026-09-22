# Phase 7 — Knowledge, Prompts, and the Skills System

**Status:** planned · **Depends on:** Phase 5 (tool surface; `byok-v3`),
Phase 6 (perception, `byok-v4`) · **Read first:** [Phase5.md](Phase5.md) §0 ·
[AIflow.md](AIflow.md) §4 (prompt map) · [styleguide.md](styleguide.md)

---

## 1. Introduction — what this phase delivers

Today's BYOK prompt (`byok-v2`→`byok-v4`) is **operational only** — role,
tools, snapshot rules. The hosted agent's game-making knowledge lives in
server prompts we can't see. This phase builds the knowledge layer that lets
BYOK **beat** the hosted agent at game making, structured so it stays
high-signal instead of bloated (context rot is real: recall degrades as
tokens grow — Anthropic context-engineering guidance; "smallest set of
high-signal tokens per step").

Concretely:

1. **Prompt architecture** — `ByokPrompts.js` becomes a section composer over
   pluggable knowledge modules with a token budget; versions continue
   (`byok-v5`).
2. **Engine reference, machine-generated** — objects, behaviors, actions,
   conditions, expressions catalogs are all declared in
   `Extensions/*/(Extension.cpp|JsExtension.js)` and
   `Core\GDCore\Extensions\Builtin\*`; a generator script turns them into a
   compact JSON reference the agent queries via a `search_reference` tool
   instead of carrying it in the prompt.
3. **EventScript grammar pack** — the full authoring reference (grammar
   derived in-repo from `EventScriptRenderer.js` + fixtures) with worked
   examples — the difference between surgical event edits and mush.
4. **Game-design system messages** — the biggest missing piece: genre
   patterns, game feel/juice mapped to GDevelop features, difficulty/level
   design patterns, standard systems recipes (HUD, save, menus, …).
5. **Math / physics / JS packs** — "never do physics math in your head"
   guidance (LLM arithmetic/spatial failure modes are documented), the full
   expression catalog (lerp, AngleBetweenPositions, …), Box2D/Jolt recipes,
   frame-rate independence, and the JS surface for JS events &
   extensions (runtimeScene/objects/eventsFunctionContext, `gdjs.evtTools`,
   PixiJS/three.js renderer access — with churn warnings).
6. **Skills system** — SKILL.md-style progressive disclosure (the 2025–2026
   industry pattern: metadata always, body on demand): a `load_skill` tool, a
   shipped starter set, user-authored skills on desktop.
7. **Docs access** — GDevelop's docs are open-source Markdown
   (GDevelopApp/GDevelop-documentation); bundle a curated subset offline +
   fetch-on-demand for the rest; replaces the hosted agent's server-side
   `read_full_docs`/`search_docs`.
8. **Per-project notes** — a small persistent "project memory" the agent
   reads at chat start and updates (`update_project_notes` tool) — the
   CLAUDE.md discipline, auto-maintained.

### New files created in this phase

```
Byok\Knowledge\ByokKnowledgeSections.js / .spec.js   section registry + budget composer
Byok\Knowledge\ByokEngineReference.js / .spec.js     loader/slicer for the generated catalog
Byok\Knowledge\ByokEventScriptPack.js / .spec.js     full grammar + examples
Byok\Knowledge\ByokGameDesignPack.js / .spec.js      design principles (always-on core)
Byok\Knowledge\ByokMathPhysicsPack.js / .spec.js     math/physics/js guidance
Byok\Knowledge\ByokJsApiPack.js / .spec.js           JS events/extensions/three.js reference
Byok\Skills\ByokSkills.js / .spec.js                 skill registry, load_skill tool, parsing
Byok\Skills\*.md                                     starter skills (content, not code)
Byok\ByokDocs.js / .spec.js                          curated docs index + fetch/cache
Byok\ByokProjectNotes.js / .spec.js                  per-project memory (storage-backed)
newIDE\app\scripts\generate-byok-engine-reference.js build-time/first-run catalog generator
```

Modified: `Byok\ByokPrompts.js` (composer + `byok-v5`),
`Byok\ByokToolSchema.js` (+3 tools), `Byok\ByokOrchestrator.js` (skill
injection point), `Byok\ByokSettingsTab.js` (custom-instructions field).
Docs data: `Byok\docs\` curated Markdown (license-checked, see 7.7).

---

## 2. Steps

### Step 7.1 — Prompt composer with token budget

**Goal:** many knowledge sources, one disciplined system prompt.

**How to implement:**

1. `ByokKnowledgeSections.js`: sections become `{id, title, build(context),
   budgetTokens}` registered in priority order: role, tools, project context,
   output rules, planning, agents policy (Phase 8 will amend), then knowledge
   sections. The composer concatenates until the budget
   (`BYOK_SYSTEM_PROMPT_BUDGET`, start 6k tokens ≈ 24k chars) is hit,
   lower-priority sections degrade to one-line summaries (their bodies
   reachable via skills/tools — progressive disclosure).
2. `buildByokSystemPrompt` keeps its signature + adds `context` (skills
   metadata list, knowledge flags); the version bumps to `byok-v5`.
3. Char-budget accounting is pure and unit-tested; the prompt↔schema sync
   test from Phase 4 survives unchanged.

**Files:** `Byok\Knowledge\ByokKnowledgeSections.js` + spec;
`ByokPrompts.js` refactored.
**Tests:** budget respected with many sections registered; priority order
stable; overflow degrades gracefully (summary line present, body absent).
**Depends on:** Phase 5.

---

### Step 7.2 — Engine reference catalog + `search_reference` tool

**Goal:** the agent knows every object/behavior/action/condition/expression
that exists, without carrying the catalog in the prompt.

**How to implement:**

1. `scripts\generate-byok-engine-reference.js` (dev script, run at build or
   first launch): walks `Extensions\*\JsExtension.js` / `Extension.cpp`
   metadata + `Core\GDCore\Extensions\Builtin\*` and emits
   `Byok\docs\engine-reference.json` — entries
   `{kind: object|behavior|action|condition|expression|effect, owner, name,
   description, parameters:[{name,type,description}]}`. The metadata is
   already declarative (`addObject/addBehavior/addAction/…`) — this is
   mechanical extraction, not authoring. C++-declared extensions are parsed
   from their `Extension.cpp` registration calls (regex-light, tolerant,
   failures logged and skipped — never fatal).
2. `ByokEngineReference.js`: loads the JSON lazily; `search(kind, owner?,
   query)` returns the top matches (name/description substring + prefix
   scoring — no new deps, no embeddings) capped at ~40 entries with a
   "narrow your query" steering line when truncated (tool-response
   discipline).
3. Tool `search_reference({query, kind?, owner?})` registered in
   `ByokExtraTools`. Always-on prompt core keeps only the cheat-sheet:
   event anatomy, object-picking semantics, `TimeDelta` rule, and the
   ~25 most-used expressions/actions (from `MathematicalToolsExtension.cpp`
   list: lerp, lerpAngle, clamp, RandomInRange, DistanceBetweenPositions,
   AngleBetweenPositions, X/YFromAngleAndDistance, AngleDifference, …).

**Files:** generator script, `ByokEngineReference.js` + spec, schema entry.
**Tests:** search ranking + cap + steering line; loader tolerates missing
file (tool returns "reference unavailable" gracefully); generator smoke test
on a fixtures subset (one small JS extension + one Builtin cpp).
**Depends on:** 7.1.

---

### Step 7.3 — EventScript grammar pack

**Goal:** reliable, surgical event authoring.

**How to implement:**

1. `ByokEventScriptPack.js`: the full grammar (statement forms, condition
   composition `and`/`not`/`Or`/`once`, `disabled`, escaping rules,
   `# event-N.M` anchors, collapse markers) + 6–10 worked examples covering:
   movement+collision loop, trigger-once patterns, for-each iteration,
   sub-events, JS code event block, link/group/comment. Sourced from
   `EventScriptRenderer.js` + `EventScriptRenderer.fixtures.json`.
2. Split: a 15-line operational core stays always-on (from Phase 5); the
   full pack loads via skills (7.6) or on first `add_scene_events` failure
   (the orchestrator offers it — a `suggest_skill` line in the corrective
   output).

**Files:** `ByokEventScriptPack.js` + spec (content assertions: grammar
lines present, examples parse with the Phase 5 parser — the pack and parser
are test-linked).
**Depends on:** Phase 5 Step 5.2.

---

### Step 7.4 — Game-design system messages

**Goal:** the agent designs like a game designer, not a code generator.

**How to implement:**

1. `ByokGameDesignPack.js` — always-on core (~40 lines):
   - **Design-first rule:** for any "build me X" request, draft a 5-line
     design (core loop, verbs, win/lose, feel) in the plan before editing.
   - **Loop-first heuristic:** every mechanic = player verb → rules →
     feedback (visual/audio/state); name the feedback for every mechanic.
   - **Juice vocabulary mapped to the engine:** screen shake (camera
     actions), hit-stop/particles (Particle emitter), easing (Tween
     behavior), flashes (opacity tween), sound (audio actions) — the agent
     should reach for these unprompted.
   - **Difficulty & pacing:** introduce → combine → twist; numbers go in
     variables, never literals, so they're tunable.
   - **Scope discipline:** smallest playable slice first; propose
     extensions, don't build them unasked.
2. Depth lives in skills (7.6): genre playbooks (platformer, top-down
   shooter, puzzle-match, endless runner), level-design patterns, balance
   heuristics, accessibility defaults.
3. This is authored content (ours, versioned with the prompt) — cite no
   external sources inside the pack; keep it opinionated and short.

**Files:** `ByokGameDesignPack.js` + spec (section presence, budget).
**Depends on:** 7.1.

---

### Step 7.5 — Math, physics & JS packs

**Goal:** kill the known failure modes at the prompt level.

**How to implement:**

1. `ByokMathPhysicsPack.js` (always-on core ~25 lines):
   - "Never compute geometry/arithmetic in your head: use expressions
     (`lerp`, `AngleBetweenPositions`, …) or compute inside `run_script`."
   - Frame-rate independence (`TimeDelta` multiplication), degree conventions
     (GDevelop angles: degrees, 0 = right/X+, clockwise on Y-down screen
     coordinates — spell it out, it's a classic LLM trip-up), vector recipes
     via the expression catalog, probability via `RandomFloatInRange`.
   - Physics recipes (skill-depth): Box2D 2D — 12 joint types exist
     (Revolute…Motor), forces vs impulses, density/friction/restitution
     defaults; Platformer tuning — gravity/max fall/slopes/ladders parameter
     names; 3D Jolt (Physics3DBehavior: rigid bodies, character, car).
2. `ByokJsApiPack.js` (skill-loaded, always-on core ~10 lines):
   - JS event scope (`runtimeScene`, `objects`, `gdjs`), extension-function
     scope (`eventsFunctionContext.getObjects/getArgument`, behaviors get
     `this.owner`), the `gdjs.evtTools.*` helper list (common/string/object/
     camera/input/sound/storage/variable/window/network), object renderer
     access `getRendererObject()` (Pixi) / `get3DRendererObject()` (three),
     layer 3D access `runtimeScene.getLayer(name).getRenderer().getThreeScene()`.
   - Churn warning: renderer internals are version-dependent; prefer events
     unless JS is clearly better. Pointer to the bundled TypeDoc reference
     (7.7) for full signatures.

**Files:** both packs + specs.
**Depends on:** 7.1; `run_script` from Phase 5 for the compute guidance.

---

### Step 7.6 — The skills system

**Goal:** unbounded knowledge, bounded context — the SKILL.md pattern
(metadata always, body on demand), plus user extensibility.

**How to implement:**

1. Format (open standard agentskills.io, adapted): a skill = Markdown file
   with frontmatter `name`, `description` (when to use), `tools?` (optional
   tool-subset hint for Phase 9), body = instructions/playbook. Shipped set
   lives in `Byok\Skills\*.md`; desktop users add skills in
   `{userData}\byok-skills\*.md` (electron `app.getPath` via a tiny IPC —
   reuse the Phase 3 IPC precedent).
2. `ByokSkills.js`: registry = parse + validate (frontmatter present, name
   unique, size cap 32 KB); system prompt gains a "Available skills" appendix
   (name + one-line description each — this is the metadata-only level);
   `load_skill({name})` tool returns the body as a tool output (the
   on-demand level); once loaded, the body stays attached to the chat as a
   persistent context block (not re-loaded per turn; dropped at compaction
   with a pointer to re-load — Phase 9).
3. Starter set (authored in this phase, each ≤ ~120 lines):
   `platformer-game.md`, `top-down-shooter.md`, `puzzle-grid.md`,
   `hud-and-menus.md`, `save-system.md`, `juice-and-game-feel.md`,
   `physics-2d-recipes.md`, `3d-scene-basics.md`, `js-custom-rendering.md`,
   `eventscript-authoring.md` (wraps 7.3), `gameplay-testing.md` (wraps
   Phase 6 harness API: stepFrames/stepUntil/input simulation/assert).
4. Skill content is project-agnostic by design; per-project specifics belong
   to project notes (7.8). Verified-skill banking (Voyager-style: store
   snippets after a green test run) is **deferred** to Phase 8/9.

**Files:** `ByokSkills.js` + spec; `Byok\Skills\*.md`; schema entry for
`load_skill`; `ByokSettingsTab.js` gets a "Skills folder (desktop)" hint row.
**Tests:** parser (valid/invalid frontmatter, dup names, size cap); appendix
rendering includes every shipped skill; `load_skill` returns body + marks
chat-level attachment; user-folder merge order (builtin < user override).
**Depends on:** 7.1.

---

### Step 7.7 — Docs access

**Goal:** replace the server-side `read_full_docs`/`search_docs` honestly.

**How to implement:**

1. **License check first** (GDevelop-documentation repo — confirm permissive
   licensing for redistribution in the worklog before bundling anything).
2. Curated offline subset in `Byok\docs\`: the ~16 events pages
   (`docs/gdevelop5/events/**`), `js-code.md`, `expressions.md`,
   `object-picking.md`, plus a generated extension-reference index
   (7.2 output doubles as this). Indexed by `ByokDocs.js` (title + path +
   tokenized headings — substring search like 7.2, no deps).
3. Tools: `search_docs({query})` (returns page titles + section matches),
   `read_doc({page})` (returns Markdown, capped, section slice by anchor).
   Online expansion (desktop, optional toggle): fetch missing pages from
   `raw.githubusercontent.com/GDevelopApp/GDevelop-documentation/main/docs/…`
   with a 24h cache — offline-first, online-best.
4. The pack system references docs instead of duplicating them where
   possible (skills link `[docs: events/js-code]`).

**Files:** `Byok\ByokDocs.js` + spec; `Byok\docs\*` (bundled subset);
schemas for the two tools.
**Tests:** index/search over a fixture subset; capping; offline mode never
fetches (asserted with a mocked fetch).
**Depends on:** 7.2 (index plumbing shared).

---

### Step 7.8 — Per-project notes + custom instructions

**Goal:** the agent remembers the project across chats; the user steers the
persona.

**How to implement:**

1. `ByokProjectNotes.js`: notes stored per project file identifier (reuse the
   `fileIdentifier` concept from cloud-save metadata; local fallback: project
   name hash) — shape `{conventions, inProgress, decisions, updatedAt}` —
   via `PreferencesProvider`-adjacent localStorage in v1 (size-capped 8 KB),
   IndexedDB when Phase 9 lands persistence.
2. Tool `update_project_notes({conventions?, inProgress?, decisions?})`
   (merge semantics, model-driven); notes auto-inject as a small section
   after project context (budget ~300 tokens).
3. `ByokSettingsTab.js`: "Custom instructions" textarea (≤ 2 KB) injected as
   the last system section — user's global persona/rules (house style:
   everything in the Byok folder).

**Files:** `ByokProjectNotes.js` + spec; schema; settings field.
**Tests:** merge semantics; injection order; caps enforced.
**Depends on:** 7.1.

---

### Step 7.9 — Phase gate

1. Full gates from `newIDE\app`.
2. Manual QA (real endpoint, recorded):
   - "Make movement feel juicy" on a bare project → plan names Tween/
     particles/camera-shake (design pack working).
   - "What behaviors exist for platformers?" → `search_reference` used,
     correct parameter names quoted.
   - Load `platformer-game.md` skill → follow-up build uses its recipe.
   - `search_docs`/`read_doc` answer an expression question offline.
   - Custom instructions visibly change behavior ("always answer in French").
   - Prompt size stays ≤ budget with all knowledge flags on (log the
     composed length in DevTools console).

**Depends on:** 7.1–7.8.

---

## 3. Phase 7 acceptance criteria (phase gate)

- [ ] System prompt composed from sections under a tested token budget; `byok-v5`; prompt↔schema sync test green.
- [ ] Engine reference generated from repo metadata and queryable via `search_reference` (ranking/caps unit-tested); the always-on cheat sheet covers event anatomy, picking, TimeDelta, top expressions.
- [ ] EventScript pack present and **test-linked to the Phase 5 parser** (every example parses).
- [ ] Game-design core section, math/physics core, JS core shipped; each ≤ its budget; specs assert content markers.
- [ ] Skills system: shipped starter set parses; `load_skill` works; user folder overrides on desktop; metadata-only appendix in every prompt.
- [ ] Docs: curated subset bundled (license verified and noted in worklog), searchable offline, online expansion optional; zero GDevelop-backend calls.
- [ ] Project notes persist per project and inject; custom instructions field works (QA-verified).
- [ ] All four checks green; worklog entry complete.

---

## 4. Deferred (do not build in this phase)

- Verified-skill banking (auto-saving green-run snippets as skills) → Phase 8
  (needs the completion gates) / Phase 9 (needs evals).
- Embedding-based retrieval over docs/reference (current substring search
  suffices at this corpus size; revisit if users report misses).
- Multi-language docs; community skill marketplace/sharing.
- Auto-updating the bundled docs (ship a version; update with releases).

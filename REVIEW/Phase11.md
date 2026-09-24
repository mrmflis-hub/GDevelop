# Phase 11 — Authoring Reach: External Scenes, Effects, Sprites, Resources, Extension Internals

**Status:** planned 2026-09-24 (owner green-lit the item list in chat; the
D11 decisions below are answered at implementation kickoff, recommendations
included) · **Depends on:** Phases 4–8 (tool parity, the seam, the
executor, extension authoring) · **Read first:** [AIflow.md](AIflow.md) §5,
`phase5-tool-decisions.md` (the admit/exclude table this phase extends),
`Phase8.md` (ByokExtensionTools patterns), [styleguide.md](styleguide.md)

> **Design note (2026-09-24):** the 2026-09-23 audit ("surfaces that could
> still be connected to AI") found which editor capabilities the BYOK agent
> cannot touch because no tool exists. The owner picked the authoring-side
> gaps for this phase: **external events + external layouts, effect-type
> discovery, sprite-frame internals, resource import/replace, and
> extension-editor internals** (custom-object children, post-creation
> parameter declarations, extension dependencies). Feasibility was surveyed
> against the tree on 2026-09-24; the file:line anchors below come from that
> survey and were verified read-only. The discovery/runtime/MCP half of the
> backlog is Phase 12.
>
> All new tools are **BYOK-only tools** (implemented in `Byok\` modules,
> advertised via `BYOK_TOOL_NAMES`) — the upstream registry
> (`EditorFunctions\index.js`) stays untouched except for the one
> behavior-preserving extraction budgeted in step 11.1, mirroring how
> Phases 7/8 handled interception.

---

## 1. Introduction — what this phase delivers

Today the agent can author scenes (events, instances, objects, variables,
properties) and events-based extensions, but it is blind to whole classes of
project content: it cannot read or write an **external events** sheet or an
**external layout**, cannot discover which **effects** exist (it guesses
`effect_type` strings), cannot edit **sprite internals** (animations,
frames, points, collision masks), cannot **import a resource**, and cannot
add **children or parameters** to an extension it created earlier. Each gap
maps to editor code that already drives libGD from the renderer — this phase
exposes that surface to the agent with eight new tools and two extended
ones.

New BYOK tools (advertised set grows 48 → 56; prompt `byok-v6` → `byok-v7`):

| Tool | Purpose | Module |
|---|---|---|
| `read_external_events_source` | read an external-events sheet as EventScript | `Byok\ByokExternalSceneTools.js` |
| `add_external_events` | create (if missing) + write events into an external-events item | same |
| `describe_external_layout` | read the instances of an external layout | same |
| `put_external_layout_instances` | brush-place instances into an external layout | same |
| `list_effects` | catalog of effect types + property schemas | `Byok\ByokCatalogTools.js` |
| `describe_sprite_frames` | read animations/directions/frames/points/masks | `Byok\ByokSpriteTools.js` |
| `change_sprite_frames` | edit the same via a typed ops list | same |
| `import_project_resources` | register/copy/download a resource, or retarget (replace) one | `Byok\ByokResourceTools.js` |

Extended tools (schemas gain optional fields, names unchanged):
`change_custom_function` (+ `parameters_to_add`/`parameters_to_remove`/
`parameters_to_move`), `change_extension_properties` (+
`dependencies_to_add`/`dependencies_to_remove`), `change_custom_object` (+
`children_to_add`/`children_to_remove`) — all in `Byok\ByokExtensionTools.js`.

Feasibility anchors (from the 2026-09-24 survey):
- External events: `project.hasExternalEventsNamed/getExternalEvents`
  (`ExternalEventsEditorContainer.js:225-233`); `gd.ExternalEvents.getEvents()`
  is the same `gdEventsList` shape the scene tools already consume, and
  `applyEventsChanges` (`ApplyEventsChanges.js:295`) plus
  `buildEventScriptSourceView` (`EventScriptSourceView.js:272`) are
  container-generic as-is.
- External layouts: `project.hasExternalLayoutNamed/getExternalLayout`
  (`ExternalLayoutEditorContainer.js:318-326`); `getInitialInstances()` is
  the same container shape `describe_instances`/`put_2d_instances` walk.
- Effects: `enumerateEffectsMetadata(project)` (`EffectsList\EnumerateEffects.js:23-67`)
  already yields type, fullName, description, 2D/3D/object flags and the
  property schema (via `effectPropertiesMapToSchema`,
  `PropertiesMapToSchema.js:580-624`); ~45 effect types total.
- Sprites: every SpriteEditor operation maps 1:1 to bound libGD methods
  (`SpriteObject.getAnimations()` down to `Point`/`Polygon2d`,
  `GDevelop.js\types.d.ts:2917-3029`), exercised from the renderer today by
  `SpriteObjectHelper.js`, `SpritesList.js`, `AnimationList.js`,
  `PointsList.js`, `PolygonsList.js`.
- Resources: `new gd.ImageResource()`-style factories (`ResourceSource.js:39-118`),
  `getResourcesManager().addResource(res)` then `res.delete()`
  (`ResourceSelector.js:302-308`), project-relative paths
  (`LocalResourceSources.js:189-216`), copy helper `copyAllToProjectFolder`
  (`ResourceUtils.js:62-118`), usage guards (`ObjectsUsingResourceCollector`,
  `EditorFunctions\index.js:7856-7901`).
- Extension internals: children are just `eventsBasedObject.getObjects()`
  (no `addChild` API — normal objects-container insertion,
  `EventsBasedObjectEditor.js:99-219`); parameters go through
  `eventsFunction.getParameters()` (`insertNewParameter/removeParameter/
  moveParameter/setName/setType`, `CompactEventsFunctionParametersEditor.js:285-397,512-545`);
  dependencies via `eventsFunctionsExtension.getAllDependencies()`
  (`ExtensionDependenciesEditor.js:59-164` — note the name).
- libGD cautions to encode in every sprite/resource step: never cache
  `gdDirection`/`gdSprite`/resource wrappers across add/remove (C++ vector
  reallocation → dangling pointers, `SpritesList.js:292-307`); `delete()`
  every wrapper you `new` after the container copies it
  (`ResourceSelector.js:306-308`, `SpritesList.js:458-461`).

---

## 2. Open owner decisions (answered at kickoff; recommendations included)

1. **D11-1 — External events/layouts: dedicated tools vs optional-arg
   overloads** of `read_scene_events`/`add_scene_events`/`describe_instances`/
   `put_2d_instances`. Recommend: **dedicated tools**, with the writers
   creating the external item if missing (`create_if_missing` +
   `associated_scene`). Overloads would mutate four stable schemas (eval
   churn) and hide the external surface behind "one more optional arg";
   four names keep the prompt explicit. Create-if-missing on writers only —
   readers list what exists in their not-found error.
2. **D11-2 — Sprite internals: one read + one write tool vs per-facet
   tools** (animations / points / masks separately). Recommend: **one read
   (`describe_sprite_frames`) + one write (`change_sprite_frames`) taking a
   typed ops list** (add/remove/reorder animation, set directions count,
   add/remove/reorder frames, set frame image, set origin/center, add/move/
   remove point, set full-image vs polygon mask). Same style as
   `put_2d_instances`' brush list; keeps the tool count down.
3. **D11-3 — Resource import input modes.** Recommend: one tool accepting
   `source` = **URL** (downloaded through the existing
   `local-file-download` IPC, `LocalFileResourceMover.js:198-202`),
   **absolute path** (copied into the project folder via the
   `copyAllToProjectFolder` semantics), or **project-relative path**
   (registered in place); `replace_existing` retargets an existing resource
   (`setFile`) instead of adding. The agent never opens file dialogs;
   the web build fails the call with an explicit desktop-only message
   (the `ByokChatStorageBackends` degradation pattern).
4. **D11-4 — Instance-helper extraction from `EditorFunctions\index.js`.**
   The external-layout tools need `describe_instances`/`put_2d_instances`
   internals, which live inline in the registry (`index.js:3316-3493`,
   `:3493-4385`). Recommend: **behavior-preserving extraction** of the pure
   core into `EditorFunctions\InstanceTools.js` (functions take a
   `gdInitialInstancesContainer`, not a layout), with `index.js` delegating
   to it and the existing `DescribeInstances.spec.js`/`Put2dInstances.spec.js`
   green before and after — the one budgeted upstream touch of this phase,
   recorded in the worklog.
5. **D11-5 — Prompt + evals.** Recommend: **bump the prompt to `byok-v7`**
   once at the end of the phase (the advertised surface changes), and add
   ≥ 6 eval tasks (one per new tool family) to `scripts\run-byok-evals.js`;
   refresh `AIflow.md` §5 (its BYOK sections are stale — they still describe
   the Phase-5 11-tool whitelist).

---

## 3. Steps

### Step 11.1 — Instance-tool extraction (`EditorFunctions\InstanceTools.js`)

**Goal:** the pure, container-generic core of `describe_instances` and
`put_2d_instances` in an importable module, so step 11.3 can target external
layouts without duplicating ~1 000 lines.

**How to implement:**
1. Move (don't copy) the instance-walking and brush-application logic from
   `index.js` into exported functions that take an
   `gdInitialInstancesContainer` + the arguments they need (no `project`
   unless the signature already has it). Keep every helper's behavior
   byte-for-byte; guard clauses stay, style rules apply to moved code
   without rewriting it.
2. `index.js`'s `describe_instances` and `put_2d_instances` delegate to the
   module; their registered names, schemas, `modifiesProject` metadata and
   outputs are unchanged.
3. New module spec covers the moved functions directly (the factories style
   of `MakeInstances.js`-style fixtures used by the existing specs).

**Tests:** existing `DescribeInstances.spec.js` + `Put2dInstances.spec.js`
green unchanged (delegation proof); new `InstanceTools.spec.js` for the
exported functions.
**Depends on:** nothing.

---

### Step 11.2 — External events tools (`Byok\ByokExternalSceneTools.js`, part 1)

**Goal:** read and write external-events sheets with the same EventScript
pipeline scenes use.

**How to implement:**
1. `read_external_events_source`: resolve
   `project.hasExternalEventsNamed/getExternalEvents` →
   `externalEvents.getEvents()` → the same source-rendering path
   `read_events_source` uses (`buildEventScriptSourceView`); include the
   associated scene name (`externalEvents.getAssociatedLayout()`) and the
   scene's/global object lists for context. Not-found error lists the
   existing external-events names (`EnumerateProjectItems.js:8-19`
   accessors) — sibling of `makeSceneNotFoundFailure`.
2. `add_external_events`: args `external_events_name`, `event_script`,
   `mode` (`replace`/`insert`), optional `create_if_missing` +
   `associated_scene`. Reuse the `ByokLocalEventWriter` parse+validate
   pipeline; make its apply step container-generic (take the target
   `gdEventsList` instead of resolving a scene internally — Byok's own file,
   free to change). Missing-item creation via
   `project.insertNewExternalEvents`.
3. Register both in `BYOK_EXTRA_TOOLS`-style interception (this module, not
   `ByokExtraTools.js`, to keep files small); mark
   `add_external_events` `modifiesProject: true` (approval row + MCP gate
   come free).

**Tests:** read round-trip on a fixture project (write via
`add_external_events`, read back identical source); create-if-missing;
not-found error content; `applyEventsChanges` container-genericity already
covered — assert the new wiring calls it with the external list.
**Depends on:** nothing.

---

### Step 11.3 — External layout tools (`Byok\ByokExternalSceneTools.js`, part 2)

**Goal:** let the agent see and populate external layouts (the spawn-point
mechanic), which it can then load via events it already writes.

**How to implement:**
1. `describe_external_layout`: `getExternalLayout(name).getInitialInstances()`
   through the step-11.1 describe core + `getAssociatedLayout()` in the
   output.
2. `put_external_layout_instances`: the 11.1 brush core against the same
   container; `create_if_missing` + `associated_scene` on creation
   (`project.insertNewExternalLayout`).
3. Same module, same registration pattern as 11.2; writer is
   `modifiesProject: true`.

**Tests:** mirror 11.2 (round-trip on fixtures, create-if-missing,
not-found listing); brush ops covered by the moved core's spec.
**Depends on:** 11.1, 11.2 (module + error helpers).

---

### Step 11.4 — Effect catalog (`Byok\ByokCatalogTools.js`)

**Goal:** the agent stops guessing `effect_type` strings.

**How to implement:**
1. `list_effects` (optional `filter`: `'2d'`/`'3d'`/`'object'`): run
   `enumerateEffectsMetadata(project)` and emit a compact array —
   `type`, `fullName`, `description`, flags
   (`notWorkingForObjects`/`only2D`/`only3D`), and per-effect
   `properties` as `{name, type, defaultValue, description, isAdvanced,
   isDeprecated}` (compact form, **not** the full PropertiesEditor Field
   shape). ~45 types keeps the output small; no pagination.
2. Note in the tool description that `change_object_properties_effects` /
   `change_scene_properties_layers_effects_groups` consume these `type`
   strings and defaults (via `changed_effects`).

**Tests:** fixture project → every bundled effect type appears with its
properties; filters; stable output shape.
**Depends on:** nothing.

---

### Step 11.5 — Sprite internals (`Byok\ByokSpriteTools.js`)

**Goal:** frame-level sprite editing: animations, directions, frames,
origin/center, custom points, collision masks.

**How to implement:**
1. Resolve the target object the same way `change_object_properties_effects`
   does; require a Sprite-type object (typed failure otherwise).
2. `describe_sprite_frames`: walk `getConfiguration().getAnimations()` →
   animation → directions → sprites (`SpriteObjectHelper.js:11-56` shape),
   emitting names, frame image names, points (`getAllNonDefaultPoints`),
   origin/center, and collision-mask mode (full-image vs polygon vertex
   counts). Cap output like `read_game_project_json` does (state the cap).
3. `change_sprite_frames`: typed ops list — animations
   (`add`/`remove`/`reorder`/`rename`, `set_directions_count`), frames
   (`add`/`remove`/`reorder`/`set_image_name`), points
   (`set_origin`/`set_center`/`set_default_center`/`add_point`/`move_point`/
   `remove_point`), masks (`set_full_image`/`set_polygon` with
   `Polygon2d.createRectangle`/vertex lists, per frame or all frames via the
   `setCollisionMaskOnAllFrames` pattern). Re-resolve wrappers by index at
   every op (no caching across mutations — `SpritesList.js:292-307`),
   `delete()` every `new` wrapper (`SpritesList.js:458-461`), and keep
   `adaptCollisionMaskAutomatically` semantics explicit in the ops
   (`SpriteObjectHelper.js`, `CollisionMasksEditor\index.js:253`).
4. `modifiesProject: true`. After edits, fire the same editor-refresh
   notification the registry tools use so open editors redraw.

**Tests:** describe → change → describe round-trips per op family on a
fixture sprite object; failure cases (non-sprite object, unknown frame
index, bad polygon); wrapper-lifecycle assertions (mock-count `delete()`).
**Depends on:** nothing.

---

### Step 11.6 — Resource import/replace (`Byok\ByokResourceTools.js`)

**Goal:** bring real assets into the project: images, audio, fonts, JSON —
the precondition for everything visual/audio the agent builds.

**How to implement:**
1. `import_project_resources`: `entries[]` of
   `{kind, source, name?}` where `source` is a URL, an absolute path, or a
   project-relative path (D11-3); `replace_existing` retargets an existing
   resource via `setFile` (usage-safe: same resource object, so references
   follow automatically).
2. Path handling: absolute paths are copied into the project folder with
   the `copyAllToProjectFolder` semantics (`ResourceUtils.js:62-118`,
   dedupe included); the project-relative target is computed with the
   `path.relative(...).replace(/\\/g, '/')` convention
   (`LocalResourceSources.js:189-216`); in-project paths register in place.
   URL sources download through the existing `local-file-download` IPC
   (`LocalFileResourceMover.js:198-202`) into the project folder.
3. Registration: kind factory (`ResourceSource.js:39-118`) → `setName`/
   `setFile` → `setOrigin('byok-import', source)` →
   `applyResourceDefaults` (`ResourceUtils.js:153-160`) →
   `getResourcesManager().addResource(res)` → `res.delete()`
   (`ResourceSelector.js:302-308`). Never register a path outside the
   project folder (validate with `isPathInProjectFolder`,
   `ResourceUtils.js:54-60`).
4. Electron-only reality (D11-3): `fs` and the download IPC come via
   `optionalRequire` (the `ByokChatStorageBackends` pattern); without them
   the tool returns a structured failure naming the limitation. Output
   lists registered names + the objects the user may want to retarget
   (report-only — retargeting stays with `change_object_properties_effects`).

**Tests:** (jsdom + mocked electron/fs, the `ByokKeyStorage.spec` pattern)
register-in-place, copy-from-absolute, replace-existing, dedupe, outside-
project-path refusal, web/electron-less failure; factory per kind.
**Depends on:** nothing.

---

### Step 11.7 — Extension internals (`Byok\ByokExtensionTools.js`)

**Goal:** close the three extension-authoring gaps the audit found:
children of custom objects, parameters after creation, dependencies.

**How to implement:**
1. **Parameters:** extend `change_custom_function` with
   `parameters_to_add` (`{name, type, description?}` →
   `getParameters().insertNewParameter(validatedName, index)` + `setType`/
   `setDescription`, `CompactEventsFunctionParametersEditor.js:316-345`),
   `parameters_to_remove` (`removeParameter`), and `parameters_to_move`
   (`moveParameter`). Type changes reuse the same refactor hooks the UI
   triggers (`onFunctionParameterTypeChanged`).
2. **Children:** extend `change_custom_object` with `children_to_add`
   (name + object type + optional initial properties, created in
   `eventsBasedObject.getObjects()` — normal objects-container insertion,
   `EventsBasedObjectEditor.js:99-219`) and `children_to_remove` (guard:
   refuse if the child is used by the object's events — same
   usage-guard style as extension deletion).
3. **Dependencies:** extend `change_extension_properties` with
   `dependencies_to_add`/`dependencies_to_remove` over
   `getAllDependencies()` (`ExtensionDependenciesEditor.js:59-164`,
   mind the plural name); output always includes the current dependency
   list. Dependency *resolution* (auto-installing a missing dependency
   extension) stays out of scope — `useEnsureExtensionInstalled` is
   name-only today (`UseEnsureExtensionInstalled.js:46-105`).

**Tests:** per-op spec mirroring the existing `ByokExtensionTools.spec.js`
factories; usage-guard refusals; rename-refactor untouched.
**Depends on:** nothing.

---

### Step 11.8 — Surface, prompt, evals, docs, phase gate

1. `ByokToolSchema.js`: schemas + `BYOK_TOOL_NAMES`/`BYOK_ONLY_TOOL_NAMES`
   entries for the eight new tools (validator must pass — each new tool is
   either intercepted or extended in place); extended-tool schema fields.
2. `ByokPrompts.js`: prompt `byok-v7` — new-tool lines in the tool section,
   plus a short "external events & layouts" guidance paragraph (external
   layouts pair with `create_scene_events`-written loaders).
3. Evals: ≥ 6 new tasks in `scripts\run-byok-evals.js` (one per tool
   family), runnable headless where the surface allows.
4. `AIflow.md` §5 refresh: current registry + the BYOK-only additions of
   Phases 7–11 (fixing the stale §2.2/§4.2/§5.4/§6 claims recorded in the
   2026-09-23 audit).
5. Full gates from `newIDE\app`; AGENTS.md §2 updated; worklog entry.

---

## 4. Phase 11 acceptance criteria (phase gate)

- [ ] External events: read → modify → read round-trip identical; writers
      create-if-missing with associated scene; not-found errors list the
      existing items (unit-tested on fixtures).
- [ ] External layouts: describe/put work against `getInitialInstances()`
      through the extracted core; the scene tools' specs stayed green
      through the 11.1 extraction (behavior-preserving proof).
- [ ] `list_effects` returns every bundled effect type with property
      schemas; the model can pass a listed `type` + defaults through the
      existing effect-change tools without guessing.
- [ ] Sprites: describe/change round-trips per op family; wrapper
      lifecycle (`delete()`/re-resolve) asserted; non-sprite targets fail
      typed.
- [ ] Resources: all three source modes register correctly, replace
      retargets in place, outside-project paths are refused, web build
      fails with the desktop-only message (unit-tested).
- [ ] Extensions: parameter add/remove/move, child add/remove with usage
      guards, dependency add/remove — all spec'd; existing
      `create_custom_function` behavior unchanged.
- [ ] Prompt `byok-v7`; `BYOK_TOOL_NAMES` = 56; validator green; ≥ 6 new
      eval tasks; `AIflow.md` §5 current.
- [ ] All four repo checks green; electron side untouched (no new electron
      code this phase); worklog entry complete; AGENTS.md §2 updated.

---

## 5. Deferred (post-11 backlog)

- **Child-property editing after creation** (edit an existing custom-object
  child's properties/behaviors in its container) — the 11.7 scope is
  create/remove; property edits want the container-generic version of
  `change_object_properties_effects`.
- **Function-folder tree management** (`getRootFolder()` reorganization) —
  `setGroup` already covers the practical naming need.
- **Dependency auto-resolution** (auto-installing missing dependency
  extensions) — touches `useEnsureExtensionInstalled`'s name-only design.
- **Object-type-specific authoring** (particles, tile maps, 3D models,
  Spine, shape-painter content) — big; each type needs its own ops surface.
- **Image/audio generation** — no local capability; hosted-only upstream;
  stays out.
- **Game i18n, storage inspection, leaderboards/analytics/monetization,
  export/packaging config** — account-bound or out of the agent's reach by
  design (`audit2209.md` / the 2026-09-23 audit chat record).

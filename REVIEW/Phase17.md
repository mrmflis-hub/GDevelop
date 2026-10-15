# Phase 17 — Tag-driven asset management: a manifest/tag layer over project resources, drop-in registration, and asset hot-reload

Status: planned 2026-10-06.
**Owner decisions 2026-10-06:** the namespace is **answered** (`[D17-1]` — feature code in `Fork/AssetPipeline/`, exposed to the AI as tools per `[D17-10]`); the owner asked for AI access to the feature, so `[D17-10]` is added. `[D17-2]`…`[D17-9]` stand as recommended (no objection; they change only on a redirect).
One part of the owner's proposal — path-aliased `import` syntax in game code — is **not buildable as written** and is reframed, not dropped: see §1.3 and `[D17-6]`.
Depends on: Phases 1–15 (for the resource pipeline, the watcher, the game-code reconciliation pattern and the `TreeView`); no Core change.
This is a **desktop-only** feature by design (the watcher and the sidecar IPC are Electron-side).

## 1. Background — what the owner proposed vs. what the tree already has

The owner proposed four things that together form a tag-driven asset pipeline:
(1) a project-level `assets.json` manifest mapping each file to an id/path/tags, auto-appended when a file is dropped in;
(2) a virtual file tree generated from the tags (so one asset can appear under several category views), "extending the Monaco-style file tree logic";
(3) path aliasing for the AI and the Monaco editor, so code can write `import playerJump from '@assets/player/jump.wav'`;
(4) a file-system watcher that re-imports/hot-reloads a changed asset so a running game reflects it without a restart.
The owner also asked whether (2) can reuse "the tag system we use for sorting files in the file tree in the Monaco editor".

The survey says three of the four are buildable fork-side with no Core change, and the fourth is blocked by an architectural fact about the runtime. Each is addressed below.

**1.1. The manifest is not the source of truth — the project file already is, and it already carries free-form per-resource metadata.**

Every resource already has a serialized, embind-bound metadata string: `SetMetadata`/`GetMetadata` (`Core/GDCore/Project/ResourcesContainer.h:115`, the field at `:169`), written and read at `ResourcesContainer.cpp:415` and `:384`, bound to JS at `GDevelop.js/types.d.ts:1182`. The IDE already stores **structured JSON inside it** — `updateResourceJsonMetadata` (`newIDE/app/src/ResourcesList/ResourceUtils.js:218`) and the `resourceCustomProperties` key (`:246`) — alongside `localFilePath`/`extension` (`:181`). `[load-bearing]` So "tags" do not need a new Core field, a new model, or even a sidecar: they ride the existing metadata string, the same way custom resource properties already do, and they round-trip through the `.json` project for free. A separate `assets.json` is therefore an *index/cache*, never an authority — exactly the discipline the game-code manifest already uses (`Byok/GameCode/ByokGameCodeManifest.js:4-16`, "a cache, never an authority").

**1.2. The "tag system" the tree uses is not tags — it is folder-derived load order and namespace, and it cannot be reused for assets.**

This is the direct answer to the owner's question. The game-code tree (`newIDE/app/src/AiGeneration/Byok/GameCode/GameCodeTree.js`) has **no tag field**: it groups by the physical folder path, and that path is *behavior-bearing*. The folder sets the D15-3a load order (tier 1 = folder root + `core/`, tier 2 = the other groupings, alphabetical — `Byok/GameCode/ByokGameCodeCore.js:277-292`) and the runtime namespace (`character/spawn.js` → `GameCode.character.spawn`, `:302-345`), which is why the tree refuses moves (`GameCodeTree.js:347`). It is also confined to `*.js` (`normalizeByokGameCodeRelativePath`, `ByokGameCodeCore.js:227-232`). `[load-bearing]` Asset tags are the opposite: many-to-many and purely cosmetic, so they must never change load order, namespaces, or export naming. What *is* reusable is the **architecture** — a pure grouping module plus the upstream `UI/TreeView` component (as `GameCodeTree.js:309` uses) — not the folder mechanism. The virtual tree is new work, but strictly fork-side.

**1.3. Path-aliased `import` in game code is blocked by the runtime, and the fix is a reframing, not a bundler.**

GDJS exported games have **no module system, no bundler, and no import resolver**. Game-code files ship as plain classic `<script src>` tags with no `type="module"` (`GDJS/GDJS/IDE/ExporterHelper.cpp:1155`), and cross-file sharing is window globals only (`GameCode = window.GameCode || {}`, `ByokGameCodeCore.js:326-345`; the module header at `:13-17` explains ES modules were rejected because a module can never be unloaded, which the hot-reload design needs). `[load-bearing]` A literal ES `import` in a game-code file is a **parse-time SyntaxError that kills the entire file**, so the namespace never publishes. Assets are addressed by **resource name** through the loader (`GDJS/Runtime/ResourceLoader.ts:609`; audio `GDJS/Runtime/events-tools/soundtools.ts:29-41`; images `GDJS/Runtime/pixi-renderers/pixi-image-manager.ts:94-98`), never by a path specifier. Monaco does not help either: `CodeEditor/MonacoSetup.js:37-42` sets no `baseUrl`/`paths`, and game code is handed to the editor as a bare string with no model URI (`GameCodeEditor.js:176-187`), so `@assets/...` is a red squiggle today, not a resolution. Building a real resolver/bundler is a few hundred lines plus export wiring and would fight the no-unloadable-module constraint; the fork-friendly answer is **name-based aliases with Monaco autocompletion** (`[D17-6]`), which gives the clean DX without a bundler.

**1.4. The watcher and the change-path already exist; only the add-path and a manual reload action are missing.**

The chain is built: chokidar in Electron main fires `add`/`change`/`unlink` (`newIDE/electron-app/app/LocalFilesystemWatcher.js:2`, `:54-62`), the renderer bridge debounces and forwards (`LocalFileResourcesWatcher.js:12`, `:32-47`, `:61`), the global event bursts the resource URL cache (`MainFrame/ResourcesWatcher.js:29-36` → `ResourcesLoader/index.js:112`, cache-busting query at `:42-46`), and editors plus the in-game editor reload (`ResourcesEditor/index.js:87`, `:292`; `MainFrame/index.js:2284`). `[constraint]` What does **not** happen: a brand-new file is never registered — general resources only appear via the manual "Scan in the project folder for…" menu (`ProjectsStorage/LocalFileStorageProvider/index.js:102` → `LocalProjectResourcesHandler.js:67`, `:88`, `:102`, `:112-116`), and there is no per-resource "Reload from disk" action (`ResourcesList/index.js:246-280` has only Rename/Delete/Remove unused).

**1.5. The exact patterns to copy already exist in the game-code feature.**

- Auto-registration/reconciliation: `reconcileResources` (`Byok/GameCode/ByokGameCodeCarrier.js:266`) adds/retargets/removes resources keyed by `setOrigin` (`:312`), driven by the watcher via `ByokGameCodeAutoReload.js` + `GameCodePaneState.js:304`.
- Project-side file IPC that is confined, atomic and thin: `registerByokGameCodeFiles` (`newIDE/electron-app/app/ByokGameCode.js:154`), path confinement in `Byok/GameCode/ByokGameCodePathCore.js:68`, `:96`, renderer wrapper `ByokGameCodeStore.js:278` (`invokeIpc`).
- A defensive manifest schema to mirror: `Byok/GameCode/ByokGameCodeManifest.js` (version, parse-or-empty, upsert/remove).

## 2. Decisions (proposed 2026-10-06 — awaiting owner)

- `[D17-1]` **Namespace: `newIDE/app/src/Fork/AssetPipeline/` for the feature code, AI exposure through thin BYOK tools.**
  Same answer as Phase 16 `[D16-1]`: the feature is not AI-first, but the AI must be able to drive it, so the **feature** code is its own non-AI namespace and the **tools** the AI calls register in the existing BYOK registry as thin adapters delegating to the fork modules — see `[D17-10]`.
  **Answered 2026-10-06: yes** ("it would be good if AI had access to it so that user can request things").
- `[D17-2]` **Tags live in the existing resource metadata; no new source of truth.**
  Tags are stored in each resource's `metadata` JSON (the `resourceCustomProperties` convention, `ResourceUtils.js:246`), so they serialize with the project file and need no Core change.
  Any `assets.json` sidecar is an optional **index/cache** only (defensive parse, never authoritative), used to avoid re-parsing metadata on a big project.
  **Recommended: metadata is the truth; sidecar optional.** `[proposed]`
- `[D17-3]` **Tag semantics.** Tags are free-form lowercase strings, many-to-many, and **cosmetic only** — they never affect load order, resource names, export naming, or compilation.
  A small suggested vocabulary is offered (kind-derived: `image`/`audio`/`font`/`json`; plus user tags) but never enforced.
  **Recommended: yes.** `[proposed]`
- `[D17-4]` **The virtual tree is a fork-owned view, layered over the upstream flat list — not a rewrite of `ResourcesList`.**
  A fork-owned panel/pane built on `UI/TreeView` groups resources by tag (an asset may appear under every tag it carries); the upstream `ResourcesList` keeps its current flat behavior, reachable from the same editor.
  **Recommended: additive fork view.** `[proposed]`
- `[D17-5]` **Auto-register dropped files, reusing the game-code reconcile pattern, gated by a setting (default on for local projects).**
  Confined to the project folder, with an ignore list, and it never deletes a resource a user added deliberately (only resources whose origin is the watcher and whose file is gone).
  **Recommended: yes.** `[proposed]`
- `[D17-6]` **Path aliasing is reframed as name-based aliases + Monaco completions; ES `import` is explicitly out.**
  The fork generates a **resource-name catalog** from the project (the authoritative names the runtime actually resolves) and feeds it to (a) Monaco as autocompletion/`addExtraLib` entries and (b) the AI prompt/knowledge, so authoring uses clean names (`play('player/jump')`).
  A runtime-safe helper convention is taught alongside it, but it stays name-based.
  Building a bundler/import resolver is out of scope (§5).
  **Recommended: reframe.** `[proposed]`
- `[D17-7]` **Asset hot-reload reuses the existing change-path; a manual "Reload from disk" action is added.**
  Changed files already burst the cache and reload; the phase adds the manual action and an auto-reload toggle, and it verifies the launched-preview path (which depends on the debugger channel, unlike the in-game editor).
  **Recommended: yes.** `[proposed]`
- `[D17-8]` **Any sidecar is versioned and defensive** (mirroring `ByokGameCodeManifest.js`): version field, per-field validation, parse-or-empty degradation to a rebuild.
  **Recommended: yes.** `[proposed]`
- `[D17-9]` **No Core change and no native resource folders.** Resource grouping stays a fork-side virtual layer; the folder tree objects get for objects (`ObjectFolderOrObject`) is deliberately not mirrored into `ResourcesContainer`.
  **Recommended: yes.** `[proposed]`
- `[D17-10]` **AI access (owner-requested 2026-10-06).** The feature is exposed to the AI as BYOK tools, so a user can ask for it in chat ("tag every enemy sprite 'enemy'", "what assets are untagged?").
  The tools are thin adapters in `AiGeneration/Byok/` (the Step 15.3 pattern) that delegate to `Fork/AssetPipeline/`, and they are **dispatchable but advertised only through `search_tools`** (never in `BYOK_CORE_TOOL_NAMES`), so the prompt budget is unaffected (`ByokToolSchema.js:263`, `ByokPromptBudget.spec.js`).
  The proposed surface: `list_assets` (filter by tag or untagged) and `set_asset_tags` (set or merge tags on one or more assets).
  Adding tools raises the dispatch-whitelist cap (69 today, guarded at `ByokToolSchema.js:2421`), which needs the same owner approval Phase 15.3's raise had.
  **Answered 2026-10-06: AI access requested** (owner). Cap raise: **`[proposed]`**.

## 3. Steps

> Files named below are today's locations; per AGENTS.md §8, re-locate anything that moved.
> New fork code goes to `newIDE/app/src/Fork/AssetPipeline/` (D17-1); Electron main touchpoints stay thin (no test runner — AGENTS.md §6); the pure logic is renderer-side and fully spec'd.

### Step 17.1 — Core: the tag model and the virtual tree builder

**Goal:** the pure rules — how tags are read/written and how a tag tree is built — with no filesystem, project or React dependency.

Depends on: nothing.

Files created:
- `newIDE/app/src/Fork/AssetPipeline/ForkAssetTags.js` — pure functions:
  - `parseForkAssetTags(metadata)` / `serializeForkAssetTags(metadata, tags)` — read/write the tags array inside the resource metadata JSON (reusing the `ResourceUtils.js:218` merge convention), never clobbering other keys.
  - `normalizeForkAssetTag(input)` — lowercase, trim, reject empty/forbidden characters; refusal is explicit.
  - `collectForkAssetTagVocabulary(resources)` — the tag set present in a project, for the picker.
- `newIDE/app/src/Fork/AssetPipeline/ForkAssetTree.js` — pure `buildForkAssetTree({ resources, tagOf })`: a **many-to-many** virtual tree (root → tag folders → assets, an asset under every tag it carries), with an "Untagged" bucket, sorted folders-first/alphabetical like the game-code tree's display order (`GameCodeTree.js:57-67`) — display only, never load order.
- Specs for both.

Upstream touchpoints: none.

Acceptance criteria:
- Tags round-trip through metadata without disturbing `resourceCustomProperties` or `localFilePath` — spec-proven.
- An asset with two tags appears in both branches, and its absence of tags lands it in "Untagged" — spec-proven.
- `normalizeForkAssetTag` refuses empty and control-character tags with a reason — spec-proven.

### Step 17.2 — Persistence: tags on resources, optional index, IPC

**Goal:** tags are written where they belong (the project model), with an optional project-side index for speed and the thin IPC to support it.

Depends on: 17.1.

Files created / modified:
- `Fork/AssetPipeline/ForkAssetTagStore.js` (new) — the writer: sets tags on resources through the resource manager and flags the project modified, so the change is saved with the project like any other resource edit.
- `Fork/AssetPipeline/ForkAssetIndex.js` (new, optional per D17-2) — the defensive sidecar (`assets-index.json`: version, per-resource tags + kind + file), mirroring `ByokGameCodeManifest.js` (version, parse-or-empty, upsert/remove).
- `newIDE/electron-app/app/ForkAssetIndex.js` (new) — thin IPC (`fork-asset-index-list/read/write`), reusing the confined/atomic pattern of `ByokGameCode.js:154` and `ByokGameCodePathCore.js:68`.
- Specs for the store and the index parser (the IPC handler itself has no runner).

Upstream touchpoints:
- `newIDE/electron-app/app/main.js` — one registration line for the index IPC.

Acceptance criteria:
- Setting a tag flags the project modified and survives a save/reload round-trip — spec-proven.
- A corrupted or future-version index degrades to "no index" and the tags are re-read from metadata — spec-proven.
- The index is never consulted as an authority when metadata disagrees — spec-proven.

### Step 17.3 — Auto-registration of dropped files

**Goal:** a file dropped into the project folder is registered as a resource (and indexed) automatically, confined and reversible.

Depends on: 17.1, 17.2.

Files created:
- `Fork/AssetPipeline/ForkAssetRegistration.js` — the generalized `reconcileResources` (`ByokGameCodeCarrier.js:266`): for a listing of on-disk files under the project folder, create/retarget resources keyed by origin (`setOrigin('fork-asset-watcher', relativePath)`), apply resource defaults (`ResourceUtils.js:153`), and remove only resources whose origin is the watcher and whose file is gone.
  Confinement and the ignore list are explicit inputs.
- `Fork/AssetPipeline/ForkAssetAutoRegister.js` — subscribes to the watcher's changed/added files, debounces, and calls the registration module when the D17-5 setting is on.
- Specs for both.

Upstream touchpoints (small, "route around" kind):
- `newIDE/app/src/ProjectsStorage/LocalFileStorageProvider/LocalFileResourcesWatcher.js` — the ignore list (`:65-78`) and the callback currently carry *changes*; the add-path must reach the fork consumer. Fix by surfacing added files through the existing callback (or removing only our listener rather than all, avoiding the `removeAllListeners` single-consumer collision already noted for game code).
- `newIDE/app/src/MainFrame/ResourcesWatcher.js:29` — the add-branch hook (today it only bursts the cache).

Acceptance criteria:
- Dropping a new PNG with the setting on registers it once (idempotent on a second event) and flags the project modified — spec-proven.
- Dropping a file outside the project folder, or one matching the ignore list, does nothing — spec-proven.
- Deleting a watcher-origin file removes its resource; deleting a user-added resource's file does not — spec-proven.

### Step 17.4 — The Assets view: tag tree, tag editing, filtering

**Goal:** the owner can see and edit tags and browse the virtual tree.

Depends on: 17.1, 17.2.

Files created:
- `Fork/AssetPipeline/ForkAssetsView.js` — an `UI/TreeView`-based panel (the `GameCodeTree.js:309` usage) rendering `buildForkAssetTree`, with a tag filter, an "Untagged" bucket, and opening an asset in the upstream `ResourcesEditor` on click.
- `Fork/AssetPipeline/ForkAssetTagEditor.js` — a tag editor rendered inside the resource properties surface (`ResourcePropertiesEditor/index.js:273` builds a schema and renders it via `PropertiesEditor`), so a tag list is edited next to the other resource properties.
- Specs (jsdom for the view).

Upstream touchpoints:
- The surface that hosts the Assets view — either a small addition to the Resources editor pane (`ResourcesEditor/index.js:331`) or a fork-owned editor tab; the exact host is `[D17-4]`'s consequence and is recorded in the worklog.

Acceptance criteria:
- Adding/removing a tag updates the tree immediately and persists — spec-proven.
- Filtering by a tag shows exactly the tagged assets; an asset with two tags is reachable from both — spec-proven.
- The upstream flat `ResourcesList` still works unchanged — spec-proven.

### Step 17.5 — Name-based aliases: resource-name catalog, Monaco completions, AI knowledge

**Goal:** clean asset references in authoring without a bundler, by teaching the names the runtime actually resolves.

Depends on: 17.1.

Files created:
- `Fork/AssetPipeline/ForkAssetCatalog.js` — builds, from the project, the authoritative `{ name, kind, file, tags }` list (`SimplifiedProject.js:296-311` already maps resources to exactly this shape) and renders two artifacts: a Monaco completion/`addExtraLib` entry set, and a compact prompt/knowledge block of available asset names for the AI.
- `Fork/AssetPipeline/ForkAssetAliasHelper.js` — a documented, runtime-safe naming convention (`play('player/jump')`-style name-based calls), with the pure resolver that validates a written name against the catalog before it is emitted into game code.
- Specs for both.

Upstream touchpoints:
- `newIDE/app/src/CodeEditor/LocalCodeEditorAutocompletions.js` — where `addExtraLib` is called today (`:50`, `:85`, `:157`, `:176`); a fork hook adds the asset catalog as an extra lib.
  No `MonacoSetup.js` change is needed because aliases are completions, not module resolution.

Acceptance criteria:
- The catalog lists every project resource by its real name, with kind and tags — spec-proven.
- A written alias that names a non-existent resource is refused by the resolver with a clear message — spec-proven.
- The completion list contains the project's asset names in Monaco (desktop QA).
- No ES `import` is emitted anywhere; the generated references are name-based calls — asserted.

### Step 17.6 — Asset hot-reload and manual reload

**Goal:** a changed asset updates a running game without a restart; a manual reload is available.

Depends on: 17.3.

Files created:
- `Fork/AssetPipeline/ForkAssetReload.js` — the manual "Reload from disk" action for a resource: calls the existing exported `triggerOnResourceExternallyChanged` (`ResourcesWatcher.js:29`) so the URL cache bursts and editors reload, exactly as an external edit already does.
- `Fork/AssetPipeline/ForkAssetAutoReload.js` — the D17-7 setting wiring and debounce for changed assets.
- Specs.

Upstream touchpoints:
- `newIDE/app/src/ResourcesList/index.js:246-280` — the resource context menu gains a "Reload from disk" entry (or the action is added through the storage provider's action list, `LocalFileStorageProvider/index.js:75-129`).

Acceptance criteria:
- Editing an asset externally reloads it in the in-game editor preview with the setting on — spec-proven at the event level, desktop-QA confirmed.
- "Reload from disk" bursts the cache and refreshes the list — spec-proven.
- The launched-preview reload path is exercised in desktop QA; if it depends on the debugger channel and cannot reload without a restart, that limitation is recorded (not assumed).

### Step 17.7 — AI access: the BYOK tools and prompt

**Goal:** a user can ask the AI to tag, list, and organise assets in chat, and the virtual tree reflects it.

Depends on: 17.1 (the tag model), 17.2 (the writer).

Files created / modified:
- `Fork/AssetPipeline/ForkAssetToolsHandlers.js` (new) — the feature-side handlers `listAssets(project, { tag })` and `setAssetTags(project, { assetNames, tags, mode })` over the Step 17.1/17.2 logic, calling the Step 17.2 writer so the project is flagged modified and the change persists.
- `Byok/ByokAssetTools.js` (new) — the thin BYOK adapters, in the `ByokExtraTool` shape (`ByokExtraTools.js:126`).
- `Byok/ByokExtraTools.js` (modified, registry merge only — the `BYOK_EXTRA_TOOLS` array at `:706`).
- `Byok/ByokToolSchema.js` (modified, appended entries only) — the two schemas, their addition to `BYOK_TOOL_NAMES` (`:115`), and the `[D17-10]` dispatch-cap raise.
- `Byok/ByokPrompts.js` (modified) — prompt bump (next version after `byok-v12`, `:47`) with a short asset-tagging section and the retrieval-map entry that lets `search_tools` surface the two tools.
- Specs for the handlers and the schema/registry guard.

Upstream touchpoints: none — the BYOK tool files are our files.

Acceptance criteria:
- Both tool names resolve and the schemas validate (`validateByokToolSchemas`, `ByokToolSchema.js:2396`); both are reachable through `search_tools` and absent from `BYOK_CORE_TOOL_NAMES`, so `ByokPromptBudget.spec.js` (≤15k hard) stays green — spec-proven.
- `set_asset_tags` goes through the Step 17.2 writer (flags the project modified and persists) and refuses a tag that fails `normalizeForkAssetTag` — spec-proven.
- `list_assets` with a tag filter returns exactly the assets the Step 17.1 tree groups under that tag — spec-proven.

### Step 17.8 — Verification round

Depends on: 17.1–17.7.

How to implement:
1. `npm test -- --watchAll=false`, `npm run lint`, `npm run flow`, `npm run check-format` from `newIDE/app`, plus the Electron app's check-format.
2. Desktop QA: drop a PNG in the project folder → it registers and is tagged; tag it twice → it appears in two branches; edit it externally → a running preview reloads; write a game-code reference using the catalog name → it resolves at runtime.
3. Confirm the upstream flat resource list and the manual "Scan in the project folder" menu still behave as before.
4. Update `AGENTS.md` §2.

## 4. Phase 17 acceptance criteria (phase gate)

- `[A17-1]` Tags persist inside the project file (resource metadata) and survive a save/reload round-trip; no Core change is required.
- `[A17-2]` The virtual tree groups many-to-many: one tagged asset appears under every one of its tags, and untagged assets are still reachable.
- `[A17-3]` A file dropped into the project folder auto-registers (setting on), confinement holds, and deletion is scoped to watcher-origin resources.
- `[A17-4]` A changed asset hot-reloads in a running preview (or the limitation is recorded with evidence), and a manual "Reload from disk" works.
- `[A17-5]` Asset references author as clean names backed by the resource-name catalog and appear as Monaco completions; **no ES `import` is introduced**, and a written name is validated against the catalog before it is emitted.
- `[A17-6]` The game-code folder tree mechanism (load order/namespace) is untouched; tags never affect load order, resource names, or export naming.
- `[A17-7]` The upstream touchpoint budget is the watcher bridge (`LocalFileResourcesWatcher.js`, `ResourcesWatcher.js`), the resource context menu / provider action list, the completions hook (`LocalCodeEditorAutocompletions.js`), the Assets-view host surface, and one `main.js` IPC registration — each recorded in the worklog. The BYOK tool/schema/prompt additions are our own files; the only approval they need is the `[D17-10]` dispatch-whitelist cap raise.
- `[A17-8]` Every new function has a spec; all four gates are green.
- `[A17-9]` Manual desktop QA passes: drop/tag/browse/reload, and a name-based asset reference in game code that runs (owner).
- `[A17-10]` The AI can list assets (by tag or untagged) and set tags from chat, the project is flagged modified and the change persists, and both tools are advertised via `search_tools` with the 15k budget staying green.

## 5. Explicitly not in this phase

- **ES `import` / `@assets` module aliases at runtime** — precluded by the no-module, classic-`<script>` runtime (§1.3) and the module-non-unloadability rule; the phase ships name-based aliases instead.
- **A bundler, transpiler, or import resolver for game code** — a separate, much larger effort that would fight the hot-reload design; only revisited if name-based aliases prove insufficient.
- **Native resource folders in the project model** — mirroring `ObjectFolderOrObject` into `ResourcesContainer` is a Core change and is deliberately out (D17-9).
- **Changing resource load order, names, or export naming from tags** — tags are cosmetic only (D17-3).
- **Asset transcoding / compression** — that is Phase 16, and it operates on the export copy, not the project.
- **Sprite-sheet slicing or texture-atlas packing** — a possible future authoring transform, not in this phase.
- **AI-driven deletion** (deleting assets or removing files) — the AI surface (`[D17-10]`) is listing plus tagging only in v1; destructive asset operations stay user-only.
- **Any server-side or cloud asset management** — this stays a local, project-side layer.

# Phase 15 — Game code on disk: BYOK-written JavaScript, bundled like the build, hot-reloaded

Status: planned 2026-10-02; all 13 decisions answered (last five on 2026-10-03).
Not started.
Owner decisions D15-1…D15-13 recorded canonically in `usertasks.md`.
Depends on: Phases 1–14 + `audit011026` (all committed or staged for the
owner's review).

## 1. Background — what the owner proposed vs. what the tree already had

The owner asked for a feature that lets BYOK write real JavaScript game code:
pull the code out of the project model heap, bundle it into files on disk by
rules we assign, expose the files in a Monaco surface so users can read and
write them too, and make edits hot-reload into a running preview — with the
standing constraint that as little GDevelop code as possible is modified, our
files stay separate, and upstream originals keep working (routed around, not
rewritten).

The survey changed the shape of the plan substantially. Four things already
exist upstream:

1. **The bundler, with rules, already ships.** A `javascript` resource
   (`newIDE/app/src/ResourcesList/ResourceSource.js:111-119`,
   `Core/GDCore/Project/ResourcesContainer.h:575-580`) referenced by an
   extension through `AddSourceFile()`
   (`Core/GDCore/Extensions/PlatformExtension.h:238`) and positioned with
   `SourceFileMetadata{resourceName, includePosition: first|last}`
   (`Core/GDCore/Extensions/Metadata/SourceFileMetadata.h:15-54`).
   `UsedExtensionsFinder::AddUsedExtension` harvests those source files for
   used extensions (`Core/GDCore/IDE/Events/UsedExtensionsFinder.cpp:26-28`),
   the resource is exposed and copied
   (`Core/GDCore/IDE/ResourceExposer.cpp:186-192`), and `ExportIndexFile`
   emits the ordered `<script src>` tags
   (`GDJS/GDJS/IDE/ExporterHelper.cpp:739-784`, `:1132-1165`).
   The IDE already ships UI for it, labelled "Extra source files (experimental)"
   (`newIDE/app/src/EventsFunctionsExtensionEditor/OptionsEditorDialog/ExtensionDependenciesEditor.js:238-303`),
   including the warning that the files only ship if the declaring extension is
   **used** by the game (`:307-314`).
   `[load-bearing]` So no bundler is written; we declare files and the existing
   exporter merges them exactly as the build does.
2. **The hot-reload loop already ships.** The exporter serializes an ordered
   `{path, hash}` list into `runtimeGameOptions.scriptFiles`
   (`GDJS/GDJS/IDE/ExporterHelper.cpp:499-516`; hashes fed from
   `newIDE/app/src/EventsFunctionsExtensionsLoader/EventsFunctionsExtensionsProvider.js:50-57`
   through `previewExportOptions.setIncludeFileHash`).
   The runtime `HotReloader` diffs old against new by path: an **added** file
   is loaded, a **changed** file is re-injected when its hash differs, and a
   **removed** file is only warned about — never unloaded
   (`GDJS/Runtime/debugger-client/hot-reloader.ts:454-498`, initial snapshot at
   `:68-75`). `[load-bearing]` A file cannot be unloaded from a running page,
   so a delete needs a hard reload — a designed-in limitation, not a bug.
3. **BYOK already owns a debugger-websocket client.** Phase 12's
   `ByokPreviewSession` captures the `DebuggerId` and
   `ByokDebuggerTools` talks the protocol, which is the same channel the
   `hotReload` command travels on.
4. **A project-folder file watcher already ships.** Electron main watches the
   project folder with chokidar and emits `project-file-changed` with relative
   paths, debounced, ignoring the game file and autosave
   (`newIDE/electron-app/app/LocalFilesystemWatcher.js:21-60`, consumed at
   `newIDE/app/src/ProjectsStorage/LocalFileStorageProvider/LocalFileResourcesWatcher.js:51-80`).

**The premise to drop.** Nothing needs to be pulled out of the libGD WASM
heap. GDevelop already treats JavaScript as a file on disk whose only
trace in the project model is a registry entry (name + project-relative
path); the heap holds no JS text for it. That removes the bidirectional
heap↔disk synchronization which was the expensive half of the owner's
original sketch, and it also makes the files sync like any other resource.
`import_project_resources` (`newIDE/app/src/AiGeneration/Byok/ByokResourceTools.js`)
already knows how to register a file as a project resource.

**Supporting survey facts** (all verified):

- Monaco has exactly one wrapper, `newIDE/app/src/CodeEditor/index.js`
  (lazy `react-monaco-editor`, workers served from
  `public/external/monaco-editor-min`), with two current users: the JsCodeEvent
  renderer and `GameplayTests/GameplayTestEditor.js`.
- Adding a tab means three upstream edits: the `EditorKind` union
  (`newIDE/app/src/MainFrame/EditorTabs/EditorTabsHandler.js:36-48`),
  `editorKindToRenderer` (`newIDE/app/src/MainFrame/index.js:308-323`), and
  `getEditorOpeningOptions` (`newIDE/app/src/MainFrame/index.js:801-925`).
  This is the same shape as the existing `'ask-ai'` kind.
- A three-pane tab is supported: `newIDE/app/src/UI/EditorMosaic/index.js`
  wraps `react-mosaic-component` (already a dependency), and the scene editor
  ships a three-pane precedent
  (`newIDE/app/src/SceneEditor/MosaicEditorsDisplay/index.js:39-48`).
- The Ask AI chat can be embedded: `AskAiEditor` is mountable more than once
  (per-mount seam state, `newIDE/app/src/AiGeneration/Byok/useByokChatSeam.js:335`;
  chat records live in module-level singletons). Today only one Ask AI tab
  exists because the tab system dedupes by key
  (`EditorTabsHandler.js:159-171`) and `openAskAi` closes-then-reopens
  (`newIDE/app/src/MainFrame/index.js:1107-1161`).
- A file tree can be built on `newIDE/app/src/UI/TreeView/index.js` — virtualized,
  with context menu, rename, drag & drop and search already working.
  `[constraint]` `getItemChildren` is synchronous, so the tree is built eagerly;
  a game's code folder is small enough for this.
- **There is no settings button in the editor toolbar.** Preferences is opened
  from the app menu (`newIDE/electron-app/app/ElectronMainMenu.js:222`) and from
  the home page's vertical button list, where it is the first entry
  (`newIDE/app/src/MainFrame/EditorContainers/HomePage/HomePageMenu.js:155-167`).
  `[load-bearing]` The owner's "button above the settings button" therefore means
  the home page button list: the new button becomes index 0 and Preferences
  moves to index 1.
- No new npm dependency is needed and none is proposed (`react-arborist` is
  absent; `TreeView`, `react-mosaic-component`, `react-dnd`, `react-monaco-editor`
  all already ship).

## 2. Decisions (owner-answered 2026-10-02)

- `[D15-1]` **Source of truth is the file on disk**, in a BYOK-owned folder
  inside the project folder; the project model holds only the registry entry.
  **Answered: yes** (recommended: yes).
- `[D15-2]` **One `<script src>` per file**, ordered by our rules; no
  concatenation into a single `bundle.js`. **Answered: yes**.
- `[D15-3]` **Folder layout is the owner's own scheme**: `<project>/<GameName>Code/`
  holding the core files plus folders divided by what they affect —
  e.g. `character/` holds every character-related script.
  **Answered: yes, with the owner's layout.**
- `[D15-3a]` **Load order inside that taxonomy**: groupings stay coherent by
  what the files refer to (the owner's examples: `character/`, `enemy/`,
  `floor/`, `lava/`), and files are ordered alphabetically within their
  grouping. Tier 1 = files at the folder root plus `core/`; tier 2 = every
  other top-level grouping, folders alphabetically, files alphabetically
  within a folder. `main.js` is a naming convention for *boot* order, not load
  position. **Answered 2026-10-03: yes, as stated by the owner.**
- `[D15-3b]` **Grouping naming carries the coherence.** Because the grouping
  names are what the AI reasons about, they are part of the contract: a file
  about a character belongs in `character/`, and the folder *is* the runtime
  namespace (D15-12), so the taxonomy stays honest instead of drifting into
  arbitrary buckets. The AI is instructed to create a grouping before adding
  the first file of a new kind. **Derived from the owner's D15-3a answer.**
- `[D15-4]` **A dedicated carrier extension** holds the source-file
  declarations, and it is made structurally used by the game so the exporter
  always includes it. **Answered: yes**.
- `[D15-5]` **A documented `main.js` entry point** that the AI writes and that
  owns boot order. **Answered: yes**.
- `[D15-6]` **Hot reload has both triggers**: an explicit `reload_game_code`
  tool/button, *and* automatic reload on watcher events behind a setting that
  defaults on for local projects. **Answered: both**.
- `[D15-7]` **A real IDE pane, not a viewer**: Monaco so users read *and* write;
  a file tree **rooted at the game code folder only** (no access to the wider
  engine filesystem); opened as a tab at the top; laid out vaguely like VS Code
  — tree left, editor middle, Ask AI chat right. **Answered: yes, as specified.**
- `[D15-8]` **Hot reload is pushed by BYOK's own debugger client**, not by the
  MainFrame preview buttons. **Answered: yes**.
- `[D15-9]` **A dedicated tab, opened from an IDE button above the settings
  button** — there is no settings button in the editor toolbar, so this resolves
  to the home page's vertical button bar / menu burger list
  (`HomePageMenu.js:155-167`): the new button becomes index 0 and Preferences
  moves to index 1. **Answered: yes — owner confirmed this reading 2026-10-02
  ("I meant the homepage vertical bar and menu burger").**
- `[D15-10]` **What happens to the pre-existing "JavaScript code" event**
  (`JsCodeEvent`, the inline JS users can already drop into an events sheet,
  stored as `inlineCode` in the project — see
  `GDJS/GDJS/Events/Builtin/JsCodeEvent.cpp:43-49`).
  **Answered 2026-10-03: leave it alone.** It stays an upstream feature with
  no migration and no deprecation; game-code files are documented as the path
  the AI should use. The two are complementary rather than competing: a JS
  code event is *positional* (it runs inside the scene's event flow, receiving
  `runtimeScene` and optionally an object list), while a game-code file is
  module-level code loaded before the scene runs.
- `[D15-11]` **Chat uniqueness while the game-code tab is open.**
  Because the pane embeds a second `AskAiEditor` mount, the standalone Ask AI
  tab closes when the game-code tab opens (reusing the `openAskAi`
  close-then-reopen pattern) so exactly one chat UI exists.
  **Answered 2026-10-03: yes** ("probably best solution").
- `[D15-12]` **Module model: classic scripts with folder-derived globals, not
  ES modules.** Individual `<script>` tags are classic scripts, so `import`
  and `export` cannot work, and ES modules cannot be unloaded on hot reload
  (see §1.2). Each file assigns into a namespace derived from its folder, so
  `character/spawn.js` writes `GameCode.character.spawn = …` — which makes the
  owner's folder taxonomy meaningful at runtime as well as on disk.
  **Answered 2026-10-03: yes, conditional on it working with the GD engine.**
  `[A15-8]` below makes that condition a tested acceptance criterion rather
  than an assumption: a file assigning `GameCode.character.spawn` must be
  callable from another file and from a scene's JS code event in a real
  preview. The namespace is created defensively at the top of every file
  (`window.GameCode = window.GameCode || {}` and the same for the folder), so
  ordering never has to be perfect for a file to load.
- `[D15-13]` **Deletion reloads hard.** A deleted file cannot be unloaded from a
  running page (§1.2), so `delete_game_code_file` triggers a hard reload
  automatically. **Answered 2026-10-03: yes** — "if this is a limitation then
  we have to roll with it".

## 3. Steps

### Step 15.1 — Core: layout, ordering, confinement, store

**Goal:** the pure rules and the byte-moving layer, with no game-model or UI
dependency, so everything downstream is testable.

Depends on: nothing beyond the existing BYOK folder conventions.

Files created:
- `newIDE/app/src/AiGeneration/Byok/GameCode/ByokGameCodeCore.js` — pure
  functions: the game-code folder name derived from the project name, the
  D15-3a ordering rule (tiers, alphabetical), the folder→namespace mapping of
  D15-12 (`character/spawn.js` → `GameCode.character.spawn`) plus the
  defensive namespace-creation lines it implies, file-name validation, and
  path confinement (every requested path resolved and refused unless it stays
  inside the game-code folder).
- `newIDE/app/src/AiGeneration/Byok/GameCode/ByokGameCodeCore.spec.js`
- `newIDE/app/src/AiGeneration/Byok/GameCode/ByokGameCodeStore.js` — reads and
  writes the folder; renderer-side `fs` where available (the `optionalRequire`
  desktop-only pattern of `ByokResourceTools.js:10-12`) with an Electron IPC
  fallback for the browser build.
- `newIDE/app/src/AiGeneration/Byok/GameCode/ByokGameCodeStore.spec.js`
- `newIDE/app/src/AiGeneration/Byok/GameCode/ByokGameCodeManifest.js` — the
  manifest (`gamecode.json`: declared folder order, file→resource mapping,
  per-file content hash), with a spec.
- `newIDE/electron-app/app/ByokGameCode.js` — thin handlers only, in the
  established shape: `registerByokGameCodeFiles(ipcMain, app)` on flat kebab
  channels `byok-game-code-<verb>`, every handler answering with a value and
  never throwing (the `ByokRagFiles.js:9-11` rule).

Upstream touchpoints: none.

Acceptance criteria:
- A path escaping the game-code folder (`..`, absolute paths, symlink-ish
  forms, NUL bytes) is refused by `ByokGameCodeCore` — spec-proven.
- The ordering function is deterministic and total for any folder listing —
  spec-proven, including mixed case and nested folders.
- The store round-trips a file with LF and CRLF content unchanged.

### Step 15.2 — Bundling: carrier extension + source-file declaration

**Goal:** make the game-code files actually ship in preview *and* export, by
routing them through GDevelop's existing include mechanism rather than
writing a bundler.

Depends on: 15.1.

Files created:
- `newIDE/app/src/AiGeneration/Byok/GameCode/ByokGameCodeCarrier.js` — creates
  or updates the carrier extension, registers each `.js` file as a
  `javascript` resource, declares it via `AddSourceFile()` +
  `SourceFileMetadata{resourceName, includePosition}` mapped from the D15-3a
  order, and guarantees the extension is used by the project (D15-4).
- `…/GameCode/ByokGameCodeCarrier.spec.js`

Upstream touchpoints: none — `AddSourceFile`, `JavaScriptResource`,
`UsedExtensionsFinder` and `ExportIndexFile` are used as shipped.

Acceptance criteria:
- After a real preview export, the emitted `index.html` carries one
  `<script src>` per game-code file, in the D15-3a order (verified against the
  export folder, not by inspection alone).
- Deleting a file removes its script tag and its resource on the next export.
- The carrier is present and used in a project that has no extension usage at
  all (the empty-project case).

### Step 15.3 — Tools and prompt

**Goal:** the agent's read/write surface, registered through the existing
interception registry.

Depends on: 15.1, 15.2.

Files created / modified:
- `Byok/GameCode/ByokGameCodeTools.js` (new) — `list_game_code_files`,
  `read_game_code_file`, `write_game_code_file`, `delete_game_code_file`,
  `reload_game_code`, in the `ByokExtraTool` shape
  (`newIDE/app/src/AiGeneration/Byok/ByokExtraTools.js:~127-140`).
- `Byok/ByokToolSchema.js` (modified, appended entries only) — the five
  schemas and their addition to `BYOK_TOOL_NAMES`.
- `Byok/ByokExtraTools.js` (modified, registry merge only).
- `Byok/ByokPrompts.js` (modified) — prompt version bump to **byok-v12** with
  a short section on game code, plus the guard that a prompt-named tool
  resolves in the registry.
- `Byok/Skills/game-code-authoring.md` (new) — regenerated into
  `Skills/ByokBuiltinSkills.generated.js` by the existing skills build.
- `Byok/Skills/extend-with-js.md` (modified) — its claim that the EventScript
  writer accepts JavaScript code events is false today (the parser has no
  `JsCode` handling; `Byok/EventScript…`/`Knowledge/ByokEventScriptPack.js:56`
  says so), and D15-10 will make game-code files the real answer.

Acceptance criteria:
- Every new tool name resolves in the registry (spec + the existing
  prompt→registry guard).
- `write_game_code_file` refuses any path outside the folder, and enforces a
  size cap.
- The prompt stays within the existing budget guard
  (`ByokPromptBudget.spec.js`, ≤15k hard).

### Step 15.4 — Hot reload

**Goal:** changed files reach a running preview, and new files load too.

Depends on: 15.2, 15.3.

Files created:
- `Byok/GameCode/ByokGameCodeHotReload.js` — computes the `{path, hash}` list
  (xxhash, as `EventsFunctionsExtensionsProvider.js:50-57` does), re-exports,
  and pushes `{command:'hotReload', payload:{…}}` over BYOK's own debugger
  client; falls back to a hard reload for deletions (D15-13). With a spec.
- `Byok/GameCode/ByokGameCodeAutoReload.js` — subscribes to watcher events for
  the game-code folder, debounces, guards re-entrancy, and honors the
  D15-6 setting. With a spec.

Upstream touchpoints (both small, both upstream-testable, both the "route
around" kind):
- `ProjectsStorage/LocalFileStorageProvider/LocalFileResourcesWatcher.js:83` —
  its `removeAllListeners('project-file-changed')` on cleanup is a
  single-consumer design that a BYOK listener collides with. Fix: stop
  removing all listeners (remove only ours, or publish through the existing
  callback), keeping current behavior for resources.

Acceptance criteria:
- Editing a file in an open preview re-loads that file without a page reload.
- Creating a file adds and loads it (the `HotReloader` "added" branch).
- Deleting a file hard-reloads.
- Auto-reload does not fire for unrelated files in the project folder.

### Step 15.5 — The pane

**Goal:** the VS-Code-like surface: tree, editor, chat.

Depends on: 15.1 (tree data), 15.3 (single-writer rule), 15.4 (reload state).

Files created:
- `Byok/GameCode/GameCodePane.js` — an `EditorMosaic` three-pane tab
  (tree | editor | chat), mirroring
  `SceneEditor/MosaicEditorsDisplay/index.js:39-48`.
- `Byok/GameCode/GameCodeTree.js` — `UI/TreeView` rooted at the game-code
  folder, with rename (which must update the resource registry, not just the
  file) and a new-file action.
- `Byok/GameCode/GameCodeEditor.js` — `CodeEditor` with `javascript` language,
  unsaved-buffer marking, and the D15-7 single-writer guard so an AI write
  never clobbers typing.

Upstream touchpoints:
- `MainFrame/EditorTabs/EditorTabsHandler.js:36-48` — the `EditorKind` union
  gains `'game-code'`.
- `MainFrame/index.js:308-323` and `:801-925` — the renderer map entry and the
  opening options (label, icon, key), exactly as `'ask-ai'` does.
- `MainFrame/EditorContainers/HomePage/HomePageMenu.js:155-167` — the new
  button at index 0, Preferences moved to index 1 (D15-9).
- D15-11: opening the tab closes the standalone Ask AI tab.

Acceptance criteria:
- The button opens the tab; the tab shows the tree rooted at the game-code
  folder and refuses to display anything above it.
- Editing and saving in Monaco updates the file and triggers the reload path.
- The chat pane is usable and shares the same chat as the Ask AI tab.
- An AI write to the file currently open in Monaco surfaces visibly instead of
  silently replacing unsaved typing.

### Step 15.6 — Verification round

`npm test -- --watchAll=false`, `npm run lint`, `npm run flow`,
`npm run check-format` from `newIDE/app` (plus the Electron app's
check-format), then the manual checklist in §4.

## 4. Phase 15 acceptance criteria (phase gate)

- `[A15-1]` A preview export of a project with game-code files emits exactly
  one `<script src>` per file, in the D15-3a order.
- `[A15-2]` An edit to one file hot-reloads that file only; a new file loads;
  a deletion hard-reloads.
- `[A15-3]` No path outside `<project>/<GameName>Code/` can be written, read,
  listed or renamed through any surface (tools, tree, agent).
- `[A15-4]` The pane's tree root is the game-code folder; the wider engine
  filesystem is not reachable from it.
- `[A15-5]` Every new function has a spec; all four gates are green.
- `[A15-6]` The upstream touchpoint budget for this phase is exactly the four
  files listed in 15.4 and 15.5, each recorded in the worklog.
- `[A15-7]` Manual desktop QA passes: create files via the agent, see them in
  the tree, edit one in Monaco, watch it hot-reload.
- `[A15-8]` The D15-12 condition holds in a real preview: a file assigning
  `GameCode.character.spawn` is callable from another game-code file *and*
  from a scene's JS code event (`runtimeScene` plus the gdjs scope), proving
  the folder-derived namespace works against the live GD engine rather than
  only in a unit test.

## 5. Explicitly not in this phase

- Migrating or rewriting existing `JsCodeEvent` inline code (pending D15-10).
- A real bundler, minifier, or transpiler — D15-2 chose per-file script tags.
- ES modules / `import` — precluded by D15-12 and by module non-unloadability.
- Bundling at build time beyond what `ExportIndexFile` already does.
- A second source of truth: the project model never mirrors file contents.
- Refactoring the tree/chat components out of upstream for reuse.
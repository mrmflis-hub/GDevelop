# Phase 19 subagent B — progress notes (steps 19.4 + 19.5)

## Chunk 1: ForkSpriteSheetToolHandler (19.5)

- Created `newIDE/app/src/Fork/SpriteSheet/ForkSpriteSheetToolHandler.js`:
  `importForkSpriteSheet(project, {objectName, sourceAbsolutePath, grid, animationName, fps, loop}, deps?)`
  composes `importForkSpriteSheetFrames` (19.2 port) then AWAITs `assembleForkSpriteSheetAnimation` (19.3).
  Exports `makeDefaultForkSpriteSheetToolDeps` (port deps + node path; null outside desktop — the
  import_project_resources-style guard), `resolveForkSpriteSheetSourcePath` (absolute passes through,
  project-relative resolves against the project folder), and the result union
  (`{success:false,message,didModifyProject}` / `{success:true,output,didModifyProject:true,...}`).
- KEY DESIGN: the handler OWNS a pre-slice object check (exists + type Sprite, mirroring the assemble
  module's scene-then-global resolution order) because the AC "writes nothing on a refusal (unknown
  object)" cannot be met by the assemble-side check — files would already be on disk, and its rollback
  only removes resource registrations. The assemble module is frozen (19.1–19.3 finished), so the ~12-line
  lookup is duplicated in the handler with a comment.
- The refusal variant carries `didModifyProject` (false everywhere except the assembly's rollback-failed
  edge, which reports an honest true so the chat's unsaved-changes flag cannot miss a persisted mutation).
- Spec `ForkSpriteSheetToolHandler.spec.js`: 11 tests, ALL GREEN, against the REAL libGD project
  (ForkSpriteSheetAssemble.spec.js discipline): end-to-end success (animation created with 16 frames,
  real assembly, fake-call order readImageSize→invokeSlice, summary names animation/count/folder/resources),
  relative-source resolution, bad grid / unknown object / non-Sprite / unsaved project / invalid args
  (nothing written — disk Set + serialized project unchanged, fakes untouched), slicer failure relay,
  desktop guard. Fixture: an in-memory "disk" Set that the invokeSlice fake populates (writing = adding
  to the set) so the real in-place registration finds its files.

## Chunk 2: BYOK adapter + schema + knowledge + prompt (19.5)

- Created `newIDE/app/src/AiGeneration/Byok/ByokSpriteSheetTools.js`: the thin
  `ByokExtraTool` adapter `import_sprite_sheet` (`modifiesProject: true` → the
  approval gate fires), snake_case→grid mapping with the documented defaults
  (animation_name 'Imported', fps 10, loop true), injectable `handlerDeps`,
  exported as `getByokSpriteSheetTools()`.
- `ByokExtraTools.js`: import + spread into `BYOK_EXTRA_TOOLS` (the BYOK_ONLY
  interception test stays green).
- `ByokToolSchema.js`: appended the `import_sprite_sheet` schema (object_name,
  source_path, grid{mode,rows,columns,frame_width,frame_height,margin,spacing},
  animation_name, fps, loop; required = object_name/source_path/grid; integer
  types inline — the phase's "appended entries only", no new helpers), added the
  name to `BYOK_TOOL_NAMES` (#75) and `BYOK_ONLY_TOOL_NAMES`, updated the cap
  comment. DISPATCHABLE COUNT = 75/75 — exactly AT the pre-approved cap
  (`[P1719-cap]` raise to 75 covers Phase 19's tool); NO further raise needed,
  but the next dispatchable tool will need one (noted in the cap comment).
  NOT added to `BYOK_CORE_TOOL_NAMES` → advertised budget unchanged.
- `Knowledge/ByokKnowledgeSections.js`: ONE `BYOK_TASK_CATALOG` row
  ("Import a sprite sheet (slice one image into animation frames)" →
  toolQuery 'sprite sheet'), matching the existing rows' shape exactly.
- `ByokPrompts.js`: version bump byok-v14 → **byok-v15** (doc comment + constant);
  `ByokPrompts.spec.js` version pin updated in sync. Composed prompt measured
  ~5378-5497 tokens (4-5 sections degraded) — under budget.
- Spec outcomes: ByokSpriteSheetTools.spec.js (7 tests, real libGD end-to-end via
  injected handler deps), ByokToolSchema.spec.js (28) — validateByokToolSchemas
  returns [] with the new entry; ByokPrompts.spec.js + ByokExtraTools.spec.js
  (38) — interception + prompt sync; ByokPromptGuard.spec.js +
  ByokPromptBudget.spec.js (13) — the catalog row's `import_sprite_sheet` token
  resolves (dispatchable), every toolQuery returns results, budget under 15k.

## Chunk 4: the import dialog (19.4)

- Created `newIDE/app/src/Fork/SpriteSheet/ForkSpriteSheetDialog.js` (default export +
  `ForkSpriteSheetDialogDeps` + `makeDefaultForkSpriteSheetPickFile` exported):
  - Props `{project, objectName, onClose(didImport), deps?}` — the target object is GIVEN
    (the dialog opens from a sprite editor), and onClose carries the should-refresh signal.
  - Source picker = the established native pattern (@electron/remote `showOpenDialog`,
    images filter — the LocalResourceSources shape), injectable; null outside desktop.
  - Grid controls: mode SelectField (rows-columns | frame-size), rows/columns OR
    frame-width/height SemiControlledTextFields, margin/spacing; animation name
    (default 'Imported'), fps (default 10), loop checkbox (default on) per D19-8.
  - Live preview: canvas drawImage of the source (file:// URL) + strokeRect per planned
    frame + the frame count, computed by the REAL planForkSpriteSheetFrames over the
    image's natural size (read through the port's readImageSize dep) — the preview writes
    NOTHING; jsdom-safe (getContext null → skipped).
  - A non-dividing grid shows the plan's refusal and disables Import (A19-3).
  - Import = the SHARED pipeline handler `importForkSpriteSheet` (port + assembly, awaited)
    through injected deps; result state shows the success summary or the errors; the
    Import button disables while importing and after success; Close calls onClose(true)
    only after a successful import.
- Spec `ForkSpriteSheetDialog.spec.js` (jsdom, 5 tests, ALL GREEN), driving the REAL
  handler + REAL plan + REAL assembly over the injected fakes: desktop-only notice +
  disabled controls without deps; bad grid shows 'does not divide' + Import disabled +
  the invokeSlice FAKE UNTOUCHED; good grid shows the frame count; executing calls
  port+assembly (invokeSlice once with the 16 planned frames into MyGameAssets, the real
  gd project gains the 'Imported' animation), shows the summary, Close → onClose(true);
  Close without an import → onClose(false).
  Conventions hit: matchMedia polyfill + require()-after-polyfill (UI/Dialog's module
  chain reads matchMedia at LOAD — imports hoist above the polyfill); UI/Dialog mocked as
  the passthrough (the ForkAssetReportDialog.spec.js convention — MUI's portal breaks
  react-test-renderer); `require(...).default` for default-exported components.

## Chunk 5: the sprite-editor entry point (19.4)

- `ObjectEditor/Editors/SpriteEditor/index.js` — MINIMAL diff (verified via git diff):
  one import, one state hook, one "Import sprite sheet" FlatButton beside "Add an
  animation" (both wrapped in the existing `!isChildObject` conditional — the pipeline
  resolves the target object BY NAME, which custom-object children cannot be), and the
  dialog mount whose onClose(didImport) closes + forceUpdate() + onObjectUpdated() — the
  editor's own established change notification (what the Advanced-options edits use).

## Verification (targeted only, per process rules)

- `npx prettier --write` over all 12 touched files; `npx eslint` over all 12 → 0 errors,
  0 warnings (one unused const found and removed).
- Targeted jest (`--maxWorkers=1 --runTestsByPath`), ALL GREEN:
  - the 8 directly-touched suites: 102 tests (ToolHandler 11, Dialog 5, SpriteSheetTools 7,
    ToolSchema 28, ExtraTools 31, Prompts 38→ combined counts, PromptGuard + PromptBudget 13).
  - downstream guards: ByokKnowledgeSections.spec.js 20; MCP protocol/server/stdio +
    GameCode/SubAgents/ExtensionTools specs 108 (the dispatchable/MCP lists consume
    BYOK_TOOL_NAMES).
- Dispatchable count: BYOK_TOOL_NAMES went 74 → 75 = exactly AT the pre-approved cap of 75
  (`[P1719-cap]` raise covers Phase 19's tool; check is `> 75`, so no further raise needed;
  the NEXT dispatchable tool will need one — noted in the cap comment).
- Prompt: byok-v15; composed ~5.4k tokens, budget spec under the 15k cap; the guard spec
  resolves the new catalog row's `import_sprite_sheet` token against the dispatchable set.
- NOT run (orchestrator's job after integration): full suite, npm run lint/flow/format.
- No commits; no files modified under ForkSpriteSheetPlan/Port/Assemble or electron-app.

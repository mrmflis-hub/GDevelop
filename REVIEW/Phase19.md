# Phase 19 — Sprite-sheet import: slice a texture atlas into frames and build the animation

Status: planned 2026-10-06.
Decisions D19-1…D19-9 are **proposals awaiting the owner's answer** (§2); the steps below assume the recommended answers.
Depends on: the committed tree; reuses the `sharp` dependency approved for Phase 16 (or falls back to renderer canvas — `[D19-2]`). No Core change, no WASM rebuild, no libGD binding change.
Desktop-first (the crop step writes files); the AI-facing tool is desktop-guarded like `import_project_resources`.

## 1. Background — what the owner asked for vs. what the tree already has

The owner's list asks for "deeper sprite-sheet importing pipelines". The tree can already import a *folder of separate frame images*; the missing piece is slicing **one** texture atlas into frames and turning them into an animation.

**What already exists and is reused as shipped — the whole libGD side is already bound, so this is pure renderer JS:**

1. **The animation API is fully reachable.** `gd.asSpriteConfiguration(objectConfiguration)` (`GDevelop.js/types.d.ts:3461`, already used at `SpriteEditor/index.js:65`) → `getAnimations(): SpriteAnimationList` (`:3022-3029`) → `addAnimation(animation)` (`:3010`). `gd.Animation` exposes `setName` / `setDirectionsCount` (`:2995-3006`); **frame timing lives on the `gd.Direction`** (`setTimeBetweenFrames`, `setLoop`, `:2976-2993`); a frame is a `gd.Sprite` whose image is a **resource name string** (`setImageName`, `:2957-2974`).
   `[load-bearing]` The exact sequence is already used upstream and can be copied: `AnimationList.js:490-516` builds an animation frame-by-frame (`new gd.Animation()` → `setDirectionsCount(1)` → `addAnimationFrame` per resource → `animations.addAnimation` → `animation.delete()`), and `SpritesList.js:202-216` adds one frame (`new gd.Sprite()` → `setImageName(resource.getName())` → `direction.addSprite(sprite)` → `sprite.delete()`).
2. **The import + registration path already exists.** `AnimationList.js:706-766` (`importImages`) is the model: choose resources → `applyResourceDefaults(project, resource)` → `resourcesManager.addResource(resource)` (`:723-731`) → group → build the animation. For programmatic registration there is the canonical `createOrUpdateResource` (`ResourcesList/ResourceUtils.js:10-28`) and the fork's own importer `importByokProjectResources` (`AiGeneration/Byok/ByokResourceTools.js:293-395`), which accepts absolute paths and registers/retargets in place.
3. **There is no slicer, and no texture-region support.** The closest helper only groups *separate* files by filename number (`AnimationImportHelper.js:46`); `gd.Sprite` has no sub-rect field (`Core/.../SpriteExtension/Sprite.h:33,38`), so frames must be **pre-cropped image resources** — which is exactly what the import path already consumes.
4. **A canvas-crop precedent exists.** `PlatformSpecificAssetsEditor/ImageResizer.js:3-42` already does canvas `drawImage` → `toBlob` in the renderer (adapted to slicing by `drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)`), and `Byok/ByokImageContent.js:137-141` does the same for downscaling.
5. **Where the UI attaches.** The sprite editor's action row (`SpriteEditor/index.js:152-215`, beside "Add an animation" at `:202-213`), the per-animation menu (`AnimationList.js:224-247`), and the per-direction "Add a sprite" split menu (`SpritesList.js:834-857`).

**The one genuinely new piece:** cropping is not in the tree, and there is no arbitrary-binary file-write IPC (`byok-game-code-write` writes strings only, `ByokGameCode.js:29-30,84-91`; `local-file-download` is HTTP-only). So the fork must (a) crop — via `sharp` in Electron main, or renderer canvas — and (b) land the frames as real files, which needs either a small fork binary-write handler or the existing blob-URL + `localFilePath` resource-mover route (`ResourceExternalEditor.js:162-172`).

## 2. Decisions (proposed 2026-10-06 — awaiting owner)

- `[D19-1]` **Namespace: `newIDE/app/src/Fork/SpriteSheet/`, AI exposure through a BYOK tool.** Consistent with Phases 16–18.
  **Recommended: yes.** `[proposed]`
- `[D19-2]` **Crop via `sharp` in Electron main** (reusing the Phase 16 dependency), in a new confined handler `fork-sprite-sheet-slice` that takes the source image + grid and writes the frame PNGs into the project folder, returning their paths.
  Fallback if Phase 16 has not shipped: crop in the renderer with canvas and register blob-URL resources persisted by the existing resource movers (no dependency, slightly more fragile).
  **Recommended: sharp path; canvas as the no-dependency fallback.** `[proposed]`
- `[D19-3]` **Frames are real files in the project folder**, registered in place through `importByokProjectResources` (in-project absolute paths register without a copy — `ByokResourceTools.js:229-236`), not blob URLs.
  **Recommended: yes.** `[proposed]`
- `[D19-4]` **v1 takes an explicit grid** (rows × columns, or frame width × height, plus margin/spacing), with a live preview of the slice lines. No automatic grid/atlas detection.
  Automatic detection is a research problem and a false-positive generator; the user (or the AI on the user's behalf) states the grid.
  **Recommended: manual grid in v1.** `[proposed]`
- `[D19-5]` **Pre-cropped frames only — no texture-region atlas.** Frames referencing sub-rects of one image would need a Core `Sprite` + serialization change; explicit out-of-scope (same call Phase 17 made).
  **Recommended: yes.** `[proposed]`
- `[D19-6]` **Target selection:** import into a chosen object + animation + direction (creating the animation if needed); the frames are appended in reading order (row-major).
  **Recommended: yes.** `[proposed]`
- `[D19-7]` **Naming is collision-safe:** `<ObjectName>_<animation>_<index>.png`, deduped through the existing `NewNameGenerator` convention so an import never overwrites an existing asset.
  **Recommended: yes.** `[proposed]`
- `[D19-8]` **Timing defaults** come from the dialog (frames-per-second, loop), written to the `Direction`; sensible defaults (10 fps, loop on).
  **Recommended: yes.** `[proposed]`
- `[D19-9]` **Dispatch-cap raise** for the `import_sprite_sheet` tool (part of the shared raise across Phases 16–19, `usertasks.md` §6).
  **Recommended: yes.** `[proposed]`

## 3. Steps

> Files named below are today's locations; per AGENTS.md §8, re-locate anything that moved.
> New fork code goes to `newIDE/app/src/Fork/SpriteSheet/` (D19-1); the AI adapter is a BYOK-only tool; the crop handler is thin Electron main.

### Step 19.1 — Core: the pure slicing plan

**Goal:** from an image's dimensions + a grid spec, produce the ordered frame rectangles — with no canvas, no `sharp`, no filesystem.

Depends on: nothing.

Files created:
- `newIDE/app/src/Fork/SpriteSheet/ForkSpriteSheetPlan.js` — pure functions:
  - `planForkSpriteSheetFrames({ imageWidth, imageHeight, grid })` where `grid` is `{ mode: 'rows-columns' | 'frame-size', rows, columns, frameWidth, frameHeight, margin, spacing }`; returns `Array<{ index, x, y, width, height }>` in row-major order.
  - Refusals are explicit: a grid that does not divide the image (leaving a remainder larger than `margin`) or produces zero frames returns `{ ok: false, error }`.
  - `makeForkSpriteSheetFrameNames({ objectName, animationName, count })` → the D19-7 names, deduped against a provided existing-name set.
- `newIDE/app/src/Fork/SpriteSheet/ForkSpriteSheetPlan.spec.js`

Upstream touchpoints: none.

Acceptance criteria:
- A 4×4 grid over a 512×512 image yields 16 rects tiling the image exactly, in row-major order — spec-proven.
- A grid with margin/spacing computes the correct per-frame origins — spec-proven.
- A non-dividing grid is refused with a message (no partial frames) — spec-proven.
- Frame names are `Object_anim_0.png…` and never collide with existing names — spec-proven.

### Step 19.2 — The slicer: crop and land the frames

**Goal:** turn the plan into frame files on disk, confined and non-destructive.

Depends on: 19.1.

Files created:
- `newIDE/electron-app/app/ForkSpriteSheet.js` — thin handler `fork-sprite-sheet-slice` (flat kebab channel, the `ByokRagFiles.js:9-11` shape: answers with a value, never throws): given the source path, the plan rects and target names, crops with `sharp` and writes each PNG into `<project>/<GameName>Assets/`, returning the written paths. Confinement and an atomic write follow the `ByokGameCode.js:101` / `ByokGameCodePathCore.js:68` pattern. Registration is one line in `electron-app/app/main.js`.
- `Fork/SpriteSheet/ForkSpriteSheetPort.js` — the renderer side: resolves the source image, reads its dimensions, calls `planForkSpriteSheetFrames`, invokes the IPC, and returns the frame file paths. The `fs`/image-size reader and the IPC are injected so the port is testable without Electron; a canvas fallback path implements the same interface (D19-2 fallback).
- `Fork/SpriteSheet/ForkSpriteSheetPort.spec.js`

Upstream touchpoints:
- `newIDE/electron-app/app/main.js` — one IPC registration.

Acceptance criteria:
- With a fake IPC, the port plans, slices, and returns the paths in frame order — spec-proven.
- A single-file failure degrades to a reported error and leaves the already-written frames intact (no partial overwrite of an existing asset) — spec-proven.
- The generated files carry the exact planned names and nothing else is written — spec-proven.

### Step 19.3 — Assemble: register the frames and build the animation

**Goal:** the cropped files become resources and one animation on the target object.

Depends on: 19.1 (naming), 19.2 (frame files).

Files created:
- `Fork/SpriteSheet/ForkSpriteSheetAssemble.js` — the libGD work, mirroring the upstream sequence exactly:
  1. Register each frame via `importByokProjectResources` (in-project absolute paths → register in place), or `createOrUpdateResource` for the blob-URL fallback.
  2. `const animations = gd.asSpriteConfiguration(objectConfiguration).getAnimations()`.
  3. Append (or create) the target `gd.Animation` with `setDirectionsCount(1)`, then per frame `new gd.Sprite()` → `setImageName(frameResource.getName())` → `direction.addSprite(sprite)` → `sprite.delete()`; `direction.setTimeBetweenFrames(1 / fps)` and `setLoop(loop)`; `animations.addAnimation(animation)` → `animation.delete()` (ownership frees, as `SpritesList.js:209-215` and `AnimationList.js:501-502` do).
  Returns `{ didModifyProject, animationName, frameCount, resourceNames, errors }`.
- `Fork/SpriteSheet/ForkSpriteSheetAssemble.spec.js` — against the real libGD WASM (the `TestProject.js` fixture pattern), asserting the animation exists with the right frame names and timing.

Upstream touchpoints: none.

Acceptance criteria:
- After assembling, the object's sprite config has the new animation with exactly the planned frames in order, and the frame timing equals `1/fps` — spec-proven against the real WASM.
- Every frame name resolves to a registered project resource — spec-proven.
- No gd wrapper is leaked (the delete-after-add ownership rule) — asserted.

### Step 19.4 — The dialog and the sprite-editor entry point

**Goal:** a user can import a sheet from the sprite editor.

Depends on: 19.1–19.3.

Files created:
- `Fork/SpriteSheet/ForkSpriteSheetDialog.js` — the import dialog: source image picker, grid controls (mode, rows/columns or frame size, margin/spacing), fps/loop, target object/animation/direction, and a **preview** that draws the slice lines over the image (canvas) and shows the frame count. Uses the `UI/Dialog` primitive.
- Specs (jsdom) for the dialog's validation and preview state.

Upstream touchpoints (small, additive):
- `newIDE/app/src/ObjectEditor/Editors/SpriteEditor/index.js:152-215` — an "Import sprite sheet" button beside "Add an animation" (`:202-213`), opening the dialog.
- Optionally `AnimationList.js:224-247` (per-animation menu) and/or `SpritesList.js:834-857` (per-direction menu) for scoped imports; and the `AnimationListInterface` ref (`:315-318`) if invoked from `index.js`.

Acceptance criteria:
- The dialog refuses a non-dividing grid before any file is written — spec-proven.
- Importing into a fresh object creates the animation and frames; into an existing direction appends — spec-proven at the assemble level.
- The preview reflects the grid without writing files — spec-proven.

### Step 19.5 — AI access: the BYOK tool and prompt

**Goal:** "import this sheet as a 4×4 grid onto `Player`" works from chat.

Depends on: 19.2, 19.3.

Files created / modified:
- `Fork/SpriteSheet/ForkSpriteSheetToolHandler.js` (new) — `importSpriteSheet(project, { objectName, source, grid, animationName, fps, loop })`: plan → slice → assemble, returning `{ output, didModifyProject }` and degrading a refusal to `{ success: false, message }`.
- `Byok/ByokSpriteSheetTools.js` (new) — the thin `ByokExtraTool` adapter (`ByokExtraTools.js:126-137`), `modifiesProject: true` (so the approval gate fires, `ByokSeam.js:86-95`), registered via a `getByokSpriteSheetTools()` spread into `BYOK_EXTRA_TOOLS` (`ByokExtraTools.js:706-744`).
- `Byok/ByokToolSchema.js` (modified, appended entries only) — the `import_sprite_sheet` schema, its addition to `BYOK_TOOL_NAMES` (`:115`) and `BYOK_ONLY_TOOL_NAMES` (`:2284`), and the D19-9 cap raise.
- `Byok/Knowledge/ByokKnowledgeSections.js` (modified) — a `BYOK_TASK_CATALOG` row (`:193-317`) for `search_tools`.
- `Byok/ByokPrompts.js` (modified) — prompt bump (`:47`).
- Specs for the handler and the schema/registry guard.

Upstream touchpoints: none.

Acceptance criteria:
- `import_sprite_sheet` resolves, validates, is `modifiesProject: true` (approval-gated), reachable via `search_tools` and absent from `BYOK_CORE_TOOL_NAMES` (budget unchanged) — spec-proven.
- The tool writes nothing on a refusal (bad grid, unknown object) — spec-proven.

### Step 19.6 — Verification round

Depends on: 19.1–19.5.

How to implement:
1. `npm test -- --watchAll=false`, `npm run lint`, `npm run flow`, `npm run check-format` from `newIDE/app`, plus the Electron app's check-format.
2. Import a real atlas into a fresh object; confirm the frames on disk, the animation in the editor, transparency preserved, and the animation plays in a real preview.
3. Confirm an import with an existing asset name does not overwrite it.
4. Run the manual QA in §4.

## 4. Phase 19 acceptance criteria (phase gate)

- `[A19-1]` Importing a sheet with a known grid creates the frame files and an animation whose frames are in the correct order, and the object animates correctly in a real preview.
- `[A19-2]` Frame files land in the project folder under collision-free names; no existing file is overwritten.
- `[A19-3]` Alpha is preserved and a non-dividing grid is refused before any file is written.
- `[A19-4]` The AI can perform the same import from chat, and the call is approval-gated because it modifies the project.
- `[A19-5]` The upstream touchpoint budget is `SpriteEditor/index.js` (the button) plus optionally `AnimationList.js` / `SpritesList.js` menu items and the `AnimationListInterface` ref, and one `main.js` IPC registration; each is recorded in the worklog.
- `[A19-6]` No Core, libGD or `GDevelop.js` change — every sprite/registr API used is already bound.
- `[A19-7]` Every new function has a spec; all four gates are green.
- `[A19-8]` Manual desktop QA passes: a full import on a real atlas, and the resulting animation previewing (owner).

## 5. Explicitly not in this phase

- **Texture-region atlas frames** (sub-rects of one image) — needs a Core `Sprite` + serialization change (D19-5).
- **Automatic grid / atlas detection** — v1 is an explicit grid (D19-4).
- **Non-image formats or 3D textures** — images only.
- **Editing the sliced frames** (trim, dedup, re-pack) — a later authoring concern.
- **Changing existing animations' frames in place** — v1 appends/creates; it does not rewrite an existing animation's frames beyond the ones it adds.
- **A generic image-crop tool** — the crop exists only inside the sprite-sheet flow.

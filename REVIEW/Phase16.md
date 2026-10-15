# Phase 16 — Build-time asset compression: shrink the images (and audio) of the export copy, never the originals

Status: planned 2026-10-06.
**Owner decisions 2026-10-06:** the two dependencies (`sharp`, `ffmpeg-static`) are **approved** (`[D16-3]`); the namespace is **answered** (`[D16-1]` — feature code in `Fork/AssetBuild/`, exposed to the AI as tools per `[D16-9]`); the owner asked for AI access to the feature, so `[D16-9]` is added. `[D16-2]`, `[D16-4]`…`[D16-8]` stand as recommended (the owner approved the dependency gate without objection; they change only on a redirect).
Depends on: nothing beyond the committed tree and the existing export pipeline.
This is a **desktop-only** feature by design (D16-5): the browser export path is not targeted, which is what makes the native dependency acceptable.

## 1. Background — what the owner proposed vs. what the tree already has

The owner proposed: install `sharp`, write a build-step script that reads an asset manifest and compresses the tagged media files into a temp output folder, then hook that function into GDevelop's exporter "just before the final archive or game package is bundled", with three verifications (dependency listed, files smaller in the output dir, an export prints the optimization log).

The survey shows the intent is right and most of the plumbing exists, but the sketch targets three things that are not how this tree works. The corrections are load-bearing, so they are stated up front:

1. **There is no separate asset manifest to read, and none is needed.** The export already walks the project's resource manager, and after the resource-copy step the export folder holds every asset — images, sounds, fonts, JSON — copied **flat** by basename (`GDJS/GDJS/IDE/ExporterHelper.cpp:1491-1496` → `Core/GDCore/IDE/Project/ProjectResourcesCopier.cpp:52-59`, `:64-83`, with `PreserveDirectoriesStructure(false)` in `ResourcesMergingHelper.cpp:36-47`). `[load-bearing]` So the optimizer's input is the export folder itself (or the resource manager's file list), not a hand-maintained manifest; a manifest would just be a second source of truth that drifts from the project.
2. **The hook is a named lifecycle, not "the exporter entry point".** Every export runs the `ExportPipeline` contract (`newIDE/app/src/ExportAndShare/ExportPipeline.flow.js:51-135`) in order — `prepareExporter` (`:85`) → `launchExport` (`:91`) → `launchResourcesDownload` (`:96`) → `launchCompression` (`:96`) → optional `launchUpload`/`launchOnlineBuild` — driven by `ExportLauncher.js:305-321`. `[load-bearing]` The optimizer's window is **after `launchResourcesDownload`** (so cloud resources are already on disk) and **before packaging**; for the one-click desktop path that means the tail of `launchCompression` immediately before `archiveLocalFolder` (`LocalOnlineElectronExport.js:161-169` → `newIDE/app/src/Utils/LocalArchiver.js:12-57`, `archiver('zip', {zlib:{level:9}})`, `archive.directory(path, false)`).
3. **Order and naming are the two traps.** Optimizing must happen after the resource download and before the zip; and the runtime resolves every asset by **resource name** through the loader (`GDJS/Runtime/ResourceLoader.ts:609`, `getResource(resourceName)`; audio via `GDJS/Runtime/events-tools/soundtools.ts:29-41`; images via `GDJS/Runtime/pixi-renderers/pixi-image-manager.ts:94-98`), with `data.js` mapping names to files. `[load-bearing]` Re-encoding a file in place is safe; renaming one would break every reference — so the optimizer is a strictly in-place, same-filename transform.

What already exists and is reused as shipped:

- **The export is entirely renderer-side, writing through `fs-extra`.** `LocalElectronExport.js:95-116` builds a `LocalFileSystem`, `assignIn`s it onto `new gd.AbstractFileSystemJS()`, and hands it to `new gd.Exporter(...)` (`:109`); the C++ exporter calls back into JS `writeToFile` (`newIDE/app/src/ExportAndShare/LocalExporters/LocalFileSystem.js:192-200`) and `copyFile` (`:151-191`). IPC is used only for cloud-URL resources (`Utils/LocalFileDownloader.js:41-46`), not for the exporter's own writes.
- **There is no existing post-export hook**, but the `ExportPipeline` object *is* the designed extension point: a fork can spread the upstream pipeline and override individual methods.
- **Export performs zero asset optimization today.** No image/audio library appears in any manifest (`newIDE/app/package.json`, `newIDE/electron-app/package.json`, `newIDE/electron-app/app/package.json`, `GDJS/package.json`), and resources are copied byte-for-byte. The only existing compression is zip deflate level 9 in `LocalArchiver.js:27`, and only when an online archive is built.
- **Manual desktop export produces no archive at all.** `LocalElectronExport.js:165-170`'s `launchCompression` resolves `null` and the output is the raw folder; the user packages it later with Electron Builder. `[constraint]` So "before packaging" means *after the export folder is written* on this path, and the optimizer must be wired to that tail too — it cannot assume a zip always exists.

Supporting facts that shape the decisions:

- The pipeline objects a fork would wrap are selected in `newIDE/app/src/ExportAndShare/LocalExporters/index.js:26-70` (`localAutomatedExporters` includes `localOnlineElectronExportPipeline`; `localManualExporters` includes `localElectronExportPipeline`). Swapping in a wrapper is a few lines there.
- `archiver` already ships in the Electron app package (`newIDE/electron-app/app/package.json`) and is required from the renderer (`LocalArchiver.js:21`), so the renderer does run Node `require`; a native addon can therefore *technically* load in the renderer, but the cleaner home for a native dependency is the Electron main process, which is also where the project's "thin handler, no test runner" rule points (AGENTS.md §6).
- The per-asset **kind** is known from the project model (`Resource.getKind()`, `image`/`audio`/`json`/…), so "which files are images" is not a filename guess — though walking the export folder by extension is the robust fallback because the copy is flat.
- `[constraint]` `sharp` is a native module: it must be installed into the Electron app's package and rebuilt for Electron's ABI (`electron-rebuild`), and it must be re-done whenever Electron's version moves. This is the single largest operational cost of the phase and is exactly why the phase is desktop-only.

## 2. Decisions (proposed 2026-10-06 — awaiting owner)

Each item states the recommendation; the owner answers in chat and they are recorded as answered, per AGENTS.md §5.3.

- `[D16-1]` **Namespace: `newIDE/app/src/Fork/AssetBuild/` for the feature code, AI exposure through thin BYOK tools.**
  The owner's answer (2026-10-06): the feature is not AI-first, but the AI must be able to drive it, so the **feature** code lives in its own non-AI namespace while the **tools** the AI calls are registered in the existing BYOK tool registry (`AiGeneration/Byok/`) as thin adapters that delegate to the fork modules — see `[D16-9]`.
  **Answered 2026-10-06: yes** ("while these don't need to be AI first driven it would be good if AI had access to it so that user can request things").
- `[D16-2]` **Non-destructive by construction.** The optimizer touches **only the export output**, never the project folder's originals.
  Because the exporter copies resources into the output before the optimizer runs, the originals are untouched by definition — the feature cannot lose a user's source art.
  **Recommended: yes.** `[proposed]`
- `[D16-3]` **Dependencies: approved.** `sharp` (images) and `ffmpeg-static` (audio) are approved as new dependencies.
  `sharp` covers PNG/JPEG/WebP/GIF; `ffmpeg-static` covers audio re-encoding.
  Operational consequence that 16.2 must honor: `sharp` is native and must be installed into the Electron app package and rebuilt for Electron's ABI.
  **Answered 2026-10-06: approved (both).**
- `[D16-4]` **Hook mechanism: wrap the pipeline, do not edit the C++ exporter.**
  A fork-owned pipeline object spreads the upstream one and overrides `launchCompression` (online path) and the manual-export tail.
  Editing `ExporterHelper.cpp` / `ProjectResourcesCopier.cpp` is rejected because it requires rebuilding the `GDevelop.js` WASM bindings and diverges from upstream.
  **Recommended: wrap.** `[proposed]`
- `[D16-5]` **Desktop-only.** The online-archive desktop path and the manual desktop export path are optimized; the browser export path (`BrowserExporters/`) is not targeted.
  This is what makes a native dependency acceptable; the browser build simply keeps today's behavior.
  **Recommended: yes.** `[proposed]`
- `[D16-6]` **Transform policy (safe defaults, no format migration).**
  In-place, same-format, same-filename: PNG re-encode at the highest compression that keeps the image lossless; JPEG at a quality setting (default 85) that is visually lossless at game resolutions; WebP only if the resource was already WebP.
  Never re-encode a transparent PNG to JPEG, never upscale, never strip alpha.
  Per-format knobs (PNG level, JPEG quality) are exposed in settings with the safe defaults preselected.
  **Recommended: as stated.** `[proposed]`
- `[D16-7]` **Opt-in, observable, and never able to fail the export.** A setting turns optimization on (default: off until the owner is comfortable), the run reports per-file before/after bytes, and any optimizer error degrades to "leave this file as the exporter wrote it" — the export still succeeds.
  **Recommended: yes.** `[proposed]`
- `[D16-8]` **Where the size report and the setting live.** The setting lives in Preferences (a "Build" section, alongside the existing MCP/RAG cards) and the report is shown once after an export that optimized anything.
  **Recommended: yes.** `[proposed]`
- `[D16-9]` **AI access (owner-requested 2026-10-06).** The feature is exposed to the AI as BYOK tools, so a user can ask for it in chat.
  The tools are thin adapters in `AiGeneration/Byok/` (the Step 15.3 pattern) that delegate to `Fork/AssetBuild/`, and they are **dispatchable but advertised only through `search_tools`** (never in `BYOK_CORE_TOOL_NAMES`), so the always-on prompt budget is unaffected (`ByokToolSchema.js:263`, `ByokPromptBudget.spec.js`).
  The proposal is a read/config surface, because the actual compression happens at export (a UI action): `report_asset_optimization` (projected per-file savings, writes nothing) and `set_asset_optimization_settings`.
  Adding tools raises the dispatch-whitelist cap (69 today, guarded at `ByokToolSchema.js:2421`), which needs the same owner approval Phase 15.3's raise had.
  **Answered 2026-10-06: AI access requested** (owner). Cap raise: **`[proposed]`**.

## 3. Steps

> Files named below are today's locations; per AGENTS.md §8, re-locate anything that moved.
> New fork code goes to `newIDE/app/src/Fork/AssetBuild/` (D16-1); the Electron main handler stays thin (no test runner — AGENTS.md §6); the pure decision logic is renderer-side and fully spec'd.

### Step 16.1 — Core: the pure optimization planner

**Goal:** decide, from a listing and settings, exactly what happens to each file — with no filesystem, no `sharp`, no Electron — so the policy is testable in isolation.

Depends on: nothing.

Files created:
- `newIDE/app/src/Fork/AssetBuild/ForkAssetPlan.js` — pure functions:
  - `planForkAssetOptimization({ files, settings })` where `files` is `Array<{ relativePath, extension, sizeBytes }>` and `settings` is the D16-6 policy; returns `Array<{ relativePath, kind: 'image'|'audio'|'skip', transform, options, skipReason }>`.
  - The kind is decided by extension **and** an explicit `imageExtensions`/`audioExtensions` set, so the flat-copied export folder is the only input needed.
  - Skips are explicit and reasoned: unsupported extension, zero-byte file, image below a floor size, audio when no encoder is configured.
  - `summarizeForkAssetPlanResults(results)` — before/after totals and the largest wins, for the report.
- `newIDE/app/src/Fork/AssetBuild/ForkAssetPlan.spec.js`

Upstream touchpoints: none.

Acceptance criteria:
- A PNG, a JPEG, a WAV and a `.txt` in one listing produce exactly the expected plan entries — spec-proven.
- A transparent PNG is never planned as a JPEG transform — spec-proven (the regression that would corrupt art).
- Zero-byte and unknown-extension files are skipped with a reason, never silently dropped — spec-proven.

### Step 16.2 — The encoder port and the Electron main handler

**Goal:** apply the plan without importing a native module anywhere the app cannot rebuild it, and keep the main-process code trivial.

Depends on: 16.1.

Files created:
- `newIDE/electron-app/app/ForkAssetOptimizer.js` — registers flat-kebab IPC `fork-asset-optimize-apply` (the `ByokRagFiles.js:9-11` shape: every handler answers with a value, never throws).
  The handler is deliberately a **thin applier**: it receives the plan entries (already decided by 16.1), runs `sharp`/`ffmpeg` per entry, writes in place, and returns `Array<{ relativePath, bytesBefore, bytesAfter, error }>`.
  It does no planning, no walking, and owns no policy.
  Registration is called from `electron-app/app/main.js` next to `registerByokGameCodeFiles` (`main.js:530`).
- `newIDE/app/src/Fork/AssetBuild/ForkAssetOptimizerPort.js` — the renderer side: lists the export folder (injectable `fs`), calls `planForkAssetOptimization`, invokes the IPC, and formats the report.
  Both the `fs` listing and the `ipcRenderer.invoke` are injected so the port is unit-testable without Electron.
- `newIDE/app/src/Fork/AssetBuild/ForkAssetOptimizerPort.spec.js`

Upstream touchpoints:
- `newIDE/electron-app/app/main.js` — one registration line (recorded in the worklog as the phase's main-process touchpoint).

Acceptance criteria:
- The port, given a fake `fs` and a fake IPC, produces a plan, invokes it, and reports deltas — spec-proven.
- An IPC error for one file degrades that file to "unchanged" and the report notes it; the run still completes — spec-proven.
- The main handler contains no decision logic (inspected; the plan is entirely in 16.1).

### Step 16.3 — The pipeline wrapper

**Goal:** run the optimizer in the exact window between the resource download and packaging, on both desktop export paths, without editing the C++ exporter.

Depends on: 16.2.

Files created:
- `newIDE/app/src/Fork/AssetBuild/ForkAssetOptimizingExportPipeline.js` — spreads an upstream `ExportPipeline` and overrides the packaging tail:
  - Online path: override `launchCompression` so it optimizes `temporaryOutputDir` **before** delegating to the upstream `launchCompression` (which builds the zip).
  - Manual path: override the tail so that after `launchResourcesDownload` completes it optimizes the user-chosen `outputDir` (the upstream `launchCompression` is a no-op there, so the wrapper becomes the tail).
  - The wrapper is a no-op that delegates straight through when the D16-7 setting is off, or when the platform is not desktop.
- `newIDE/app/src/Fork/AssetBuild/ForkAssetOptimizingExportPipeline.spec.js` — asserts delegation order with fake pipelines/ports.

Upstream touchpoints:
- `newIDE/app/src/ExportAndShare/LocalExporters/index.js:26-70` — the automated and manual exporter arrays reference the wrapped pipelines instead of the raw ones (a few changed lines).

Acceptance criteria:
- In a simulated online export, optimize runs after `launchResourcesDownload` and before the upstream `launchCompression` — spec-proven by call order.
- In a simulated manual export, optimize runs after the resource download on `outputDir` — spec-proven.
- With the setting off, the wrapper delegates with zero behavior change — spec-proven.

### Step 16.4 — Settings and the size report

**Goal:** the owner can turn it on, tune the safe knobs, and see what it did.

Depends on: 16.3.

Files created:
- `newIDE/app/src/Fork/AssetBuild/ForkAssetBuildSettingsTab.js` — a Preferences card in the established style: enable toggle, PNG level, JPEG quality, "also optimize manual exports", and a "no audio encoder configured" note when D16-3's audio dependency is absent.
- `newIDE/app/src/Fork/AssetBuild/ForkAssetReportDialog.js` — the one-shot after-export report (total before/after, count optimized/skipped, the largest savings), reusing the `UI/Dialog` primitive.
- Specs for both (the settings tab under `@jest-environment jsdom`).

Upstream touchpoints:
- The Preferences dialog's tab list (one entry), in the same shape the MCP and RAG cards already use.

Acceptance criteria:
- Toggling the setting off makes the next export byte-identical to today's — spec-proven at the pipeline level.
- The report lists per-file skips with their reasons — spec-proven.

### Step 16.5 — AI access: the BYOK tools and prompt

**Goal:** a user can ask the AI to shrink the game and the AI can answer with what would happen — without the AI ever writing to the project's originals.

Depends on: 16.1 (the planner is what a dry run runs), 16.4 (the settings the tools read/write).

Files created / modified:
- `Fork/AssetBuild/ForkAssetToolsHandlers.js` (new) — the feature-side handlers: `reportAssetOptimization(project, settings)` (plans over the project's resources and returns projected per-file savings, writing nothing) and `setAssetOptimizationSettings(project, settings)`.
- `Byok/ByokAssetTools.js` (new) — the thin BYOK adapters, in the `ByokExtraTool` shape (`ByokExtraTools.js:126`), each delegating to the handlers above.
- `Byok/ByokExtraTools.js` (modified, registry merge only — the `BYOK_EXTRA_TOOLS` array at `:706`).
- `Byok/ByokToolSchema.js` (modified, appended entries only) — the two schemas, their addition to `BYOK_TOOL_NAMES` (`:115`), and the `[D16-9]` dispatch-cap raise.
- `Byok/ByokPrompts.js` (modified) — prompt bump (next version after `byok-v12`, `:47`) with a short asset-optimization section and the retrieval-map entry that lets `search_tools` surface the two tools.
- Specs for the handlers and the schema/registry guard.

Upstream touchpoints: none — the BYOK tool files are our files.

Acceptance criteria:
- Both tool names resolve in the registry and the schemas validate (`validateByokToolSchemas`, `ByokToolSchema.js:2396`) — spec-proven.
- Both tools are reachable through `search_tools` and absent from `BYOK_CORE_TOOL_NAMES`, so `ByokPromptBudget.spec.js` (≤15k hard) stays green — spec-proven.
- `report_asset_optimization` writes nothing (the project is asserted unchanged after the call) — spec-proven.

### Step 16.6 — Verification round

**Goal:** confirm the optimizer never damages an export and always shrinks something.

Depends on: 16.1–16.5.

How to implement:
1. `npm test -- --watchAll=false`, `npm run lint`, `npm run flow`, `npm run check-format` from `newIDE/app`, plus the Electron app's check-format.
2. Export a project with known large PNGs/JPEGs to a folder with the setting on; confirm every optimized file keeps its **exact filename**, loads in a preview, and is smaller.
3. Confirm the project folder's originals are unchanged (hash before/after).
4. Force an optimizer failure (a deliberately locked file) and confirm the export still succeeds with that file untouched.
5. Run the manual desktop QA checklist in §4.

## 4. Phase 16 acceptance criteria (phase gate)

- `[A16-1]` With optimization on, an export produces strictly smaller image files (and audio, if D16-3 includes an encoder) **under the same names**, and the exported game still runs and loads every asset.
- `[A16-2]` No file in the project folder is modified by an export (hash comparison) — non-destructiveness proven.
- `[A16-3]` An optimizer failure (locked file, unsupported codec) never fails the export; the affected file is left as exported.
- `[A16-4]` Both desktop paths are covered: the one-click online export (zip contains optimized files) and the manual export (folder contains optimized files).
- `[A16-5]` With the setting off, export behavior is byte-identical to the pre-phase tree.
- `[A16-6]` The upstream touchpoint budget is two files — `electron-app/app/main.js` (one IPC registration) and `ExportAndShare/LocalExporters/index.js` (pipeline swap) — plus the Preferences tab list entry; each is recorded in the worklog. The C++ exporter and `ProjectResourcesCopier` are **not** touched. The BYOK tool/schema/prompt additions are our own files; the only approval they need is the `[D16-9]` dispatch-whitelist cap raise.
- `[A16-7]` Every new function has a spec; all four gates are green.
- `[A16-8]` Manual desktop QA passes: an export with optimization on shows the report and a smaller build, and a preview of that build loads its assets (owner).
- `[A16-9]` The AI can report projected optimization savings and change the optimization settings from chat, with no write to the project's originals; both tools are advertised via `search_tools` and the prompt budget stays under the 15k cap.

## 5. Explicitly not in this phase

- **Audio transcoding to a new codec or container** (e.g. WAV → OGG/Opus) as a default — that changes playback guarantees and is a separate decision; v1 only re-encodes when the owner opts in per format.
- **Format migration** (PNG/JPEG → WebP/AVIF) as a default — the runtime supports only what it already supports; changing formats per asset is out.
- **Texture-atlas packing, sprite-sheet slicing, or per-frame dedup** — those are authoring transforms, not build compression, and belong (if anywhere) to Phase 17's asset tooling.
- **Optimizing the project folder in place** — only the export copy is touched (D16-2).
- **Any change to the C++ exporter, `ProjectResourcesCopier`, or the WASM bindings.**
- **The browser export path** — desktop-only (D16-5).
- **AI-driven one-off compression that writes into the project** — the AI surface (`[D16-9]`) is read/config only; compression happens at export, and the project's originals are never an AI write target.
- **Uploading or hosting optimized assets** — this phase ends at a smaller local build.

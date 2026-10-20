# BYOK — Outstanding User Tasks

Everything here still needs **you**: a desktop session, a real endpoint, a file
you must author, or a decision only you can make. Work top to bottom — the
order is roughly "what breaks something if it stays broken" first.

**Everything not listed here is done or assumed verified.** The full history —
every completed checklist, every answered decision, every superseded phase QA
list — is in [`deprecated/usertasks.md`](deprecated/usertasks.md). Per your
instruction (2026-10-03), **basic functionality of Phases 1–12 is treated as
verified**, so the old per-phase QA matrices are retired, not skipped.

**A note on the old task numbers.** The audit records (`audit011026.md`,
`audit100226.md`), the phase plans and the worklog still say things like
"usertasks Task 18" or "Task 15". Those numbers point into the **archive**
(`deprecated/usertasks.md`), where the full context lives — those documents
are permanent records and were not rewritten.

**Housekeeping:** `outofscoped.md` is empty (no agent backlog).
`deferred.md` holds the deliberately-postponed items.

---

## 1. Phase 15 desktop QA — game code on disk `[do this one first]`

*Newest code, least proven, and the only feature whose acceptance criteria
cannot be checked headlessly.* Plan: `Phase15.md`. Built 2026-10-03, committed
`0b82098612`.

1. **The pane.** Home page → the new "Game code" button (index 0, above
   Preferences) opens a three-pane tab: tree | Monaco | Ask AI chat.
   - The tree root is the game-code folder (`<project>/<GameName>Code/`) and
     nothing above it is reachable or draggable into.
   - Create a file from the tree, rename it, delete it — each updates the
     **project's resource registry**, not just the file (a rename that skipped
     the registry would ship the old path).
   - Opening the game-code tab closes the standalone Ask AI tab and back again
     (D15-11: exactly one chat UI at a time).
2. **D15-7, the single-writer guard.** With a file open in Monaco, type into it
   and do NOT save. Then have the AI write that same file
   (`write_game_code_file`). The editor must show a notice offering "Load the
   new version" / "Keep my version" — it must **never silently replace your
   unsaved typing**.
3. **A15-2, hot reload.** Start a preview, then:
   - edit one game-code file → **only that file** reloads, no page reload;
   - create a new file → it loads;
   - delete a file → the page hard-reloads (D15-13: a script cannot be
     unloaded from a running page).
4. **A15-8, the D15-12 condition.** This is the one the owner made the design
   conditional on ("as long as it works with the GD engine"). Have the AI
   create `character/spawn.js` assigning `GameCode.character.spawn`, then:
   - call it from **another game-code file**; and
   - call it from a **scene's JS code event** (which sees `runtimeScene` and
     the `gdjs` scope).
   Both must work against the live engine, not just in a unit test.
5. **A15-1, the last hop.** Preview a project with two game-code files in
   different folders and confirm the exported `index.html` carries one
   `<script src>` per file, in D15-3a order (folder root + `core/` first, then
   the other groupings alphabetically). This is **not assertable in Jest** —
   `UsedExtensionsFinder.ScanProject` is blind in the test WASM (it reports
   only `BuiltinObject`, even for the app's own event writer), and the
   exporter uses the same finder. See `deferred.md` `[P15-a15-1-tail]`.
   **If the tags are absent**, the "marker action makes the carrier extension
   structurally used" mechanism needs another hook; the next candidate is a
   project-level object of a carrier-declared type.

---

## 2. Rebuild and upload the v3 RAG bundle `[blocks a shipped feature]`

The corpus hash changed on 2026-10-01 (tags folded into the hash, map-chunk
tag split, two EventScript example fixes, fence-aware chunking), so the
published **v2 bundle is stale and the app correctly refuses it**.

1. Rebuild:
   ```
   cd newIDE\app
   node scripts/byok-embedder/build-byok-rag-bundle.js
   ```
2. Upload the **new** file from `newIDE/app/build/byok-rag-bundle/` as a
   release asset on `mrmflis-hub/GDevelop` (release tag
   `byok-rag-bundle-v3`; the RAG tab finds any tag with the
   `byok-rag-bundle-` prefix). **Do not re-upload v2** (`…-571d1b30.json`).
3. Optional second asset on the same release: a Qdrant snapshot (name it
   `…-qdrant-snapshot`), produced by restoring the JSON bundle into a local
   Qdrant and taking a collection snapshot. Skip it — the in-process import
   path is complete without it.
4. Verify with a fresh profile: RAG tab → download the bundle (one consent
   dialog) → semantic search works with no ~30-minute build. Then feed it a
   tampered file → it must be refused with a rebuild offer, never accepted.
5. Confirm **GitHub Releases on `mrmflis-hub/GDevelop` may carry these
   assets** (no keys, no secrets, ever).

Also confirm a hosting answer for the finetuned embedder — a free public
Hugging Face repo you create, or release-only. **Low urgency: 14.3 (the
finetune) was deferred by your own order ("move on without finetuned model"),
so items 17.1 (the 200-query set) and 17.4 (the Colab training run) are
moot until you revisit that.**

---

## 3. Electron-main and upstream-guard QA

*`newIDE\electron-app` has **no test runner** by project rule, so everything
below is genuinely unexercised. It accumulated across the audit011026,
audit100226 and outofscoped-closure sessions — one pass covers all of it.*

**MCP server lifecycle**
- Double-toggle the MCP server → exactly **one** endpoint starts (mutex).
- Kill GDevelop with the server on (no clean quit) → the next start takes over
  the stale discovery file.
- Start a second GDevelop instance with the server enabled → it refuses with
  the "another instance owns the endpoint" message; the first is unaffected.
- Disable the endpoint **mid-request** → the caller gets 403, not a forward.
- MCP client cancellation actually reaches the window that received it.
- Reload the editor window while MCP is enabled → the next call fails fast
  instead of hanging ~150 s.
- With MCP read-write, have a client call `add_scene_events` and confirm the
  **save prompt appears** — before the fix, MCP edits were silently discarded
  on close (`A1002-UP-9`).
- The Preferences activity log lists calls made through **other editor
  windows**, and "Clear" clears everywhere.

**RAG / bundle**
- The bundle info/download channels refuse any host but `api.github.com` /
  `github.com`.
- Snapshot restore refuses a non-release URL, and no longer destroys the
  collection on a slow import.
- A resource URL containing a colon or a reserved device name is sanitized.
- Closing a preview whose window is already destroyed does not reject.

**Upstream guards**
- An unparseable `create_scene` background color is refused **without**
  creating the scene.
- An empty event replacement no longer deletes the target event.

**The packaged app `[I-desktop-app-never-packaged]`** — the QA of the fork
always ran the IDE **from the sources** (`npm run electron-app`), never from a
package, so the packaging path was never exercised. It was broken for
months: the packaged app died at startup with "Cannot find module", because
the Electron main process required the pure modules of the IDE, which are not
shipped. Fixed on 2026-10-20 (the modules are now listed in
`newIDE/electron-app/app/SharedModules.json`, loaded through
`app/SharedCore.js` and shipped in `resources/Shared/`).
→ One pass is still worth doing: double click `Build GDevelop App.cmd` at the
root of the repository, then LAUNCH `newIDE/electron-app/dist/win-unpacked/
GDevelop.exe` (the installer needs an installed copy). Check that the IDE
opens, that a game preview starts, and that the MCP endpoint and the BYOK
chat work — none of that was ever exercised on a package.

**One upstream file was touched `[I-electron-builder-config-touched]`** —
`newIDE/electron-app/electron-builder-config.js` gained one `extraResources`
entry (the shared modules). The fork had never modified that file; it is
recorded here because `AGENTS.md` §4 asks for every upstream touch to be
known.

**One deliberate behaviour change to confirm by hand:** a long chat tool (a
preview wait, a sub-agent) now holds the project mutation lock, so an MCP
call issued at that moment **waits** for it instead of interleaving. Nothing
hangs (the client-side timeout still answers), but it is a serialization you
did not have before — worth one manual pass.

---

## 4. Remaining edge behaviours (beyond "does it work")

*Specific known gaps, not a re-run of the basic QA.*

1. **40+ round build session.** Watch the `Context summarized:` row appear
   around 75% context and the loop **continue** — it must not dead-end with
   `byok-context-full` (this was a real bug class; the fix is in, untested
   against a real long chat).
2. **Command palette / shortcut on the desktop build.** "Open Ask AI" is
   listed; `Ctrl+Alt+A` opens the panel; reassigning the shortcut through
   Preferences works; no clash with your other shortcuts. Not safely testable
   on the remote VM — needs your machine.
3. **Offline behaviour.** Catalog tools fail with the explicit offline
   message; runtime tools fail typed when no BYOK preview runs;
   `read_doc_page` answers the docs-min drill-down with the network blocked.
4. **One online-export smoke test.** `local-file-download` / `-save-from-arraybuffer`
   are now confined (path containment + gdevelop.io-only cookie). Confirm a
   normal online export still downloads its resources.
5. **Per-provider and chat behaviours from the audit fixes** (cheap, one
   sitting): the effort pill no longer re-routes a providers-only chat to the
   global endpoint; a failed resource download reports a failure instead of
   registering a broken resource; the rail's BYOK Rename works; deleting a
   working chat stops the loop; restore is refused while a chat works; a
   restarted app recovers the persisted RAG index (semantic mode, no rebuild);
   the Qdrant setup survives a restart on the same port.

---

## 5. Decisions you may want to revisit

*Each was answered or taken during the sessions; each is a real fork, not an
oversight.*

1. **Prompt budget: 12,703 tokens vs the 8–10k aim.** Taken on your behalf,
   with a recommendation to accept the landing rather than cut real teaching to
   hit an advisory number. The budget spec now prints the six largest sections
   and schemas every time it warns, so there is data if you want to revisit.
   Levers are listed in `deferred.md` `[BYOK-D-prompt-budget]`.
   *Recommendation: leave it.*
2. **Game-code pane layout is not persisted between sessions.** The
   preference key would have to join the closed `EditorMosaicName` union,
   which was outside the approved upstream budget. The pane opens at a 22/62
   split; in-session resizing works. *Recommendation: leave it — it is a
   clean standalone change later if the annoyance is real.*
3. **Report the upstream fixes to GDevelop. BOTH PACKAGES ARE READY
   (2026-10-04).** `REVIEW/upstream/` now holds:
   - `upstream.md` — the self-contained report;
   - `UP-1-local-file-download/` — the security fix, four annotated files +
     two patches. **File this one first**; the redirect detail (axios 0.19
     forwards headers cross-host) is the part worth a maintainer's attention;
   - `UP-2-to-UP-8-correctness-and-lifetime/` — the other seven, as six
     annotated patch files, with a **recommended four-PR split** in its
     README (they should not be bundled into one PR).
   Remaining owner-only action: decide which PRs to open, and in what order.

---

## 6. Phases 16–19 done — desktop QA left `[cap now full: 75/75]`

- `[P16-impl]` `Phase16.md` — build-time asset compression (shrink the export
  copy, never the originals) — **implemented 2026-10-07, uncommitted.**
  `Fork/AssetBuild/` holds the planner, the port, the pipeline wrapper, the
  settings store, the Build Preferences tab, the one-shot report dialog and the
  BYOK tools; the Electron main gained the thin applier
  `electron-app/app/ForkAssetOptimizer.js`; `sharp` + `ffmpeg-static` were added
  to `electron-app/app/package.json`. The upstream touchpoints are exactly the
  three of `[A16-6]`: `electron-app/app/main.js` (one IPC registration),
  `ExportAndShare/LocalExporters/index.js` (the two wrapped pipelines) and
  `MainFrame/Preferences/PreferencesDialog.js` (the "Build" tab entry).
- `[P17-impl]` `Phase17.md` — tag-driven asset management (tags in resource
  metadata, a virtual tag tree, auto-registration of dropped files, asset
  hot-reload + "Reload from disk", name-based aliases with Monaco completions)
  — **implemented 2026-10-08, uncommitted** (all 8 steps; the permanent record
  is the 2026-10-08 worklog entry). `Fork/AssetPipeline/` holds the feature;
  the BYOK tools are `list_assets` + `set_asset_tags` (prompt `byok-v14`).
  **Update 2026-10-09:** the recorded limitation `[P17-preview-reload]` (a
  changed asset did not reload a LAUNCHED preview) is resolved — the reload
  paths now also re-export + hard-reload running previews
  (`ForkAssetPreviewReload.js`; see `deferred.md` for why in-place refresh is
  impossible). Covered by `[P17-qa]` bullet 3 below.
- `[P18-impl]` `Phase18.md` — event-sheet guardrails (pure-JS diagnostics:
  Once-in-loop, Wait-in-loop, object-picking, duplicate Once, as inline badges
  with a settings popover) — **implemented 2026-10-08, uncommitted** (all 4
  steps). `Fork/Guardrails/` holds the engine; the BYOK tool is
  `scan_scene_events` (read-only). **Update 2026-10-09:** the recorded
  limitation `[P18-while-conditions-unscanned]` is resolved — the While event's
  `whileConditions` list is now scanned by every condition-reading rule
  (real-gd spec coverage).
- `[P19-impl]` `Phase19.md` — sprite-sheet import (slice an atlas into frame
  PNGs, register them, build the animation) — **implemented 2026-10-09,
  uncommitted** (all 5 steps; prompt `byok-v15`). `Fork/SpriteSheet/` holds the
  pure plan, the renderer port, the assembly and the import dialog
  (`ForkSpriteSheetDialog.js`, opened by an "Import sprite sheet" button beside
  "Add an animation" in `SpriteEditor/index.js` — the one upstream editor
  touchpoint); the Electron main gained the confined slicer
  `electron-app/app/ForkSpriteSheet.js` (`fork-sprite-sheet-slice`, reuses the
  Phase 16 `sharp`). The BYOK tool is `import_sprite_sheet`
  (approval-gated, `modifiesProject: true`, reachable via `search_tools`,
  never in `BYOK_CORE_TOOL_NAMES`). The two subagent progress files
  (`REVIEW/Phase19SubagentAProgress.md` / `B`) hold the build log.

**Answered 2026-10-06:**

- `[D16-3]` dependencies **approved** — `sharp` (images) and `ffmpeg-static`
  (audio); both are installed in the Electron app package. `sharp` is native and
  must be rebuilt for Electron's ABI (Phase 19 reuses it for slicing).
- `[D16-1]` / `[D17-1]` namespace **answered**: the feature code lives in its own
  non-AI namespace (`newIDE/app/src/Fork/…`) and is exposed to the AI as BYOK
  tools. Phases 18 and 19 follow the same rule (`Fork/Guardrails/`,
  `Fork/SpriteSheet/`), each with a BYOK tool adapter.

**Still needs you:**

1. `[P16-qa]` **Phase 16 desktop QA** (`Phase16.md` §4, `[A16-8]`). The gates, the
   specs and a real applier run are all green — a synthetic export copy lost 73 %
   of a PNG and 67 % of an MP3 under the same file names, with the project
   folder's hashes unchanged — but the end-to-end IDE path needs the desktop app:
   - Preferences → **Build** → turn "Optimize assets when exporting" on.
   - One-click online Electron export: the build still succeeds, the zip holds
     the optimized files (extract and compare sizes), and the sizes report
     appears once, right after the export.
   - Manual "export to a folder": the folder's images/audio are smaller under
     the same names, and the report appears.
   - Hash the project folder before and after: no project file changed.
   - Run the exported build and confirm every image and sound still loads (the
     files keep their names precisely so the runtime's resource lookup does).
   - Turn the toggle off and export again: the output must be byte-identical to
     the pre-phase tree (`[A16-5]`).
2. `[P16-abi]` **Electron ABI rebuild for `sharp`.** `sharp` ships a Node-ABI
   prebuild; the Electron main process needs the Electron-ABI build. If an
   export reports "the sharp image encoder is not installed" inside a packaged
   app, run the Electron rebuild for `newIDE/electron-app/app`
   (`npx electron-rebuild`, or `electron-builder install-app-deps`) — and again
   after every Electron upgrade. The app degrades gracefully until then (images
   are left exactly as exported, and the Build tab says so).
3. `[P1719-cap]` **The dispatch-whitelist cap raise for Phases 17–19 — TAKEN
   in-tree 2026-10-08 (71 → 75, the recommended number) and now FULL:
   `BYOK_TOOL_NAMES` sits at exactly 75/75 after Phase 19's `import_sprite_sheet`
   (2026-10-09).** The next dispatchable tool needs a new owner-approved raise
   (the cap comment in `ByokToolSchema.js` says so). If taking the list to the
   cap was not the intent, any of the four Phase 17–19 names can be pulled from
   `BYOK_TOOL_NAMES` without touching any other code.
4. `[P17-qa]` **Phase 17 desktop QA** (`Phase17.md` §4, `[A17-9]` + the visual
   ACs). Gates and specs are green; the end-to-end IDE paths need the desktop
   app:
   - Drop a PNG into the project folder with the Resources editor open → it
     registers automatically (the "Assets" tag-tree toggle in the Resources
     editor toolbar), appears in the tree, and the project shows unsaved
     changes.
   - Tag an asset with two tags → it appears under both branches; the tag
     editor refuses an invalid tag inline; a save/reload round-trip keeps the
     tags.
   - Edit an asset externally → the open editors reload it AND any launched
     separate-window preview is re-exported and hard-reloaded (it restarts —
     resolved 2026-10-09, `deferred.md` `[P17-preview-reload]` explains why a
     restart is the only refresh); "Reload from disk" in the resource context
     menu bursts the cache, refreshes the list and also refreshes previews.
   - Open game code in the editor → the asset names appear as Monaco
     completions (`forkAssets["…"]`); write `play('<resource name>')` in a
     preview → it resolves at runtime.
   - In chat (BYOK on): "what assets are untagged?" uses `list_assets`; "tag
     every enemy sprite enemy" uses `set_asset_tags` and flags unsaved
     changes.
5. `[P18-qa]` **Phase 18 desktop QA** (`Phase18.md` §4, `[A18-7]`). Gates and
   specs are green; check visually:
   - Build each trap by hand (a Once under a For Each, a Wait inside a Repeat,
     an action on an object no condition picks, two Once conditions on one
     event) → each shows its badge with the explaining tooltip; a clean scene
     shows none; disabled events/subtrees show none.
   - The badge's settings popover mutes a rule live and the master switch
     removes all badges (re-enable needs a firing badge or the localStorage
     key — see `outofscoped.md` `[P18-master-switch]`).
   - The sheet still edits/undoes normally (the analysis is read-only,
     spec-proven).
   - In chat: "scan my scene for traps" uses `scan_scene_events` and returns
     the same diagnostics the badges show.
   - New 2026-10-09: a Once written into a WHILE event's own condition list
     (the loop guard, not a child event) shows the badge too.
6. `[P19-qa]` **Phase 19 desktop QA** (`Phase19.md` §4, `[A19-1..3, A19-8]`).
   Gates and specs are green (292 suites; the plan/port/assembly/dialog/tool
   specs all pass against the real libGD WASM); the end-to-end path needs the
   desktop app — NOTE `sharp` needs the Electron-ABI rebuild first (item 2
   above; the slicer shares the optimizer's binary):
   - Sprite editor → "Import sprite sheet" beside "Add an animation" → pick a
     real atlas, set a grid → the preview draws the slice lines and the frame
     count; a non-dividing grid disables Import with the plan's message.
   - Import into a fresh animation → the frames land in
     `<project>/<GameName>Assets/` under `Object_anim_N.png` names, the
     animation plays in a real preview with alpha preserved (`[A19-1]`,
     `[A19-3]`).
   - Import twice / onto an existing name → no existing file is overwritten
     (the names dedupe) (`[A19-2]`).
   - In chat (BYOK on): "import sheet.png as a 4x4 grid onto Player" triggers
     `import_sprite_sheet` and ASKS for approval (it modifies the project)
     (`[A19-4]`).

**A note on the Phase 16 cap raise itself:** it was taken in-tree (69 → 71) on
the strength of your standing approval for this exact raise (Phase 15.3) plus the
2026-10-06 answer to `[D16-9]` ("AI access requested"). If that was not the
intent, the two asset tools can be pulled from `BYOK_TOOL_NAMES` without
touching any other code.

Each doc's §2 lists its full decision set (D16-1…9, D17-1…10, D18-1…9, D19-1…9);
everything except the cap raise is either answered or stands as recommended.

**MCP client — resolved 2026-10-06, no phase.** The owner declined a BYOK MCP
client: it is fragile and a lot of work, and unnecessary because the external AI
clients (Claude Desktop, VS Code, ZCode) are themselves MCP clients and can bridge
to other MCP servers on their own. Instead the fork now documents the bridge in
the app: the MCP settings card carries a tip, and the About dialog gained an "AI
and external tools" note. No further action.

---


## 7. Upstream sync — 2026-10-19 `[one resolution closed, one left as-is]`

`upstream/master` (140 commits, up to `987b9d3919`) is merged into `master`.
19 files conflicted; all 45 hunks are resolved and every gate is green (332
suites / 4073 tests, lint 0, Flow 0, prettier clean). The merge commit is on
`master`; `backup/pre-upstream-sync-2026-10-19` keeps our previous head
(`1230fc6e18`) if you want to compare.

One resolution was a fork divergence, and it is now settled:

1. **The extension-authoring tools — RESOLVED (owner decision,
   2026-10-19).** Upstream shipped its own `create_extension` /
   `create_custom_*` / `change_custom_*` with a different argument shape and
   no `event_script` support. The fork's tools now live in their own
   namespace — `create_extension_BYOK`, `create_custom_function_BYOK`,
   `change_custom_object_BYOK`, `find_extension_usages_BYOK` and the five
   others — so a name can never reach the wrong implementation, the name
   says which one runs, and the "which implementation wins" guard is gone.
   The cost: the BYOK agent answers different names than the hosted agent
   for the same job. The fork's tools have since gained upstream's
   duplication, expression type, getter and `fit_area_to_children`
   (2026-10-19); what is still different is upstream's variant model (the
   custom object's named variants) and its shared properties. Details:
   `deferred.md` → `[I-fork-vs-upstream-extension-tools]`.
   → nothing to decide; the entry stays as the standing note for the next
   upstream merge.
2. **The Preferences dialog — left as is (owner decision, 2026-10-19).**
   Upstream redesigned it (search bar, section list, scroll spy); our BYOK /
   RAG / Build tabs were re-added on top of the new structure as plain tabs.
   They are NOT searchable sections and they do not appear in the section
   list. Keeping them as tabs is deliberate: it makes them stand out as
   fork-only panels.

Desktop QA: the merge changed the chat surface (the hosted file attachments
and the BYOK "+" attach button now coexist), the extension tools (they are
renamed — the agent now calls `create_extension_BYOK`) and the Preferences
tabs — a pass over the chat (attach a file, send a message) and over the
Preferences tabs is worth a run. The BYOK RAG bundle (Task 2) still needs its
v3 rebuild + upload: the corpus hash changed with this merge.

## Reference (no action)

- `REVIEW/audit011026.md`, `audit100226.md` — the two full audits, every
  finding marked `[fixed]`.
- `REVIEW/deferred.md` — by-design items and accepted limitations, including
  the CometAPI endpoint quirks (gpt-6-luna rejects `tools` +
  `reasoning_effort`; glm-5.3-flash returns garbage after very large tool
  outputs).
- `REVIEW/deprecated/usertasks.md` — the historical record: 22 tasks,
  every answered owner decision, and every retired per-phase QA matrix.

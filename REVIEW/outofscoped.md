# Out-of-Scope Backlog — to be tackled

**Purpose:** every task, fix, or issue that **should be tackled** but fell
outside the running agent's scope or budget. This file is only "to be
tackled": an entry is **removed as soon as the fix is implemented and
verified** (all gates green) — the permanent record then lives only in
`worklog.md`. Items blocked on an owner decision stay here with a `Blocked
on:` line pointing at the numbered decision in `usertasks.md`.

Rules for agents: see `AGENTS.md` §5.2. If nothing new belongs here at the
end of a session, the worklog entry says `no OOS`.

**Status: open entries** (the environment/decision rows below). The
2026-10-02 completion session (owner-ordered) fixed and verified the last
audit011026 triage items — B-TOOL-11 (post-launch-resolve debugger
binding), B-MCP-13 (activity mirrored to main + aggregated in
`byok-mcp-status`), B-UI-13 (versioned `index.json` chat index,
stat-only steady state) and B-ARTIFACT-1 (landed in `943379bff0`) — and
the Polygon2d lifecycle call was resolved by documenting the ownership
transfer at the two editor sites with inverse regression pins (audit
UP-8; the delete variant is disproven by the 2026-09-24 WASM-heap repro).
All were removed; the permanent record is `audit011026.md` +
`worklog.md`. The benchmark WASM crash
filed 2026-09-24 was FIXED and verified on 2026-10-01 (root cause: a
type-confused `gd.Serializer.toJSON(scene.getEvents())` in
`ByokSettingsTab.js`'s snapshot reader — audit011026 B-TOOL-1; permanent
record in `worklog.md`) and was removed. The Recents-rail Rename was
re-added and verified on 2026-10-01 (audit011026 O6) and was removed.
The live-redraw entry filed by the Phase 11+12 session was **fixed
and verified on 2026-09-24** (the owner approved the MainFrame touchpoint as
usertasks Task 15; the new external-item fan-out channel is implemented and
tested — permanent record in `worklog.md`) and was removed from this file.
Previously emptied by the Phase 10 order ("nothing can remain deferred or broken
unless specifically approved by me earlier"); the last actionable rows were
fixed and verified in that session:

- **Project-notes identifier captured once per orchestrator** (surfaced
  Phase 7, step 7.8) — FIXED: `useByokChatSeam.js` now reads
  `fileMetadata` live through `byokFileMetadataRef` in both
  `getProjectNotesIdentifier` closures (chat orchestrator + MCP host), so a
  mid-chat "Save as…" moves the notes to the new identifier.
- **Two-argument `unserializeFromJSObject` project corruption** (surfaced
  Phase 8 via ByokFork) — FIXED: `Utils/Serializer.js` routes the
  `optionalProject === serializable` case to the single-argument in-place
  form; covered by the new `Serializer.spec.js`.
- **Duplicate `onOpenAskAi` key in AskAiEditorContainer's Props** — FIXED:
  the older `{| aiRequestId, paneIdentifier |}` shape was removed; the
  current `(?OpenAskAiOptions) => void` shape remains the only declaration.
- F1, F2 (watchdog half) and F3 (+ D5) were implemented and verified in
  Phase 9 (`Phase9.md` steps 9.1/9.3/9.4) and their entries were removed.
- The two accepted-limitation notes (in-place-restore stale deep views;
  repeated in-jest restores flakiness) moved to `deferred.md` as
  by-design/accepted entries.

The permanent record for all of the above is in `worklog.md`
(2026-09-23 Phase 10 entry and the phase entries cited above).

## Open entries

- **Two pre-existing preview-launcher robustness nits** (surfaced while
  fixing audit UP-2/UP-5 on 2026-10-02, left to keep the fix diff
  focused): `LocalPreviewLauncher/index.js` `closePreview` fires
  `ipcRenderer.invoke('preview-close', …)` with no `.catch` (a
  main-process error would surface as an unhandled rejection), and
  `electron-app/app/PreviewWindow.js` `closePreviewWindow` reads
  `entry.previewWindow.id` on entries that in a close race could hold a
  destroyed window (practically benign behind the `closed` filter).
  Small, upstream-reportable; fix alongside the next touch of either
  file.

## Added 2026-09-25 (Phase 13 session)

- **`npm install` prunes the libGD test alias from `node_modules`.** Any
  `npm install` in `newIDE/app` (e.g. the Phase 13
  `@huggingface/transformers` install) removes
  `node_modules/libGD.js-for-tests-only/`, and every Jest suite then fails
  with `Cannot find module 'libGD.js-for-tests-only' from
  'src/setupTests.js'` (`scripts/import-libGD.js:6-12` creates it; npm
  treats the hand-made folder as extraneous). Fix for now (used in this
  session): `mkdir -p node_modules/libGD.js-for-tests-only && cp
  public/libGD.js node_modules/libGD.js-for-tests-only/index.js && cp
  public/libGD.wasm node_modules/libGD.js-for-tests-only/libGD.wasm`.
  Proper fix: a postinstall hook or a Jest moduleNameMapper entry so the
  alias survives installs. Blocks: nothing (workaround is mechanical), but
  it will bite every fresh dependency change.
- **One random Jest suite flakes per full run (documented, still open).**
  With `--watchAll=false --maxWorkers=1`, full runs each fail exactly one
  DIFFERENT untouched suite (observed 2026-09-25:
  `EventsFunctionsList/TreeViewItemContents.spec.js`, then
  `Byok/Mcp/ByokMcpSettingsCard.spec.js`; both pass standalone and in the
  following full run). Same class as the known "parallel workers flake"
  note. Blocked on: a headless repro (needs `--detectOpenHandles` tracing
  across a full run); zero evidence it is Phase 13 code (both flaked
  suites are untouched).
- **The Phase 13 prompt budget lands at ~10.5k typical / 11.5k worst-case,
  above the 8–10k aim (D13-6).** `ByokPromptBudget.spec.js` reports the
  number every run and enforces the 15k hard cap with ~3.5k headroom; the
  residue is the pinned EventScript block (~550 tokens, 13.6 by design),
  the task catalog (~600) and the worst-case 2 KB custom-instructions
  payload (~500). Levers if the owner wants the band reached: shrink the
  catalog guidance further, drop `read_events_source` or `put_2d_instances`
  from the core set behind `search_tools`, or spend the schema-slimming
  pass on the remaining fat schemas (`put_2d_instances` ~570, `add_scene_events`
  ~440). Blocked on: an owner call — accept the landing or commission the
  further slimming.
## 2026-09-27 — Phase 14 filings

- `[O14-displacement]` `[open]` — Docs-min displacement data: on 4 of the
  24 eval queries ("timer spawn create objects", "play a sound effect",
  "physics gravity forces", "expression clamp values") the weighted
  top-3 now carries relevant-but-different minified-wiki pages instead of
  the strict expected source (gate green at hashing 79 % / MiniLM 83 %).
  This is exactly the D14-2 data that decides whether docs-min chunks
  later displace curated chunks; revisit on the next eval round (or the
  owner's Task 17.1 queries), not before.
- `[O14-prose-typos]` `[open]` — Two minification agents normalized
  upstream PROSE typos (batch-022 "Triggred Once"→"Triggered Once";
  batch-033 "Returns a Hash a MD5"→"Returns an MD5 hash") against the
  verbatim-keeping contract; identifiers were kept verbatim everywhere.
  Decide before the next `DOCs/` refresh whether
  `scripts/build-byok-minified-docs.js`'s contract pins verbatim-everything
  or explicitly blesses prose-only fixes (one line in
  MINIFICATION_CONTRACT).


## 2026-10-01 — audit011026 triage (see REVIEW/audit011026.md for detail)

- All four entries this section carried (B-TOOL-11, B-MCP-13, B-UI-13,
  B-ARTIFACT-1) were FIXED and verified by the 2026-10-02 completion
  session and removed — dispositions in `audit011026.md`.
- The O4 flake family keeps growing: full runs on 2026-10-02 each failed
  exactly one DIFFERENT untouched suite (`ByokExtraTools.spec.js`,
  `ByokRagIndex.spec.js`, `LocalResourceMover.spec.js`,
  `LocalResourceExternalEditors.spec.js` across the session's runs — the
  last with a `useEnsureExtensionInstalled` mock-bleed TypeError while
  all its tests pass); every one passes standalone. Fifth+ members of
  the family documented below. Still open.
- O3 (npm install prunes the libGD test alias), O5 (prompt budget accept
  or slim), O14-displacement and O14-prose-typos remain open unchanged.

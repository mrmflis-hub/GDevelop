# Out-of-Scope Backlog — to be tackled

**Purpose:** every task, fix, or issue that **should be tackled** but fell
outside the running agent's scope or budget. This file is only "to be
tackled": an entry is **removed as soon as the fix is implemented and
verified** (all gates green) — the permanent record then lives only in
`worklog.md`. Items blocked on an owner decision stay here with a `Blocked
on:` line pointing at the numbered decision in `usertasks.md`.

Rules for agents: see `AGENTS.md` §5.2. If nothing new belongs here at the
end of a session, the worklog entry says `no OOS`.

**Status: 2 open entries** (the benchmark WASM crash filed 2026-09-24 by the
QA session 5; the Polygon2d lifecycle call, still blocked on the owner).
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

- **Benchmark tool execution crashes the libGD WASM heap ("memory access
  out of bounds") when applying an event-writing batch to the scratch
  project** (surfaced 2026-09-24 during the QA-round-1 benchmark re-test,
  QA session 5; reproduced with both mimo-v2.6-flash and glm-5.3-flash).
  `runByokBenchmark` task 2 ("Write a working event batch") dies inside
  `executeByokBenchmarkCalls` with `memory access out of bounds`; tasks 3-4
  then fail with the same error, and the poisoned WASM module makes every
  later benchmark run fail instantly at
  `ProjectHelper.createNewGDJSProject` with the misleading classification
  "The endpoint returned an unexpected error." until the page is reloaded.
  The fix belongs in the benchmark's own tool-application path (likely a
  wrapper lifecycle issue of the same family as the Polygon2d entry below —
  the chat-side event writer does not crash). Blocked on: nothing
  structural, but it needs a headless repro of the benchmark's scratch
  flow; the two spec-visible effects (per-task crash capture works, error
  classification mislabels WASM aborts as endpoint errors) are the
  regression surface.

- **Polygon2d wrapper leak + lifecycle asymmetry in the collision-mask
  editors** (surfaced 2026-09-24 while porting sprite mask editing).
  `ObjectEditor/Editors/SpriteEditor/CollisionMasksEditor/PolygonsList.js:224-235`
  and `CollisionMaskHelper.js:148-156` `new`/`createRectangle` a
  `gd.Polygon2d` and `push_back` it into the live mask vector but never
  `delete()` the wrapper — unlike `gd.Sprite`/`gd.Point`/`gd.Vector2f`
  wrappers, which the same editors DO delete after their `push_back`s.
  Deleting the Polygon2d the same way corrupts the WASM heap (repro:
  memory access out of bounds in later libGD calls — hit while testing
  `ByokSpriteTools`), so the asymmetry looks deliberate-but-undocumented
  and the price is a small wrapper leak per polygon edit. Blocked on: an
  owner call whether to align the lifecycle (needs a libGD-side check of
  `VectorPolygon2d::push_back` copy semantics) or document it where the
  editor code lives. BYOK side already encodes the safe pattern
  (`ByokSpriteTools.js` `applyPolygonMaskToFrame`).

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
- **Rename is gone from the BYOK Recents rows.** The removed
  `ByokChatHistory` dialog had inline rename; Phase 13's rail action list
  (D13-4) is open/archive/delete only, so rename was dropped with the
  dialog. `ByokChatPersistence.renameChat` still exists — re-adding a
  rename entry to the rail's context menu is a ~15-line change. Blocked
  on: owner confirmation that the phase's action list was meant to be
  exhaustive.

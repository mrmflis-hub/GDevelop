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

## 2026-10-02 — audit100226 triage (see REVIEW/audit100226.md for detail)

Fixed and REMOVED from this backlog (2026-10-02, second session; full
inventory and reasoning in `audit100226.md` Part 6): the Qdrant backend is no
longer upload-only (RAG-1), stale points are removed on a shrinking corpus
(RAG-2), the snapshot restore no longer drops the collection on a client
timeout (RAG-3), lexical search answers paraphrases instead of zero hits
(RAG-5), the persisted-load latch no longer blocks a mid-session enable, the
minified-docs accessor is memoized and the lexical pass uses a precomputed
lowercase view, response validation covers content/arguments shapes, Stop
aborts the compaction call, the turn-budget error is non-retryable, the loop
guard rolls back an unexecuted batch and detects alternating cycles, the two
runtime-inspection tools honor their advertised filters and cap their dump,
`list_effects` is capped with an honest total, the preserved block reads the
right skill argument, `read_events_source`'s `max_chars` matches the
implementation, `read_doc_page` is advertised whenever the prompt teaches it
(and the advertisement is deduped), a chat deleted mid-save can no longer be
resurrected, a failed file listing can no longer wipe every image sidecar, a
chat selection naming a removed provider falls through to normal routing,
removing a provider no longer clears the shared legacy key slot, the models
cache is scoped per provider, the MCP queue releases its slot at task start, a
timed-out MCP call is cancelled rather than executed late, MCP activity entries
are bounded and whitelisted, `update_project_notes` is refused in MCP read-only
mode, the MCP server start is mutexed, the snapshot URL is validated server-side,
model-chosen resource names reject ADS colons and reserved device names,
atomic-write temp names are unique per call and cleaned up on failure, a
reloaded renderer is dropped from the ready senders, a project mutation lock
serializes chat and MCP tool execution, the extension create tools sanitize
names and refuse reserved lifecycle names, the event-replacement paths verify
content before clearing, and a mutating function that throws still reports the
mutation.

The following remain open, with their reasons.

- `[A1002-PROMPT-3/4]` `[open]` — The prompt-to-registry guard only extracts
  call-shaped tokens (`Name(`), so every BARE tool mention escapes its check,
  and it scans only the composed (partly degraded) prompt, so the
  historically most defect-dense text (the EventScript pack) is never
  scanned. Widening it means deciding which bare identifiers are tool names,
  which needs a curated token list rather than a substring pass.
- `[A1002-SCRIPT-2]` `[open]` — The eval harness sends a generic 2-message chat
  with neither the BYOK system prompt nor any tool schemas, while its scorers
  require argument names (`create_if_missing`, `brush_position`,
  `children_to_add`) the model was never shown — so authoring-reach tasks are
  near-unpassable except by training prior. Fixing it properly means the eval
  becomes a full BYOK loop (tools, approval, persistence), which is a much
  larger harness than the current scorer-only design.
- `[A1002-PROMPT-5/6/7]` `[open]` — Prompt-text polish: the EventScript pack
  teaches 7 of the 8 placement relations; four docblocks drifted during earlier
  refactors; and the prompt budget sits above the 8-10k aim with identifiable
  duplication. The budget item needs an owner call (see O5 above).
- `[A1002-RAG-6/7/8]` `[open]` — Three retrieval-quality items: a runtime with
  a good index but a failed embedder load is never retried (semantic search
  stays off for the session); the RAG-off lexical corpus is built WITHOUT the
  user's opt-in docs folder, so their files are invisible until a full build;
  and user-docs chunks are titled by bare file name, so same-named files in
  different folders are indistinguishable and their ids are unstable across
  rebuilds.
- `[A1002-RAG-9/10/11]` `[open]` — Loaded embedders are never evicted (switching
  embedders keeps two models resident); the first search after a restart pays
  the corpus build inline in the agent loop; and the chunker's overlap tail can
  start mid-word or mid-fence.
- `[A1002-UI-6/7/8/9/10]` `[open]` — Five persistence/UI polish items: a failed
  file move can leave the old chat file to be adopted as a duplicate entry;
  quarantined files and the index count against the 200 MB quota while never
  being evicted; a chat whose images were all evicted keeps a stale sidecar;
  `ChatMessages`' memo is defeated by inline closures so the whole transcript
  re-renders on each store notification; and a provider with no per-model block
  sends an empty model name to its Test button.
- `[A1002-MCP-3/4/6/8/9]` `[open]` — Five low MCP items: a cancellation is
  routed by "currently focused window" rather than the window that received the
  request; a POST whose body arrives after a disable still forwards on the
  captured state; an unknown tool name answers an isError result where the spec
  wants a -32602 protocol error; the activity dedupe key can collapse two
  distinct same-millisecond calls; and legacy JSON-RPC batch clients still hang
  on a >=400 answer. The window-routing ones live in Electron main, which has no
  test runner by project rule — they need the pure-CJS extraction pass the
  other MCP findings got before they can be pinned by a spec.
- `[A1002-ELEC-21/22]` `[open]` — An unhandled rejection from the preview-close
  tracker, and the RAG bundle info/download channels accepting any https host
  from the renderer (no credentials attached, sha256 verified, capped).
- `[A1002-UP-14/15/16]` `[open]` — Three low upstream items: the
  `replace_event_but_keep_existing_sub_events` wrapper leaks on a throw; the
  replace paths still enqueue a delete when the generated events are empty;
  and `create_scene` persists an unvalidated `background_color` (a named color
  becomes NaN and is written into the project).
- `[A1002-CACHE-7/8]` `[open]` — The RAG status card deserializes the whole
  multi-MB index to read four manifest fields, and the persisted-index recovery
  builds the corpus once to hash it and then rebuilds the identical corpus for
  the lexical cache.
- `[A1002-SCRIPT-3/4/5]` `[open]` — The eval harness still discards judge token
  usage, the shared 24-query RAG eval set has no docs-min queries (so a
  regression confined to the two largest corpus grades passes the gate), and
  the minified-docs plan inventory still sorts with a locale-dependent
  comparator.

Unchanged from before this session: the O4 flake family, O3 (npm install prunes
the libGD test alias), O5 (prompt budget accept or slim), O14-displacement and
O14-prose-typos.

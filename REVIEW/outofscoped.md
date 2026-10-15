# Out-of-Scope Backlog — to be tackled

**Purpose:** every task, fix, or issue that **should be tackled** but fell
outside the running agent's scope or budget. This file is only "to be
tackled": an entry is **removed as soon as the fix is implemented and
verified** (all gates green) — the permanent record then lives only in
`worklog.md`. Items blocked on an owner decision stay here with a
`Blocked on:` line pointing at the numbered decision in `usertasks.md`.

Rules for agents: see `AGENTS.md` §5.2. If nothing new belongs here at the
end of a session, the worklog entry says `no OOS`.

## Open — Phase 16 (build-time asset compression), 2026-10-07

Phase 16 shipped implemented, tested and gate-green (see the 2026-10-07
worklog entry). These are the things noticed during that session that should be
tackled but were outside its scope: the phase's upstream budget is explicit and
tight (`[A16-6]`: two files plus the Preferences tab entry), so anything that
would have touched a fourth upstream file, or that is a refinement rather than
an acceptance criterion, is recorded here instead.

- `[P16-image-floor]` **The "too small to bother" floor is a byte threshold
  (4096), a proxy for a dimension question.** A real guard would read the
  image dimensions; the byte floor avoids decoding every candidate.
  Where: `ForkAssetPlan.js:FORK_ASSET_IMAGE_FLOOR_BYTES`.
  → update 2026-10-08: left as a deliberate proxy, on purpose. For a
  build-time optimizer the question the floor answers is "is there anything
  to GAIN", and bytes answer that better than dimensions do: a 5000×4000
  flat-color PNG under 4 KB is already near-optimally compressed (nothing to
  regain), while a 16×16 noise icon can be 100 KB (a real win). Dimensions
  would proxy visual size, which the exporter does not care about, and
  getting them means decoding (or at least header-sniffing) every candidate
  in the listing — exactly the cost the floor exists to avoid. Revisit only
  if real export reports ever show a meaningful miss.
- `[P16-projection]` **The savings projection is a fixed low/high band per
  transform, not a measurement.** Honest (it says "estimate") but coarse; the
  real ratios could be learned from the export reports.
  Where: `ForkAssetToolsHandlers.js:FORK_ASSET_PROJECTION_RATIOS`.
  → update 2026-10-08: left as-is — learning the real ratios needs
  accumulated per-transform export-report data, which does not exist yet
  (the feature shipped yesterday and is opt-in). The honest estimate band
  stays until there are reports to average.
- `[P16-main-test]` **The Electron applier has no unit tests** — the Electron
  package has no test runner (AGENTS.md §6), so it is kept thin and was verified
  by a real Node run against a synthetic export copy (recorded in the worklog:
  73 % off a PNG, 67 % off an MP3, same names, project hashes unchanged). If a
  runner is ever added to `electron-app`, the applier is the first candidate.
  Where: `newIDE/electron-app/app/ForkAssetOptimizer.js`.
  → update 2026-10-08: still no runner (adding one is infrastructure the
  owner has not ordered). The applier was re-verified today with the same
  discipline — a real Node run against an ffmpeg-generated animated GIF
  (frames and total duration preserved, 3264 → 2589 bytes) and a synthetic
  PNG (721638 → 1313 bytes), plus the new folder-guard refusals.

## Open — found by the 2026-10-09 verification subagent

- `[O-MCP1-start-spec]` **The MCP queue's armed-at-task-START property has no
  spec that could fail against a revert.** The restructure is real and wired
  (`ByokMcpToolHost.js:193-223`: the timeout timer is created inside
  `previousTail.then`, chain extended synchronously), but the only queue spec
  (`B-MCP-3`) enqueues its single follower at t≈0, which behaves identically
  under the old enqueue-armed code and the new start-armed code — the
  distinguishing property is a follower enqueued while a predecessor is
  already RUNNING (it must not start its timeout until it starts running).
  Where: `Mcp/ByokMcpToolHost.js` + `ByokMcpToolHost.spec.js`.
  Blocks it: nothing but time — a staggered-burst spec with fake timers.
- `[O-RAG-restore-branch-spec]` **The `loadPersistedByokRagIndex` Qdrant
  restart-recovery branch has no direct spec** (`Rag/ByokRagSearch.spec.js:17`
  mocks the module away). The primitives it calls (store `search`/`inspect`,
  the build service's Qdrant branch) ARE spec'd, so this is a wiring-level
  gap only. Where: `Rag/ByokRagSearch.js` around the persisted-index loader.

## Closed — the 2026-10-03 session closed every entry that was open then

The owner ordered "implement all outofscoped.md items; where a user decision
is needed use your recommended solution". **Every entry this file carried is
now fixed, tested and verified** (permanent records: `worklog.md` 2026-10-03
entry, plus the per-finding dispositions below). Three items ended as an
explicit *measured* disposition rather than a code change; they are recorded
in `deferred.md` as by-design with their numbers, so nothing is silently lost.

### Closed by fix (verified, tested, gates green)

- **O3 — `npm install` prunes the libGD test alias.** ROOT-CAUSED and fixed
  in `scripts/import-libGD.js`: the "already present" flag was computed once
  at load, BEFORE the restore branch, so the script still fell through to the
  network and `exit(1)`. The alias is now rebuilt from `public/` when npm
  prunes it, and the flag is re-evaluated at the point of use. Verified by
  deleting `node_modules/libGD.js-for-tests-only` and re-running the script
  (exit 0, files restored).
- **O4 — "one random Jest suite flakes per full run".** The documented
  ~8-member flake family had ONE root cause, and it was worse than
  documented: not a timeout, and not a random suite — a **cross-file React
  leak**. `useByokChatSeam.spec.js` mounted trees it never unmounted; their
  async effects (chat history, model choices) resolved *after the file
  ended* and re-rendered the dead tree against the NEXT test file's mocks,
  throwing inside an unrelated suite — or crashing the whole worker process
  outright. Because any suite rendering the seam was affected, the victim
  changed every run. Fixed at three levels: the seam spec tracks and unmounts
  every renderer in `afterEach`, the `useEnsureExtensionInstalled` stub is a
  plain function (so `resetMocks: true` can no longer strip it and turn a
  late render into a TypeError), and `setupTests.js` drains the event loop in
  `afterAll` so any remaining leak stays in the file that caused it.
  **Deterministic repro** (this is how it was found, and how to re-check it):
  `npm test -- --watchAll=false --maxWorkers=1 --runTestsByPath
  src/AiGeneration/Byok/useByokChatSeam.spec.js src/UI/HelpIcon/HelpIcon.spec.js`
  — it failed and crashed the process before the fix, passes after it.
- **The two preview-launcher nits** (`closePreview` firing `ipcRenderer.invoke`
  with no `.catch`; `closePreviewWindow` reading `entry.previewWindow.id` on a
  possibly-destroyed window).
- **`A1002-RAG-6/7/8/9/10/11`** and **`A1002-CACHE-7/8`** — all eight
  retrieval items, including three tests proven non-vacuous by reverting the
  fix (RAG-11's two, UP-15's).
- **`A1002-UI-6/7/8/9/10`** — all five persistence/UI items.
- **`A1002-UP-14/15/16`** — all three upstream items.
- **`A1002-ELEC-21/22`** — both Electron-main items.
- **`A1002-MCP-3/4/6/8/9`** — all five MCP items.
- **`A1002-PROMPT-3/4/5/6/7`** — the guard now catches bare tool mentions
  and scans every knowledge section at full size; the missing placement
  relation is taught; the drifted docblocks are corrected. (One of the four
  alleged docblock drifts turned out to be a **false finding** — recorded in
  the 2026-10-03 worklog entry's "Issues found", where the `max_chars`
  capability is cited at its real implementation in
  `EditorFunctions/index.js`.)
- **`A1002-SCRIPT-3/4/5`** — judge token accounting, six `docs-min` eval
  queries added to the shared set (24 → 30), and the locale-dependent
  comparator replaced with a byte-wise one.

### Closed as a measured disposition (no code change) — recorded in `deferred.md`

- **O5 / `A1002-PROMPT-7` — the prompt budget above the 8–10k aim.**
- **`O14-displacement`** — docs-min chunks displacing curated ones on some
  eval queries.
- **`O14-prose-typos`** — resolved by making the minification contract say
  explicitly that upstream prose typos stay verbatim.

Rules for agents: see `AGENTS.md` §5.2. If nothing new belongs here at the
end of a session, the worklog entry says `no OOS`.

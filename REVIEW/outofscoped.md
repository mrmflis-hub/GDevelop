# Out-of-Scope Backlog — to be tackled

**Purpose:** every task, fix, or issue that **should be tackled** but fell
outside the running agent's scope or budget. This file is only "to be
tackled": an entry is **removed as soon as the fix is implemented and
verified** (all gates green) — the permanent record then lives only in
`worklog.md`. Items blocked on an owner decision stay here with a
`Blocked on:` line pointing at the numbered decision in `usertasks.md`.

Rules for agents: see `AGENTS.md` §5.2. If nothing new belongs here at the
end of a session, the worklog entry says `no OOS`.

## Status: EMPTY — the 2026-10-03 session closed every entry

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
  alleged docblock drifts turned out to be a **false finding** — see
  `deferred.md`.)
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

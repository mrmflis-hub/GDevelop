# Open & Deferred Findings Tracker — audit2209

**Purpose:** the full detail of every known finding that is **not yet
fixed**, consolidated on 2026-09-22 from the five `audit2109*.md` reports,
`audit.md`, the 2026-09-21/22 worklog entries, `usertasks.md` and the agent
memory. **The actionable layer is the triage docs** (introduced later that
day): `outofscoped.md` (code work to tackle), `deferred.md` (postponed
features), `usertasks.md` (human decisions + QA) — watch those for what to
do next; this file holds the findings detail and history. When an item below
is fixed, mark it **DONE** with a date rather than deleting it.

**Statuses:** OPEN (needs code work) · DEFERRED (owner decision required) ·
USER-QA (only a human with the desktop app can do it) · ENV (environment/
tooling) · DOC (documentation drift) · BY-DESIGN (documented decision, no
action planned).

**Context:** Phases 1–6 are implemented and committed (`0802d2d21e`); gates
green (164 suites / 1740 tests / lint / flow / format). All 11 deduplicated
audit2109 B-findings are fixed.

---

## 1. Code findings still open

**Dispositioned 2026-09-22** (owner answers in `usertasks.md`): O1, O7,
O13, D5 and D10 are **approved** and tracked in `outofscoped.md`; O2 is
**accepted** (estimate fallback deferred); O12 is **closed by-design** with
D9; O3/O4 keep their standing Phase 8 / Phase 7–8 recommendations
(`deferred.md`). The rows below keep the full detail; the triage docs hold
the live status.

| # | Sev | Finding | Where | What it needs |
|---|-----|---------|-------|---------------|
| O1 | D | Like/dislike buttons render on BYOK chats but are inert (`onSendByokNoopFeedback`). Hiding them needs `onSendFeedback` to become an **optional** prop in `AiRequestChat/index.js` + `ChatMessages.js` (upstream files, out of BYOK budget). | `AskAiEditorContainer.js` | 2 upstream prop-type changes + render gates |
| O2 | C | Context guard disappears when the endpoint omits `usage` (`usageFromResponse` requires all three token fields) — the round cap is then the only runaway protection (pinned by the no-usage runaway test). | `ByokUsageTracker.js`, `ByokOrchestrator.js` | char-count estimate fallback, or accept |
| O3 | D | `ensureExtensionInstalled` in the BYOK executor memo keys on the React `project` prop: an extension install in the same second a project is created mid-chat uses the stale memo until the next render. | `AskAiEditorContainer.js` | upstream `useEnsureExtensionInstalled` refactor (out of budget) |
| O4 | D | The chat UI does not render transcript images to the **user** (the model sees them; the user sees the tool-output text only). | `AiRequestChat/*` (upstream render path) | upstream polish, noted in `Phase6.md` §5 |
| O5 | E | `loadByokKey` reports "no key stored" for both an absent entry and an undecryptable one — the container's guidance can mislead after a DPAPI failure. | `ByokKeyStorage.js` | distinguishing return shape (`none`/`unreadable`/`ok`) |
| O6 | E | A failed v1-plaintext migration leaves the plaintext entry on disk (retried on every load until it succeeds). | `ByokKeyStorage.js` | clear-only-after-confirmed-write (boolean return already exists) |
| O7 | D | `byok-empty-answer` error code is not mapped in `AiRequestErrorRow` (falls back to the generic transient presentation — retryable, which is correct, but the heading is generic). | `AiRequestErrorRow.js` | one mapping line when wording is agreed |
| O8 | E | `> 500` approved-call-ids eviction is an unexplained magic number (FIFO or a named constant with a why-comment would fit the style rules). | `AskAiEditorContainer.js:743` | trivial |
| O9 | E | Double "working" persist on every message (`appendUserMessage` sets it, `runLoop` sets it again immediately). | `ByokOrchestrator.js` | drop one |
| O10 | E | `describeInvalidRequestForReasoningEffort` is a predicate named "describe…" (Phase2 doc mandated the name); also only a 400 triggers the reasoning-effort degradation — a 422 naming the parameter classifies as `unknown` and fails the chat. | `ByokErrors.js` | rename (record spec deviation) + optional 422 tolerance |
| O11 | D | Spec hygiene: the 14-line `beforeEach` is duplicated across the `ByokSettingsTab.spec.js` describes (5 copies); `ByokSeam.spec.js` still uses CommonJS `require` + the `mockFn` indirection helper. | the two spec files | hoist/convert (chore) |
| O12 | E | `Array<any>` Flow escapes kept where precision is blocked: `ByokTranscript.byokResponseToAssistantMessage`'s content array (Flow array invariance vs the unexported `Generation.js` content union) and the orchestrator's `chatOptions`. | `ByokTranscript.js`, `ByokOrchestrator.js:391` | export the content-item union upstream, then type precisely |
| O13 | C | (from `audit.md` C12) The chat UI's manual "process function calls" affordances are silent no-ops when a BYOK chat is selected (BYOK tool execution is orchestrator-driven). | `AskAiEditorContainer.js` / `AiRequestChat` | hide or repurpose the affordances for BYOK chats |

## 2. Deferred features — owner decision (build / backlog / never)

**All 16 owner decisions were answered on 2026-09-22** (canonical record:
`usertasks.md`; approved work → `outofscoped.md` F1–F3 + findings table;
rejections → `deferred.md`). Statuses below are synced to the answers —
the triage docs are the actionable layer, this table is the summary:

| # | Feature | Status after the 2026-09-22 answers |
|---|---------|--------|
| D1 | Persisted BYOK chat history | **APPROVED with owner design** (file saves at 3 checkpoints, history button, 5-words+date naming) → `outofscoped.md` F1 + `Phase9.md` |
| D2 | Token streaming (`stream_options.include_usage`) | **NO for now** — superseded by the approved progress-updates + watchdog design (`outofscoped.md` F2); streaming stays in `deferred.md` |
| D3 | Re-admit store tools (`search_object_asset_store`…) | **BY-DESIGN: never** — swap to the official workflow; login stays, BYOK-enabled toggle routes AI (`deferred.md`) |
| D4 | Sub-agents (edit/explorer) | deferred — Phase 8 home unchanged (`deferred.md`) |
| D5 | BYOK badge in the chat header + exact token row | **APPROVED** (`outofscoped.md`) |
| D6 | Per-chat model/effort override UI | **APPROVED with owner design** — multi-provider registration, `provider/model` dropdown + effort dropdown (`outofscoped.md` F3) |
| D7 | BYOK in the homepage stand-alone AI form | de-scoped, reconfirmed (`deferred.md`) |
| D8 | C1's optional refactor: shrink `AskAiEditorContainer.js`'s BYOK additions into a hook | deferred — Phase 8 start (`deferred.md`) |
| D9 | C2: upstream export of the helpers BYOK reimplements | **BY-DESIGN: keep local** — no upstream PRs for now; owner may approach the GDevelop team later (`deferred.md`; closes O12 by-design) |
| D10 | C11: API-key field empty-blur clears the stored key | **APPROVED FIX** — explicit delete only (low-skill users) (`outofscoped.md`) |

## 3. Manual QA only a human can run

Full step-by-step checklists live in `usertasks.md`; the queue:

- **Task 1** — Phase 3 desktop verification (safeStorage/DPAPI, packaged build, network checks). OPEN.
- **Task 2** — Phase 4 end-to-end QA on a real endpoint (★ items verify the 2026-09-21 fixes). OPEN.
- ~~**Task 3** — commit the pending tree~~ **DONE 2026-09-22** (`0802d2d21e`; the doc-move decision was resolved then too — `agents.md`/`styleguide.md` live at the repo root).
- **Task 4** — review the applied audit fixes in the diff (fixes are committed; ★ verification folded into Task 2). OPEN (optional).
- ~~**Task 5** — green-light/shelve the deferred features above.~~ **DONE
  2026-09-22** — all 16 decisions answered (see `usertasks.md`); dispositions
  live in `outofscoped.md` / `deferred.md`.
- **Task 6** — Phase 5 desktop QA: the tool parity matrix (zero-backend event writing), stuck-loop demo. OPEN.
- **Task 7** — Phase 6 desktop QA: perception with a real vision endpoint ("trees overlap" flagship, preview/logs/gameplay-test flows). OPEN.
- **Task 8** (was the duplicate "Task 6 — Housekeeping") — real-provider "Test connection" smoke; libGD mirror fallback report. OPEN.
- **AGENTS.md refresh** (from old Task 3.4 / audit C4): the checkout is a git repo at `C:\Projects\GDevelop`, shell is Git Bash, `newIDE/electron-app` now has `node_modules`. OPEN.

## 4. Environment & tooling (ENV)

- **E1 (new, 2026-09-22):** `newIDE/electron-app` dev dependencies are now installed (`npm install --ignore-scripts` at the root **and** in `electron-app/app`), so `npm run check-format` / `node --check` work there. The **Electron binary was deliberately not downloaded** (`--ignore-scripts`) — running/packaging the desktop app still needs a full `npm install` in `electron-app` (Task 1 step 1).
- **E2 (RESOLVED 2026-09-22):** the two pre-existing upstream diffs in `electron-app` (`app/CliCommandHandoff.js`, `app/OpenProjectsRegistry.js`) were formatted and committed (`7283b2fc1c`, owner-approved) — the electron-app `check-format` gate is **fully green** now.
- **E3:** `npm install` dirties `package-lock.json` in both `newIDE/app` and `electron-app` — always `git checkout --` them after an environment rebuild.
- **E4 (RESOLVED 2026-09-22 by the owner):** a working `libgd-2.3.3` copy is saved at the **repo root** — `import-libGD.js` no longer depends on the 404-ing S3 mirrors. The owner also cloned `GDevelop-documentation` to **`DOCs/`** at the repo root (input for the Phase 7 knowledge work).
- **E5:** Jest prints "A worker process has failed to exit gracefully…" on full runs (pre-existing, no failing test).
- **E6:** The jest preset resets every mock implementation before each test (`resetMocks`) — implementations inside `jest.mock` factories must be re-set in `beforeEach` (also in memory).
- **E7:** Tests must run via `npm test -- --watchAll=false`; raw `npx jest` bypasses react-app-rewired setup (no libGD → misleading failures).

## 5. Documentation drift (DOC)

- **DOC1 (RESOLVED 2026-09-22):** `AGENTS.md` was rewritten by the owner — it now reflects the git repo, the `C:\` path, Git Bash, the triage docs (`outofscoped.md`/`deferred.md`/`usertasks.md`) and the decision process.
- **DOC2:** the `audit2109*.md` reports are point-in-time (line numbers shifted after the fixes and Phases 5–6) — treat them as history; the live actionable layer is the triage docs, with this file as the full-detail summary behind them.
- **DOC3:** phase-doc recorded deviations (C3 "two handlers" vs three, C10 `PreferencesProvider.js` touch, Phase 5's 23-vs-22 advertised tools reconciliation, Phase 6's "modified 5 tools" vs 9) — recorded in the docs themselves; nothing to do unless the docs are ever upstreamed.
- **DOC4 (fixed 2026-09-22):** `usertasks.md` had two tasks numbered "Task 6" — the Housekeeping one is now Task 8.

## 6. By-design / documented decisions (no action planned)

- Non-streaming chat completions (v1 design; streaming = D2).
- Web-build key storage is obfuscation, not encryption — honest status row says so (`ByokKeyStorage.js` header).
- `run_script` sandbox is hygiene, not a security boundary (upstream `ScriptRunner.js`); one approval per script.
- Tool descriptions/schemas are model-facing English by design (matches the server-side convention).
- A tool call without a server-issued `id` is **rejected** by the client with a classified error (rather than fabricating an id) — revisit only if a real endpoint emits null ids.
- `startNewChat`/`sendUserMessage` are identical in v1 (documented).
- `listByokChats`' `archivedAt` filter is a harmless dead condition (archive deletes the entry).
- BYOK chats never enter `AiRequestContext` (isolation by design).

---

*Next review: when Phase 7 starts, or after the USER-QA tasks surface findings.*

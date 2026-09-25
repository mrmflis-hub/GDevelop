# BYOK — User Tasks (things only a human can do)

Every task below was blocked during the automated phases because it needs a
desktop session, a real account/endpoint, or an explicit owner decision. Each
one is already recorded in `worklog.md` under "Issues found"; this file turns
them into step-by-step instructions. Work top to bottom — the first two are
the phase gates that are still open.

> **Monitoring note (2026-09-22):** the actionable triage is split across
> three files — [`outofscoped.md`](outofscoped.md) (agent backlog, "to be
> tackled"), [`deferred.md`](deferred.md) (deliberately postponed, with
> reasoning), and this file (everything needing a human decision, action, or
> assistance). [`audit2209.md`](audit2209.md) keeps the full findings detail
> behind them.

---

## Owner decisions — presented and answered 2026-09-22

This is the canonical record of the 16 decisions presented in chat on
2026-09-22, each with the agent's recommendation and **the owner's answer**.
Approved work lives in `outofscoped.md` (or its phase step); rejections and
postponements live in `deferred.md` as by-design entries.

1. **D1 — Persisted BYOK chat history.** Recommend: build in Phase 9.
   **Answer: APPROVED — build**, with the owner's design: chats are saved to
   file (YAML or Markdown — implementation picks, see `Phase9.md`) after
   every user message, after the AI finishes responding, and on app closure;
   the chat window starts clear on reopen and old chats are loadable from a
   history button in the chat tab; chat names = first 5 words of the first
   prompt + date of last interaction. → design recorded in `Phase9.md`,
   backlog entry F1 in `outofscoped.md`.
2. **D2 — Token streaming.** Recommend: backlog.
   **Answer: NO streaming for now** — keep the spinner. Instead the owner
   approved the alternative UX (progress updates via prompt + watchdog
   notices — entry F2 in `outofscoped.md`). Streaming stays in
   `deferred.md`.
3. **D3 — Re-admit store tools.** Recommend: keep excluded.
   **Answer: REJECTED — never re-admit.** Users who need asset-store tools
   swap back to the official workflow. Owner also confirmed the routing
   model: the user stays logged in; the BYOK-enabled setting is the router
   toggle (BYOK on → new chats route to BYOK; off → official AI); all
   non-AI features are identical either way. → by-design in `deferred.md`.
4. **D4 — Sub-agents (edit/explorer).** Recommend: build in Phase 8.
   **Answer: DEFERRED** — stays in `deferred.md` (Phase 8 home unchanged).
5. **D5 — BYOK badge in the chat header + exact token row.** Recommend: build.
   **Answer: APPROVED** → `outofscoped.md`.
6. **D6 — Per-chat model/effort override UI.** Recommend: backlog.
   **Answer: APPROVED — build**, ZCode-style: users register providers
   (name + endpoint + key); the chat gets two dropdowns — models listed as
   `provider name/model name` (pulled from the server) and an effort
   dropdown defaulting to low/medium/high, or the per-model effort levels
   when the server lists them. → entry F3 in `outofscoped.md`.
7. **D8 — Shrink `AskAiEditorContainer.js`'s BYOK additions into a hook.**
   Recommend: at the start of Phase 8.
   **Answer: keep local for now** — unchanged, stays deferred to Phase 8.
8. **D9 — Upstream export of the helpers BYOK reimplements.** Recommend: skip.
   **Answer: KEEP LOCAL.** Owner context: GDevelop is not accepting
   BYOK-fork PRs at the moment; this may be the only full
   server-independent BYOK implementation, and the owner may approach a team
   member about how such a PR could ever land — until then, no upstreaming.
   → by-design in `deferred.md`; O12 closes as by-design with it.
9. **D10 — API-key field: focus + blur empty clears the stored key.**
   Recommend: fix.
   **Answer: APPROVED — explicit delete only.** Rationale: GDevelop targets
   low-skill users; non-obvious destructive gestures defeat the point. Only
   the "Clear the stored key" button (and a deliberate empty-blur after the
   user actually typed) removes the key; an untouched empty field never
   clears. → `outofscoped.md`.
10. **O1 — Like/dislike buttons are inert on BYOK chats.** Recommend: hide.
    **Answer: APPROVED — hide, but do NOT delete the code** (keep the no-op
    handler for a possible future upstream PR). → `outofscoped.md`.
11. **O13 — The chat's "process function calls" affordances are silent no-ops
    on BYOK chats.** Recommend: hide.
    **Answer: APPROVED** (owner: "do both", with #15) → `outofscoped.md`.
12. **O2 — The context guard disappears when an endpoint omits `usage`.**
    Recommend: accept.
    **Answer: ACCEPT** — the round cap holds; the char-estimate fallback is
    recorded as **deferred** (not never) in `deferred.md`.
13. **O3 — Executor/`ensureExtensionInstalled` memo staleness.**
    **Answer: defer to Phase 8** .
14. **O4 — Transcript images not rendered to the user.**
    **Answer: present user with an in-chat link to saved img, no need to render chat.**
15. **O7 — `byok-empty-answer` wording.** **Answer: APPROVED** via the
    owner's "do both" — wording "The model returned an empty answer."
    (retryable) → `outofscoped.md`.
16. **E2 — electron-app format gate red on two upstream files.**
    **Answer: APPROVED and DONE 2026-09-22** — formatted and committed as
    `7283b2fc1c`; the electron-app `check-format` gate is fully green.

**Also answered outside the numbered list (2026-09-22):**

- **Direction: PAUSE.** No feature building until the owner says so; this
  session readjusted the docs and recorded these decisions. The human-QA
  tasks below (1, 2, 6, 7) remain the owner's whenever they choose.
- **AGENTS.md refresh:** DONE by the owner (the file now reflects the git
  repo, the `C:\` path, Git Bash, the triage docs and this decision
  process).
- **libGD pinning:** DONE by the owner — a working `libgd-2.3.3` copy is
  saved at the repo root (import-libGD no longer depends on the 404-ing S3
  mirrors), and the `GDevelop-documentation` repository is cloned to `DOCs/`
  at the repo root for the Phase 7 knowledge work.

---

## Task 1 — Phase 3 desktop verification (safeStorage / DPAPI)

**Status: PASSED — 2026-09-24, owner reported in chat: "completed
without errors."**

**Why you:** the checklist needs the real Electron app with DevTools; the
agent sessions were headless and `newIDE\electron-app` has no `node_modules`.
**Recorded in:** worklog 2026-09-19 (Phase 3), "Issues found", first bullet;
`Phase3.md` step 3.5 and ACs 1, 2, 7.

1. One-time setup (in `C:\Projects\GDevelop`):
   ```
   cd newIDE\app
   npm install            (if node_modules is missing again; then npx patch-package,
                            npm run make-version-metadata, npm run build-theme-resources)
   cd ..\electron-app
   npm install            (runs the zipped-extensions import + app\ npm install)
   ```
2. Start the desktop dev app: `cd newIDE\app` → `npm start` (renderer), and
   `npm run electron-app` (Electron shell), per `newIDE\README.md`.
3. Open **File → Preferences → BYOK**, enable BYOK, enter an endpoint + key.
   - [x] The storage-status row under the API key says *"encrypted by your
     operating system (DPAPI on Windows)"* — not the obfuscation warning.
4. Save the key, then open DevTools (F12) → Application → Local Storage:
   - [x] `gd-byok-key` holds `{"version":3,"value":"<base64 blob>"}`.
   - [x] The base64 blob is NOT the Phase 2 format (it must differ from the
     value you would see on the web build) and does not contain the key.
5. Restart the app (fully quit, relaunch):
   - [x] The chat / "Test connection" still works without re-entering the key
     (DPAPI decrypts across restarts under the same Windows user).
   - Note in the worklog which case you tested: same-user restart
     (expected to work) vs another Windows user (expected NOT to decrypt).
6. Networking check, with DevTools → Network open:
   - [x] "Test connection" against an arbitrary https endpoint sends the
     request from the renderer with the `Authorization` header and succeeds —
     no CORS errors (desktop windows run with `webSecurity: false`,
     `main.js` ~lines 183–196).
7. Packaged build (uses the repo's own pipeline, no new one):
   ```
   cd newIDE\electron-app
   npm run build          (electron-builder, config: electron-builder-config.js)
   ```
   Repeat items 3–6 inside the packaged app.
8. Regression: open a local project and run a normal preview — nothing
   changed in behavior (the only `main.js` diff is the 3 handler lines).
9. Append the results (pass/fail per item) to `REVIEW/worklog.md` as a new
   entry, and tick Phase 3 ACs 1, 2, 7.

**Explicitly out of scope** (do not claim it): DPAPI across Windows
sign-out/sign-in of the same account.

---

## Task 2 — Phase 4 end-to-end QA on a real endpoint

**Status: PASSED — 2026-09-24, owner reported in chat: "completed
without errors."**

**Why you:** needs the running desktop/web app, a real OpenAI-compatible
endpoint (OpenAI, LM Studio, Ollama, etc.) and visual inspection. What the
agent could do headlessly is already done (157 test suites + a local-server
e2e smoke, see worklog 2026-09-20).
**Recorded in:** worklog 2026-09-20 (Phase 4), "Issues found"; `Phase4.md`
step 4.8 and ACs 1, 2, 8.

Prerequisite: Task 1 done (desktop app runs). The audit's A1/A4 bugs were
**fixed on 2026-09-21** (worklog of that date), so the QA below can be run
as designed — the fix verification steps are marked with a star (★).

1. Preferences → BYOK: enable, point at your endpoint, fetch models, pick
   one, "Test connection" → expect success.
2. Open a small project → Ask AI → ask:
   *"Create a scene called Forest with a player object and a few trees."*
   - [x] Tool-call rows appear in the chat; the scene and objects appear in
     the editor; a final text answer arrives; chat status is `ready`.
   - [x] DevTools → Network: **zero** requests to `api.gdevelop.io/generation`
     during the whole exchange.
   - [x] The "Chat context" bar moves (set a small context-window value to
     make it visible).
3. Follow-up: *"add a score variable"* → the model inspects
   (`describe_instances`/`read_scene_events`) then edits — history honored.
4. Auto-edit off (toggle in the chat):
   - [x] A modifying call pauses with the existing "Apply this edit?" row.
   - [x] ★ Refuse → the chat suspends cleanly (no perpetual "working"
     spinner, Stop button released) and sending a follow-up message works —
     this verifies the A1 fix.
   - [x] ★ A multi-step request starts with `create_or_update_plan` and the
     plan renders — this verifies the A4 fix (the tool list no longer offers
     `add_scene_events`/`read_full_docs`/`search_docs`).
   - [x] Approve → the edit proceeds.
   - [x] ★ After an endpoint error (e.g. stop your local server mid-chat),
     the error row offers a retry that re-runs the turn — verifies C13.
5. Regression: disable BYOK in preferences → normal Ask AI with a GDevelop
   account works end-to-end (create a chat, get an answer).
6. Mid-loop stop: start a long request, close the Ask AI tab while it runs →
   app must not hang; reopening the tab is clean (see `audit.md` A2 for a
   known edge: an in-flight batch may still finish after "stop").
7. Append the results to `REVIEW/worklog.md` and tick Phase 4 ACs 1, 2, 8.

---

## Task 3 — Decide and commit the pending git state — **DONE 2026-09-22**

**Why you:** the checkout became a git repository after the docs were
written; committing was never the agent's to do.
**Status:** committed by the user as `0802d2d21e` "phase5-9 planned" (audit
fixes + Phases 5–6); the doc-move was resolved then too (`agents.md` /
`styleguide.md` live at the repo root). What may still be worth doing: the
AGENTS.md refresh described below.

Current uncommitted state (verify with `git status`):
- `newIDE/electron-app/app/main.js` + `ByokSafeStorage.js` (Phase 3),
- `AskAiEditorContainer.js` + the four new `Byok/` module pairs (Phase 4),
- `REVIEW/worklog.md`, this file, `audit.md`,
- a half-finished doc move: `REVIEW/agents.md` + `REVIEW/styleguide.md`
  deleted, untracked copies at the repo root.

Steps:
1. Decide the doc move: keep the copies at the root and commit the deletion
   (`git add -A agents.md styleguide.md REVIEW/agents.md REVIEW/styleguide.md`),
   or restore them into `REVIEW/` (`git checkout -- REVIEW/` and delete the
   root copies).
2. Review the code diff (`git diff`, `git status`) against the audit.
3. Commit — suggested split: one commit for Phase 3 (electron files), one for
   Phase 4 (seam + Byok modules), one for the docs.
4. Update `AGENTS.md` while at it: the checkout **is** a git repo now, the
   path is `C:\Projects\GDevelop` (not `D:\`), and the shell used by the
   tooling is Git Bash.

---

## Task 4 — Review the applied audit fixes (fixes landed 2026-09-21)

**Status: the fixes are implemented, unit-tested, and all four gates are
green** (1561 tests passed, lint/flow/format clean — see the 2026-09-21
worklog entry). What remains for you:

1. Skim the fix diff (`git diff` on `ByokOrchestrator.js`,
   `ByokToolSchema.js`, `ByokPrompts.js`, `AskAiEditorContainer.js` and
   their specs) — or trust the tests and go straight to Task 2, whose ★
   items verify the fixes interactively.
2. What was fixed: **A1** (refused batches now record `success:false` tool
   outputs before suspending — the chat survives and resumes),
   **A2** (stop now also cancels an arrived, un-executed batch),
   **A3** (the sent message clears from the input immediately),
   **A4** (`create_or_update_plan` is answered by the orchestrator itself
   and lights up the plan UI; `add_scene_events`/`read_full_docs`/
   `search_docs` were dropped from the 11-tool whitelist; prompt bumped to
   `byok-v2`), **C5** (approved calls are remembered until auto-edit is
   toggled), **C13** (failed BYOK chats get a working retry).
3. Not fixed on purpose (still yours to decide): C1's optional refactor,
   C2's upstream exports, C11 (empty-blur clears the key), and the D1–D7
   backlog in Task 5.

---

## Task 5 — Green-light or shelve the deferred features

**Why you:** all of these were deliberately deferred and need an owner
decision + prioritization before anyone builds them.
**Recorded in:** `Phase4.md` §4 (post-Phase-4 backlog); worklog 2026-09-20.
**Answer via decisions #1–#8 in the pending-decisions list above** (the
per-feature rationale now lives in [`deferred.md`](deferred.md)); the table
below is the seam detail.

| # | Feature | Where the seam is today |
|---|---|---|
| 1 | Persisted BYOK chat history (localStorage, capped) | `ByokChatStore.js` — `BYOK_CHAT_PERSISTENCE_ENABLED = false` |
| 2 | Token streaming (`stream_options.include_usage`) | `ByokClient.js` is non-streaming by design |
| 3 | `generate_events` as a nested BYOK call (+ re-admit store tools) | executor stub in `ByokSeam.js`; `createByokSubAgentRunner` seam |
| 4 | Sub-agents (edit/explorer) | `ByokOrchestrator.js` — `createByokSubAgentRunner()` returns null |
| 5 | BYOK badge in the chat header + exact token row | `ByokUsageTracker.getTotals` already provides the data |
| 6 | Per-chat model/effort override UI | settings are global (`ByokTypes.js`) |
| 7 | BYOK in the stand-alone homepage AI form | de-scoped in `report.md` §5 — `AskAiStandAloneForm.js` untouched |

For each: build now / backlog / never — then it can be planned like the
other phases.

---

## Task 8 — Housekeeping decisions (small, optional) — **ALL DONE (closed 2026-09-25)**

*(Renumbered from "Task 6" on 2026-09-22 — the Phase 5 QA task below had
taken the number.)*

1. [x] **API-key field clears the stored key** when you focus+blur it empty
   (pre-existing Phase 1 behavior, `saveByokKey('')` clears; see audit C11).
   Decide: fix (skip the save on blur of an untouched empty field) or accept —
   this is decision #9 above. *(Decision #9: APPROVED explicit-delete-only;
   implemented in Phase 7 step 7.0.)*
2. [x] **Real-provider smoke**: run the settings-tab "Test connection" once
   against a real provider (the Phase 2 smoke used a local mock server —
   12/12, but a real provider was never hit). *(Done 2026-09-24, QA
   session 5: both CometAPI providers "Connection successful!".)*
3. [x] **libGD mirror fallback**: `import-libGD.js` keeps falling back to the
   HEAD~2 S3 object (the HEAD~1 object 404s) — worth reporting upstream or
   pinning the working hash in the docs. *(Done 2026-09-22: owner pinned a
   working `libgd-2.3.3` copy at the repo root.)*

---

## Task 6 — Phase 5 desktop QA: the parity matrix (zero backend event writing)

**Why you:** needs the real Electron app + a real BYOK endpoint with the
Network tab open. **Recorded in:** worklog 2026-09-22 (Phases 5–6),
"Issues found"; `Phase5.md` §3.

**Status: largely verified 2026-09-24 (QA session 5, agent-driven,
glm-5.3-flash) — see per-item notes. Stuck-loop watchdog confirmed
working by the owner (mimo triggered it and was stopped with the stuck
message). The events headline is superseded by the Phase 13
harness/prompt rework (owner, 2026-09-25) — re-test after 13.6.**

1. One-time setup: as Task 1 (desktop app running, BYOK configured).
2. With DevTools → Network open (filter `api.gdevelop.io`), run one BYOK
   chat per tool family and check each succeeds:
   - [ ] objects: `create_or_replace_object` →
     `inspect_object_properties_effects` → `change_object_properties_effects`
     → delete via `delete_this_object`.
     *(Partial, session 5: create + real store-asset install verified in
     agentic chats; inspect/change/delete not separately exercised.)*
   - [ ] behaviors: `add_behavior` → `inspect_behavior_properties` →
     `change_behavior_property`.
   - [ ] instances 2D and 3D: `put_2d_instances`, `put_3d_instances` (a 3D
     layer), verified with `describe_instances`.
     *(Partial, session 5: `put_2d_instances` verified — instances visible
     on the canvas and in `get_project_overview`; 3D not exercised.)*
   - [ ] scenes: `create_scene` → `inspect_scene_properties_layers_effects`
     → `change_scene_properties_layers_effects_groups` → delete scene.
   - [ ] project: `inspect_project_properties_resources` →
     `change_project_properties_resources`.
   - [x] variables: `add_or_edit_variable` → `inspect_variables`.
     *(Session 5: global Score added and updated via `add_or_edit_variable`
     ×2; `inspect_variables` not separately called — covered in practice
     by the agent reading state back.)*
   - [ ] **events (the headline):** `read_events_source` → an anchored
     `add_scene_events` replace (echo `expected_event_source`) →
     `delete_event` by path — with **zero** requests to
     `api.gdevelop.io/generation` in the Network tab.
     *(SUPERSEDED by the Phase 13 harness/prompt rework — owner,
     2026-09-25: `read_events_source` verified; glm-5.3-flash had all 3
     `add_scene_events` attempts correctly rejected by the local
     validator with actionable guidance, so the gap is the knowledge
     harness, not the model — fixed by Phase 13 steps 13.5/13.6. Re-test
     after 13.6. Zero hosted calls verified throughout.)*
   - [ ] script batching: one `run_script` doing 5+ operations; then a
     refused approval (auto-edit off) — nothing in the script ran.
     *(Partial, session 5: `run_script` executed successfully inside a
     build chat; the refused-approval half not exercised.)*
   - [x] project-from-scratch: new chat with no project open →
     `initialize_project` → keep editing the new project in the same chat.
     *(Verified twice, session 5: two chats initialized projects
     ("Forest Game", "ForestDemo") and kept editing them; projects
     appeared in the editor with real content.)*
3. [x] Stuck loop: point BYOK at a deliberately dumb model (or a scripted fake)
   that repeats one identical call:
   - [x] the 3rd identical call gets the corrective message, the 4th stops
     the chat with "The AI got stuck".
     *(CONFIRMED WORKING by the owner, 2026-09-25: mimo triggered the
     watchdog in practice and was stopped with the stuck message.)*
4. [x] Regression: BYOK off → the hosted Ask AI still works.
   *(Covered by Task 2 item 5, PASSED 2026-09-24.)*

## Task 7 — Phase 6 desktop QA: perception with a real vision endpoint

**Why you:** screenshots and previews need the real app; the flagship demo
needs a vision-capable model. **Recorded in:** worklog 2026-09-22 (Phases
5–6), "Issues found"; `Phase6.md` §3.

**Status: screenshot capture + vision ingestion CONFIRMED (2026-09-24,
QA session 5, owner observation): both glm-5.3-flash and mimo-v2.6-flash
called `capture_preview_screenshot`/`capture_scene_screenshot` and mimo
definitely SAW the captured screenshot. The self-fix loop did not
succeed — repeat the flagship and the remaining items after the Phase 13
prompt/harness rework (steps 13.5/13.6).**

1. "Trees overlap" flagship: with a vision model, ask for "5 trees around
   the player, then look and fix any overlap":
   - [ ] the agent calls `capture_scene_screenshot` after placing, sees the
     overlap in the image, fixes it, re-captures.
2. Preview flow: `start_preview` on a scene whose events `console.log`:
   - [ ] `read_preview_logs` shows the line; `inspect_runtime_state` lists
     instances/variables; `capture_preview_screenshot` returns the frame;
     `get_runtime_errors` shows a deliberate crash; `stop_preview` closes.
3. Gameplay test loop: ask for a test with a wrong assertion:
   - [ ] the model sees failure + screenshot + the executed `source`,
     repairs it, re-runs, passes (screenshots default `on-failure`).
4. Vision-off regression: set Image support to "No" in Preferences → BYOK:
   - [ ] the same flows work text-only; the Network tab shows no
     `image_url` parts in the request bodies.
   - [ ] with "Auto-detect": point at a text-only model → the chat degrades
     to text-only once and continues (one console note).

## Task 9 — Phase 8 desktop QA: the autonomous build workflow (flagship)

**Why you:** the flagship needs the real desktop app + a real endpoint
(preferably vision-capable); no agent session can run it. **Prerequisite:**
Task 1 done. **Spec:** `Phase8.md` step 8.7.2 + §3.

From the homepage form with BYOK on (or the Ask AI tab with no project
open), send exactly:

> Build me a small platformer: 3 short levels, coins, one enemy type, HUD,
> menu, save best score, and make it feel juicy.

- [ ] Brief + plan: the agent shows a design brief via `create_or_update_plan`
  before editing; the plan tasks update as mechanics complete.
- [ ] The build-workflow skill is auto-included from turn one (visible as
  `[Auto-loaded skill: build-workflow]` in the first request body — DevTools
  Network tab — or via `load_skill` if the model loads it explicitly).
- [ ] Scenes/objects/events built locally; at least one gameplay test
  written and green (or visibly repaired); a screenshot captured and
  discussed; an extension or a JS event used somewhere sensible.
- [ ] Completion gate: the final message carries the `[Completion gate]`
  `Verified:` block; if the model claims done unverified, exactly one
  `[completion gate]` nudge message appears and the second claim is honored
  with a warning line.
- [ ] Restore points: after an editing turn, the user message shows the
  restore arrow in the chat; restoring confirms, rewinds the project, and
  the conversation forks ("Fork of …" appears in the history).
- [ ] Zero `api.gdevelop.io/generation` calls in the Network tab.

## Task 10 — Phase 8 desktop QA: sub-agents, extension authoring, entry points

**Why you:** same as Task 9. **Spec:** `Phase8.md` steps 8.1/8.4/8.5 + §3.

- [ ] Scout: ask something broad ("explore the project and list what could
  be improved") → `run_explorer_agent` runs in a fresh context and returns
  a capped summary; the chat continues. A nested agent call is refused.
- [ ] Reviewer: before a done-claim on a multi-step build,
  `run_review_agent` checks the work and flags gaps without editing.
- [ ] Extensions: ask for a reusable mechanic → `create_extension` +
  `create_custom_behavior`/`create_custom_function` build it; the new
  functions appear usable in events right away (regeneration once per
  batch); deleting a used extension is refused with the usage list.
- [ ] Entry points: right-click an event / an action / an object / a scene
  selection → the "Ask AI about this …" item opens the Ask AI tab with the
  prefilled request (works for hosted AI too).
- [ ] Homepage: the standalone form starts a BYOK chat that KEEPS RUNNING
  when the form's dialog closes (the Ask AI tab selects it and shows the
  work in progress).
- [ ] Regression: BYOK off → the hosted flows (form, context menus,
  restore) behave exactly as before.

## Task 11 — Phase 9 desktop QA: stamina (watchdog, compaction, history, routing, benchmark)

**Why you:** the Phase 9 gate is desktop-only (long real-endpoint runs,
restarts, two providers). **Prerequisite:** Task 1 done. **Spec:**
`Phase9.md` steps 9.1–9.8 + §3. **Added 2026-09-23** (Phase 9 implemented;
owner ordered the phase in chat, restarting the paused project).

**9.1 + 9.2 — waiting UX and long builds:**
- [x] Progress sentences appear per completed to-do during a build (the
  Phase 7.1 prompt half) — regression of the F2 pair.
  *(Verified 2026-09-24, QA session 5: "Reviewing a starter game
  template." / "Analyzing the object properties" rendered in-chat during
  builds.)*
- [x] Stall notice: park the endpoint (e.g. pause the local server) mid-turn
  → after the configured window (default 90 s) one `No activity for 90s…`
  line appears **in the transcript** (a centered notice row, not an error);
  it repeats at most once per window; any activity ends the sequence; Stop
  disarms it. Toggle it off in Preferences → BYOK → "While the AI is
  working" → no notices ever.
  *(CONFIRMED WORKING by the owner, 2026-09-25: mimo hit the watchdog in
  practice and the chat was stopped with the stuck message. The
  never-responding-endpoint variant from QA session 5 was inconclusive —
  provider failover routed around the dead endpoint, which is itself
  correct behavior.)*
- [ ] 40+-round build session: watch the `Context summarized:` row appear
  around the 75% context bar and the loop CONTINUE (no `byok-context-full`
  error unless the window is tiny).

**Status of 9.3 / 9.4 / 9.5: PASSED — 2026-09-24, owner reported in
chat: "completed without errors." (9.1 + 9.2 not yet reported.)**

**9.3 — durable history:**
- [x] Send a message, let the AI finish, quit the app mid-history →
  `byok-chats/` under the user-data folder holds readable `.md` files (name
  = first 5 words + date).
- [x] Reopen: the chat window starts clear; the "Chat history" button lists
  the saved chats (names/dates only); Open reloads the chat with its
  screenshots still rendering; archive hides from the default list and is
  restorable; Delete (with confirmation) is permanent.
- [x] Settings shows the storage usage line; the feedback export button
  downloads `byok-ai-feedback.json`.

**9.4 — multi-provider routing + D5:**
- [x] Register a second provider (Preferences → BYOK → Providers); per-
  provider key + "Test this provider".
- [x] The chat header shows `BYOK · Provider/model · <n> tokens (<turns>)`;
  the model dropdown lists `provider name/model name` from each provider's
  `/models`; a per-chat pick overrides the routing; the effort dropdown
  offers low/medium/high (or the server-listed levels when probed).
- [x] With routing on "automatic" and a fast profile set, the Network tab
  shows the fast model for compaction/suggestion calls and the strong one
  for edit turns.

**9.5 — capabilities + benchmark:**
- [x] On an endpoint without `reasoning_effort` support: the first turn
  degrades once; the second turn's request body carries no
  `reasoning_effort` (DevTools), and no further 400s.
- [x] "Run the benchmark (≈2 min)" runs the 4 tasks on a scratch project
  and prints the pass counts; two models produce a sensible ranking.

**Regression:** hosted AI unaffected; Phase 5–8 scenarios still green.

## Phase 10 owner decisions — presented and answered 2026-09-23

The MCP-server phase (`Phase10.md`) was ordered in chat on 2026-09-23 with
"Fantastic! Please implement this." — given immediately after the five
recommendations below were presented in chat, this approved them as
recommended (full reasoning and the affected steps in `Phase10.md` §2).
They are all reversible constants (a default, a folder, a doc appendix).

1. **D10-1 — Protocol implementation.** Recommend: hand-rolled JSON-RPC/MCP
   subset (no new dependency). **Answer: APPROVED as recommended** —
   hand-rolled (`Byok/Mcp/ByokMcpProtocol.js`); no `@modelcontextprotocol/sdk`.
2. **D10-2 — Default access mode when the MCP server is enabled.** Recommend:
   read-write (the enable toggle is the consent act; read-only stays one
   dropdown away, and the activity log audits every call). **Answer: APPROVED
   as recommended** — `DEFAULT_BYOK_MCP_ACCESS_MODE = 'read-write'`.
3. **D10-3 — Tool surface over MCP.** Recommend: full parity, including
   `run_script` and `initialize_project` (the access mode gates them like
   any modifying tool). **Answer: APPROVED as recommended** — full parity.
4. **D10-4 — Code location.** Recommend: `Byok\Mcp\` (sibling of the seam
   and registry it reuses; stays inside the scope rule). **Answer: APPROVED
   as recommended** — `Byok\Mcp\`.
5. **D10-5 — Client wiring support in v1.** Recommend: dev-time commands
   documented in `Phase10.md` Appendix A. **Answer: APPROVED as
   recommended** — dev-time wiring; the settings card copies a generic JSON
   config snippet.

## Phase 11/12 green-light — presented and answered 2026-09-24

The 2026-09-23 surface audit ended with a numbered candidate list in chat.
On 2026-09-24 the owner picked ten items ("These seem to be the most
alluring to implement. Please Plan them in Phase11 and Phase 12 to have
more or less equal amount of work") — this approves them as scope with the
following phase homes:

1. `get_game_starter_summary` local summarizer (no-project templates) →
   `Phase12.md` step 12.1.
2. External events + external layouts tools → `Phase11.md` steps 11.2/11.3.
3. Effect-catalog tool (`list_effects`) → `Phase11.md` step 11.4.
4. Local store-discovery replacement — owner's "IF it's possible then
   yes": verified possible on 2026-09-24 (the public asset/resource and
   example catalogs are auth-free static JSON, no Generation API, and the
   install paths already run client-side) → `Phase12.md` step 12.2.
5. Command-palette entry + Ask-AI keyboard shortcut → `Phase12.md` step 12.3.
6. + 10. MCP-native skills/prompts/notes primitives + a `read_project_notes`
   tool (owner's items 6 and 10 are the same work) → `Phase12.md` step 12.4.
7. Resource import/replace + sprite-internals tools → `Phase11.md` steps
   11.5/11.6.
8. Extension-editor internals (custom-object children, post-creation
   parameter declarations, dependencies) → `Phase11.md` step 11.7.
9. Debugger/profiler connection (against the BYOK-launched preview) →
   `Phase12.md` step 12.5.

Not picked, stays deferred: leaderboard/analytics/multiplayer/export
tooling, image/audio generation, object-type-specific authoring
(particles/tile maps/3D/Spine/shape painter), child-property editing after
creation, dependency auto-resolution, live in-game instance editing — see
`Phase11.md` §5 and `Phase12.md` §5. The per-phase design decisions
(D11-1…D11-5 in `Phase11.md` §2, D12-1…D12-8 in `Phase12.md` §2) carry
recommendations in the docs and are answered at implementation kickoff,
per the established pattern.

## Task 12 — Phase 10 desktop QA: the GDevelop MCP server

**Why you:** the MCP endpoint lives in the Electron main process and needs
real clients, real ports and real windows. **Prerequisite:** Task 1 done
(desktop build). **Spec:** `Phase10.md` §4 + Appendix A. **Added 2026-09-23**
(Phase 10 implemented; owner ordered the phase in chat).

**Lifecycle and security:**

*Status: transport security, no-host rule, tool surface, prompts/
resources and restart-reconnection verified 2026-09-24 (QA session 5);
second-instance refusal, kill-takeover and the activity-log visual check
remain.*

- [ ] Preferences → BYOK → "MCP server (external agents)": the toggle
  starts and stops the endpoint; while running, the card shows the
  `http://127.0.0.1:<port>/mcp` URL and the discovery-file path
  (`<userData>\gdevelop-mcp-endpoint.json`), and the file exists with
  `port`/`token`/`pid`; disabling removes it.
  *(Partial, session 5: card showed "Running — …/mcp" with the live
  discovery file `{port,token,pid,protocolVersion,startedAt}`; the
  explicit off-toggle + file-removal half not exercised.)*
- [x] `curl`-style rejections (or MCP Inspector misconfigured): wrong/absent
  Bearer token → 403; `GET /mcp` → 405; a >1 MB body → 413; `GET /health`
  with the token answers `{ok:true,pid,port,protocolVersion}`.
  *(Session 5: all verified by curl — 403 ×2, 405, 413, 404 unknown path,
  health payload exact.)*
- [ ] Start a second GDevelop instance with the server enabled → it refuses
  (the card shows the "another instance owns the endpoint" message); the
  first instance is unaffected.
- [ ] Kill GDevelop (no clean quit) with the server on → the stale
  discovery file is taken over by the next start.

**End-to-end with real clients (Appendix A has the exact commands):**
- [x] MCP Inspector (`npx @modelcontextprotocol/inspector node
  newIDE\app\scripts\gdevelop-mcp-stdio.js`): initialize → tools/list shows
  the ~50 tools (+ `get_project_overview`), tools/call
  `get_project_overview` returns the snapshot of the open project.
  *(Session 5, via the stdio adapter — the exact process Inspector
  spawns: initialize negotiated rev 2026-07-28; tools/list 65 tools with
  no project / 63 with one; `tools/call get_project_overview` returned
  the live "ForestDemo" snapshot. Required fixing the adapter discovery
  path first — see worklog session 6.)*
- [ ] Claude Code (or ZCode) connected per Appendix A: it can READ the open
  project (`read_scene_events`, `describe_instances`); with "Read &
  write" it makes a small edit that appears live in the editor; in
  "read-only" mode its write attempts are refused with the message naming
  the setting to unlock.
- [ ] The card's activity log lists every call (tool, outcome, whether the
  project was modified, duration); "Clear the activity log" empties it.
- [x] The "open the Ask AI panel once" rule: with the panel never opened in
  the project window, an external tool call gets the actionable no-host
  error; after opening the Ask AI tab, calls work. Verify the registration
  SURVIVES switching tabs (if a tab switch kills it, record it in the
  worklog — the pre-agreed fallback is lifting the registration to
  MainFrame level).
  *(Session 5: `-32001` with the actionable message before the panel was
  ever opened; after mounting it, tools/list worked and kept working
  across Home/Preferences navigation in the same window.)*
- [x] Restart GDevelop while a client session is open → the adapter
  reconnects on the next call (new port + token are re-read from the
  discovery file); no error beyond the one retried call.
  *(Session 5: after a full app restart the server came up on a new port
  with a new token and the adapter completed initialize + tools/list
  against it.)*

**Regression:** hosted AI and BYOK chat flows unaffected; the settings tab
renders correctly in the web build (toggle disabled with the desktop-only
explainer).

## Task 13 — Phase 11 desktop QA: authoring reach (external sheets/layouts, effects, sprites, resources)

*Filed by the Phase 11+12 implementation session (2026-09-24). Everything
below needs the desktop app; the unit suites cover the headless paths.*

- [ ] External events: `add_external_events` with `create_if_missing` +
      `associated_scene`, then open the sheet in the project manager — the
      events written by the agent are there; `read_external_events_source`
      round-trips; an external-events editor open DURING a write shows the
      changes after close/reopen (v1 limitation: no live redraw — recorded).
- [ ] External layouts: `put_external_layout_instances` creates
      `CoinField`, the layout editor shows the placed instances; a scene
      event "Create objects from external layout" spawns them in a preview.
- [ ] `list_effects` output vs the Effects editor list (same types); pick a
      listed type through `change_scene_properties_layers_effects_groups`
      and see the effect applied in the scene editor.
- [ ] Sprites: `change_sprite_frames` on a real sprite (set_frame_image,
      add_point, set_polygon_mask all_frames) — the sprite editor shows the
      changes after reopen; no WASM crash after long op lists.
- [ ] `import_project_resources`: a real URL download into the project
      folder; an absolute-path copy with dedupe; `replace_existing`
      retarget keeps object references working in a preview. Web build:
      the desktop-only failure message.
- [ ] Extension internals: parameters_to_add/move/remove on a function used
      by events (references follow); children add/remove with the usage
      guard; dependencies add/remove then check the export dialog's
      dependency list.

## Task 14 — Phase 12 desktop QA: discovery, runtime steering, palette, MCP prompts/resources

*Filed per `Phase12.md` Appendix A.*

- [ ] Catalog tools against the real network: `get_game_starter_summary`
      lists real templates; a chosen slug drives `initialize_project`
      end-to-end; `search_object_asset_store` for a known term returns
      ranked results; `search_resource_store` → `import_project_resources`
      → the sound plays in a preview.
      *(Partial, session 5: `get_game_starter_summary` returned the live
      286-entry catalog; projects initialized end-to-end;
      `create_or_replace_object` with search terms installed REAL store
      assets (Player + Tree with required resources). The
      resource-search→sound-import half not exercised.)*
- [ ] `create_or_replace_object` with `search_terms` ("add an enemy")
      installs a real asset in a BYOK chat (the old
      unavailable-dependency failure is gone); required extensions install.
- [ ] Command palette lists "Open Ask AI"; `Ctrl+Alt+A` opens the panel;
      reassignment through the shortcuts preferences works; verify no clash
      with the user's other shortcuts on the desktop build.
- [x] MCP Inspector: `prompts/list` + `prompts/get` expose the skill
      library; `resources/list` + `resources/read` serve the notes and the
      docs pages; capabilities advertise tools+prompts+resources; Claude
      Code reads a skill prompt + the notes resource without any tool
      call; Phase 10 behavior (gate, activity log, adapter) still green.
      *(Session 5, via the stdio adapter: 13 skill prompts
      (`build-workflow` fetched in full), 16 resources incl.
      `gdevelop://project/notes`, capabilities = tools+prompts+resources.
      Phase 10 gate/adapter green; the activity-log visual check still
      open.)*
- [ ] Runtime tools against a real preview: pause while playing (the game
      freezes), `read_runtime_details` shows the paused state,
      `profile_runtime` on a busy scene returns framesAverageMeasures;
      the Debugger editor open concurrently still works and vice versa;
      the profiler output path survives stop.
- [ ] `stop_preview` actually closes the preview window (the
      closeAllPreviews fix) — and note whether other preview windows close
      too (accepted v1 scope: the BYOK one-preview rule).
- [ ] Offline: catalog tools fail with the explicit offline message;
      runtime tools fail typed when no BYOK preview runs.

---

## Task 15 — Budget approval: live-redraw channel for external-item editors

*Filed 2026-09-24 by the Phase 11 verification session; full root cause in
`outofscoped.md` ("External-events/external-layout editors do not
live-redraw after BYOK writes").*

- [x] **APPROVED by the owner in chat on 2026-09-24 and IMPLEMENTED the
      same day** (verified, all gates green — see the 2026-09-24
      live-redraw worklog entry): the new fan-out channel is
      `onExternalLayoutModifiedOutsideEditor` /
      `onExternalEventsModifiedOutsideEditor` — payload types in
      `EditorFunctions/OutsideEditorChanges.js`, guarded fan-outs in
      `MainFrame/index.js`, threaded through `EditorTabsPane`/
      `PoppedOutEditorContainerWindow`/`BaseEditor` into the props bag and
      via `AskAiEditorContainer` → `useByokChatSeam` → `ByokOrchestrator`
      into the tool collaborators (also wired for the MCP host).
      `ExternalLayoutEditorContainer` refreshes its SceneEditor instances
      view; `ExternalEventsEditorContainer` clears the sheet selection and
      pushes a history entry so the new events render (and highlight via
      the AI-generated event id). `put_external_layout_instances` no
      longer tells the user to close and reopen the editor; a no-op put
      does not trigger a redraw. The `outofscoped.md` entry was removed.


---

## 2026-09-24 — Owner QA round 1: findings and dispositions

*The owner began the desktop QA (Tasks 1/2/6/7/9–14 context) and reported
three findings in chat; triaged and partly fixed the same day (see the
2026-09-24 fourth-session worklog entry).*

1. **Key in DevTools differs from the provided key — expected, closed.**
   Desktop keys are stored OS-encrypted (safeStorage/DPAPI) in
   localStorage; DevTools shows the ciphertext. Storage verified intact on
   the owner's profile.
2. **"AskAI routes through GDevelop completions" — disproven, closed as
   explained.** The BYOK gate covers every chat entry point; the durable
   BYOK transcript proves the client loop ran against the configured
   cometAPI endpoint. The observed `GET api-dev.gdevelop.io/generation/
   ai-request-summary` is the hosted chat-history list refresh, not a
   model call (see deferred.md item 3 for the optional polish). The
   "harness tools not working" complaints are the weak BYOK model failing
   tool calls (examples in the transcript).
3. **Benchmark failed 4/4 and burned ~1M tokens — real bug, FIXED.**
   Requests carried no `tools` (and no `max_tokens` cap). Fixed:
   task tool schemas now travel with every benchmark call and output is
   capped (`BYOK_BENCHMARK_MAX_OUTPUT_TOKENS = 4096`).

   Additional real bug fixed from the same QA chat's durable transcript:
   BYOK `start_preview` could never launch (invalid `PreviewOptions`
   shape — `options.getIsMenuBarHiddenInPreview is not a function`).
4. **Preview-close "Uncaught runtime errors: Object has been destroyed" —
   upstream race, FIXED** (destroyed-window guards in
   `ElectronMainMenu.js` focus/blur callbacks).

### Re-test steps for the owner (next desktop run)

*All four re-tested by the agent-driven QA session on 2026-09-24 (fifth
session; real CometAPI keys, desktop dev app) — details in the 2026-09-24
fifth-session worklog entry.*

- [x] **Benchmark re-test: PASSED (fix verified) — with a new finding.**
      mimo-v2.6-flash: 0/4 passed, 25,110 tokens, task 1 made **7 real
      tool calls** (was 0/0 before the fix); glm-5.3-flash: 0/4, 19,777
      tokens, 6 tool calls. Totals are in the expected
      thousands-to-tens-of-thousands range. The weak models still FAIL the
      tasks — that is the benchmark doing its job. **New bug found:** the
      benchmark's event-batch application crashes the libGD WASM heap
      ("memory access out of bounds") for any model, poisoning tasks 2–4
      and every later run until a page reload — filed in
      `outofscoped.md` (Open entries).
- [x] **`start_preview` re-test: PASSED.** In a BYOK chat the agent ran
      `start_preview` → the "Preview of Forest Game" window actually
      opened; `capture_preview_screenshot` returned a live 1022×802 frame
      (sidecar saved in the durable transcript);
      `inspect_runtime_state` once returned the typed "preview is not
      connected to the debugger" error (transient connection race — the
      model adapted and used the screenshot).
- [x] **Preview-close overlay re-test: PASSED after fixing a NEW crash
      found in this session.** The BYOK preview session registered
      debugger callbacks without `onServerStateChanged` /
      `onErrorReceived` / `onConnectionErrored`; the preview lifecycle
      fanned out into `undefined is not a function` and blanked the whole
      editor (uncaught React-tree crash). **FIXED** in
      `ByokPreviewSession.js` (all three no-op callbacks registered;
      spec regression test added) — after the fix, the agent's full
      preview cycle (start → capture → stop) ran with the editor staying
      alive and no overlay.
- [x] **Routing sanity: PASSED.** DevTools Network (filter "comet") shows
      BYOK turns POST to `api.cometapi.com/v1/chat/completions` only
      (plus `/v1/models` for the picker); no `api.gdevelop.io/generation`
      traffic during BYOK turns. The durable `byok-chats` transcripts
      carry the full request/response trail. (Incidental positive
      evidence: with provider 1 deliberately pointed at a dead endpoint,
      the chat silently failed over to provider 2 and still answered.)

### Task 8.2 — real-provider smoke: PASSED (2026-09-24, QA session 5)

Both registered CometAPI providers ("CometAPI" key 1, "CometAPI-Test"
key 2, endpoint `https://api.cometapi.com/v1`) show **"Connection
successful!"** from the settings tab (Task 8 item 2). The per-provider
"Test this provider" flow verified both keys independently.

### Model matrix findings (2026-09-24 QA session 5, shared $1.50 pool)

- **mimo-v2.6-flash** — tool calls work; too weak for multi-step builds
  (benchmark 0/4, partial scene creation only).
- **glm-5.3-flash** — good tool caller (full build pipeline: initialize
  project → scene → objects with real store assets → instances → global
  variable); BUT deterministically fails after very large tool outputs
  (the starter catalog) with HTTP 200 + unusable body, and never produces
  valid EventScript (3 attempts, all rejected by the local validator —
  which correctly guides with actionable errors). See `deferred.md`
  (2026-09-24 section).
- **gpt-6-luna** — unusable for agentic BYOK on this endpoint: CometAPI
  rejects `tools` + `reasoning_effort` in chat/completions for it, and
  forces a non-none default effort even when the client omits the
  parameter. Verified by curl. See `deferred.md` (2026-09-24 section).

### Agent-driven desktop QA (2026-09-24, fifth session) — coverage summary

*The owner asked for the outstanding user tasks to be driven with Computer
Use against the real CometAPI endpoint. What passed, what remains:*

- **Verified passing:** Task 8.2; round-1 re-tests (all four, above);
  Task 6 items — `create_scene`, `create_or_replace_object` (installs
  real store assets + required resources), `put_2d_instances`,
  `add_or_edit_variable` (global), `initialize_project` +
  project-from-scratch ("add an enemy"-class installs work — the old
  unavailable-dependency failure is gone), zero
  `api.gdevelop.io/generation` calls during BYOK turns; Task 12 —
  transport security (403 wrong/absent token, 405 GET, 413 oversize,
  404), `/health`, `-32001` no-host rule before the Ask AI panel is
  opened, host registration surviving the panel mount, `tools/list` 65
  tools with no project / 63 with a project, `get_project_overview`
  live snapshot, `prompts/list` (13 skill prompts) + `prompts/get`,
  `resources/list` (16, `gdevelop://project/notes` + docs) +
  `resources/read`, stdio adapter end-to-end (with a discovery-path fix,
  below), restart reconnection (new port + token re-read);
  Task 14 — `get_game_starter_summary` over the live catalog (286
  starters), store asset installs in a BYOK chat, MCP
  prompts/resources/capabilities; Task 11 9.1 — progress sentences
  visible during builds ("Reviewing a starter game template.",
  "Analyzing the object properties").
- **Fixed in this session (spec + Flow + format green):**
  `ByokPreviewSession.js` debugger-callback crash (above) and
  `ByokMcpStdioAdapterCore.js` discovery path used "GDevelop" instead of
  the real userData folder "GDevelop 5", so the zero-config discovery
  wiring (Claude Code / MCP Inspector) failed with `-32002` on every
  call — after the fix the stdio adapter completes initialize →
  tools/list → prompts/resources end-to-end.
- **Still open for the owner (or a next QA session):** Task 6 — events
  headline (SUPERSEDED by the Phase 13 harness/prompt rework, owner
  2026-09-25 — re-test after 13.6) and run_script batching with a
  refused approval; Task 13 (external events/layouts,
  `list_effects`, sprite internals, `import_project_resources`,
  extension internals); Task 7 (vision flagship + vision-off); Task 9
  (flagship build); Task 10 (sub-agents, extension authoring, context
  menus, homepage form keep-running); Task 11 9.2 stall notice (the
  hanging-endpoint test was masked by multi-provider failover — itself
  now evidenced) and the 40+-round compaction; Task 12 — the explicit
  second-instance refusal, stale-discovery takeover after a kill, and
  the activity-log visual check; Task 14 — command palette / Ctrl+Alt+A
  on the desktop build and the offline checks (not safely testable on
  this remote VM); Task 11 9.3–9.5 regression re-checks on the current
  tree.



---

## Task 16 — Phase 13 desktop QA: the consolidated chat panel, attachments, rebuilt settings, RAG + Qdrant

*Added 2026-09-25 (the Phase 13 implementation session). Everything below
needs the desktop app; the unit suites cover the logic, not the real
integrations.*

1. **Header toggle + bottom bar (13.1).** With BYOK configured and on: the
   chat header shows a green BYOK button; turning it off turns it red and
   hides the `provider/model · N tokens (M turns)` row; the Preferences →
   BYOK "Use BYOK as is" checkbox follows both toggles. The effort pill
   and the model dropdown sit at the bottom bar; picking a model/effort
   persists on the chat record (reopen the chat to verify).
2. **Recents rail (13.1).** BYOK chats (including ones from previous
   sessions — persisted) list above the hosted chats; a row's three-dots
   menu offers Archive/Unarchive + Delete with a confirmation; the old
   "Chat history" button is gone.
3. **Homepage carryover (13.2).** With BYOK on, submit the homepage form
   ("make me a platformer"); when `initialize_project` opens the project,
   the Ask AI tab re-opens with THAT chat selected and its transcript
   scrolling live — no forked/duplicated chat in the rail.
4. **"+" attach (13.3).** On a BYOK chat: attach a `.md` (inline fenced
   block in the sent message), a `.zip` (rejected with a friendly error),
   an image (rendered after your message; survives closing and reopening
   the chat via the sidecar). With image support = No, the image menu
   entry is hidden; on a hosted chat the whole "+" is gone.
5. **Rebuilt settings (13.4).** The tab reads top-to-bottom per the
   owner's layout; add a provider, open Advanced provider settings,
   customize a model (temperature / max tokens / context window), run the
   per-model benchmark against a real endpoint; set DEFAULT STRONG MODEL
   via the two dropdowns; old profiles migrate to the first provider.
6. **RAG (13.7).** Preferences → RAG: enable (consent dialog shows the
   ~25 MB download), build the index with a real network connection, then
   in a BYOK chat ask the model to `search_knowledge "collision variable"`
   — it should return the example + reference chunks. Before enabling,
   the same tool answers with exact-text search.
7. **Qdrant (13.8).** Click "Set up permanent indexing with Qdrant"
   (downloads the official binary into `%APPDATA%/GDevelop 5/qdrant/`);
   verify it turns healthy, that quitting and restarting the app restarts
   it, and that switching the index backend to Qdrant + rebuilding works.
   Also verify the clean fallback: with networking blocked, the setup
   fails with a message and the in-process index keeps working.
8. **EventScript harness (13.6, the glm-5.3-flash retest).** The prompt of
   the 13.5 model: ask a mid-tier model to "add a coin that increases the
   score when the player touches it" — the pinned examples + retryHints
   should get valid `add_scene_events` batches where the pre-13 harness
   failed; a deliberately invalid batch should come back with a
   `retryHint` containing a runnable example.

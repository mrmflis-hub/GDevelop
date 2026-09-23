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
   - [ ] The storage-status row under the API key says *"encrypted by your
     operating system (DPAPI on Windows)"* — not the obfuscation warning.
4. Save the key, then open DevTools (F12) → Application → Local Storage:
   - [ ] `gd-byok-key` holds `{"version":3,"value":"<base64 blob>"}`.
   - [ ] The base64 blob is NOT the Phase 2 format (it must differ from the
     value you would see on the web build) and does not contain the key.
5. Restart the app (fully quit, relaunch):
   - [ ] The chat / "Test connection" still works without re-entering the key
     (DPAPI decrypts across restarts under the same Windows user).
   - Note in the worklog which case you tested: same-user restart
     (expected to work) vs another Windows user (expected NOT to decrypt).
6. Networking check, with DevTools → Network open:
   - [ ] "Test connection" against an arbitrary https endpoint sends the
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
   - [ ] Tool-call rows appear in the chat; the scene and objects appear in
     the editor; a final text answer arrives; chat status is `ready`.
   - [ ] DevTools → Network: **zero** requests to `api.gdevelop.io/generation`
     during the whole exchange.
   - [ ] The "Chat context" bar moves (set a small context-window value to
     make it visible).
3. Follow-up: *"add a score variable"* → the model inspects
   (`describe_instances`/`read_scene_events`) then edits — history honored.
4. Auto-edit off (toggle in the chat):
   - [ ] A modifying call pauses with the existing "Apply this edit?" row.
   - [ ] ★ Refuse → the chat suspends cleanly (no perpetual "working"
     spinner, Stop button released) and sending a follow-up message works —
     this verifies the A1 fix.
   - [ ] ★ A multi-step request starts with `create_or_update_plan` and the
     plan renders — this verifies the A4 fix (the tool list no longer offers
     `add_scene_events`/`read_full_docs`/`search_docs`).
   - [ ] Approve → the edit proceeds.
   - [ ] ★ After an endpoint error (e.g. stop your local server mid-chat),
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

## Task 8 — Housekeeping decisions (small, optional)

*(Renumbered from "Task 6" on 2026-09-22 — the Phase 5 QA task below had
taken the number.)*

1. **API-key field clears the stored key** when you focus+blur it empty
   (pre-existing Phase 1 behavior, `saveByokKey('')` clears; see audit C11).
   Decide: fix (skip the save on blur of an untouched empty field) or accept —
   this is decision #9 above.
2. **Real-provider smoke**: run the settings-tab "Test connection" once
   against a real provider (the Phase 2 smoke used a local mock server —
   12/12, but a real provider was never hit).
3. **libGD mirror fallback**: `import-libGD.js` keeps falling back to the
   HEAD~2 S3 object (the HEAD~1 object 404s) — worth reporting upstream or
   pinning the working hash in the docs.

---

## Task 6 — Phase 5 desktop QA: the parity matrix (zero backend event writing)

**Why you:** needs the real Electron app + a real BYOK endpoint with the
Network tab open. **Recorded in:** worklog 2026-09-22 (Phases 5–6),
"Issues found"; `Phase5.md` §3.

1. One-time setup: as Task 1 (desktop app running, BYOK configured).
2. With DevTools → Network open (filter `api.gdevelop.io`), run one BYOK
   chat per tool family and check each succeeds:
   - [ ] objects: `create_or_replace_object` →
     `inspect_object_properties_effects` → `change_object_properties_effects`
     → delete via `delete_this_object`.
   - [ ] behaviors: `add_behavior` → `inspect_behavior_properties` →
     `change_behavior_property`.
   - [ ] instances 2D and 3D: `put_2d_instances`, `put_3d_instances` (a 3D
     layer), verified with `describe_instances`.
   - [ ] scenes: `create_scene` → `inspect_scene_properties_layers_effects`
     → `change_scene_properties_layers_effects_groups` → delete scene.
   - [ ] project: `inspect_project_properties_resources` →
     `change_project_properties_resources`.
   - [ ] variables: `add_or_edit_variable` → `inspect_variables`.
   - [ ] **events (the headline):** `read_events_source` → an anchored
     `add_scene_events` replace (echo `expected_event_source`) →
     `delete_event` by path — with **zero** requests to
     `api.gdevelop.io/generation` in the Network tab.
   - [ ] script batching: one `run_script` doing 5+ operations; then a
     refused approval (auto-edit off) — nothing in the script ran.
   - [ ] project-from-scratch: new chat with no project open →
     `initialize_project` → keep editing the new project in the same chat.
3. Stuck loop: point BYOK at a deliberately dumb model (or a scripted fake)
   that repeats one identical call:
   - [ ] the 3rd identical call gets the corrective message, the 4th stops
     the chat with "The AI got stuck".
4. Regression: BYOK off → the hosted Ask AI still works.

## Task 7 — Phase 6 desktop QA: perception with a real vision endpoint

**Why you:** screenshots and previews need the real app; the flagship demo
needs a vision-capable model. **Recorded in:** worklog 2026-09-22 (Phases
5–6), "Issues found"; `Phase6.md` §3.

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

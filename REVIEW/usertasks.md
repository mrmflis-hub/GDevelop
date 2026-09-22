# BYOK — User Tasks (things only a human can do)

Every task below was blocked during the automated phases because it needs a
desktop session, a real account/endpoint, or an explicit owner decision. Each
one is already recorded in `worklog.md` under "Issues found"; this file turns
them into step-by-step instructions. Work top to bottom — the first two are
the phase gates that are still open.

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

## Task 3 — Decide and commit the pending git state

**Why you:** the checkout became a git repository after the docs were
written; committing was never the agent's to do.
**Recorded in:** worklog 2026-09-19/20, "Issues found" (repository drift).

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

## Task 6 — Housekeeping decisions (small, optional)

1. **API-key field clears the stored key** when you focus+blur it empty
   (pre-existing Phase 1 behavior, `saveByokKey('')` clears; see audit C11).
   Decide: fix (skip the save on blur of an untouched empty field) or accept.
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

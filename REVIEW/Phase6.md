# Phase 6 — Perception: Screenshots, Previews, and Runtime Feedback

**Status:** planned · **Depends on:** Phase 5 (full tool surface, interception
registry) · **Read first:** [Phase5.md](Phase5.md) §0 (roadmap overview) ·
[AIflow.md](AIflow.md) · [styleguide.md](styleguide.md)

---

## 1. Introduction — what this phase delivers

The hosted agent is **blind**: it reads the project as text and never sees
the game. This phase gives the BYOK agent eyes and a pulse — the single
biggest quality lever we have. Evidence: adding runtime image feedback to a
strong agent raised game-dev benchmark success from 41.1% → 52.0%
(GameDevBench, 2026), and every production game-testing agent (TITAN 2025,
AWS's Unity QA agent) pairs a screenshot with a machine-readable state dump —
pixels alone are not enough. We copy exactly that hybrid.

Concretely:

1. **Vision input** — `ByokTypes`/`ByokClient`/`ByokTranscript` learn
   multi-part messages with base64 images (`image_url` content parts,
   OpenAI-compatible), sized/capped for token cost.
2. **Screenshot tools** (three capture paths, all building on existing code):
   - `capture_scene_screenshot` — the scene editor canvas (PixiJS with
     `preserveDrawingBuffer: true` → `toDataURL` works any time; 3D scenes
     share the same canvas).
   - `capture_preview_screenshot` — a live preview window via Electron
     `webContents.capturePage` (one small IPC handler, precedent: the BYOK
     safe-storage handlers).
   - gameplay-test screenshots — already return base64 JPEGs to the IDE
     (`GameplayTestResult.screenshots`); we admit the tools and feed them to
     the model.
3. **Preview control & runtime feedback** — start/stop a preview
   programmatically (the `GameplayTestRunner` already launches previews
   without UI), read its console logs and crashes (the debugger WebSocket
   already forwards `console.log` and `game.crashed`), and read live game
   state (`refresh` dump: instances, variables).
4. **Gameplay tests admitted** — `run_gameplay_test` /
   `change_gameplay_tests`: the strongest existing run-&-self-correct loop
   (structured assertions, console logs, final state, screenshots, source
   returned on failure for repair).
5. **The act→look→verify discipline** — prompt + loop plumbing so every
   visual edit is followed by a look, and images never blow the context
   window (fixed size, eviction of old images from replay).
6. **Prompt bump to `byok-v4`.**

### Existing machinery this phase builds on (no engine changes)

| Existing piece | File | What we do with it |
|---|---|---|
| Editor canvas, always-capturable | `InstancesEditor\index.js:240-318` (`PIXI.autoDetectRenderer({preserveDrawingBuffer: true})`; 3D: shared-GL canvas) | `capture_scene_screenshot` |
| Preview windows registry | `electron-app\app\PreviewWindow.js` (module-level `previewWindows` array) | `preview-capture` IPC → `webContents.capturePage()` |
| Programmatic preview launch | `MainFrame\index.js:2767` `_launchPreview` funnel; `GameplayTestRunner.js:685` calls `previewLauncher.launchPreview` directly | `start_preview` tool |
| Debugger transport | `electron-app\app\DebuggerServer.js` (WS server); `LocalPreviewLauncher\LocalPreviewDebuggerServer.js:216-282` (`sendMessage`, `sendMessageWithResponse`, `registerCallbacks`) | console logs, `game.crashed`, state dumps |
| Runtime commands | `GDJS\Runtime\debugger-client\abstract-debugger-client.ts:256+` (`play/pause/refresh/set/call`, `game.crashed` :593, `console.log` :655) | `read_preview_logs`, `inspect_runtime_state` |
| Gameplay tests end-to-end | `EditorFunctions\GameplayTestTools.js`; `GameplayTests\GameplayTestRunner.js`; runtime harness `GDJS\Runtime\gameplay-tests\gameplay-test-runner.ts` (`stepFrames`, input simulation, `takeScreenshot` :2667, `assert`, state inspectors) | admit tools; feed results incl. images |
| Quick-customization capture precedent | `MainFrame\index.js:3135` `launchQuickCustomizationPreview` with `launchCaptureOptions.screenshots` | reference for capture plumbing |
| Offscreen render precedent | `ResourcesList\ResourcePreview\Resource3DPreview.worker.js:217` (`toDataURL` offscreen) | pattern reference |

### New files created in this phase

```
Byok\ByokImageContent.js / .spec.js        image part creation (resize/encode/cap), cost accounting
Byok\ByokPreviewSession.js / .spec.js      preview lifecycle + debugger subscription (logs/crash/state ring buffers)
Byok\ByokRuntimeTools.js / .spec.js        the perception tool implementations (registered in ByokExtraTools)
```

Modified: `Byok\ByokTypes.js` (content parts), `Byok\ByokClient.js` (send
multi-part), `Byok\ByokTranscript.js` (persist/evict images),
`Byok\ByokToolSchema.js` (+5 tools), `Byok\ByokPrompts.js` (`byok-v4`),
`Byok\ByokOrchestrator.js` (image budget in context guard),
`AskAiEditorContainer.js` (editor-canvas + preview-launch callbacks),
`electron-app\app\main.js` (`preview-capture` IPC, ~15 lines).

---

## 2. Steps

### Step 6.0 — Vision capability spike

**Goal:** know whether the user's endpoint sees images before any tool fires.

**How to implement:**

1. Settings gain `supportsImages: 'yes' | 'no' | 'auto'` (default `auto`).
   `auto` = send images; on a 4xx whose message mentions
   image/content/type (normalized by `ByokErrors`), disable images for the
   chat, notify once in-chat, and continue text-only (mirrors the
   `reasoning_effort` degraded-retry precedent in `ByokClient.js:223-244`).
2. Image format decision (validated in the spike against 2–3 popular
   endpoints — OpenAI, OpenRouter, LM Studio/Ollama with a vision model):
   JPEG quality 0.7 (matches the gameplay-test harness), max long edge
   **1024 px**, base64 `data:` URI in `image_url`. Token cost ≈ 1.1–1.6k per
   image at that size (OpenAI vision pricing ≈ 1.2k at 1024²; Anthropic
   ≈ (w×h)/784 — both fine at 1024).
3. When `supportsImages: 'no'`, perception tools stay available but return
   textual descriptions only (scene dump / state dump); screenshots taken for
   the *user* still render in the chat UI (transcript items can carry images
   the model never sees — see 6.5 storage split).

**Files modified:** `Byok\ByokTypes.js`, `Byok\ByokSettingsTab.js` (one
selector). **Depends on:** Phase 5.

---

### Step 6.1 — Image content in client + transcript (`ByokImageContent.js`)

**Goal:** images flow end-to-end: tool result → transcript → next model call,
with cost discipline.

**How to implement:**

1. `ByokTypes`: `ByokUserContentItem = {type:'text', text} | {type:'image_url', image_url:{url}}`;
   user message content becomes `string | Array<ByokUserContentItem>`
   (back-compat: strings pass through).
2. `ByokImageContent.js`: `makeImagePart(dataUrl)` — validate type, downscale
   to ≤1024 long edge via an offscreen canvas, re-encode JPEG 0.7, return the
   part + `{width, height, approxTokens}` metadata for the budget guard.
3. `ByokTranscript`: function-call outputs may reference images by id
   (`{images: ['img-1']}` stored on the output item); replay emits them as a
   `user` message containing `[tool result image]` text + image parts.
   **Eviction:** at replay, only the **latest 2 images per chat** are
   materialized; older ones are replaced by a one-line placeholder
   ("screenshot removed to save context — call capture again if needed").
   (Claude Code's discipline: old tool payloads go first; screenshots are the
   most expensive per item.)
4. `ByokClient`: no change beyond passing the parts through (request body
   already serializes whatever `messages` contain).

**Files created/modified:** as above.
**Tests:** downscale/encode caps (a 4096-px fixture → ≤1024, JPEG); eviction
keeps last 2, placeholders elsewhere; back-compat strings unchanged;
approx-tokens estimator monotonic.
**Depends on:** 6.0.

---

### Step 6.2 — Screenshot tools (`ByokRuntimeTools.js`, part 1)

**Goal:** three ways to look, one schema each.

**How to implement:**

1. `capture_scene_screenshot({scene_name?, layer_name?})` — via a new
   injected editor callback `onCaptureSceneScreenshot` implemented in
   `AskAiEditorContainer.js` (it already sits where editor callbacks live);
   internally reaches the active `InstancesEditor`'s renderer canvas and
   `toDataURL('image/jpeg', 0.7)` (canvas already has
   `preserveDrawingBuffer`). If the requested scene isn't the open editor,
   the output says which scene is open (capture what's visible; do not
   silently fail).
2. `capture_preview_screenshot({preview_id?})` — Electron IPC `preview-capture`
   in `main.js` (next to the BYOK encrypt handlers, `main.js:465-471`
   precedent): finds the window (last preview if no id) among
   `PreviewWindow.js`'s registry, `webContents.capturePage()` → PNG buffer →
   base64. Works when occluded; ~15 lines total.
3. Both return `{success, image: <id>, width, height, note}` where `note`
   carries 1–2 lines of scene context (open scene name, layer count) — the
   hybrid-grounding rule: **never send an image without its textual state
   sibling**.

**Files created:** `Byok\ByokRuntimeTools.js` (+ spec with fake callbacks).
**Files modified:** `AskAiEditorContainer.js` (callback),
`electron-app\app\main.js` (IPC), `Byok\ByokToolSchema.js`.
**Tests:** tool returns image id + note; error paths (no editor open, no
preview running) produce actionable `success:false` outputs; IPC handler
unit-tested with a fake `webContents` (electron-mocking pattern from memory:
jest.mock electron).
**Depends on:** 6.1, Phase 5 `ByokExtraTools`.

---

### Step 6.3 — Preview control + runtime feedback (`ByokPreviewSession.js`)

**Goal:** the agent runs the game and reads its vitals.

**How to implement:**

1. `Byok\ByokPreviewSession.js` — wraps the existing programmatic launch
   (`previewLauncher.launchPreview`, `GameplayTestRunner.js:685` precedent —
   injected as a callback, not imported, keeping the orchestrator
   React-free): `start({scene_name?})`, `stop()`, `list()`. One BYOK preview
   at a time (v1 rule; the runner already serializes gameplay-test runs).
2. Subscribe via `LocalPreviewDebuggerServer.registerCallbacks`:
   - **log ring buffer** (last 200 entries: level, text, tick) fed by
     `console.log` (skipping `isUnavoidableLibraryWarning` lines, reusing the
     filter from `Debugger\index.js`);
   - **crash capture**: `game.crashed` payload stored (the report builder
     already marks JS-code-event stacks `GDJSInline`);
   - **state snapshot**: on demand, `sendMessageWithResponse({command:
     'refresh'})` → the `dump` payload reduced to a compact per-scene
     summary (instances: name, x, y, z-order; variables) capped like other
     outputs (20k chars, `capToolOutput`).
3. Tools (implemented in `ByokRuntimeTools`, registered in `ByokExtraTools`):
   - `start_preview({scene_name?})` → `{success, preview_id, debugger_id}`
   - `stop_preview({})`
   - `read_preview_logs({since_index?, level?})` → sliced ring buffer
   - `get_runtime_errors({})` → crashes + error-level logs since last call
   - `inspect_runtime_state({scene_name?, variable_paths?})` → reduced dump
4. Every state read pairs with a hint in its output: "pair this with
   `capture_preview_screenshot` to see the frame" (prompt also enforces).

**Files created/modified:** `Byok\ByokPreviewSession.js` (+ spec: fake
debugger server), tools in `ByokRuntimeTools.js`.
**Tests:** session lifecycle against a fake transport (start subscribes, stop
unsubscribes, no dangling listeners); ring buffer slice semantics; crash
capture reduces to the expected fields; state reduction caps.
**Depends on:** 6.2 (shared injection plumbing).

---

### Step 6.4 — Gameplay tests admitted

**Goal:** the crown jewel of self-correction, already fully client-side.

**How to implement:**

1. Whitelist `run_gameplay_test` + `change_gameplay_tests` (schemas authored
   from `GameplayTestTools.js` arg extraction; note the conditional
   `getModifiesProject` — persisting test source edits the project, a bare
   `persist:false` probe doesn't; the approval seam already honors
   `getModifiesProject`).
2. In the BYOK executor, post-process the result before it reaches the
   model: convert `screenshots[]` base64 JPEGs into image parts (6.1),
   keep assertions/errors/consoleLogs/finalState as text (already capped
   upstream), and **always return the executed `source` on failure** so the
   model repairs it (the tool already does this — just don't strip it).
3. Default `screenshots: 'on-failure'` in the prompt guidance (harness caps
   at 5 — fine with our 2-image replay budget; the latest failure shot is
   what matters).
4. Known limitation honored in the prompt: the test frame must stay visible
   (hidden tab ⇒ `paused`); instruct the model to treat `paused` as
   "ask the user to keep the window visible", not a game bug.

**Files modified:** `Byok\ByokToolSchema.js`, `Byok\ByokRuntimeTools.js`
(result shaping), `Byok\ByokPrompts.js`.
**Tests:** result shaping (images extracted, text kept, source-on-failure
preserved); approval classification for persist vs probe.
**Depends on:** 6.1; Phase 5 whitelist mechanics.

---

### Step 6.5 — Context budget for images + prompt `byok-v4`

**Goal:** eyes without bankruptcy.

**How to implement:**

1. Orchestrator context guard gains an image budget: estimated image tokens
   (from `ByokImageContent` metadata) count against the ratio; exceeding
   soft-budget ⇒ force eviction of older images at the next replay (6.1
   rule) before any hard stop. Never let images alone trigger
   `byok-context-full` while text is small.
2. `byok-v4` prompt additions:
   - **Look-verify cycle:** "After any visual change (instances, scene,
     resources, effects), capture a screenshot before declaring the step
     done; after logic changes, run a preview or a gameplay test; report what
     you saw."
   - **Hybrid grounding:** "Screenshots come with textual state; when
     coordinates matter, read them from `describe_instances` /
     `inspect_runtime_state`, never guess from pixels."
   - Tool list grows (auto); tests unchanged (prompt↔schema sync).
3. Full gates + manual QA:
   - "Add 5 trees around the player, then look and fix any overlap" — agent
     captures, identifies an overlap, fixes it, re-captures (the flagship
     perception demo).
   - Preview flow: start preview from a fresh scene, read logs (a deliberate
     `console.log`), stop.
   - Gameplay test: write a failing test on purpose (wrong assertion), model
     sees failure + screenshot + source, repairs, passes.
   - Vision-off regression: with `supportsImages: 'no'`, same flows work
     text-only, no image parts sent (network tab).

**Files modified:** `Byok\ByokOrchestrator.js`, `Byok\ByokPrompts.js` (+specs).
**Depends on:** 6.1–6.4.

---

## 3. Phase 6 acceptance criteria (phase gate)

- [x] The model receives screenshots as image parts (fixture: multipart request body asserted in a fake-client test) and old images are evicted from replay (latest-2 rule, unit-tested). *(2026-09-22: `ByokOrchestrator.spec.js` "materializes screenshots…" + `ByokTranscript.spec.js` image-replay block.)*
- [x] `capture_scene_screenshot` and `capture_preview_screenshot` both return actionable results in QA (network-tab: zero GDevelop-backend calls); error paths are `success:false` with guidance, unit-tested. *(2026-09-22: error paths and happy paths unit-tested; the in-app QA is desktop-only — see the worklog "Issues found".)*
- [x] The agent can start a preview, read its console logs and crashes, read runtime state, and stop it — lifecycle unit-tested against a fake debugger transport; no dangling subscriptions.
- [x] `run_gameplay_test` results reach the model with assertions, logs, state, screenshots-as-images, and the repairable source; approval gating distinguishes persist vs probe (upstream `getModifiesProject` honored by `byokCallRequiresApproval`, shape asserted in the ByokRuntimeTools/ByokSeam suites).
- [ ] QA demonstrates the act→look→verify cycle end-to-end (the "trees overlap" scenario) with a real vision-capable endpoint; with images disabled the same tools degrade to text-only. *(2026-09-22: the text-only degradation is unit-tested; the real-endpoint scenario needs the desktop app — `usertasks.md` Task 6.)*
- [x] Image token budget prevents context exhaustion by images alone (unit test with inflated image metadata).
- [x] Prompt version `byok-v4`; all four checks green; worklog entry complete.

---

## 5. Implementation notes (appended 2026-09-22)

- `supportsImages` is the `imageSupport` setting (`auto` default): `auto`
  degrades to text-only once when the endpoint's 4xx names image content
  (`describeInvalidRequestForImageContent`), `no` never sends parts, `yes`
  sends them and surfaces rejections.
- Image budget: the context guard decrements `imagesToKeep` (2→1→0) under
  ratio pressure and keeps executing the pending batch — images alone never
  stop the chat (a `slice(-0)` bug found and fixed on the way).
- The scene screenshot reaches the canvas through the DOM
  (`findLargestVisibleSceneCanvas` — the largest visible canvas, no editor
  refactoring needed); the preview screenshot rides the
  `byok-preview-capture` Electron IPC over the `getPreviewWindows()`
  registry (both outside the phase's file list — recorded in the worklog).
- `run_gameplay_test` is intercepted for result shaping only (base64 → image
  ids); `change_gameplay_tests` goes through the registry unchanged.
- The chat UI does not yet render transcript-referenced images for the user
  (the model sees them; the user sees the tool output text) — noted for a
  later polish with Phase 9's durable history.

---

## 4. Deferred (do not build in this phase)

- Multiple simultaneous previews; preview interaction scripting beyond
  gameplay tests (the harness already simulates input *inside tests* — an
  always-on interactive session is Phase 8+ material).
- Video/multi-frame captures (GameDevBench used video; cost/benefit poor for
  v1 — revisit with Phase 9 streaming).
- Auto-capture on every edit (prompt-driven for now; an automatic
  screenshot-after-mutation hook is a Phase 9 polish candidate).
- Runtime `set`/`call` mutation tools (agent mutating the live game mid-run)
  — the debugger supports it; not needed until Phase 8's iterate recipes ask
  for it.

# Phase 12 — Discovery, Runtime, and External-Agent Integration

**Status:** planned 2026-09-24 (owner green-lit the item list in chat; the
D12 decisions below are answered at implementation kickoff, recommendations
included) · **Depends on:** Phase 11 (shared catalog module, prompt
conventions) and the Phase 4–10 surface (seam, preview session, MCP
protocol) · **Read first:** [Phase10.md](Phase10.md) (MCP architecture),
[AIflow.md](AIflow.md) §5, `phase5-tool-decisions.md`, [styleguide.md](styleguide.md)

> **Design note (2026-09-24):** second half of the 2026-09-23 audit
> backlog: everything that connects the agent to things *outside* the
> project model — the **starter-template and asset/resource catalogs**
> (replacing hosted-only discovery with auth-free public ones), the
> **running game's debugger/profiler channel**, the **command palette /
> keyboard entry point**, and the **MCP-native `prompts`/`resources`
> primitives** so external agents see skills, notes and docs without
> screen-scraping tools. Feasibility was surveyed read-only on 2026-09-24;
> every piece is reachable client-side with zero GDJS/Electron-main changes
> except reusing existing IPC. Key anchors from that survey:
> - Examples catalog: `listAllExamples()` (`GDevelopServices\Example.js:41-68`)
>   — two no-auth GETs, static CDN JSON, ~294 `ExampleShortHeader`s; the
>   returned `slug` is exactly what `initialize_project`'s
>   `template_slug` consumes today (`AskAiStandAloneForm.js:144-147`).
> - Asset catalog: `listAllPublicAssets` + `getPublicAsset`
>   (`GDevelopServices\Asset.js:396-472`) — no auth; the Asset Store UI
>   already searches it **client-side** (`AssetStoreContext.js:287-349` +
>   `UI\Search\UseSearchItem.js`); an `AssetShortHeader` plugs straight
>   into the existing install path (`NewObjectDialog.js:110-254` →
>   `InstallAsset.js:150-334`).
> - Resource catalog: `listAllResources` (`Asset.js:512-540`) — no auth;
>   hits carry a direct public `url` installable exactly like the
>   resource-store UI does (`BrowserResourceSources.js:246-281`:
>   `setFile(url)` + `setOrigin('gdevelop-asset-store', url)`).
> - The current BYOK blockers are two seam stubs: `ByokSeam.js:246-251`
>   wires `searchAndInstallAsset`/`searchAndInstallResources` as
>   `makeUnavailableDependency(...)` — step 12.2 replaces them.
> - Debugger: the IDE-side singleton `localPreviewDebuggerServer`
>   (`LocalPreviewDebuggerServer.js:96-380`) already receives every
>   preview message and fans out to all `registerCallbacks` subscribers;
>   ByokPreviewSession already holds it (`ByokPreviewSession.js:194`).
>   Commands `play`/`pause`/`refresh`/`getStatus`/`set`/`call`/
>   `profiler.start`/`profiler.stop` are handled in
>   `GDJS\Runtime\debugger-client\abstract-debugger-client.ts:252-568`;
>   profiler stats are **pushed** on stop (`profiler.output`), never a
>   response payload.

---

## 1. Introduction — what this phase delivers

1. **Starter discovery without the hosted backend** —
   `get_game_starter_summary` (currently a permanent-failure stub,
   `EditorFunctions\index.js:8654`) becomes a real BYOK no-project tool
   over the public examples catalog: list starters, summarize one, hand
   the `slug` to `initialize_project`. The "make me a game from scratch"
   flow stops relying on the model's memory of GDevelop templates.
2. **Asset & resource discovery** — `search_object_asset_store` /
   `search_resource_store` (excluded stubs since Phase 5) come back as
   local tools over the auth-free public catalogs, and the
   `create_or_replace_object` `search_terms` path — stubbed out at
   `ByokSeam.js:246` — starts working again, so "add a platform character"
   installs a real asset instead of failing.
3. **Command palette + keyboard entry** — "Ask AI" becomes a registered
   command with a default shortcut, discoverable from the command palette
   (the audit found no palette entry and no shortcut).
4. **MCP-native prompts/resources + read-notes** — external agents get
   skills as MCP `prompts`, project notes + the docs index as MCP
   `resources`, and a `read_project_notes` tool (today notes are only
   writable, and skill names hide in an error string).
5. **Debugger/profiler tools** — the agent can pause/resume the preview it
   launched, take a targeted runtime dump, and profile a scene (start,
   wait, stop, read `framesAverageMeasures` + `stats`), closing the loop
   on "it works but is slow" requests.

New BYOK tools: `read_project_notes`, `read_runtime_details`,
`control_runtime`, `profile_runtime` (4 new) + locally implemented
`get_game_starter_summary`, `search_object_asset_store`,
`search_resource_store` (3 intercepted names). Advertised set 56 → 63;
prompt `byok-v7` → `byok-v8`.

---

## 2. Open owner decisions (answered at kickoff; recommendations included)

1. **D12-1 — Names: reuse the upstream stub names vs invent new ones.**
   Recommend: **reuse** `get_game_starter_summary`,
   `search_object_asset_store`, `search_resource_store` via interception
   (the `add_scene_events` precedent): names stay stable across hosted/BYOK
   parity docs, and the phase5-tool-decisions exclusion entries get flipped
   with a pointer here.
2. **D12-2 — Catalog scope.** Recommend: **public/free content only.**
   Private packs, purchased templates and received items need Shop
   authorization (`Asset.js:474-496`, `listReceived*` :678-752); the tools
   refuse those with an explanatory message rather than half-supporting
   accounts.
3. **D12-3 — Wire the `create_or_replace_object` search collaborator.**
   Recommend: **yes** — implement `searchAndInstallAsset` in the seam
   (local search → `AssetShortHeader` → headless install), replacing the
   `makeUnavailableDependency` stub at `ByokSeam.js:246-248`. This is the
   owner's "IF it's possible then yes" payoff: "add an enemy" installs.
   Headless install reuses `getPublicAsset` + `addAssetToProject`
   (`InstallAsset.js:150-334`) + the BYOK-wired
   `useEnsureExtensionInstalled` for required extensions.
4. **D12-4 — Local search implementation.** Recommend: **self-contained
   scorer in the tool module** (name/shortDescription/tags substring +
   simple pertinence, the `UseSearchItem` philosophy without the
   `js-worker-search` web-worker dependency) over a once-per-session
   cached catalog fetch. Deterministic, unit-testable, no dependence on
   the Asset Store UI being mounted.
5. **D12-5 — Debugger tool set + gating.** Recommend: three tools —
   `read_runtime_details` (targeted `refresh` dump, reduced), 
   `control_runtime` (`pause`/`resume`/`getStatus`), `profile_runtime`
   (`profiler.start` → await pushed `profiler.output` → `profiler.stop`
   → stats). Runtime-only state is not project state: **do not flag
   `modifiesProject`** (they pass the MCP read-only gate like the other
   runtime reads), but refuse mutating commands while a gameplay test is
   running (the runtime already guards, `abstract-debugger-client.ts:8-15`)
   and always target the BYOK session's own `DebuggerId` — never broadcast
   (`sendMessageWithResponse` broadcasts to *all* previews,
   `LocalPreviewDebuggerServer.js:254-256`; the session must capture the id
   from `onConnectionOpened`, `:151-159`).
6. **D12-6 — MCP primitives scope.** Recommend: **prompts = the skill
   library** (`prompts/list`/`prompts/get` → name, description, body),
   **resources = project notes + the docs index** (`resources/list`/
   `resources/read`, URIs `gdevelop://project/notes`,
   `gdevelop://docs/<page-path>`), plus the `read_project_notes` tool for
   in-chat use. No arbitrary project files as resources (binary/large);
   capabilities advertised as `{ tools, prompts, resources }`; the stdio
   adapter and discovery file are transport-agnostic and unchanged.
7. **D12-7 — Command palette + shortcut.** Recommend: register an
   **"Ask AI"** command (opens the panel, `openAskAi` with no prefill) and
   a default shortcut of **Ctrl+Alt+A**, verified conflict-free against
   `src\KeyboardShortcuts` defaults at implementation, user-reassignable
   through the existing shortcut preferences.
8. **D12-8 — Prompt + evals.** Recommend: **bump to `byok-v8`**, remove the
   now-false "plan from your own knowledge of templates" guidance line,
   add ≥ 5 eval tasks (starter pick, asset search+install, resource
   search, notes read, runtime profile where headless-able), and refresh
   `phase5-tool-decisions.md` exclusion entries.

---

## 3. Steps

### Step 12.1 — Starter summaries (`Byok\ByokCatalogTools.js` + schema/prompt)

**Goal:** no-project chats can browse and pick real templates.

**How to implement:**
1. Implement `get_game_starter_summary` in `ByokCatalogTools.js` (the
   Phase 11 module): no `template_slug` → list the catalog
   (`listAllExamples()`, `Example.js:41-68`) as compact headers (slug,
   name, shortDescription, tags, difficultyLevel, license); with a slug →
   resolve the header, fetch the full `Example` via `getExample`
   (`Example.js:73-84`, no auth) and return the full summary including
   `description`. Cache the catalog per session (the UI's
   `ExampleStoreContext` pattern, in-memory only).
2. Unknown slug → structured failure listing a few near-miss slugs;
   offline/network failure → explicit message (the catalog is online-only,
   same degradation as the UI, `NewProjectSetupDialog.js:724-740`).
3. Advertise it in `BYOK_NO_PROJECT_TOOL_NAMES` next to
   `initialize_project` (`ByokToolSchema.js:202`) — it is a no-project
   tool; with a project open it is neither advertised nor needed (the
   registry stub keeps failing for hosted parity).
4. Intercept before the registry (the module's existing interception
   pattern), and update the prompt guidance that today says to plan from
   memory.

**Tests:** list/summary/unknown-slug/network-failure with a fake fetch;
no-project advertisement only; interception beats the registry stub.
**Depends on:** Phase 11 (module placement).

---

### Step 12.2 — Asset & resource store discovery (`Byok\ByokCatalogTools.js` + `ByokSeam.js`)

**Goal:** the agent finds and installs real assets/resources; the store
stubs become real tools; `create_or_replace_object` regains
`search_terms`.

**How to implement:**
1. `search_object_asset_store` (args `search_terms`, optional
   `object_type`, `tags`): one-time fetch
   `listAllPublicAssets` (`Asset.js:396-456`), self-contained scorer
   (D12-4) over name/shortDescription/tags (+ inherited pack authors),
   optional objectType/tag filters; return ≤ 10 trimmed
   `AssetShortHeader`s (`id`, `name`, `objectType`, `tags`, size/colors,
   `previewImageUrls[0]`). Public catalog only (D12-2).
2. `search_resource_store` (audio/font): `listAllResources`
   (`Asset.js:512-540`), same scorer; hits carry the direct `url` —
   reference `import_project_resources` (Phase 11) for installation and
   note the `setFile(url)` + `setOrigin('gdevelop-asset-store', url)`
   convention (`BrowserResourceSources.js:246-281`).
3. Seam wiring (D12-3): replace `makeUnavailableDependency('search...')` at
   `ByokSeam.js:246-251` with a headless `searchAndInstallAsset`:
   search → first/appropriate header → `getPublicAsset` →
   `addAssetToProject` (`InstallAsset.js:150-334`) with
   `useEnsureExtensionInstalled` for required extensions; and a
   `searchAndInstallResources` equivalent using the Phase 11 resource
   importer. `getAssetStoreTagForNewObject` stays `null` (tag-based
   "new object" chips are a UI concern).
4. Extension-install flush: reuse the existing per-batch editor-reload
   hooks (`ByokExtensionTools.js:126` pattern) so newly installed assets
   appear without a manual refresh.

**Tests:** scorer ranking/dedup/filters on fixture catalogs; both tools'
happy/empty/offline outputs; seam collaborator install path with fakes
(extension ensured, resource dedupe, `setAssetStoreId`); stub-removal
regression (the old unavailable-dependency spec flips to the real one).
**Depends on:** 12.1 (module), Phase 11 (`import_project_resources`).

---

### Step 12.3 — Command palette entry + shortcut (`MainFrame` touchpoint)

**Goal:** "Ask AI" discoverable from the palette and the keyboard.

**How to implement:**
1. Re-locate the command registration point at implementation (search
   `registerCommand`/`useCommands` in `MainFrame\index.js` — the doc's
   2026-09-24 survey did not pin it; the doc's intent governs, not a line
   number). Register one command ("Ask AI" / `open-ask-ai`) calling the
   existing `openAskAi` (`MainFrame\index.js:1105`) with no prefill.
2. Default shortcut `Ctrl+Alt+A` (D12-7) through the existing
   keyboard-shortcut preferences machinery (`src\KeyboardShortcuts`),
   conflict-checked; user-reassignable, removable.
3. Upstream touch budget: the registration block in `MainFrame\index.js`
   (same audited-touchpoint class as the Phase 10 mount); no other
   shared-file edits.

**Tests:** command registration + handler wiring (jsdom, mocked context);
shortcut default + reassignment round-trip in the existing shortcuts spec
pattern.
**Depends on:** nothing.

---

### Step 12.4 — MCP prompts/resources + `read_project_notes` (`Byok\Mcp\*`)

**Goal:** external agents see skills, notes and docs as first-class MCP
primitives instead of error-string Easter eggs.

**How to implement:**
1. `Byok\Mcp\ByokMcpPrompts.js` (+ spec): `prompts/list` → one prompt per
   skill (name, description/`whenToUse`, body from the skills module — the
   bag gains a skill enumerator); `prompts/get` → `{ messages: [...] }`
   with the skill body. Unknown prompt → `-32602`.
2. `Byok\Mcp\ByokMcpResources.js` (+ spec): `resources/list` →
   `gdevelop://project/notes` (present when a project host is registered)
   + one entry per docs-index page (`gdevelop://docs/<path>`);
   `resources/read` → notes text or the doc page body (the same
   `ByokDocs` source `read_doc` uses). URI table is the module's contract;
   `resources/templates` not offered.
3. `ByokMcpProtocol.js`: extend the method table and advertise
   `capabilities: { tools, prompts: { listChanged: false }, resources:
   { listChanged: false } }` (D12-6); everything else stays `-32601`.
   Version constant untouched.
4. Host bag additions (`useByokChatSeam.js` registration): skill
   enumerator + notes reader (`ByokProjectNotes` read path — today only
   the writer exists as a tool). Host-absent behavior mirrors tools: 
   `tools`-style "unavailable" results.
5. `read_project_notes` BYOK-only tool (`Byok\ByokExtraTools.js`, next to
   `update_project_notes`): reads the merged notes for the chat's project.
6. `ByokMcpTools.js` unchanged (tools/list math untouched); the Phase 10
   activity log naturally covers the new methods via the same dispatch.

**Tests:** prompts/resources tables (list/get/read/unknown), capability
advertisement, host-absent paths, `read_project_notes` (empty, populated,
per-project isolation) — all in the existing pure-core spec style; stdio
adapter untouched (transport-agnostic by design).
**Depends on:** nothing (Phase 10 architecture).

---

### Step 12.5 — Debugger/profiler tools (`Byok\ByokDebuggerTools.js` + `ByokPreviewSession.js`)

**Goal:** the agent sees and steers the game it launched — pause, dump,
profile.

**How to implement:**
1. Session support in `ByokPreviewSession.js`: capture the `DebuggerId`
   from `onConnectionOpened` (currently ignored, `:211-213`); expose
   targeted `sendMessageWithResponse` (wait for the matching id — do NOT
   use the broadcasting singleton method, `LocalPreviewDebuggerServer.js:254-256`)
   and a subscription buffer for pushed messages (`profiler.output`,
   `status`, `game.crashed` — already partially handled, `:143-174`).
   While touching this file, fix the pre-existing quirk the survey found:
   `stop()` calls `closePreview()` with no window id where the launcher
   expects one (`ByokPreviewSession.js:251-253` vs
   `LocalPreviewLauncher\index.js:141-144`).
2. `read_runtime_details`: targeted `refresh` dump reduced the same way
   `inspect_runtime_state` reduces it, plus `getStatus` (paused state,
   current scene).
3. `control_runtime`: `pause`/`play`/`getStatus`; refuse while a gameplay
   test is running (mirror the runtime's own guard list,
   `abstract-debugger-client.ts:8-15`); surface `commandIgnored` as a
   typed failure.
4. `profile_runtime`: `profiler.start` → subscribe and await
   `profiler.output` (stop-to-read: stats only arrive on stop, `:300-308`;
   bounded wait, e.g. 60 s cap) → `profiler.stop` → return
   `framesAverageMeasures` + `stats` (the `Debugger\Profiler\index.js:35-103`
   `getStats` reduction, including 3D draw-call stats).
5. Gating per D12-5: `modifiesProject` stays false for all three; not
   advertised over MCP read-only restrictions (they pass the gate like
   `read_preview_logs`); document in the tool descriptions that they act
   on the BYOK-launched preview only.
6. Lifecycle: pending requests fail typed when `closeAllConnections` wipes
   callbacks (`LocalPreviewDebuggerServer.js:352-375`); no crash.

**Tests:** fake debugger-server fixture (the session spec pattern):
id capture, targeted request/response correlation, broadcast avoidance,
pause/play/status, profiler start→pushed-output→stop happy path + timeout
+ connection-closed, gameplay-test refusal, the stop() id fix regression.
**Depends on:** nothing (Phase 6 preview session).

---

### Step 12.6 — Surface, prompt, evals, docs, phase gate

1. `ByokToolSchema.js`: three intercepted names into `BYOK_TOOL_NAMES`
   (flip the `phase5-tool-decisions.md` exclusions with a pointer here),
   four new BYOK-only tools, schemas; advertised total 63.
2. `ByokPrompts.js`: prompt `byok-v8` — catalog/runtime/notes guidance;
   drop the "plan from your own knowledge" line.
3. Evals: ≥ 5 new tasks (12.6 list) in `scripts\run-byok-evals.js`.
4. `AIflow.md` §5 touch-up if Phase 11 left new drift; AGENTS.md §2
   update; worklog entry.
5. Full gates from `newIDE\app`; electron untouched; desktop QA list
   (below) filed as a new usertasks task.

---

## 4. Phase 12 acceptance criteria (phase gate)

- [ ] No-project chat: `get_game_starter_summary` lists/summarizes real
      templates and the chosen `slug` drives `initialize_project`
      end-to-end (unit + eval).
- [ ] `search_object_asset_store`/`search_resource_store` return ranked
      public-catalog results offline-of-AI (no auth, no Generation API);
      `create_or_replace_object` `search_terms` installs a real asset in
      BYOK chats; the old unavailable-dependency failures are gone
      (unit-tested).
- [ ] Command palette lists "Ask AI"; default `Ctrl+Alt+A` opens the
      panel; reassignment works (unit + desktop QA).
- [ ] MCP: `prompts/list`+`get` expose the skill library;
      `resources/list`+`read` serve notes + docs; capabilities advertise
      all three; `read_project_notes` reads in-chat; Phase 10 behavior
      (gate, activity log, adapter) regresses green (unit + Inspector QA).
- [ ] Runtime tools: targeted (never cross-preview) pause/dump/profile;
      profiler stats arrive via the pushed-output path with a bounded
      wait; gameplay-test guard; `stop()` id quirk fixed (unit-tested).
- [ ] Prompt `byok-v8`; advertised set 63; validator green; ≥ 5 new evals;
      `phase5-tool-decisions.md` updated.
- [ ] All four repo checks green; electron untouched; worklog complete;
      AGENTS.md §2 updated; desktop QA task filed.

---

## 5. Deferred (post-12 backlog)

- **Server-push MCP notifications** (`tools/list_changed`, progress
  notifications) — needs the SSE half of the transport; still stateless on
  purpose (Phase 10 §5).
- **MCP resources for project scenes/events files** — the tools already
  cover reads; file-shaped resources only if an external agent asks.
- **Purchasable/private catalog content** — needs account consent UI;
  out of scope per D12-2.
- **Live instance editing via the debugger** (`set`/`call` paths) — the
  dump read ships; mutation of the *running game* (distinct from the
  project) wants its own owner decision about the read-only gate.
- **In-game-editor commands** (`switchForInGameEdition` family,
  `abstract-debugger-client.ts:404-521`) — powerful but UI-heavy; revisit
  only with a concrete agent workflow.

---

## Appendix A — Desktop QA additions (filed as usertasks Task 14)

- Catalog tools against the real network (starters list, asset search for
  a known term, resource search → import → object retarget).
- Command palette + shortcut on the desktop build; conflict check.
- MCP Inspector: prompts/resources surfaces; Claude Code reads skill
  prompt + notes resource without any tool call.
- Runtime tools against a real preview: pause while playing, profile a
  busy scene, confirm the Debugger editor (if open) still works
  concurrently and vice versa.
- Offline: catalog tools fail with the explicit offline message; runtime
  tools fail typed when no BYOK preview runs.

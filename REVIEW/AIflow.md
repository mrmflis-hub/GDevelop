# AI Flow Architecture — Prompts, Tools, and Context Map

**Purpose:** architecture-design reference for the AI prompting/system of the
"Ask AI" feature. Maps what the agent has access to, where prompts come from
and how they reach the model, the full tool surface, and what "skills" /
game-design system-message content exists (and doesn't) in this repository.
Companion to `report.md` (BYOK feasibility map); no code was changed for this
document. All paths relative to repo root; checked against the tree on
2026-09-21.

---

## 1. Executive summary

1. There are **two agent loops** in this checkout:
   - **Hosted flow** (GDevelop backend, `api.gdevelop.io/generation`): the
     client posts the user's text + a serialized snapshot of the project and
     polls a transcript; the **entire agent loop — system prompts, tool
     schemas, model choice, sub-agents — runs server-side**. None of those
     prompts are in this repo.
   - **BYOK flow** (`src\AiGeneration\Byok\`, this project): a **client-side
     orchestrator** that owns its system prompt (`byok-v2`), its own tool
     schemas (an 11-tool whitelist), and drives a chat-completions loop against
     a user-provided OpenAI-compatible endpoint, reusing the same editor tool
     executor and chat UI as the hosted flow.
2. **What the agent "sees" of the game** is identical in both flows: a
   *SimplifiedProject* JSON snapshot (properties, objects, groups, variables,
   layers, resources, a prose instance-count summary, gameplay tests — **no
   events, no binaries, no instance coordinates**) plus a summary of
   project-specific extensions. Events are read at runtime through tools, not
   shipped in the snapshot. The snapshot is re-serialized fresh with **every**
   message, and it goes stale the moment the agent edits anything.
3. **"Skills" do not exist** in this codebase — no skill concept, file, or
     prompt string anywhere (the only 3 "skill" hits are marketing copy, a
     test fixture, and a name-generator word). If the term came from
     GDevelop's product material, it refers to something server-side.
4. **Game-design system-message content is absent from the client.** The
   hosted agents' prompts (orchestrator, edit/explorer/script/tester
   sub-agents, event generation) live server-side; the repo holds only
   fingerprints (`AI_ORCHESTRATOR_TOOLS_VERSION = 'v15'`,
   `systemPromptTemplateHash`). The single client-owned system prompt — BYOK's
   — is **strictly operational** (role, tool list, snapshot freshness, output
   rules, planning, single-agent constraint) with zero game-design guidance.
   This is the most obvious gap/opportunity if richer prompting is wanted.

---

## 2. The two flows

### 2.1 Hosted flow (server-side agent loop)

```
Renderer (newIDE\app)                         GDevelop backend (api.gdevelop.io/generation)
──────────────────────                        ─────────────────────────────────────────────
user types in AiRequestChat
  → AskAiEditorContainer.js:783-946  create:
      POST /ai-request  ──────────────────────→ owns: system prompts, tool schemas,
        userRequest (raw text)                   model/preset, agent loop, sub-agents,
        gameProjectJson (SimplifiedProject,      docs search, plan tool, retries
          inline <10 KB / presigned-URL ≥10 KB),
        projectSpecificExtensionsSummaryJson,
        aiConfiguration.presetId, mode, toolsVersion 'v15'
  ← poll getAiRequest (adaptive 1.4-5 s; batched status checks)
        AiRequestContext.js watch loop 1159-1303
  transcript items: output_text / reasoning /
        function_call (may carry subAgentAiRequestId) /
        function_call_output
  → useProcessFunctionCalls (Utils.js:232-729)
        auto-executes tool calls LOCALLY via
        EditorFunctionCallRunner (approval gate:
        doesFunctionCallModifyProject → inline
        EditApprovalRequest when auto-edit off)
  → POST /ai-request/{id}/action/add-message ─→ server feeds results to LLM,
        functionCallOutputs + fresh snapshot +     next turn… until final text
        userMessage ('' for tool-result sends)
```

Key files: `Utils\GDevelopServices\Generation.js` (all endpoints + message
types), `AiGeneration\AiRequestContext.js` (state + polling),
`AiGeneration\AskAiEditorContainer.js` (entry points),
`AiGeneration\Utils.js` (tool-call processing + approval),
`EditorFunctions\*` (tool implementations).

Transcript message shape (OpenAI-like, `Generation.js:39-101`): assistant
messages carry `reasoning` (summary text), `output_text`, and `function_call`
items (`call_id`, `name`, `arguments` as JSON string, optional
`subAgentAiRequestId` — the client then polls that sub-agent request too);
tool results return as `function_call_output` items. `AiRequest.status`:
`working | ready | error | suspended`; `mode`: `chat | agent | orchestrator`.

### 2.2 BYOK flow (client-side agent loop, this project)

```
user types in the SAME AiRequestChat UI
  → AskAiEditorContainer seam: chat id has 'byok-' prefix (ByokSeam.js:15-22)
      → BYOK chats live in ByokChatStore only — never in AiRequestContext,
        which would load/poll them on GDevelop's servers (container :533-537)
  → ByokOrchestrator.sendUserMessage:
      1. system prompt   = buildByokSystemPrompt (ByokPrompts.js, 'byok-v2')
      2. messages        = transcript replay (ByokTranscript.js) + the latest
                           SimplifiedProject snapshot folded into the LAST user
                           message (ByokOrchestrator.js:202-240) — re-fetch fresh
                           via getProjectUserContent each turn (:466)
      3. tools           = toOpenAiToolsFormat(getByokToolSchemas()) — 11 tools
      4. reasoning_effort (optional, user toggle) ── ByokClient ──→
                           POST {baseUrl}/chat/completions (retries, normalized errors)
      5. tool_calls → SAME EditorFunctionCallRunner, restricted to the whitelist;
           approval gate via byokCallRequiresApproval (unknown tool ⇒ approval)
      6. tool outputs (capped 20 000 chars, ByokOrchestrator.js:55) → next turn
      7. final text → AiRequest-shaped transcript items → existing chat UI
         (context bar fed by ByokUsageTracker from completions `usage`)
```

Key files: `AiGeneration\Byok\ByokOrchestrator.js` (the loop),
`ByokPrompts.js` (system prompt), `ByokToolSchema.js` (tool schemas +
whitelist), `ByokClient.js` (HTTP), `ByokTranscript.js` (GDevelop↔OpenAI
message mapping), `ByokSeam.js` (editor wiring), `ByokChatStore.js`
(session-only storage), `ByokUsageTracker.js` (token accounting).

---

## 3. What the agent has access to

### 3.1 The serialized project snapshot (both flows)

Built by `EditorFunctions\SimplifiedProject\SimplifiedProject.js`
(`getSimplifiedProject`, :406-467; types :9-87):

**Included:** project properties (name, resolution, orientation, scale mode,
first layout); global objects + per-scene objects (name, type, behavior
name+type, object variables, animation names); object groups (members, merged
variables); layers (name, lighting position, isBaseLayer — no camera/visibility
detail); `instancesOnSceneDescription` — a **generated English sentence** with
instance counts per layer, not coordinates; global/scene variables with leaf
values (collections list children names only); resources (name, kind, file
path, metadata — no binaries); gameplay tests (name, type, description, source,
last run status).

**Deliberately absent:** event sheets (the agent reads them at runtime with
`read_scene_events` / `read_game_project_json`), instance coordinates,
extension code, object effects, sprites/images. Size is uncapped client-side —
"the backend trims it if needed" (comment :403-405).

Transport (`AiGeneration\PrepareAiUserContent.js`): SHA-256-hashed, cached
30 min; inlined below thresholds (project ≥10 000 chars, events ≥9 000 chars →
presigned-URL upload to GDevelop storage instead; extensions summary always
uploaded). `eventsJson` is currently always `null` in the chat flow
(`AskAiEditorContainer.js:855, 1088`). **BYOK always inlines the snapshot**
(no GDevelop storage round-trip), folded into the last user message.

### 3.2 Project-specific extensions summary (both flows)

`getProjectSpecificExtensionsSummary` (SimplifiedProject.js:469-518) emits, per
events-based extension, its objects/behaviors/effects/instructions with
descriptions and parameter metadata — i.e. the custom-extension API surface the
model can call. This is prompt-shaped knowledge shipped with every request.

### 3.3 Live editor access at runtime (via tools)

The snapshot is static; the **tools read the live project**: `read_scene_events`
(event sheet as text tree), `read_events_source` (EventScript source, 30 000-char
cap), `describe_instances` (positions/sizes/z-order per layer),
`inspect_object_properties_effects`, `inspect_behavior_properties`,
`inspect_scene_properties_layers_effects`, `inspect_project_properties_resources`
(200-resource cap), `inspect_variables`, and since v15 `read_game_project_json`
(depth/path/pagination-limited live JSON view, scriptable). All edits go through
the same registry and hit the real in-editor project, with hot-reload callbacks
coalesced per batch (`AiGeneration\Utils.js:521-525`).

### 3.4 Edit permission boundary (both flows)

Every registry entry declares `modifiesProject: boolean` (+ optional
`getModifiesProject(args)` — today only `run_gameplay_test`,
GameplayTestTools.js:196-202). `doesFunctionCallModifyProject`
(`AiGeneration\Utils.js:130-148`) drives the gate: with auto-edit off,
modifying calls are held behind an inline `EditApprovalRequest`; refusal
suspends the request; approval then covers the rest of the batch
(Utils.js:439-511). `run_script` declares `modifiesProject: true` so a whole
script is one approval. BYOK mirrors this via `byokCallRequiresApproval`
(unknown tool names ⇒ approval, ByokSeam.js:71-80).

### 3.5 Backend services reachable through tools (hosted flow only)

`POST /asset-search` (asset-store objects), `POST /resource-search`
(audio/fonts), `POST /ai-generated-event` + polling (server-side event
generation), docs search, sub-agents, plan tool, telemetry — see §5.3. BYOK v1
excludes all of these from its whitelist (§5.4).

### 3.6 Sub-agents (hosted only)

A `function_call` may carry `subAgentAiRequestId` (Generation.js:39-48): the
server spawned a sub-agent (explorer = read-only script agent, edit agent,
tester); the client polls it alongside the parent
(`getAiRequestStatuses` batch) and merges its transcript. Server-side tools
`run_explorer_agent` / `run_edit_agent` / `run_tests` exist as client stubs
only. **BYOK v1 is a single agent by design** (SINGLE_AGENT_SECTION of the
prompt).

---

## 4. Prompts — where they live and how they reach the model

### 4.1 Hosted flow: prompts are server-side (not in this repo)

Everything the **client** puts into the prompt pipeline:

| Input | Source | Reaches the model how |
|---|---|---|
| User text | `userRequest` (create) / `userMessage` (follow-ups) | `POST /ai-request` body (Generation.js:551), `/action/add-message` (:622) |
| Project snapshot | `SimplifiedProject.getSimplifiedProject` | `gameProjectJson` inline or storage key, re-sent **with every message** (:552-553, :627-628) |
| Extensions summary | `getProjectSpecificExtensionsSummary` | `projectSpecificExtensionsSummaryJson` (+key) (:554-555, :629-630) |
| Model config | preset dropdown | `aiConfiguration: {presetId}` only (:559) — an opaque id into server presets (definitions fetched from GDevelop's CDN `ai-settings-v2.json`, Generation.js:1180-1194; preset type :1130-1138 with mode/name/reasoningLevel; plan availability overlaid in `AiConfiguration.js:15-68`) |
| Tool-set pin | client constant | `toolsVersion: 'v15'` (`AI_ORCHESTRATOR_TOOLS_VERSION`, AiGeneration\Utils.js:102-108; sent at AskAiEditorContainer.js:874, 1124-1125) — v14 added gameplay tests, v15 made `read_game_project_json` a live editor-side read |
| Tool results | local executions | `functionCallOutputs` = `{call_id, output: JSON.stringify({success, …})}` (AiRequestUtils.js:390-400) |
| Asset-search context | trailing chat | `lastUserMessage` + up to 5 trailing `output_text` as `lastAssistantMessages` (AiRequestUtils.js:422-441 → createAssetSearch, Generation.js:992-1044) |
| Suggestion chips | server-generated | `message.suggestions` rendered as clickable chips (SuggestionLines.js:100-153); the suggestion request itself posts a fresh project snapshot (`action/get-suggestions`, Generation.js:813-858) |
| Prefill templates | client UI | only the gameplay-test "Edit the gameplay test … to " template (GameplayTestEditorContainer.js:218-229) — pre-fills the input; enters the pipeline only when the user sends |

**Confirmed absent from the client for the hosted flow** (grep-verified): any
system-prompt/persona text, and the tool descriptions/JSON-schemas sent to the
model — the `EditorFunction` type carries only `launchFunction`,
`modifiesProject`, `renderForEditor` (EditorFunctions\index.js:429-450); the
descriptions live on GDevelop's servers. Repo fingerprints of the server
prompts: `systemPromptTemplateHash` / `userPromptTemplateHash` returned in
generation stats (Generation.js:173-174) and the `toolsVersion` comment
("Only bump it once the matching prompts and generation-api are deployed",
Utils.js:102-108).

### 4.2 BYOK flow: the one prompt owned by this repo

`AiGeneration\Byok\ByokPrompts.js` — version **`byok-v2`**
(`BYOK_AGENT_PROMPT_VERSION`, :13; bump on any behavioral change). Assembled by
`buildByokSystemPrompt({toolNames, hasOpenedProject})` (:60-76) and injected as
the OpenAI `system` message (ByokOrchestrator.js:210-211). Sections, in order:

1. **ROLE** (:15-17) — "You are an assistant editing GDevelop games through
   tools. Never invent tool names… Prefer the smallest edit that satisfies the
   request — do not re-create or rewrite objects, scenes or events that already
   match what is asked for."
2. **Tool list** (:25-37) — `- name: first sentence of description` for each
   whitelisted tool. First sentences only: the full descriptions travel with
   the `tools` array every request, duplicating them would double prompt tokens.
3. **Project context** (:39-45) — with project open: the user message carries a
   simplified JSON snapshot, **stale after any edit — inspect before editing**
   (`describe_instances`, `read_scene_events`, `read_game_project_json`).
   Without a project: tell the user to open one (BYOK cannot create projects —
   `initialize_project` is not whitelisted).
4. **Output rules** (:47-50) — plain text only when done or to ask for a
   missing piece; always use tools, never describe an edit instead of making
   it; one batch of tool calls per turn; never batch calls that depend on
   another call's result.
5. **Planning** (:52-53) — multi-step requests call `create_or_update_plan`
   first and keep it updated.
6. **Single agent** (:55) — "do the work yourself… There are no sub-agents to
   delegate to — never ask for one."

Per-turn request shape (ByokOrchestrator.js:202-250, ByokClient.js):
`{model, messages: [system, …transcript] , tools, reasoning_effort?}` with the
fresh snapshot appended to the **last user message** as
`[Current simplified project snapshot, as JSON — may be slightly stale after
your edits]` (:229), and tool outputs capped at 20 000 chars (:55). Tools are
serialized by `toOpenAiToolsFormat` (ByokToolSchema.js:445-456).

---

## 5. Tools

### 5.1 Full registry (hosted flow)

Registries exported at `EditorFunctions\index.js:9029-9076`
(`editorFunctions`, needs an open project) and :9078-9083
(`editorFunctionsWithoutProject`). "Edits" = the `modifiesProject` flag at the
cited line.

**Executed client-side (real implementations):**

| Tool | Purpose | Edits | Notes |
|---|---|---|---|
| `run_script` | Run an AI-written JS script calling the other tools as async functions | yes (:8998) | `new Function` sandbox (hygiene, **not** a security boundary, ScriptRunner.js:12-16); 600-call cap; read-only mode for explorer sub-agents (:8960-8969) |
| `create_object` / `create_or_replace_object` | Create an object (asset-store asset, type, or duplicate), replace/move | yes (:1675) | backend `POST /asset-search` via searchAndInstallAsset (:1241); installs extensions (:1345) |
| `inspect_object_properties` (legacy alias), `inspect_object_properties_effects` | Read object properties/behaviors/effects | no (:2122) | read-only |
| `change_object_property` (legacy alias), `change_object_properties_effects` | Change object properties/effects, incl. `delete_this_object` | yes (:2465) | backend `POST /resource-search` for image/audio (:2291, :2393) |
| `add_behavior` | Add behavior to object/group, installing its extension | yes (:2754) | `ensureExtensionInstalled` (:2625) |
| `remove_behavior` | Delete a behavior | yes (:2835) | deprecated since v6, kept for old requests (:2759-2760, :9040-9043) |
| `inspect_behavior_properties` | Read behavior properties/shared data | no (:2937) | read-only |
| `change_behavior_property` | Change behavior properties, incl. `delete_this_behavior` | yes (:3313) | batch of changes |
| `describe_instances` | List instances on a layer: positions/sizes/z-order/variables | no (:3453) | source of instance ids for `put_*`/instance variables |
| `put_2d_instances` | Place/move/erase/transform 2D instances via virtual brushes (point/line/grid/random/erase) | yes (:4376) | — |
| `put_3d_instances` | Same for 3D layers (X/Y/Z brush) | yes (:5204) | — |
| `read_scene_events` | Read a scene's event sheet as text tree | no (:5275) | read-only |
| `read_events_source` | Read events as EventScript source (30 000-char cap) | no (:5424) | syntax matches generation's `event_script` input |
| `add_scene_events` | Generate + insert events into a scene | yes (:6086) | **backend job** `POST /ai-generated-event` + polling (:5835); not callable inside `run_script` |
| `generate_events` | Direct alias of `add_scene_events` | yes (:9073) | same backend job |
| `create_scene` | Create empty scene, optional UI layer/background/startup scene | yes (:6181) | returns `meta.newSceneNames` → editor auto-opens |
| `inspect_scene_properties_layers_effects` | Read scene settings/layers/effects | no (:6550) | read-only |
| `change_scene_properties_layers_effects_groups` | Change scene settings/layers/effects/groups, delete scene | yes (:7417) | no-op = success from v12 (:7394-7400) |
| `inspect_project_properties_resources` | Read project properties/resources (200-resource cap) | no (:7543) | name filter |
| `change_project_properties_resources` | Change project properties/resources, renames, extension install | yes (:7938) | resource rename refactorer |
| `add_or_edit_variable` | Batch create/edit/delete variables (global/scene/object/instance) | yes (:8504) | delegates to ApplyVariableChange.js |
| `inspect_variables` | Read variables at any scope | no (:8597) | read-only |
| `read_game_project_json` | Depth/path/pagination-limited live JSON view of the project | no (:8909) | live editor-side read since v15; scriptable |
| `run_gameplay_test` | Create/update + run one gameplay test in a **live preview** | conditional — `getModifiesProject`: edits only when persisting source (GameplayTestTools.js:196-202) | runs locally via runProjectGameplayTests; timeout clamped 1-120 s |
| `change_gameplay_tests` | Delete/rename/reorder tests, change description (never source) | yes (GameplayTestTools.js:400) | source changes must go through `run_gameplay_test` |
| `initialize_project` *(no-project registry)* | Create a new project, optionally from a store template | yes (:8782) | via editorCallbacks; rejected if a project is open (EditorFunctionCallRunner.js:133-144) |

**Server-side stubs** (client entry always fails; the real logic runs in the
orchestrator Lambda; locked by `ServerSideTools.spec.js` and excluded from
scripts by `ScriptExecution\NonScriptableFunctionNames.js:17-39`):

| Tool | Real work happens | Purpose |
|---|---|---|
| `create_or_update_plan` | server | agent's execution plan (rendered client-side via OrchestratorPlan UI) |
| `run_explorer_agent` | server | spawn read-only explorer sub-agent (its `run_script` is forced read-only) |
| `run_edit_agent` | server | spawn editing sub-agent (flagged modifying ⇒ approval-gated) |
| `run_tests` | server | orchestrator-level gameplay test runs |
| `search_object_asset_store` | server (orchestrator Lambda) | asset-store search |
| `search_resource_store` | server | audio/font resource search |
| `read_full_docs` / `search_docs` | server | GDevelop docs (served server-side) |
| `report_fulfilment_problem` | server | telemetry when the AI can't fulfil the request |
| `get_game_starter_summary` *(no-project)* | server | summarize a starter template for planning |

### 5.2 Execution model

Calls from the polled transcript enter `processEditorFunctionCalls`
(`EditorFunctionCallRunner.js:85-300`): sequential processing; validation gates
(no project open / `initialize_project` with project open / args JSON parse /
unknown function → immediate failed result); dispatch
`editorFunctions[name].launchFunction({…collaborators, args, project})`;
result shaping — `meta.didModifyProject` honored when explicitly boolean
(`run_script`, gameplay tests), otherwise `modifiesProject && success`;
`meta.newSceneNames` accumulates for scene auto-open; thrown errors become
failed results. Collaborators bag: project, i18n, editorCallbacks,
`toolsVersion`, `runScriptReadOnly`, `generateEvents`, refresh callbacks,
`ensureExtensionInstalled`, asset/resource search hooks, PixiResourcesLoader.

### 5.3 Tools that reach GDevelop's backend

All via `https://api[-dev].gdevelop.io/generation` (ApiConfigs.js:111-114):
`add_scene_events`/`generate_events` → `POST /ai-generated-event` + poll
(uploads content through presigned URLs; Generation.js:870-961, 1091-1128);
asset search → `POST /asset-search` (with conversation context, :992-1044);
resource search → `POST /resource-search` (:1046-1080).

### 5.4 BYOK whitelist (11 tools)

`ByokToolSchema.js:85-97` (`BYOK_V1_TOOL_NAMES`) — schemas are **authored in
this file** (checked against each implementation's `SafeExtractor.extract…`
calls; `validateByokToolSchemas` fails the tests if a name leaves the upstream
registry). Exposed: `describe_instances`, `inspect_variables`,
`read_scene_events`, `read_game_project_json`, `create_scene`,
`create_or_replace_object`, `add_behavior`, `change_behavior_property`,
`add_or_edit_variable`, `put_2d_instances`, `create_or_update_plan` (kept as a
client-rendered plan even though the hosted one is server-side).

**Deliberately excluded (documented :69-84):** `run_script` + sub-agents
(single-agent v1), `generate_events`/`add_scene_events` (GDevelop's
event-generation backend), store-search tools (GDevelop account APIs),
`read_full_docs`/`search_docs` (permanent failure stubs — docs are
server-side), gameplay-test tools (later phase). Note `create_or_replace_object`
still triggers the asset-store backend when given a `description`/`asset_id` —
the one whitelisted tool with a server dependency.

---

## 6. Skills

**Verdict: no "skills" concept exists in this repository.** Case-insensitive
sweep over `newIDE\app\src`: the only three hits are a course-description test
fixture (`fixtures\GDevelopServicesTestData\index.js:3643`), Learn-section
marketing copy (`HomePage\LearnSection\MainPage.js:188`, the lone locale string
too), and a word-list entry in `ProjectNameGenerator.js:986`. No skill-named
file exists anywhere. The closest analogues in the architecture are the
**sub-agents** (explorer/edit/tester, hosted only) and the **script agent**
(`run_script`) — capability groupings, not "skills" in the prompt sense.

## 7. Game-design system messages

**Verdict: none client-side.** No "game design" / "level design" / "events
sheet" guidance text exists anywhere in `src\AiGeneration` (grep-verified). The
hosted orchestrator's game-design knowledge — how to structure events, genre
conventions, difficulty, what makes a good GDevelop game — lives entirely in
the server-side system prompts (repo fingerprints only: `toolsVersion v15`
comment in Utils.js:102-108, `systemPromptTemplateHash` in Generation.js:173).
The BYOK prompt (§4.2) is operational only. Consequence for architecture work:
**any game-design system-message layer for BYOK is greenfield** — the natural
home is a new section in `ByokPrompts.js` (with a `BYOK_AGENT_PROMPT_VERSION`
bump), or a separate `ByokGameDesignKnowledge.js` module merged into the system
prompt, keeping the file-per-concern isolation the folder already follows.

---

## 8. File index (quick reference)

| Concern | File |
|---|---|
| AI HTTP service + message types | `newIDE\app\src\Utils\GDevelopServices\Generation.js` |
| Chat state + polling watch loop | `newIDE\app\src\AiGeneration\AiRequestContext.js` |
| Chat entry points + BYOK seam | `newIDE\app\src\AiGeneration\AskAiEditorContainer.js` |
| Tool-call processing + approval gate + toolsVersion | `newIDE\app\src\AiGeneration\Utils.js` |
| Snapshot transport (inline vs presigned upload) | `newIDE\app\src\AiGeneration\PrepareAiUserContent.js` |
| SimplifiedProject builder + extensions summary | `newIDE\app\src\EditorFunctions\SimplifiedProject\SimplifiedProject.js` (+ `ExtensionSummary.js`) |
| Tool registry (what the model can call) | `newIDE\app\src\EditorFunctions\index.js` (registries :9029-9083) |
| Tool executor | `newIDE\app\src\EditorFunctions\EditorFunctionCallRunner.js` |
| Script sandbox | `newIDE\app\src\EditorFunctions\ScriptExecution\ScriptRunner.js`, `ExposedFunctions.js`, `NonScriptableFunctionNames.js` |
| Gameplay test tools | `newIDE\app\src\EditorFunctions\GameplayTestTools.js` |
| Backend-recursing tool clients | `newIDE\app\src\AiGeneration\UseGenerateEvents.js`, `UseSearchAndInstallAsset.js`, `UseSearchAndInstallResource.js` |
| AI presets (CDN) | `newIDE\app\src\AiGeneration\AiConfiguration.js` |
| BYOK agent loop | `newIDE\app\src\AiGeneration\Byok\ByokOrchestrator.js` |
| BYOK system prompt (only client-owned prompt) | `newIDE\app\src\AiGeneration\Byok\ByokPrompts.js` |
| BYOK tool schemas + whitelist | `newIDE\app\src\AiGeneration\Byok\ByokToolSchema.js` |
| BYOK ↔ editor wiring | `newIDE\app\src\AiGeneration\Byok\ByokSeam.js` |
| Chat UI (both flows) | `newIDE\app\src\AiGeneration\AiRequestChat\` |

*Written 2026-09-21 from read-only mapping (3 Explore subagents + orchestrator
verification). No code was modified.*

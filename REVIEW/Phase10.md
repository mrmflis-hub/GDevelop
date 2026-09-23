# Phase 10 — MCP Server: GDevelop as a Tool Provider for External Agents

**Status:** implemented 2026-09-23, uncommitted (owner ordered the phase in
chat with "implement this"; decisions D10-1…D10-5 taken as recommended —
answers recorded in `usertasks.md`) · **Depends on:** Phases 4–8 (tool
parity, the seam, the executor) and 9 (settings surface) · **Read first:**
[AIflow.md](AIflow.md) §5 (tool registry), `Phase8.md` step 8.0 (the seam),
[styleguide.md](styleguide.md)

> **Implementation notes (2026-09-23, deviations from the first design
> draft, all recorded in the worklog):** the electron status channel is
> `byok-mcp-status` (the hook/card read the running state); the tool-host
> bag exposes `getExtraTool`/`isExtraToolShadowedByRegistry` so dispatch
> mirrors the chat loop exactly (including the extension-shadow rule); the
> stdio adapter's pure logic lives in
> `Byok/Mcp/ByokMcpStdioAdapterCore.js` as a plain-CJS module (the
> `OptionalRequire.js` precedent) that the script requires directly — one
> implementation, tested, no duplication. The plan-tool echo reproduces the
> orchestrator's `depends_on → dependsOn` normalization; `run_gameplay_test`
> and `add_scene_events` dispatch through their BYOK extra implementations
> exactly as chats do.

> **Design note (2026-09-23):** `Phase9.md` §4's "no Phase 10 was needed"
> line referred to Phase 9 leftovers only (streaming and the O2 fallback
> stay conditional). This phase exists because the owner ordered it in chat
> on 2026-09-23: **build an MCP server so other apps — Claude Code, ZCode,
> any MCP client — can connect to GDevelop and drive it with tools.**
>
> The MCP specification revision this phase implements against is
> **`2026-07-28`** (the current one; stateless-first). Everything versioned
> lives behind one constant so a future revision is a one-line bump.

---

## 1. Introduction — what this phase delivers

The BYOK project so far lets **a chat inside GDevelop** drive the editor
through the tool registry (`EditorFunctions\index.js`, the 48-tool parity
surface + BYOK-only extras). This phase turns the direction around: GDevelop
itself becomes an **MCP server**, so the agent can live somewhere else — a
coding assistant that already has the user's full context — and call the
same tools against the **live, open project**. No LLM calls are involved:
the server only executes tools; the connected client brings its own model.

Concretely:

1. **Loopback MCP endpoint inside the desktop app** — while GDevelop runs
   (and the user enables the feature), the Electron main process serves the
   MCP protocol on `127.0.0.1` behind a per-session bearer token, and
   forwards every `tools/call` into the renderer, where the existing
   executor (`createByokEditorFunctionCallExecutor`, `ByokSeam.js`) runs the
   tool against the real project — previews, hot-reload, unsaved-changes and
   all.
2. **A zero-dependency stdio adapter** — MCP clients spawn stdio servers, so
   the repo ships `scripts\gdevelop-mcp-stdio.js` (~60 lines, system Node ≥
   18): it reads a discovery file, shuttles newline-delimited JSON-RPC
   between the client's stdin/stdout and the IDE's loopback HTTP endpoint,
   and stays alive across IDE restarts by re-reading the discovery file.
3. **Full tool parity over MCP** — `tools/list` advertises exactly what a
   BYOK chat can call at that moment (`getByokAdvertisedToolNames`: the
   registry whitelist + BYOK-only extras, `initialize_project` when no
   project is open) plus one MCP-native tool, `get_project_overview`
   (the SimplifiedProject snapshot the BYOK prompt uses, as a tool).
   Sub-agent tools refuse over MCP by the existing nesting guard — the
   external agent orchestrates itself.
4. **A permission posture that fits "another app can edit my project"** —
   the server is **off by default**; when on, an access mode
   (`read-only` / `read-write`, decision D10-2) gates every call from the
   same `modifiesProject` / `getModifiesProject` metadata the chat approval
   row uses; an activity log (ring of the last 200 calls) is always visible
   in the settings; the off toggle is an instant kill switch. There is **no
   inline approval UI** over MCP — there is no chat to render it in; the
   access mode is the consent surface (recorded reasoning in step 10.2).
5. **Settings card** — Preferences → BYOK gains an "MCP server" card:
   enable toggle, access mode, running status (endpoint URL + copyable
   client config + discovery-file path), and the activity list.
6. **Client wiring, documented** — the exact `claude mcp add` command, a
   `.mcp.json` snippet, the ZCode config entry, and the MCP Inspector
   incantation for QA (Appendix A).

### Architecture (one diagram, normative for steps 10.5–10.8)

```
MCP client (Claude Code / ZCode / Inspector)
   │  spawns                        stdio: newline-delimited JSON-RPC 2.0
   ▼
scripts\gdevelop-mcp-stdio.js  ── reads ──→  <userData>\gdevelop-mcp-endpoint.json
   │                                              { port, token, pid, protocolVersion }
   │  HTTP POST /mcp (Bearer token, 127.0.0.1 only, stateless JSON — no SSE)
   ▼
Electron main process (ByokMcpServer.js): validate → route to a ready window
   │  ipc: 'byok-mcp-request' → renderer, 'byok-mcp-response' ← renderer
   ▼
Renderer (useByokMcpServer.js → ByokMcpProtocol.js → ByokMcpToolHost.js)
   │  register/unregister: the tool host lives in useByokChatSeam (10.6)
   ▼
createByokEditorFunctionCallExecutor → processEditorFunctionCalls → live project
```

Protocol scope (v1): `initialize`, `notifications/initialized`, `ping`,
`tools/list`, `tools/call`, `notifications/cancelled`. Capabilities:
`{ tools: { listChanged: false } }`. No `resources`, no `prompts`, no
server→client requests (no sampling/elicitation), no SSE stream — §5.

### New files created in this phase

```
Byok\Mcp\ByokMcpProtocol.js / .spec.js          JSON-RPC 2.0 + MCP method dispatch, version negotiation
Byok\Mcp\ByokMcpTools.js / .spec.js             schema→descriptor conversion, result→content mapping, access gate
Byok\Mcp\ByokMcpToolHost.js / .spec.js          module-level host registry, serialized call queue, activity ring
Byok\Mcp\ByokMcpStdioAdapterCore.js / .spec.js  adapter logic: discovery parsing, request build, failure policy
Byok\Mcp\useByokMcpServer.js / .spec.js         MainFrame-mounted hook (IPC ⇄ protocol) + <ByokMcpServerHost />
scripts\gdevelop-mcp-stdio.js                   the stdio adapter CLI (thin plain-JS wrapper over the tested core)
electron-app\app\ByokMcpServer.js               loopback HTTP server + discovery file + IPC routing (manual QA)
```

Modified: `Byok\ByokTypes.js` / `.spec.js` (`mcpServer` settings slice +
defaults), `Byok\ByokSettingsTab.js` / `.spec.js` (the MCP card),
`Byok\useByokChatSeam.js` / `.spec.js` (tool-host register/unregister
effect), `MainFrame\index.js` (one import + one `<ByokMcpServerHost />` —
audited upstream touchpoint, same budget class as the chat-header one),
`electron-app\app\main.js` (one `require` + one `registerByokMcpServer(...)`
call, the Phase 3 pattern).

---

## 2. Open owner decisions (implementation waits for these)

Presented in chat on 2026-09-23 with the phase design; answers get recorded
in `usertasks.md` ("Phase 10 decisions") and the chosen branches of the
steps below become fixed.

1. **D10-1 — Protocol implementation: hand-rolled vs official SDK.**
   Recommend: **hand-rolled** (`ByokMcpProtocol.js`, ~300 lines). The v1
   surface is six methods of JSON-RPC 2.0 over one transport; the official
   `@modelcontextprotocol/sdk` is a Node/server library we would drag into
   the bundle for no capability we use, and the repo rule forbids new
   dependencies without explicit approval anyway.
2. **D10-2 — Default access mode when the server is enabled.** Recommend:
   **read-write**. Enabling a loopback-only, token-gated local server is the
   consent act, and the feature's purpose is letting an external agent
   build; `read-only` stays one dropdown away and every call lands in the
   activity log. The cautious alternative (read-only default, second toggle
   for writes) costs every user one extra click and surprises nobody who
   reads the card.
3. **D10-3 — Tool surface: full parity or read-only subset.** Recommend:
   **full parity** including `run_script` and `initialize_project`.
   `run_script` is gated by the access mode like any modifying tool (and is
   the same power the individual tools already grant, just scripted);
   `initialize_project` is what makes "scaffold me a game" work from a
   coding agent with no project open. Note for the record: `run_script` is
   a hygiene sandbox, not a security boundary (AIflow.md §5.1) — the
   boundary is the off switch, the token, and the access mode.
4. **D10-4 — Code location: `Byok\Mcp\` vs a new top-level `src\Mcp\`.**
   Recommend: **`Byok\Mcp\`**. The server is a consumer of BYOK's seam,
   registry, and settings — sibling placement keeps imports tight and stays
   inside the AGENTS.md scope rule without an amendment.
5. **D10-5 — Client wiring support level for v1.** Recommend:
   **dev-time wiring only** — documented commands (Appendix A) with the
   adapter run by system Node. An in-app "copy client config" button and a
   packaged-adapter story (launching via the Electron binary) are
   packaging-phase work (§5).

---

## 3. Steps

### Step 10.1 — Protocol core (`Byok\Mcp\ByokMcpProtocol.js`)

**Goal:** one pure, fully tested module that knows MCP: given a raw
request (method, params, id) and injected handlers, produce the raw
response. No React, no electron, no editor imports — everything arrives
injected, so the whole method table is unit-testable with fakes.

**How to implement:**

1. Constants: `BYOK_MCP_PROTOCOL_VERSION = '2026-07-28'` and
   `BYOK_MCP_SUPPORTED_PROTOCOL_VERSIONS = ['2026-07-28']` (a future
   revision appends here, nothing else changes).
2. `handleByokMcpMessage({ method, params, id }, handlers)` →
   `{ response } | { notification: true } | { error: { code, message } }`:
   - `initialize` → `{ protocolVersion: <the client's when supported, else
     BYOK_MCP_PROTOCOL_VERSION>, capabilities: { tools: { listChanged:
     false } }, serverInfo: { name: 'gdevelop', title: 'GDevelop', version:
     <injected app version> } }`.
   - `notifications/initialized`, any unknown **notification** (no id) →
     accepted, no response (the transport answers HTTP 202).
   - `ping` → `{}`.
   - `tools/list` → `{ tools: handlers.listTools() }` (descriptors from
     10.2; no cursor pagination — the set is ~50 and the spec's pagination
     is optional).
   - `tools/call` → `handlers.callTool(params)`; handler errors arrive as
     a tool-result with `isError: true` (business failures are results per
     spec, not JSON-RPC errors), only malformed `params` are `-32602`.
   - `notifications/cancelled` → `handlers.cancel(id)`.
   - Unknown method **with** an id → `-32601`; malformed envelope →
     `-32600`; the JSON-parse error itself is the transport's (`-32700`,
     emitted in 10.5 where the raw text arrives).
3. JSON-RPC response framing helpers (result/error envelopes, id passthrough)
   shared with the adapter core.

**Tests:** every method of the table; version negotiation both branches;
unknown method/notification; `tools/call` error-as-result vs `-32602`;
envelope id handling.
**Depends on:** nothing.

---

### Step 10.2 — Tool surface mapping + access gate (`Byok\Mcp\ByokMcpTools.js`)

**Goal:** the bridge between MCP's tool world and BYOK's: advertise the
right names with the right schemas, execute one call through the right
executor path, and return spec-shaped content.

**How to implement:**

1. **Descriptors:** `makeByokMcpToolDescriptors({ hasOpenedProject,
   accessMode })` — for `getByokAdvertisedToolNames({ hasOpenedProject })`:
   take each schema from `getByokToolSchemasForNames` and map it to
   `{ name, description, inputSchema: <the schema's parameters object,
   verbatim — it is already JSON Schema> }`; append the BYOK-only extras
   (`getByokExtraTools()` — their schemas advertise the same way). Then the
   one MCP-native tool: `get_project_overview` (empty `inputSchema`,
   description naming the SimplifiedProject snapshot). The descriptor list
   is computed per `tools/list` call (a project may open mid-session).
2. **Access gate:** `byokMcpCallIsAllowed(toolMeta, args, accessMode)` —
   `read-only` rejects exactly what the chat approval row would hold:
   a registry tool with `modifiesProject === true` or
   `getModifiesProject(args) === true`, an extra tool with
   `modifiesProject: true` (incl. `initialize_project` from the
   no-project registry). Rejection returns a `tools/call` result with
   `isError: true` whose text names the setting that unlocks writes
   (Preferences → BYOK → MCP server → Read & write) — the agent can relay
   it to the user verbatim.
3. **Execution:** `callByokMcpTool({ name, args }, host)` — normalize
   `arguments` (object per spec; be liberal and accept a JSON string like
   the chat loop does), then: a BYOK-only extra → `tool.run(args,
   collaborators)` (the host's collaborators bag, 10.6 — deliberately
   without `runSubAgent` and with `byokChatId: null`, so the existing
   nesting guard refuses sub-agents over MCP and no restore-point snapshot
   is keyed); otherwise the seam executor with one synthetic call
   `{ name, arguments: JSON.stringify(args), call_id: 'mcp-<n>' }` and
   context `{ aiRequestId: 'byok-mcp', getRelatedAiRequestLastMessages: ()
   => null }`.
4. **Result → content:** text content = the same output object the chat
   records as the `function_call_output`, `JSON.stringify`-ed (one
   deliberate divergence from the chat loop, recorded here: the cap is
   **200 000 chars** with an explicit `\n[truncated by the GDevelop MCP
   server]` marker instead of the chat's 20 000 — MCP clients manage their
   own context and read tools benefit from the room). `isError: true` when
   the output reports failure. Image ids in extra-tool outputs are
   materialized through `ByokImageContent` and appended as
   `{ type: 'image', data: <base64>, mimeType }` content items (the id
   references never leave the IDE).
5. `get_project_overview` executes in this module: no project → text
   `{"hasOpenProject": false}` (the agent then calls `initialize_project`);
   otherwise `makeSimplifiedProjectBuilder(gd).getSimplifiedProject(...)`
   JSON under `{"hasOpenProject": true, "simplifiedProject": …}` — the
   exact snapshot shape the BYOK system prompt folds into messages.

**Tests:** descriptor set matches `getByokAdvertisedToolNames` + extras +
the native tool (schema round-trip on a sample of tools); gate truth table
across `modifiesProject` / `getModifiesProject` / extras / access modes;
arguments object-vs-string; text and image content mapping; truncation
marker; `get_project_overview` both branches with a fixture project.
**Depends on:** 10.1 (types only).

---

### Step 10.3 — Tool host (`Byok\Mcp\ByokMcpToolHost.js`)

**Goal:** the module-level rendezvous the seam registers into and the
protocol dispatches through — the `setByokOrchestrator` pattern of
`ByokChatStore`, applied to tool execution. Owns serialization, timeouts,
cancellation, and the activity log.

**How to implement:**

1. Module-level registry: `setByokMcpToolHost(host | null)` /
   `getByokMcpToolHost()`. The host bag (built in 10.6):
   `{ executeRegistryCalls, extraTools, editorFunctions,
   editorFunctionsWithoutProject, hasOpenedProject, getProject, i18n,
   getSettings }`.
2. Serialized queue: MCP calls execute **one at a time** (the editor
   project is shared mutable state; the chat loop already serializes its
   batches the same way). A `tools/call` while another runs waits FIFO;
   `notifications/cancelled` marks the waiting/in-flight entry so its
   result is discarded when it eventually completes (no renderer-side
   thread to kill — the same semantics as suspending a chat).
3. Per-call timeout: 120 s (constant) → `isError` result "timed out after
   120 s" (recorded in the activity log as failed).
4. Activity ring, capped 200: `{ at, tool, argsPreview (first 200 chars),
   ok, didModifyProject, durationMs }`; `listByokMcpActivity()` for the
   settings card. Entries are pushed for rejections and timeouts too —
   the log is the audit trail of *everything the external agent tried*.
5. Crash containment: a host throwing during registration or execution is
   unregistered (never left half-registered) and the call returns an
   `isError` result; the next seam mount re-registers.

**Tests:** FIFO ordering with a blocked fake executor; timeout; cancel-
discard; ring cap; rejection entries; unregister-on-throw; double
registration replaces.
**Depends on:** 10.2.

---

### Step 10.4 — Settings slice + card (`ByokTypes.js`, `ByokSettingsTab.js`, `Byok\Mcp\ByokMcpSettingsCard.js`)

**Goal:** the user-facing switch, status, and audit view.

**How to implement:**

1. `ByokTypes.js`: `ByokMcpServerSettings = {| enabled: boolean,
   accessMode: 'read-only' | 'read-write' |}` with defaults
   `{ enabled: false, accessMode: <per D10-2> }`, added to `ByokSettings`
   and normalized field-by-field in `getByokSettings` like every other
   slice (an unknown/absent field must never crash a load).
2. `ByokMcpSettingsCard.js` (mounted in `ByokSettingsTab.js` with the
   other cards): enable toggle (writes the settings slice through the same
   handler the other toggles use), access-mode dropdown, and — when
   enabled — the live status the hook (10.5) publishes: running/stopped +
   why (`another GDevelop window owns the endpoint` on the refusal path),
   the endpoint URL, a "Copy client config" button producing the
   Appendix-A `claude mcp add` line, the discovery-file path, and the
   activity list (`listByokMcpActivity`, newest first, with a clear
   button). Every user-visible string through Lingui `<Trans>`.
3. The card must render sensibly in the web build (no electron): the
   toggle shows with a desktop-only explainer line and is disabled —
   same degradation class as the storage-backend pick.

**Tests:** normalizer defaults + garbage-tolerance; toggle/access-mode
wiring; status rendering per state; activity list order + clear.
**Depends on:** 10.3.

---

### Step 10.5 — Renderer endpoint (`Byok\Mcp\useByokMcpServer.js` + the MainFrame touchpoint)

**Goal:** the renderer half of the transport: receive MCP requests from
main, run them through 10.1→10.3, answer. Mounted once per window in
`MainFrame` so it exists regardless of which editor is open; inert in the
web build.

**How to implement:**

1. `optionalRequire('electron')` (the `ByokChatStorageBackends` pattern):
   no electron → the hook returns a static inert status and subscribes to
   nothing.
2. `ipcRenderer.on('byok-mcp-request', (event, { requestId, rawMessage }))`
   → parse the raw JSON (a parse failure answers
   `{ error: { code: -32700, … } }` without throwing) →
   `handleByokMcpMessage` with handlers wired to `getByokMcpToolHost()`
   (absent host → tools/list still works — descriptors are static enough —
   while `tools/call` answers the "host unavailable" error of 10.7 verbatim)
   → `ipcRenderer.send('byok-mcp-response', { requestId, response })`.
3. Host-status declaration: when the hook observes the host registry
   change (the seam's register/unregister in 10.6 is a store notification
   — subscribe, don't poll), send `byok-mcp-host-status { ready }` so main
   routes to windows that can actually execute.
4. Settings→main lifecycle: on mount and whenever `enabled` changes in the
   BYOK preferences (read through the same preferences context MainFrame
   already provides), `invoke('byok-mcp-set-enabled', { enabled })` —
   errors travel as values (`{ ok: false, error }`, the ByokSafeStorage
   pattern) and surface in the card's status.
5. `ByokMcpServerHost` — a null-rendering component calling the hook, so
   the MainFrame touchpoint stays one import + one JSX element.
6. Web-build guard double-check: none of the above may run its effect
   bodies without electron (unit tests exercise the inert path too).

**Tests:** (jsdom + the mocked-electron pattern of `ByokKeyStorage.spec`)
request in → parsed → dispatched → response out, happy path; `-32700` and
`-32600` passthrough; host-absent call answer; host-status sends on
registry change; set-enabled invoked on mount and on change; inert without
electron.
**Depends on:** 10.1, 10.3, 10.4.

---

### Step 10.6 — Seam registration (`useByokChatSeam.js`)

**Goal:** the executor + collaborators the server needs are exactly what
the seam already assembles — registration is one effect there, and both
hosts (Ask AI editor container, homepage standalone form) get it for free.

**How to implement:**

1. An effect registering, via `setByokMcpToolHost`, a host bag built from
   the existing seam members: `executeByokFunctionCalls` (the memoized
   executor — the same instance chats use, so the O3 live-project getter
   semantics carry over), `editorFunctions` / `editorFunctionsWithoutProject`
   (they arrive as options), `getByokExtraTools()` collaborators (the same
   bag shape `ByokExtraTools.js` documents: `getProject: getByokLiveProject`,
   outside-editor callbacks, `runtimeDeps`, `onlineDocsEnabled`,
   `getProjectNotesIdentifier`, extension-reload hooks — without
   `runSubAgent`), `hasOpenedProject`, `i18n`,
   `getSettings: () => getByokSettings(preferencesValuesRef.current || {})`.
2. Cleanup unregisters **only if the registered host is this one** (two
   windows / host + form must not race each other's cleanup — compare
   identity, like the orchestrator store's discipline).
3. Availability constraint, stated in the QA list: the host exists while a
   seam host is mounted. The Ask AI editor stays mounted once its tab has
   been opened in a project window, and the homepage form mounts its seam
   on the homepage — so the practical rule is "open the Ask AI tab once in
   the project you want the agent to drive". If a `tools/call` arrives
   with no host, the error says exactly that. (If QA shows the container
   unmounts on tab switches contrary to this expectation, the fallback —
   lifting registration to a MainFrame-level effect — is a worklog
   escalation, not a silent redesign.)
4. No changes to `AskAiEditorContainer.js` or `AskAiStandAloneForm.js` are
   expected; if wiring turns one up, it is a one-line props pass and gets
   recorded as an audited touchpoint in the worklog.

**Tests:** (extend `useByokChatSeam.spec.js`) register on mount with the
expected bag; unregister on unmount; a second mount replaces; cleanup of
an unmounted host does not remove a newer registration.
**Depends on:** 10.3.

---

### Step 10.7 — Electron main endpoint (`electron-app\app\ByokMcpServer.js`)

**Goal:** the loopback listener, the discovery file, and request routing —
the one piece with no test runner, so it stays thin (validation, forwarding,
nothing else; every decision it makes is a table in this step) and gets a
manual QA checklist.

**How to implement:**

1. `createByokMcpHttpServer({ onMcpMessage, getReadyWindows })`: an
   `http.Server` bound to `127.0.0.1`, port 0 (ephemeral). Per request:
   - Only `POST /mcp` and `GET /health` exist; everything else → 404;
     `GET /mcp` → 405 (there is deliberately no SSE stream).
   - `Authorization: Bearer <token>` required (403 otherwise); `Host`
     header must be `127.0.0.1:<port>` (DNS-rebinding guard); body capped
     at 1 MB (413); `Content-Type: application/json` expected.
   - **No CORS headers, ever** — the only client is the adapter; a browser
     page must not be able to call the endpoint even if it learned the
     token.
   - Valid notification (no `id`) → 202 empty; valid request → forwarded,
     JSON answer when the renderer replies.
2. Token + discovery: token = `crypto.randomBytes(32).toString('hex')` per
   server run; the discovery file
   `<userData>\gdevelop-mcp-endpoint.json` = `{ port, token, pid,
   protocolVersion, startedAt }`, written on start, deleted on stop and on
   `before-quit`. Ownership rule: if the file exists and its `pid` is
   alive, this instance **refuses to start** the server (the settings card
   shows the refusal — two IDE instances must not flip-flop the endpoint
   the adapter sees); a stale file (dead pid) is taken over.
3. Routing: keep the last ready `webContents` (from
   `byok-mcp-host-status`), preferring the focused window at request time.
   No ready window → the JSON-RPC error `-32001` "no GDevelop tool host is
   available — open the Ask AI panel in the project window, then retry".
   Pending-map with a **150 s** request timeout (above the 120 s tool
   timeout, so the tool's own error wins the race) → `-32000`.
4. IPC surface (all errors-as-values, the `ByokSafeStorage` convention):
   `byok-mcp-set-enabled` (invoke; starts/stops the listener + discovery
   lifecycle), `byok-mcp-host-status` (on), `byok-mcp-request`
   (webContents.send), `byok-mcp-response` (on).
5. `registerByokMcpServer(ipcMain, app)` + `main.js` gets one require and
   one call (the `registerByokChatFileHandlers` pattern).

**Manual QA checklist (goes into the phase gate):** server starts/stops
with the toggle; discovery file appears/disappears; wrong/absent token →
403; oversized body → 413; `GET /mcp` → 405; health answers with the
token; tools/call round-trip through a real client; second enabled
instance refuses and the card says so; killing GDevelop leaves a stale
file the next start takes over; adapter reconnects across an IDE restart.
**Depends on:** 10.1 (framing), 10.5 (IPC contract).

---

### Step 10.8 — Stdio adapter (`scripts\gdevelop-mcp-stdio.js` + `Byok\Mcp\ByokMcpStdioAdapterCore.js`)

**Goal:** the process MCP clients actually spawn. Plain CommonJS, zero
dependencies, global `fetch` (friendly stderr message on Node < 18). The
tested logic lives in the flow-typed core; the script is a dumb stdin/
stdout pump (the same thin-shim rule as the electron files).

**How to implement:**

1. Core (tested): `resolveByokMcpEndpoint({ cliArgs, readDiscoveryFile })`
   — `--url/--port/--token` override the discovery file; validates shape,
   `pid` liveness is *not* required (the IDE may restart); 
   `buildByokMcpHttpRequest(rawLine, endpoint)` — POST `/mcp`, Bearer
   header, the raw line verbatim as body; `byokMcpOutputFor(rawResponse,
   { endpointReachable })` — only messages with an `id` go to stdout (202
   notification acks print nothing); stdout carries **protocol messages
   only** — every diagnostic goes to stderr.
2. Failure policy (the part that makes the adapter feel solid): a failed
   POST (ECONNREFUSED/timeout) → re-read the discovery file once after 1 s
   (the IDE restart case: new port + token) and retry; still failing →
   answer the in-flight request with `-32002` "the GDevelop MCP endpoint is
   unreachable — is GDevelop running with the MCP server enabled?" and
   **stay alive** (the client shows the error; a later call retries). The
   adapter exits only when stdin closes.
3. Script: `readline` on stdin → core → `fetch` (180 s timeout) → write
   responses to stdout; `--help` prints the Appendix-A wiring lines.

**Tests:** (core) discovery parse/validate/override matrix; request build;
stdout-only-with-id rule; each failure-policy branch with a fake fetch.
**Depends on:** 10.1 (framing).

---

### Step 10.9 — Wiring docs + phase gate

1. Appendix A of this file is the wiring record; verify every command in
   it against the real clients during QA (Claude Code `mcp add`, a
   `.mcp.json`, ZCode's MCP config, MCP Inspector) and correct the appendix
   in the same session if a command drifted.
2. Full gates from `newIDE\app`; the electron side per its `check-format`
   + the manual checklist of 10.7.
3. AGENTS.md §2 status line updated (Phase 10 implemented, QA Task 12
   opened with the desktop checklist).

---

## 4. Phase 10 acceptance criteria (phase gate)

- [ ] Protocol: every method of the 10.1 table unit-tested; version
      negotiation both branches; notifications produce no response body.
- [ ] Surface: `tools/list` returns exactly `getByokAdvertisedToolNames` +
      extras + `get_project_overview`, schemas verbatim; the set grows
      `initialize_project` only while no project is open (unit-tested).
- [ ] Gate: `read-only` rejects every modifying call (registry
      `modifiesProject`/`getModifiesProject`, extras, `initialize_project`)
      with the unlocking-instruction text; `read-write` executes (truth
      table unit-tested).
- [ ] Execution: one call at a time (FIFO); timeout at 120 s as an
      `isError` result; cancellation discards; every call/rejection/timeout
      lands in the activity ring capped at 200 (all unit-tested).
- [ ] Transport: token/Host/size validation, 404/405/403/413 behavior and
      the discovery-file lifecycle verified in the desktop QA; adapter
      answers `-32002` on an unreachable IDE and survives its restart
      (core unit-tested, behavior QA'd).
- [ ] Settings: toggle drives the listener; access mode gates; card shows
      status, client-config copy, discovery path, activity list; web build
      degrades to a disabled card (unit-tested).
- [ ] Seam: host registers on mount, unregisters on unmount, replacement
      is identity-safe (unit-tested); "open the Ask AI tab once" verified
      in QA, with the tab-switch-keeps-mount expectation explicitly
      checked and recorded.
- [ ] End-to-end QA: Claude Code (or ZCode) connected per Appendix A can
      list tools, read the open project, and make a small edit (with
      read-write) that appears live in the editor; MCP Inspector passes
      the same path; the hosted AI and BYOK chat flows regress green.
- [ ] All four repo checks green; worklog entry complete.

---

## 5. Deferred (post-10 backlog)

- **`resources` and `prompts`** — project files as MCP resources, the skill
  library as MCP prompts: natural follow-up once tools prove the transport;
  v1 keeps the server single-capability.
- **Server-push notifications** (`tools/list_changed`, progress
  notifications during long tools): needs the SSE half of the transport;
  stateless JSON was chosen on purpose (spec 2026-07-28 stateless-first).
- **Per-project routing across windows** (each open project addressable
  from one client): v1 routes to the focused ready window; if the owner
  drives multi-project sessions from an agent, revisit.
- **Packaged-app adapter story** (in-app client-config copy, launching the
  adapter via the Electron binary so no system Node is needed): packaging
  phase, with D10-5.
- **Sampling / elicitation** (server→client model requests): GDevelop has
  no reason to call the client's model yet; also requires the SSE half.
- **Remote / LAN transports:** never without an explicit owner request —
  the loopback + token posture is the security model.

---

## Appendix A — Client wiring (the commands the QA verifies)

Prerequisite every time: GDevelop desktop running, Preferences → BYOK →
MCP server enabled, and the Ask AI tab opened once in the target project
window (step 10.6's availability rule).

- **Claude Code (user scope):**
  `claude mcp add gdevelop --scope user -- node "C:\Projects\GDevelop\newIDE\app\scripts\gdevelop-mcp-stdio.js"`
- **Project `.mcp.json` (any MCP client that reads one):**
  ```json
  {
    "mcpServers": {
      "gdevelop": {
        "command": "node",
        "args": ["C:\\Projects\\GDevelop\\newIDE\\app\\scripts\\gdevelop-mcp-stdio.js"]
      }
    }
  }
  ```
- **ZCode (MCP server entry, same command/args shape as `.mcp.json`).**
- **MCP Inspector (manual QA):**
  `npx @modelcontextprotocol/inspector node newIDE\app\scripts\gdevelop-mcp-stdio.js`
- Overrides for exotic setups: `--url http://127.0.0.1:PORT/mcp --token <hex>`
  (both also readable from the discovery file the IDE writes; never commit
  or share the token — it is per-session and loopback-only by construction).

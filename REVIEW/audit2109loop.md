# Audit 2026-09-21 — agent: loop

## Files assigned

1. `C:\Projects\GDevelop\newIDE\app\src\AiGeneration\Byok\ByokOrchestrator.js`
2. `C:\Projects\GDevelop\newIDE\app\src\AiGeneration\Byok\ByokOrchestrator.spec.js`
3. `C:\Projects\GDevelop\newIDE\app\src\AiGeneration\Byok\ByokPrompts.js`
4. `C:\Projects\GDevelop\newIDE\app\src\AiGeneration\Byok\ByokPrompts.spec.js`
5. `C:\Projects\GDevelop\newIDE\app\src\AiGeneration\Byok\ByokChatStore.js`
6. `C:\Projects\GDevelop\newIDE\app\src\AiGeneration\Byok\ByokChatStore.spec.js`

All six were read in full from the working tree (the uncommitted state of
ByokOrchestrator.js / ByokOrchestrator.spec.js / ByokPrompts.js is what was
reviewed). Dependencies traced: `ByokTranscript.js`, `ByokToolSchema.js`,
`ByokClient.js`, `ByokErrors.js`, `ByokTypes.js`, `ByokUsageTracker.js`,
`ByokSeam.js`, `ByokModelsCache.js`, `AiRequestUtils.js`,
`AskAiEditorContainer.js`, `AiRequestChat/index.js`,
`AiRequestChat/AiRequestErrorRow.js`, `AiRequestChat/ChatMessages.js`,
`AiGeneration/Utils.js`, `AiRequestContext.js`,
`EditorFunctions/index.js`, `EditorFunctions/EditorFunctionCallRunner.js`,
`EditorFunctions/ScriptExecution/ScriptRunner.js`, `Generation.js`,
`REVIEW/Phase4.md`, `REVIEW/report.md`, `REVIEW/worklog.md`.

## Issues found

### [B] Tool whitelist is not enforced at dispatch — hallucinated non-whitelisted tools (incl. `run_script`) actually execute

- Affected: `ByokOrchestrator.js` `executeToolCalls` (lines 334-415) and
  `collectPendingToolCalls` (267-272); policy declared in
  `ByokToolSchema.js` `BYOK_V1_TOOL_NAMES` (85-97) and its exclusion comment
  (69-84); dispatch reaches `EditorFunctions/index.js` registry (9029-9076).
- Explanation: the v1 whitelist is only *advisory* — it filters the `tools`
  array sent to the model (`ByokOrchestrator.js:240`) and the prompt lines,
  but `executeToolCalls` forwards **any** tool name the model emits to
  `executeFunctionCalls`. Many OpenAI-compatible servers (vLLM, llama.cpp,
  LM Studio, Ollama prompt-template function calling) do not constrain the
  model to the advertised tool list, so a `run_script`, `put_3d_instances`,
  `run_tests`, … call is dispatched to the real registry implementation.
  `run_script` (`EditorFunctions/index.js:8935-8999`) runs entirely
  client-side (`executeScript`, `new Function` sandbox that is explicitly
  "hygiene, not a security boundary" — `ScriptRunner.js:69-94`) with the full
  mutating function set (`runScriptReadOnly` is not passed by
  `ByokSeam.js:176-229`) and up to 600 editor-function calls per script
  (`ScriptRunner.js:231`). `ByokSeam` only stubs the server-dependent
  collaborators (`generateEvents`, asset/resource stores,
  `ByokSeam.js:130-132, 186, 222-227`); everything else in the registry
  executes. With auto-edit on, a hallucinated `run_script`
  (`modifiesProject: true`, index.js:8998) runs with no approval at all.
  This defeats the documented v1 exclusion decision and is reachable via
  prompt injection through project content (the snapshot embeds
  user/untrusted game data).
- Proposed solution: in `executeToolCalls`, before asking for approval,
  partition the batch by `BYOK_V1_TOOL_NAMES` (plus `BYOK_PLAN_TOOL_NAME`);
  turn every non-whitelisted name into a
  `byokToolResultToFunctionCallOutput` with
  `{success:false, message:'<name> is not available in BYOK chats.'}` via
  `appendNotExecutedToolOutputs`, and only dispatch the whitelisted rest.
- Tests to write: `ByokOrchestrator.spec.js` — model returns
  `makeToolCall('call-x','run_script','{...}')` → executor NOT called, a
  `success:false` output mentioning "not available" is appended, loop
  continues and finishes `ready`; mixed batch
  (`run_script` + `create_scene`) → only `create_scene` dispatched; batch
  with only non-whitelisted calls → no approval requested, no executor call.

### [B] Suspend/Stop does not abort the in-flight model request, and a late plain-text answer flips a suspended chat back to "ready"

- Affected: `ByokOrchestrator.js` `runLoop` (417-455, suspension only checked
  at loop top 422 and `executeToolCalls` entry 340-347; `markReady` at
  429-431 has no suspension guard); `ByokClient.js` `sendByokChatCompletion`
  (161-178 — axios POST with no `signal`/CancelToken; timeout 120s at line
  21; plus 2 retries with backoff at 26-28).
- Explanation: when the user hits Stop, `suspend()` (496-499) only sets a
  flag and the status. The HTTP request in flight keeps running to
  completion — up to 120s per attempt ×3 attempts with backoff (~6 min worst
  case) — spending the user's paid tokens on an endpoint they explicitly
  stopped. When the response finally arrives: if it is a tool-call batch the
  design handles it (not-executed outputs, 340-347); but if it is a
  plain-text answer, `markReady()` (429-431) overwrites the `suspended`
  status the user just saw, flipping the chat back to `ready` with no user
  action. Phase4 step 4.2 only requires "the loop checks between tool
  executions", but the audit's abort priority (in-flight fetch) is unmet and
  the status flip is visibly wrong.
- Proposed solution: thread an `AbortController` from the orchestrator
  through `ByokChatCompletionOptions` (add `signal`), abort it in
  `suspend()`; treat the abort rejection as a silent stop (keep
  `suspended`). Independently, guard the plain-text exit:
  `if (pendingToolCalls.length === 0) { if (isSuspended) return; markReady(); return; }`
  (recording the arrived answer is fine; the status should stay
  `suspended`).
- Tests to write: `ByokOrchestrator.spec.js` — (1) suspend mid-model-call,
  resolve with a **text** answer → status stays `suspended`, answer recorded;
  (2) `suspend()` aborts: assert the client was called with an options
  object exposing a signal and that resolving/aborting it does not re-mark
  ready; (3) existing "does not execute an arrived batch when suspended"
  test (312-347) keeps passing.

### [B] Stop pressed while the edit-approval row is open: approving afterwards still executes the modifying batch

- Affected: `ByokOrchestrator.js` `executeToolCalls` (334-360): the
  `isSuspended` check runs only *before* `await onRequestEditApproval`
  (340-347 vs 349-360); container wiring makes both UI actions live at once
  (`AskAiEditorContainer.js:681-701` approval promise,
  `1476-1491` `onStop` → `suspendAiRequestWithByokSupport`; the Stop button
  is visible because `isWorking` includes `status === 'working'`,
  `AiRequestChat/index.js:554-563, 763`).
- Explanation: during the approval pause the BYOK chat status is still
  `working`, so `onStop` passes `getHasWorkInProgress()` and calls
  `suspend()` → `isSuspended = true`, status `suspended`. The approval row is
  still on screen; if the user then clicks Approve,
  `onRequestEditApproval` resolves `true` and `executeToolCalls` proceeds to
  run the modifying calls with no re-check — project edits execute *after*
  the user pressed Stop, the outputs are appended while the status says
  `suspended`, and the next loop-top check silently exits. Symmetrically,
  the container's leave-chat path resolves the approval with `false`
  (`AskAiEditorContainer.js:1522-1527`), so only the Stop path has this
  race.
- Proposed solution: re-check `isSuspended` right after the approval await:
  `if (!approved) {...}` then `if (isSuspended) { appendNotExecutedToolOutputs(...); persistUpdate(); return false; }`.
  (Optionally also re-check after `await executeFunctionCalls` before
  appending/continuing — appending outputs is harmless, but skipping the
  `onFunctionCallsExecuted` side effects (auto-opening scenes,
  `AskAiEditorContainer.js:703-719`) after a stop is more correct.)
- Tests to write: `ByokOrchestrator.spec.js` — model returns a modifying
  call; make `onRequestEditApproval` a deferred promise; call
  `orchestrator.suspend()`; resolve the approval with `true`; assert
  `executeFunctionCalls` was NOT called, status stays `suspended`, and
  not-executed outputs were appended.

### [B] Per-model / server-reported context windows are ignored — the loop guard and the context bar use only the global fallback

- Affected: `ByokOrchestrator.js` `recordAssistantTurn` (259-262) passes
  `settings.contextWindowTokens` to `contextStatsFromUsage`; the guard reads
  that stat (436-445). `ByokTypes.js:14-24, 37-44` documents
  `contextWindowByModel` as taking precedence; `ByokSettingsTab.js:216-243`
  writes per-model values; `ByokModelsCache.js:133-156`
  (`resolveContextWindowTokens`) implements the full fallback chain
  (server-reported → per-model → global → 8192) but has **no production
  caller** (grep: definition only).
- Explanation: a user who sets 128k for their model in the BYOK tab (or
  whose server reports `context_length`) still gets the ratio computed
  against the global value (default 8192). The guard then aborts the chat
  with `byok-context-full` at ~7.4k tokens and the "Chat context" bar shows
  a wildly wrong ratio — for large-context models this breaks normal
  conversations (severity: realistic, hits anyone who configures the
  per-model field the settings tab explicitly offers).
- Proposed solution: resolve the window once at orchestrator construction
  (`resolveContextWindowTokens(settings, getCachedByokModels(baseUrl) find
  model, settings.modelName)` or at minimum
  `settings.contextWindowByModel[settings.modelName] ||
  settings.contextWindowTokens || 8192`) and use that value in
  `recordAssistantTurn`.
- Tests to write: `ByokOrchestrator.spec.js` — settings with
  `contextWindowTokens: 8192` and
  `contextWindowByModel: { 'test-model': 100000 }`, one tool round with
  usage 9000 tokens → loop continues (currently fails with
  `byok-context-full`); `contextStats.usedPercentage` computed against
  100000.

### [B] The plan tool's output never renders: BYOK chat records have no `mode`, and the plan UI is gated on `mode === 'orchestrator'`

- Affected: `ByokTranscript.js` `createByokAiRequestShell` (155-170 — no
  `mode` field), used by `ByokChatStore.js:42`; rendering gate at
  `AiRequestChat/ChatMessages.js:514-534` (`aiRequest.mode ===
  'orchestrator'` for `orchestrator_plan` items); the orchestrator's claim
  at `ByokOrchestrator.js:294-300` that the output is "the `plan` output the
  chat UI's plan component renders".
- Explanation: `appendPlanToolOutput` produces exactly the
  `{success:true, plan:{tasks}}` shape the plan component consumes, and the
  prompt actively tells the model to use `create_or_update_plan` first for
  multi-step requests (`ByokPrompts.js:52-53`). But since the shell never
  sets `mode: 'orchestrator'`, ChatMessages never creates the
  `orchestrator_plan` item — the user sees a raw `function_call_output` JSON
  blob instead of the plan UI. The server flow sets `mode: 'orchestrator'`
  at creation (`AskAiEditorContainer.js:873`). The plan feature — the reason
  the orchestrator owns this tool at all (worklog A4) — is effectively
  invisible in every BYOK chat.
- Proposed solution: set `mode: 'orchestrator'` in
  `createByokAiRequestShell` (and thread it through `ByokChatStore`),
  verifying the side effects of the mode gates (feedback banner
  `AiRequestChat/index.js:701-707` — `onSendFeedback` is profile-guarded, so
  decide whether to keep it for BYOK).
- Tests to write: `ByokChatStore.spec.js` / `ByokTranscript` spec — the
  created record has `mode === 'orchestrator'`; an integration-style
  assertion (or manual QA step) that a `function_call_output` containing
  `plan.tasks` renders an `orchestrator_plan` item for a BYOK-shaped
  request.

### [C] Non-`finished` executor results (`status: 'aborted'`) are silently dropped — dangling `tool_calls` corrupt the OpenAI transcript and break retry

- Affected: `ByokOrchestrator.js:397-405` — destructures only
  `functionCallOutputs` from
  `getFunctionCallOutputsFromEditorFunctionCallResults` and discards
  `hasUnfinishedResult`; producer semantics at `AiRequestUtils.js:380-413`
  (non-`finished` → `hasUnfinishedResult`, filtered out);
  `EditorFunctionCallRunner.js:259-262` emits `status:'aborted'`; the server
  flow explicitly handles this case (`AiGeneration/Utils.js:628-633`,
  discards the whole batch).
- Explanation: if any result comes back `aborted` (today only
  `generate_events` sets it — `EditorFunctions/index.js:5849-5851` — which
  is excluded from v1, but `status:'working'` results would behave the
  same), that `call_id` gets **no** `function_call_output`. The assistant
  message keeps a `tool_call` with no matching tool message, so the next
  `buildMessagesForModel` sends a protocol-invalid conversation (most
  OpenAI-compatible endpoints reject it with 400) and `retryAfterError`
  replays the same invalid transcript forever. The BYOK loop dropped the
  very signal (`hasUnfinishedResult`) the server flow uses to detect this.
- Proposed solution: in `executeToolCalls`, read `hasUnfinishedResult`; if
  true, append a failure output for every pending call of the batch that
  has no result (or refuse the whole batch like the server flow does),
  mirroring `appendNotExecutedToolOutputs` with a "was aborted before
  finishing" message.
- Tests to write: `ByokOrchestrator.spec.js` — executor returns
  `[{status:'aborted', call_id:'call-1'}]` → a `function_call_output` for
  `call-1` is appended (success:false), the second model call's messages
  keep the assistant `tool_calls` followed by a `tool` message, chat ends
  `ready`.

### [C] Context guard silently disappears when the endpoint omits `usage` — only the 20-round cap remains

- Affected: `ByokOrchestrator.js:436-445` (guard keyed on
  `aiRequest.contextStats`), `253-263` (`recordAssistantTurn` only sets
  stats `if (usage)`), `ByokUsageTracker.js:11-25`
  (`usageFromResponse` returns null unless **all three** token fields are
  numbers).
- Explanation: some proxies omit `usage` (documented at
  `ByokTypes.js:88-90`, `ByokUsageTracker.js:7-10`) or report only
  `prompt_tokens`. Then `contextStats` stays null, `usedPercentage` is 0 and
  the `MAX_BYOK_CONTEXT_RATIO` guard never fires; the only runaway
  protection left is the round cap while every round re-sends a growing
  history — the conversation then dies with an unclassified endpoint error
  when the real window overflows. Phase4's AC ("context-ratio cap both stop
  the loop with a clear status") is only conditionally met.
- Proposed solution: when `usage` is missing for N consecutive rounds
  (e.g. always), fall back to a conservative estimate (e.g. char-count
  heuristic of `buildMessagesForModel().length / 4`) or at least surface a
  one-line note in `contextStats`/docs; minimum viable fix: document the
  degradation and add a test pinning the current behavior.
- Tests to write: `ByokOrchestrator.spec.js` — responses without `usage`
  through 20 tool rounds → loop still stops at the round cap (documents the
  fallback); with partial usage (`prompt_tokens` only) → treated as
  missing.

### [C] BYOK error codes are unmapped in the chat error UI and user-visible strings are hardcoded English (i18n contract)

- Affected: `ByokOrchestrator.js` `markError` calls (440-444, 451-454),
  `appendNotExecutedToolOutputs` messages (341-344, 352-357 — these render
  in the chat's tool output rows);
  `AskAiEditorContainer.js:639-645` (`byok-missing-key`);
  rendering at `AiRequestChat/AiRequestErrorRow.js:53-61, 169-173` —
  unknown codes get the generic `<Trans>The AI ran into an error</Trans>`,
  the message is only a **tooltip** on the raw code chip.
- Explanation: the carefully written messages ("The conversation is close
  to the context window limit. Start a new chat to continue.", "…maximum
  number of tool rounds…") never surface as text; the server analogues
  `context-too-large` / `repeated-tool-call-loop` map to precise
  `<Trans>`-ed headings while `byok-context-full` /
  `byok-too-many-tool-rounds` show a generic heading plus a code chip.
  AGENTS.md/styleguide §5 requires Lingui for every user-visible string;
  these are plain English (report.md §3.8 sets the Lingji msgid convention).
- Proposed solution: map the BYOK codes in `getAiRequestErrorKind`
  (`byok-context-full` → the existing `too-large` wording,
  `byok-too-many-tool-rounds` → `stuck`), and route the orchestrator's
  user-visible messages through i18n (they are non-JSX; pass `i18n` or use
  Lingui `t` macro like `AskAiEditorContainer.js:1344-1345` does).
- Tests to write: `ByokOrchestrator.spec.js` — none needed for the mapping
  itself (it lives in `AiRequestErrorRow`), but add a case asserting the
  exact codes emitted (`byok-context-full`,
  `byok-too-many-tool-rounds`) so the mapping can't drift.

### [C] `ByokChatStore.listByokChats` / `archiveByokChat` have no production caller — a deselected BYOK chat is unreachable for the rest of the session

- Affected: `ByokChatStore.js:73-86` (both exports; grep: only the spec
  uses them); `AskAiEditorContainer.js` — no `listByokChats`/`archiveByokChat`
  import (81-85 imports only create/get/subscribe/update), and
  `onStartOrOpenChat` clears the selection (`1322-1324`
  `setSelectedByokChatId(null)`).
- Explanation: the Ask AI history sidebar lists server summaries only, so
  once the user switches to another chat (or starts a new one), a BYOK chat
  can never be re-selected — even mid-run ("continue working in
  background", `AskAiEditorContainer.js:1552-1554`): its orchestrator keeps
  executing tools and spending tokens on a conversation the user can no
  longer see or stop. The store API was built for exactly this (Phase4 step
  4.5) but the wiring is missing; chats also accumulate in the module Map
  forever (no archive path). Within-session re-entry is not the deferred
  "persistence" item (that is about localStorage).
- Proposed solution: list BYOK chats in `AskAiHistory` (oldest first, via
  `listByokChats` + `subscribeByokChats`), and call `archiveByokChat` +
  `orchestrator.suspend()` on the container's archive action.
- Tests to write: container-level wiring is manual-QA territory, but add a
  `ByokChatStore.spec.js` case that `updateByokChat` after
  `archiveByokChat` is ignored (guards the planned suspend-on-archive
  path).

### [D] A throw from the executor (or `onFunctionCallsExecuted`) after tool calls were recorded leaves dangling `tool_calls` and reports a misleading endpoint error

- Affected: `ByokOrchestrator.js` `runWithUserMessage` catch (468-473) —
  `classifyByokError` on a local `Error` yields kind `unknown` with the
  generic endpoint message (`ByokErrors.js:172`); `executeToolCalls` has no
  try/catch around `executeFunctionCalls` (376-391) or
  `onFunctionCallsExecuted` (408-413).
- Explanation: per-call failures are contained by
  `EditorFunctionCallRunner.js:289-296`, but the seam can still throw
  outside that net — e.g. `flushAccumulatedOutsideEditorChanges` runs in a
  `finally` (`ByokSeam.js:230-232`) and a throwing editor callback replaces
  the return value, or `onOpenLayout` inside the container's
  `onFunctionCallsExecuted` (`AskAiEditorContainer.js:703-719`) throws. The
  transcript then ends with an assistant `tool_calls` message and no
  outputs; status becomes `error` with "The endpoint returned an unexpected
  error" (the original message is discarded), and `retryAfterError` replays
  the protocol-invalid conversation (see the C above for the wire
  consequence).
- Proposed solution: wrap the executor call and the callback in
  `executeToolCalls`; on throw, `appendNotExecutedToolOutputs(functionCalls,
  'The tool execution crashed: ' + message)` and continue the loop (or at
  least keep the transcript valid); include `error.message` in the
  classified fallback for non-ByokError throwables.
- Tests to write: `ByokOrchestrator.spec.js` — executor rejects → a
  failure output is appended for the call, loop continues to a `ready`
  answer; `onFunctionCallsExecuted` throws → chat still ends consistently
  and the transcript stays protocol-valid.

### [D] `finish_reason` is ignored — a truncated (`length`) or content-filtered turn is treated as a final answer

- Affected: `ByokOrchestrator.js:427-432` (stop condition is solely "no
  pending tool calls"); `ByokTranscript.js:29-66` (maps `choices[0]`
  regardless of `finish_reason`).
- Explanation: a response with `finish_reason: 'length'` can carry a
  half-finished `tool_calls` entry (arguments JSON cut mid-string) or empty
  content; the loop either runs the truncated call (fails, model recovers —
  acceptable) or, with empty content, marks the chat `ready` with a blank
  assistant message. `content_filter` similarly ends the chat as a normal
  answer with no indication. The client only validates `choices` is a
  non-empty array (`ByokClient.js:180-192`), not `choices[0].message`.
- Proposed solution: check `choice.finish_reason` in
  `byokResponseToAssistantMessage`'s caller: on `'length'` with pending
  truncated tool calls, emit a failure output telling the model its call
  was cut; on empty content + non-`stop` reason, `markError` with a clear
  code. Also validate `choices[0].message` shape in the client.
- Tests to write: `ByokOrchestrator.spec.js` — response with
  `finish_reason:'length'`, empty content → not silently `ready`;
  `ByokClient.spec.js` — `choices:[{}]` rejected.

### [D] A second message sent while the loop is running is silently dropped (no queue)

- Affected: `ByokOrchestrator.js:457-461` (`if (isRunning) { console.info…
  return; }`); UI mostly prevents it (`AiRequestChat/index.js:554-563, 768`
  disables the input while `status === 'working'`), but the BYOK branch of
  `onSendMessage` resets the input field immediately
  (`AskAiEditorContainer.js:970-983`) before awaiting.
- Explanation: in any race where the input is briefly enabled (status
  flips between rounds during `persistUpdate` churn, or a future UI
  change), the user's text is consumed — cleared from the field — and
  discarded with only a `console.info`. The server flow has the same shape
  but queues via the backend.
- Proposed solution: either queue the message (run it when the current
  loop ends) or keep it in the input field and surface a transient "still
  working" signal instead of dropping it.
- Tests to write: `ByokOrchestrator.spec.js` — call `sendUserMessage`
  twice without awaiting the first; assert the second message is either
  queued and processed after the first completes, or explicitly rejected —
  and never silently lost.

### [D] Chat-level state is frozen at orchestrator creation (`hasOpenedProject`, project closure)

- Affected: `ByokOrchestrator.js` `hasOpenedProject` (used in the system
  prompt at 211-214, set once from `AskAiEditorContainer.js:656`); the
  container's `getProjectUserContent` closure captures the `project` of the
  creation render (`AskAiEditorContainer.js:658-664`).
- Explanation: closing or switching the project mid-chat leaves the prompt
  asserting "a snapshot is attached / inspect before editing" while tools
  now answer "No project opened" (`EditorFunctionCallRunner.js:122-131`);
  conversely opening a project in a no-project chat never upgrades the
  prompt. Worse, the frozen closure keeps reading the old `gdProject`
  object on the next `sendUserMessage`, which may already be destroyed
  (native object) and throw inside `getSimplifiedProject`.
- Proposed solution: make `hasOpenedProject` a getter option
  (`hasOpenedProject: () => boolean`) resolved per `runWithUserMessage`,
  and have the container's `getProjectUserContent` read the current project
  from a ref rather than the closure.
- Tests to write: `ByokOrchestrator.spec.js` — flip a `hasOpenedProject`
  getter between messages → second model call's system prompt swaps to the
  no-project section.

### [D] The Retry button silently no-ops for the missing-API-key error chat

- Affected: `AskAiEditorContainer.js:637-647` — the missing-key path sets
  the chat to `error` and returns **before** any orchestrator is created or
  registered (`byokOrchestratorsRef.current.set` only at 721);
  `onRetryByokChat` (1495-1504) does nothing when no orchestrator exists;
  the UI offers Retry because `canRetryAiRequest` is true for status
  `error` with no `retriedAfterMessagesCount` (`AiRequestUtils.js:45-50`).
- Explanation: the user clicks Retry and nothing happens — no feedback, no
  re-read of the key store (which is what a retry should do here: the user
  may just have saved a key in Preferences).
- Proposed solution: in `onRetryByokChat`, when no orchestrator is
  registered but the chat is in `error`, re-run the `startByokChat` body
  (key reload + orchestrator creation + replay) or at minimum surface a
  "send a new message" hint.
- Tests to write: container manual-QA item; a `ByokChatStore`-level test is
  not applicable — record in the Phase4 manual checklist.

### [D] Test gaps in the three specs (abort/round-cap/error paths are covered, but several risky paths are not)

- Affected: `ByokOrchestrator.spec.js` — no test for suspend-during-approval
  (would fail today, see the B above), executor rejection, missing `usage`
  (guard-off behavior), a response containing text **and** tool_calls in
  one message, `onFunctionCallsExecuted` being invoked with
  `createdSceneNames`, and the suspended→ready flip. `ByokPrompts.spec.js`
  — no case for a tool description without `. ` (the
  `firstSentenceOf` full-description fallback, `ByokPrompts.js:25-29`).
  `ByokChatStore.spec.js` — no test that `updateByokChat`'s array copy
  actually isolates the stored record from later mutations of the passed
  `output` array (the documented intent, `ByokChatStore.js:54-57`).
- Explanation: the specs are otherwise strong (round cap at 177-193,
  context guard at 406-430, tool-error recovery at 195-234, refused-edit
  suspension at 236-275, mid-model-call suspension at 312-347, plan tool at
  484-540, retry at 542-561), but the untested paths are precisely the
  ones where this audit found defects.
- Proposed solution: add the listed cases alongside the fixes above.
- Tests to write: see each case above.

### [E] Minor polish

- `ByokOrchestrator.js:492-495` — `startNewChat` and `sendUserMessage` are
  identical (documented; acceptable for v1).
- `ByokOrchestrator.js:418-419` + `196-198` — `appendUserMessage` sets
  `working` and `runLoop` sets it again immediately (double
  `persistUpdate`/notification on every message).
- `ByokOrchestrator.js:207, 236-237` — `Array<any>` / `chatOptions: any`
  lose Flow precision where `ByokChatMessage[]` /
  `ByokChatCompletionOptions` exist.
- `ByokErrors.js:172` — the `unknown` fallback discards the original
  error's message, hampering debugging of local (non-endpoint) failures.
- `usageTracker.getTotals` is never read in production
  (`AskAiEditorContainer.js:702` creates the tracker) — matches Phase4's
  deferred "exact token row" nice-to-have; fine, just noting it is wired
  but unused.
- `ByokChatStore.js:74` — `listByokChats` filters on `archivedAt` which
  nothing ever sets (archive deletes the entry); harmless dead condition.

## Checks that passed

- **Round cap exists, is a named constant, and is tested**:
  `MAX_BYOK_TOOL_ROUNDS = 20` (`ByokOrchestrator.js:46`), enforced by the
  loop bound (421) with a clear error (451-454), asserted in
  `ByokOrchestrator.spec.js:177-193` (exactly 20 model calls, status
  `error`, code `byok-too-many-tool-rounds`).
- **Context-ratio guard exists and is tested** (modulo the B/D findings
  above): `MAX_BYOK_CONTEXT_RATIO = 0.9` (`ByokOrchestrator.js:52`),
  checked *before* executing more tools (436-445), tested at
  `ByokOrchestrator.spec.js:406-430` including "no further tool executed".
- **Tool failures are fed back, not thrown** — per-call containment in
  `EditorFunctionCallRunner.js:146-162, 289-296`; the loop appends
  `success:false` outputs and continues (`ByokOrchestrator.js:393-405`),
  asserted at spec 195-234 (invalid-JSON args recover to `ready`).
- **Refused edit suspends with a protocol-valid transcript** (an output for
  every call of the batch, including the non-modifying ones):
  `ByokOrchestrator.js:349-359`, spec 236-275; resume keeps
  `tool_calls` → `tool` ordering (spec 277-310).
- **Batch arriving after a mid-model-call suspension is not executed**:
  `ByokOrchestrator.js:336-347`, spec 312-347.
- **Plan tool interception is correct against the registry**: the
  client-side `create_or_update_plan` is a permanent failure stub
  (`EditorFunctions/index.js:8600-8609`), so owning it in the orchestrator
  (301-326, invalid-args → `success:false` at 306-318, tested at spec
  519-540) is the right call — only its *rendering* is broken (B above).
- **All 11 whitelisted tool names exist in the registry**
  (`EditorFunctions/index.js:9029-9076`) and the whitelist↔schema↔registry
  sync is test-enforced (`validateByokToolSchemas`,
  `ByokToolSchema.js:498-544`).
- **No double execution via the chat UI**: BYOK chats are excluded from
  `aiRequestsToProcess` (`AskAiEditorContainer.js:1255-1271`) so
  `useProcessFunctionCalls` never picks them up, and
  `editorFunctionCallResults` is nulled for BYOK (1986-1994).
- **History array aliasing between rounds is handled**: the orchestrator
  mutates its own `aiRequest.output` and every mutation path funnels
  through `persistUpdate` (168-170), while the store replaces the record
  with a shallow copy per update (`ByokChatStore.js:59-68`) — renders are
  always post-notification snapshots; messages are treated as immutable.
- **Concurrent invocation of one orchestrator is guarded** (`isRunning`,
  `ByokOrchestrator.js:457-461, 476-489`); separate chats get separate
  orchestrators (`byokOrchestratorsRef`, container 551-553, 721).
- **No prompt-injection via placeholder substitution**: the system prompt
  interpolates nothing user-controlled (`ByokPrompts.js:60-76`); the
  project snapshot is folded exactly once into the last user message
  (`ByokOrchestrator.js:219-233`), never accumulated per round — no
  unbounded prompt growth beyond transcript growth itself.
- **System prompt matches Phase4 step 4.1's required structure** (role /
  tool list from schemas / project-context variants / output rules / plan /
  single-agent), and the `byok-v1`→`byok-v2` bump is documented in the
  worklog.
- **ChatStore is session-only by design** (`BYOK_CHAT_PERSISTENCE_ENABLED
  = false`, `ByokChatStore.js:15-18`) — so localStorage quota, JSON.parse
  corruption recovery and persisted-PII concerns are N/A; the API key never
  enters chat records (it lives only in the orchestrator's `connection`,
  sent as an Authorization header, `ByokClient.js:168-175`), so no key/PII
  leakage into transcripts.
- **Style contract**: all six files carry `// @flow`; options/store types
  are exact `{| |>`; no nested loops or nested ifs in the three source
  files (guard clauses + early returns throughout); `updateByokChat`
  ignores unknown ids without notifying (tested, spec 63-79).

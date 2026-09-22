# Audit 2026-09-21 — agent: schema

## Files assigned

1. `newIDE\app\src\AiGeneration\Byok\ByokToolSchema.js`
2. `newIDE\app\src\AiGeneration\Byok\ByokToolSchema.spec.js`
3. `newIDE\app\src\AiGeneration\Byok\ByokTranscript.js`
4. `newIDE\app\src\AiGeneration\Byok\ByokTranscript.spec.js`
5. `newIDE\app\src\AiGeneration\Byok\ByokTypes.js`
6. `newIDE\app\src\AiGeneration\Byok\ByokTypes.spec.js`
7. `newIDE\app\src\MainFrame\Preferences\PreferencesProvider.js` (BYOK lines only)

All 7 files read in full (working-tree state, not git HEAD). Every tool schema was
cross-checked against its implementation in
`newIDE\app\src\EditorFunctions\index.js` (argument names, required vs optional,
enum values), and the transcript layer against
`newIDE\app\src\Utils\GDevelopServices\Generation.js` plus its consumers
(`AiRequestUtils.js`, `AiRequestChat/*`, `ByokOrchestrator.js`).

## Issues found

### [C] put_2d_instances `brush_position` description contradicts the implementation ("the scene center when omitted" is actually a failure)

- Affected: `ByokToolSchema.js:369-371` (`brush_position` description); related
  minor inaccuracy at `ByokToolSchema.js:381-383` (`new_instances_count`
  "(1 when omitted)").
- Explanation: The schema tells the model the brush position defaults to the
  scene center when omitted. The implementation does the opposite for every
  placement path: `EditorFunctions\index.js:3875-3884` returns
  `makeGenericFailure('A valid brush_position is required …')` whenever
  `brush_position` is missing/invalid, unless the brush is `"none"` with zero new
  instances (the fallback `[0, 0]` at `index.js:3887` is unreachable otherwise,
  per its own comment). The "scene center" wording survives only in the legacy
  display text of `renderForEditor` (`index.js:3545-3551`). A model that wants
  center placement (a common request — "put the player in the middle") will
  deliberately omit `brush_position` per the schema and get a guaranteed failed
  round; the failure message does tell it what to do, so it self-heals at the
  cost of a wasted turn each time (and retry-loop risk on weaker models).
  Likewise `new_instances_count` "(1 when omitted)" is only true when no
  `existing_instance_ids` are given: omitted + existing ids becomes 0
  (`index.js:3840-3845`), not 1.
- Proposed solution: Reword the descriptions to match the guards:
  `brush_position` → 'Position of the brush, as "x,y" in pixels. Required when
  creating instances (point/line/grid/random_in_circle brushes); only the "none"
  brush modifying existing instances may omit it.'
  `new_instances_count` → 'Number of instances to create. Defaults to 1 when
  creating without `existing_instance_ids`; omitted or 0 with
  `existing_instance_ids` only moves/transforms them.'
- Tests to write: `ByokToolSchema.spec.js` — a `put_2d_instances` spot check in
  the style of the existing `create_scene` one (spec:91-103): assert
  `required` equals `['scene_name', 'layer_name', 'brush_kind']`, assert the
  exact 16-entry property key set, and assert the `brush_position` description
  does not contain "scene center when omitted" (documentation-as-code guard).
  Fails on the current text, passes after the rewording.

### [C] validateByokToolSchemas failure branches are never tested; the "catches a rename" test does not test the validator

- Affected: `ByokToolSchema.spec.js:15-23` (test "catches a whitelisted name
  that disappears from the registry"); validator logic at
  `ByokToolSchema.js:458-544`.
- Explanation: That test only re-asserts `editorFunctions[name]` is defined for
  each whitelisted name — the exact fact the first test already proves via
  `validateByokToolSchemas()` returning `[]` (its own comment admits it checks
  "a copy of the behavior"). No test feeds the validator a bad input, so its
  four problem branches (registry miss `ByokToolSchema.js:502-506`, empty
  description `507-509`, unknown property type `471-477`, whitelist/schema set
  mismatch `528-537`) have zero negative-path coverage. A refactor that
  silently drops or inverts one of these checks keeps the suite green — and this
  validator is the project's designated upstream-rename guard (its doc comment,
  `ByokToolSchema.js:517-523`).
- Proposed solution: Make the check testable without changing runtime call
  sites: let `collectSchemaProblems` (or the whole `validateByokToolSchemas`)
  accept an optional registry parameter defaulting to the imported
  `editorFunctions`. Then test each failure mode with a synthetic registry /
  synthetic schema list.
- Tests to write: `ByokToolSchema.spec.js` — schema whose name is absent from a
  stub registry → one problem naming the tool; schema with a property of type
  `'strng'` (including one nested inside `items`) → problem; schema with an
  empty description → problem; whitelist entry with no schema (and the
  count-mismatch message) → problem. All fail before the refactor (cannot be
  expressed), pass after.

### [C] Schema↔implementation sync is pinned for only one of 11 tools (create_scene); the highest-risk tools are unasserted

- Affected: `ByokToolSchema.spec.js:91-103` (the only per-implementation spot
  check); `ByokToolSchema.js:4-12` (header claims each schema was checked
  against the implementation's `SafeExtractor.extract…` calls).
- Explanation: A single misspelled property name in the BYOK-owned schemas is
  exactly the "silent breakage" this file is most at risk of — the model sends
  an argument the handler then ignores (`SafeExtractor.extract…` returns
  null/default), `validateByokToolSchemas` still returns `[]` (name is in the
  registry, property types are valid), and the tool mis-executes with no test
  failing. The spec pins only `create_scene` (4 properties). The riskiest
  schemas get no pin: `put_2d_instances` (16 properties, reads spread over
  `index.js:3592-3633`, `3826-3830`, `4073-4087`), `add_or_edit_variable`
  (nested op objects, `index.js:7944-7983`), `create_or_replace_object`
  (11 properties, `index.js:1098-1132`).
- Proposed solution: Add spot checks mirroring the `create_scene` test for the
  three tools above: exact `required` array + exact sorted property key set
  (+ nested op keys for `add_or_edit_variable`'s `variables` items:
  `variable_name_or_path`, `value`, `variable_type`, `delete_this_variable`).
- Tests to write: `ByokToolSchema.spec.js` — the three spot checks above; they
  fail today only if a property is added/renamed wrongly (that is the point:
  they turn any future drift of these sets into a red test instead of silent
  mis-execution).

### [D] create_or_update_plan works only via undocumented orchestrator interception; the file's own header/exclusion logic argues against its presence

- Affected: `ByokToolSchema.js:69-97` (exclusion comment + whitelist) and
  `402-431` (schema); implementation reality at
  `EditorFunctions\index.js:8600-8609` (permanent failure stub: "Unable to
  create or update plan - this is handled server-side.");
  `ByokOrchestrator.js:62, 294-326, 362-368` (client-side interception that
  makes it work).
- Explanation: The header (`ByokToolSchema.js:7-11`) states every schema
  describes "exactly the arguments the `launchFunction` implementations read",
  and the exclusion comment (`:79-81`) drops `read_full_docs`/`search_docs`
  precisely because they are permanent failure stubs. `create_or_update_plan`'s
  registry `launchFunction` is the same kind of stub — it reads no arguments at
  all. It functions in BYOK only because `ByokOrchestrator` intercepts the name
  (`BYOK_PLAN_TOOL_NAME`) before the editor executor and echoes the tasks back
  as a plan output. Nothing in `ByokToolSchema.js` records this coupling, so a
  maintainer applying the file's own exclusion logic (or removing the
  orchestrator special case) silently turns every multi-step chat's first tool
  call into a guaranteed failure — `ByokPrompts.js:53` even instructs the model
  to call it first.
- Proposed solution: One comment line on the whitelist entry, e.g.:
  "`create_or_update_plan`: its registry launchFunction is a server-side stub —
  `ByokOrchestrator` (BYOK_PLAN_TOOL_NAME) executes it client-side; do not
  remove without removing the whitelist entry."
- Tests to write: `ByokToolSchema.spec.js` — assert the plan schema's
  `required` is `['tasks']` and its task items carry `id/title/description/
  status/depends_on` (pins the contract the orchestrator's
  `JSON.parse(arguments).tasks` depends on). No behavioral test needed in this
  file; the interception itself is ByokOrchestrator.spec.js territory.

### [D] Plan task field naming: schema `depends_on` vs internal `AiRequestPlanTask.dependsOn`

- Affected: `ByokToolSchema.js:422-425` (`depends_on`) vs
  `Generation.js:27-33` (`dependsOn: string[]`); tasks echoed verbatim by
  `ByokOrchestrator.js:306-318` into the plan output consumed via
  `getLatestActivePlan` (`AiRequestUtils.js:268-297`).
- Explanation: The model, following the schema, sends `depends_on`; the
  internal Flow type calls it `dependsOn`. Today nothing breaks because
  `OrchestratorPlan.js` only reads `task.id/.title/.description/.status`
  (verified by grep — no `dependsOn` usage anywhere in `AiRequestChat`), and
  the echoed tasks are untyped `JSON.parse` output. But the Flow type
  `AiRequestPlanTask` is silently wrong for BYOK-sourced plans: any future
  consumer of `task.dependsOn` gets `undefined` for every BYOK chat while
  working for hosted chats.
- Proposed solution: Keep snake_case on the wire (consistent with every other
  tool argument) and map once when echoing: in `appendPlanToolOutput`, map
  `depends_on` → `dependsOn` per task (small named helper, guard-clause style).
  Alternatively rename the schema property to `dependsOn` — one naming, no
  mapping — but that breaks the file's snake_case convention.
- Tests to write: `ByokOrchestrator.spec.js` (or a transcript-level test if the
  mapping moves there) — a plan call with `[{"id":"task-1",…},
  {"id":"task-2","depends_on":["task-1"],…}]` produces a plan output whose
  tasks carry `dependsOn: ["task-1"]`; currently would fail (echoes
  `depends_on`).

### [D] getByokSettings hands out the shared DEFAULT_BYOK_SETTINGS object (mutation hazard)

- Affected: `ByokTypes.js:195-197` (both early returns).
- Explanation: The early returns hand callers a reference to the module-level
  default object. A caller that mutates the returned settings — the obvious
  mistake being `settings.contextWindowByModel[modelId] = n` — corrupts the
  default for every later `getByokSettings` call in the session (and
  `initialPreferences` holds the same reference via
  `PreferencesContext.js:463`). Current callers copy before writing
  (`ByokSettingsTab.js:242-243` spreads `contextWindowByModel`), so this is
  latent, not live.
- Proposed solution: Return a fresh object on those paths, e.g.
  `{ ...DEFAULT_BYOK_SETTINGS, contextWindowByModel: {} }`, or a tiny
  `makeDefaultByokSettings()` factory used by both the constant and the early
  returns.
- Tests to write: `ByokTypes.spec.js` — `const a = getByokSettings({}); a.contextWindowByModel['x'] = 1; a.endpointUrl = 'y';` then assert
  `getByokSettings({}).contextWindowByModel` is `{}` and `endpointUrl` is
  `''`. Fails before the fix (second call sees the polluted default), passes
  after.

### [D] Avoidable Flow escapes in ByokTranscript (`Array<any>`, `(byokMessage: any).tool_calls`)

- Affected: `ByokTranscript.js:35` (`const content: Array<any> = [];`) and
  `140-147` (builds `byokMessage` then `(byokMessage: any).tool_calls = …`).
- Explanation: The style contract (styleguide §5 / AGENTS.md rule 5) asks for
  exact Flow types; both `any` escapes are avoidable. The `tool_calls`
  assignment exists only because the object is built before the branch is
  known — returning in two branches types cleanly against the
  `ByokChatMessage` union:
  `if (toolCalls.length === 0) return { role: 'assistant', content: text || null };`
  `return { role: 'assistant', content: text || null, tool_calls: toolCalls };`
  The content array could be typed with the `Generation.js` content-item types
  instead of `Array<any>`.
- Proposed solution: The two-branch return above; type `content` as
  `Array<AiRequestAssistantMessage['content'][number]>` or the equivalent
  local alias.
- Tests to write: none (behavior identical); existing spec
  (`ByokTranscript.spec.js:139-192`) already pins the outputs.

### [D] Transcript replay edge cases untested (reasoning items dropped, multi-part user messages, missing tool_call id)

- Affected: `ByokTranscript.spec.js` (gaps); behavior at
  `ByokTranscript.js:113-125` and `48-58`.
- Explanation: Three replay behaviors are intentional but unpinned:
  (a) an assistant message containing a `reasoning` content item must have it
  dropped on replay (`ByokTranscript.js:121-125` filters `output_text` only) —
  hosted transcripts carry `reasoning` items (`Generation.js:64-71`), and
  accidentally sending reasoning back as content would be a real bug;
  (b) a user message with several `user_request` items joins them with `' '`
  (`:113-118`);
  (c) some OpenAI-compatible servers return `tool_calls[].id` null/empty — the
  mapper then produces `call_id: null` (`:48-58`), which many endpoints reject
  in the follow-up `tool` message; current behavior is undefined/untested.
- Proposed solution: (a)+(b): add the two spec cases. (c): decide a policy —
  e.g. fall back to a generated id (`byok-call-N`) when the server sends none —
  or document BYOK as requiring compliant ids; a test either way.
- Tests to write: `ByokTranscript.spec.js` — assistant message with a
  `reasoning` + `output_text` + `function_call` content replays without the
  reasoning item; user message with two `user_request` items replays as one
  `user` message with the texts joined by a space; (once a policy exists) a
  response whose tool call has no id still round-trips to a valid
  `tool_call_id`.

### [E] Minor doc drift and unused-export nits

- Affected: `ByokTypes.js:137-141` — `isByokReasoningEffort`'s doc comment says
  it is used "to narrow the value of a select field", but
  `ByokSettingsTab.js` iterates `BYOK_REASONING_EFFORTS` directly; the export
  has no consumer outside `ByokTypes.js` (it is tested, so no rule is
  violated — the comment is just stale). `ByokTranscript.js:87` —
  `userRequestToByokMessage(text)` lacks the `options?` parameter sketched in
  `Phase2.md` step 2.8; harmless drift between doc and code.
  `ByokToolSchema.js:27-34` — `'integer'` in `BYOK_PROPERTY_TYPES` is unused
  (explicitly documented as future use — acceptable, noted for completeness).
- Proposed solution: Trim the stale sentence in the `isByokReasoningEffort`
  comment; either note the missing `options` param in the transcript doc
  comment or leave as-is until a consumer needs it.
- Tests to write: none.

## Checks that passed

- **All 11 whitelisted tool names exist in the registry** —
  `EditorFunctions\index.js:9029-9076`: `describe_instances` (:9046),
  `inspect_variables` (:9058), `read_scene_events` (:9049),
  `read_game_project_json` (:9069), `create_scene` (:9052),
  `create_or_replace_object` (:9032), `add_behavior` (:9039),
  `change_behavior_property` (:9045), `add_or_edit_variable` (:9057),
  `put_2d_instances` (:9047), `create_or_update_plan` (:9062).
- **Every schema property name / required list / enum matches the
  implementation's extractions** (per-tool evidence):
  `describe_instances` — `index.js:3342-3344` (`scene_name` required,
  `filter_by_object_name` optional); `inspect_variables` — `index.js:8535-8552`
  + scope resolution `:7998-8033` (5-value scope enum, `instance_id` required
  only for the instance scope — schema describes it as such);
  `read_scene_events` — `index.js:5238`; `read_game_project_json` —
  `index.js:8868-8883` (all 7 args read with these exact names, none required);
  `create_scene` — `index.js:6118-6130` (exactly the 4 schema properties);
  `create_or_replace_object` — `index.js:1098-1132` (all 11, scope enum
  `scene|global` matches `:1163-1165, :1205`); `add_behavior` —
  `index.js:2589-2595` (3 required + optional `behavior_name`);
  `change_behavior_property` — `index.js:3104-3131` + render `:2945-2965`
  (nested `property_name`/`new_value` match); `add_or_edit_variable` —
  `extractVariableOperations` `index.js:7944-7983` (op keys exact;
  `variable_type` enum consistent with `ApplyVariableChange.js:11-17, 171-180`
  — non-primitive values degrade to JSON parsing, never crash);
  `put_2d_instances` — all 16 properties verified across `index.js:3592-3633`,
  `3826-3830`, `4073-4087`; `create_or_update_plan` — `tasks` shape matches
  what `ByokOrchestrator.js:306-318` parses, and the task `status` enum
  (`pending|in_progress|done|voided`) matches `Generation.js:31` and what
  `OrchestratorPlan.js` / `getLatestActivePlan` (`AiRequestUtils.js:290-292`)
  filter on. No mismatched parameter name found anywhere.
- **brush_kind enum is exact** — the six schema values are exactly the kinds
  the implementation branches on (`index.js:3682` erase, `3817` line/grid,
  `3851-3854` placement brushes, `4044` random_in_circle, `4056` point,
  `4062` none; unknown kinds degrade to "none" with a warning, `:4062-4069`).
- **OpenAI tools-API validity** — `toOpenAiToolsFormat`
  (`ByokToolSchema.js:445-456`) emits
  `{type:'function', function:{name, description, parameters}}`; every
  `parameters` is `{type:'object', properties, required}`; only standard
  JSON-Schema keywords are used (`type`, `description`, `properties`,
  `required`, `items`, `enum` — all in OpenAI's supported subset); output is
  JSON-serializable (spec `ByokToolSchema.spec.js:124-128`). No strict mode is
  claimed anywhere, so the absence of `additionalProperties: false` is correct.
- **Transcript shapes match `Generation.js` exactly** — `output_text`
  `{type,status,text,annotations}` vs `Generation.js:72-77`; `function_call`
  `{type,status,call_id,name,arguments}` vs `:39-48`; standalone
  `function_call_output` `{type,call_id,output}` vs `:50-57`; `user_request`
  content vs `:85-96`; the shell (`ByokTranscript.js:155-170`) satisfies
  `AiRequest` (`Generation.js:133-168`) with `status: 'working'` a valid
  `GenerationStatus` (`:15`). `userId: ''` is safe: it is only written when
  creating server-side chats (`AiGeneration\Utils.js:994, 1008, 1104, 1388`),
  never used to filter chat rendering.
- **Compatibility with the transcript helpers is integration-tested** —
  `getFunctionCallsToProcess` (`AiRequestUtils.js:103-163`) exercised in
  `ByokTranscript.spec.js:194-233` (pending call extracted; output present →
  no call returned), matching its call_id-keyed backward scan. The chat UI
  renders BYOK-produced calls safely: `FunctionCallRow.js:157-189` parses
  `arguments` in try/catch and renders nothing for unknown tools or tools
  without `renderForEditor` (so the stub `create_or_update_plan` renders
  nothing in-chat by design, the plan itself coming from
  `getLatestActivePlan`, `AiRequestUtils.js:268-297`).
- **No API key or auth material can reach the transcript** — `ByokTranscript.js`
  only ever maps model content and tool results, never connection data; the
  key lives solely in the `Authorization` header (`ByokClient.js:163-172`,
  with the constraint stated in a comment) and is scrubbed from thrown errors
  (`ByokClient.js:177`). Tool outputs come from `editorFunctions` and are
  capped by the orchestrator's `capToolOutput` (`ByokOrchestrator.js:288, 322`).
- **Response-shape guarding** — `ByokClient.js:181-192` rejects responses
  without a non-empty `choices` array before they reach
  `byokResponseToAssistantMessage`, and that mapper is itself null-safe for
  missing `message`, non-string `content`, and absent `tool_calls`
  (`ByokTranscript.js:32-49`).
- **ByokTypes contracts** — every exported type is exact (`ByokTypes.js:18-25,
  51-54, 60-68, 75-83, 89-103, 109-113, 120-126, 132-135`); every exported
  function/value has tests (`ByokTypes.spec.js` covers `getByokSettings`
  incl. corrupted/partial/localStorage-shaped inputs, `isByokReasoningEffort`,
  `isByokFullyConfigured`, `DEFAULT_BYOK_SETTINGS`); all six settings fields
  are consumed (`ByokSeam.js:29-31` reads via `getByokSettings`/
  `isByokFullyConfigured`; `ByokSettingsTab.js:216-243` uses
  `contextWindowByModel`/`contextWindowTokens`/`reasoningEffort`;
  `ByokOrchestrator.js:242-262` uses `reasoningEffort` and
  `contextWindowTokens`); `MIN/MAX_CONTEXT_WINDOW_TOKENS` and
  `BYOK_REASONING_EFFORTS` are used by `ByokSettingsTab.js`.
- **PreferencesProvider BYOK lines** — import at `:33`, `byok: ByokSettings`
  at `:96` in `getInitialPreferences`' explicitly-typed return; the default
  flows from `initialPreferences` (`PreferencesContext.js:463`) through the
  spread at `PreferencesProvider.js:159`, and
  `loadPreferencesFromLocalStorage` (`PreferencesProvider.js:60-68`) auto-fills
  the `byok` key for existing users. The ~3-line touch is outside Phase1.md's
  two-file budget but is the case Phase1.md step 1.2(6) explicitly sanctions
  ("if Flow complains about the new field in a type annotation somewhere…
  fix by adding the field there; note it in the worklog") and it is recorded in
  `REVIEW\worklog.md` (lines 275 and 283).
- **Whitelist deviation from Phase2.md is deliberate and test-locked** — the
  on-disk whitelist drops `read_full_docs`/`search_docs`/`add_scene_events`
  with a documented rationale (`ByokToolSchema.js:69-84`) and an explicit spec
  guard (`ByokToolSchema.spec.js:43-61`). Notably `add_scene_events` and
  `generate_events` are the same implementation (`index.js:9051, 9073` both
  map to `addSceneEvents`), which Phase2.md's own exclusion of
  `generate_events` already covered — the removal resolves the phase doc's
  internal inconsistency.
- **Style** — all three modules have `// @flow`; no nested ifs and no nested
  loops (flat loops with guard `continue`s only); no user-visible strings, so
  no Lingui obligations (tool descriptions are model-facing English by design,
  matching the server-side convention); module structure matches the
  `AiRequestUtils.spec.js` factory style (`makeToolCall`/`makeResponse`/
  `makeUserRequestMessage`/`makeByokSettings`).

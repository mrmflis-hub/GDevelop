# Audit 2026-09-21 — agent: client

## Files assigned

1. `newIDE\app\src\AiGeneration\Byok\ByokClient.js`
2. `newIDE\app\src\AiGeneration\Byok\ByokClient.spec.js`
3. `newIDE\app\src\AiGeneration\Byok\ByokErrors.js`
4. `newIDE\app\src\AiGeneration\Byok\ByokErrors.spec.js`
5. `newIDE\app\src\AiGeneration\Byok\ByokModelsCache.js`
6. `newIDE\app\src\AiGeneration\Byok\ByokModelsCache.spec.js`

Read in full, plus dependencies verified: `ByokTypes.js`, `Utils\RetryIfFailed.js`,
`ByokSettingsTab.js`, `ByokOrchestrator.js`, `ByokTranscript.js` (response mapping),
`styleguide.md` §5, `REVIEW\Phase2.md`, `newIDE\app\package.json` (axios `^0.18.1`).

## Issues found

### [B] The context-window fallback chain is never used by the production flow

- Affected: `ByokModelsCache.js:133-156` (`resolveContextWindowTokens` — **zero production
  consumers**; grep across `newIDE\app\src` finds only its own spec), and the consumer that
  should call it: `ByokOrchestrator.js:259-262`
  (`contextStatsFromUsage(usage, settings.contextWindowTokens)`).
- Explanation: the orchestrator computes the chat's context stats — which feed both the
  "Chat context" bar and the `MAX_BYOK_CONTEXT_RATIO = 0.9` stop guard
  (`ByokOrchestrator.js:435-447`) — from the raw **global** setting only. The
  server-reported context window (the whole purpose of `extractContextWindowTokens`,
  `ByokModelsCache.js:16-63`) and the per-model values (`contextWindowByModel`,
  `ByokSettings`) never reach it. With the 8192 default and a 32k-window model, the
  conversation is cut off with `byok-context-full` after ~7.4k tokens; with a 4k model the
  overflow guard never triggers. Phase 2's AC "per-model context window:
  server-reported → user-set → 8192 default" (`Phase2.md` §3) holds only at unit-test
  level. (`ByokOrchestrator.js` is outside my assigned files; found by following my
  module's consumers.)
- Proposed solution: in `ByokOrchestrator.recordAssistantTurn`, resolve the window via
  `resolveContextWindowTokens(settings, modelInfo, settings.modelName)` where `modelInfo`
  comes from `getCachedByokModels(settings.endpointUrl)?.find(m => m.id === settings.modelName)`
  (falling back to `null` when never fetched — the function already handles that,
  `ByokModelsCache.js:137-155`).
- Tests to write: `ByokOrchestrator.spec.js` — a turn against a model whose cached info
  reports `contextWindowTokens: 32768` with global setting 8192 produces
  `contextStats.usedPercentage` computed against 32768 (fails today: computed against
  8192); same test with a per-model override in `contextWindowByModel`; and the 0.9 guard
  not firing at 9k tokens when the server reported 32k.

### [C] All BYOK error strings are hardcoded English and bypass Lingui

- Affected: `ByokErrors.js:45-71` (`getGenericMessageForKind`), `ByokClient.js:56-61`
  (`makeNoModelListError`), `ByokClient.js:186-191` ("The endpoint returned an unexpected
  chat response."); rendered raw at `ByokSettingsTab.js:167` and `:202`
  (`setModelsFetchMessage(byokError.message)` / `message: byokError.message`) and
  `ByokOrchestrator.js:470,485` → `aiRequest.error.message`, shown by the existing chat
  error row (`AiRequestChat\AiRequestErrorRow.js:169`).
- Explanation: these are user-visible strings, but they are plain string literals
  with no `<Trans>`/`t` — violating AGENTS.md rule 5 ("Lingui `<Trans>` for every
  user-visible string"). The rest of the settings tab is fully `<Trans>`-ed
  (`ByokSettingsTab.js:156-163,194-198`), so these stand out; non-English users get
  English errors for every BYOK failure with no generic server message.
- Proposed solution: keep `ByokError` machine-readable (kind + the server-provided
  dynamic message when present) and translate the static fallbacks at the display
  boundary: a small `kind → <Trans>` mapping used by the settings tab and the error row;
  server-provided messages stay dynamic strings (pass-through, React escapes them).
- Tests to write: `ByokErrors.spec.js` / a display-mapping spec — the mapping returns a
  translated node for every `ByokErrorKind`; `ByokSettingsTab.spec.js` — a thrown
  authentication error renders the translated node, not the English literal.

### [C] Retry policy amplifies 429s and triples the timeout wait

- Affected: `ByokClient.js:24-28,246-259`, `ByokErrors.js:180-187`
  (`rate-limit` and `timeout` are retryable), consumer `ByokSettingsTab.js:178-191`.
- Explanation: (a) a 429 is retried twice more with fixed 800ms/1600ms backoff,
  ignoring any `Retry-After` header (`error.response.headers` is discarded before
  classification, `ByokErrors.js:152-158`) — with strict providers this burns quota and
  can extend rate-limit windows. Phase2.md:208-210 does endorse retrying rate-limits, so
  this is spec-compliant, but the amplification is real. (b) `timeout` errors are
  retryable with the full per-attempt timeout: the "Test connection" button passes no
  `timeoutMs` (`ByokSettingsTab.js:178-184`), so a hung (but accepting) endpoint leaves
  the button saying "Testing…" for up to 3 × 120s + backoff ≈ 6 minutes with no cancel.
  (c) note only: retrying `network` failures of a non-idempotent POST can double token
  billing if the first request reached the server — accepted practice, worth a comment.
- Proposed solution: plumb `Retry-After` (seconds or HTTP-date) from the axios error
  into `ByokError`, and either skip the automatic retry when it exceeds the backoff
  budget or clamp the first retry delay to it; give the test-connection ping a short
  `timeoutMs` (e.g. 15000, like `/models`).
- Tests to write: `ByokClient.spec.js` (`sendByokChatCompletionWithRetries`) — a 429
  with `Retry-After: 60` is not retried (or delayed accordingly); a timeout-kind error
  is retried (currently untested); `ByokSettingsTab.spec.js` — the ping posts with the
  short timeout.

### [C] No cancellation support: an in-flight request cannot be aborted

- Affected: `ByokClient.js:136-178` and `:210-261` (`ByokChatCompletionOptions`,
  `ByokTypes.js:120-126`, has no signal/cancel token; axios 0.18 `cancelToken` unused),
  consumer `ByokOrchestrator.js` `suspend()`.
- Explanation: the audit checklist asks for AbortController wiring — there is none. The
  orchestrator's suspend only sets a flag checked between rounds, so "stop" leaves the
  current model call running to its 120s timeout (×3 with retries), still spending the
  user's tokens/money, and the assistant turn still lands in the transcript afterwards.
- Proposed solution: add an optional `cancelToken`/abort option to the request, check
  it between retry attempts, classify cancellation as a distinct non-retryable kind
  (e.g. reuse `network` with a "cancelled" message or add `'cancelled'`), and wire it
  from `suspend()`.
- Tests to write: `ByokClient.spec.js` — cancelling the token rejects with the
  classified cancelled error and is not retried; orchestrator suspend during a call
  aborts rather than completing the round.

### [D] Models cache: stale on key change, shared mutable reference, unnormalized key

- Affected: `ByokModelsCache.js:91-109` (module `Map` + accessors),
  `:115-124` (`refreshByokModels` caches the very array it returns),
  consumer `ByokSettingsTab.js:139-140` (cached list shown immediately).
- Explanation: (a) the cache is keyed by base URL only — switching the API key (same
  endpoint, different account) keeps showing the previous key's models until an explicit
  re-fetch; (b) `cacheByokModels` stores the caller's array by reference and
  `refreshByokModels` returns the same array it caches, so any consumer mutation (sort
  in place, push) corrupts the cache — the safety comment at `:86-90` ("only ever holds
  replaceable copies") overstates what the code guarantees; (c) `https://host/v1` and
  `https://host/v1/` are distinct cache entries for one endpoint (the client normalizes
  the URL, the cache does not).
- Proposed solution: cache a defensive copy (`models.slice()`), key on the normalized
  base URL, and add `clearByokModels()` (or key invalidation) used when the stored key
  changes.
- Tests to write: `ByokModelsCache.spec.js` — mutating the array returned by
  `refreshByokModels` does not change `getCachedByokModels`; caching under
  `'https://h/v1'` is visible under `'https://h/v1/'`.

### [D] `fetchByokModels` is dead production code duplicating `normalizeByokModels`

- Affected: `ByokClient.js:115-128`; grep shows no production import (only
  `ByokClient.spec.js` and comments).
- Explanation: after the `fetchRawByokModels` refactor, `refreshByokModels` bypasses it
  (`ByokModelsCache.js:120`). It re-implements the entry filtering of
  `normalizeByokModels` (`ByokModelsCache.js:70-84`) with silently different behavior —
  no sorting, context window always `null` — a divergence trap for the next consumer.
- Proposed solution: delete `fetchByokModels` and its describe block (Phase2 step 2.2
  mandated it, but step 2.5's `refreshByokModels` superseded it), or reimplement it as
  `normalizeByokModels(await fetchRawByokModels(...))` so there is one mapping.
- Tests to write: none beyond removing/redirecting the existing block; if kept, a test
  asserting its output is sorted like the cache's.

### [D] Response validation is shallower than the declared Flow type

- Affected: `ByokClient.js:180-194` (only `choices` non-empty is checked) vs
  `ByokTypes.js:89-103` (`ByokChatCompletionResponse` promises `choices[0].message`
  with `role`/`content`, optional typed `tool_calls`).
- Explanation: a response like `{ choices: [{}] }` or a tool call entry without
  `function` passes validation; `ByokTranscript.js:48-57` then reads
  `toolCall.function.name` unguarded and crashes the orchestrator loop's catch. The
  transcript guards `message` itself (`ByokTranscript.js:32-38`) but trusts `tool_calls`
  element shapes.
- Proposed solution: extend the guard in `sendByokChatCompletion` — `choices[0].message`
  must be an object, and each `tool_calls` entry must have string `id` and
  `function.name` — throwing the existing classified `unknown` error otherwise.
- Tests to write: `ByokClient.spec.js` — `{ choices: [{}] }` and
  `{ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{}] } }] }`
  throw the `unknown` ByokError (today they are returned and explode downstream).

### [D] `buildEndpointUrl` ignores whitespace around the base URL

- Affected: `ByokClient.js:37-40`.
- Explanation: the trailing-slash trim is anchored at `$`; a base URL pasted with a
  trailing newline after the slash (`'https://host/v1/\n'`) is not trimmed, and after
  the browser's URL parser strips the newline the request goes to
  `https://host/v1//models` — a 404 on strict servers, surfaced as an opaque
  `not-found`. The settings tab stores the URL untrimmed
  (`ByokSettingsTab.js:282`), and `isByokFullyConfigured` only trims its own copy
  (`ByokTypes.js:230`), so the app regards such an endpoint as validly configured.
- Proposed solution: `baseUrl.trim().replace(/\/+$/, '')` in `buildEndpointUrl`.
- Tests to write: `ByokClient.spec.js` `buildEndpointUrl` block —
  `'  https://host/v1/ '`, `'https://host/v1/\n'` → `'https://host/v1/models'`.

### [D] Styleguide §5.3 letter violations: nested ifs and a chained ternary

- Affected: `ByokClient.js:223-244` (two `if`s nested inside the degradation `if`
  block), `ByokErrors.js:161-169` (`if (error.code === 'ECONNABORTED')` nested inside
  `if (error && error.request)`), `ByokModelsCache.js:83` (chained ternary in the sort
  comparator — "no chained ternaries", `styleguide.md` §5.3).
- Explanation: AGENTS.md rule 5 and styleguide §5.3 say "No nested ifs. Use guard
  clauses / early returns" and "no chained ternaries". The nested cases are mild
  (property-copy ifs, not deep control flow), but they are the documented,
  review-enforced rules for BYOK code.
- Proposed solution: in `classifyByokError`, early-return the request branch
  (`if (!(error && error.request)) return …unknown;` then flat timeout/network
  returns); in the wrapper, build `degradedOptions` via a small named helper with flat
  ifs; replace the comparator with a named `compareByModelId` using ifs.
- Tests to write: existing suites must keep passing unchanged.

### [E] Retry backoff comment misstates the delays

- Affected: `ByokClient.js:24-28` ("2 additional attempts, 800ms then 1.6s apart") vs
  `Utils\RetryIfFailed.js:19-34`.
- Explanation: with `times: 2` there is exactly **one** 800ms delay (between retry 1
  and retry 2); the 1.6s delay never occurs because the loop exits after the final
  failure without waiting.
- Proposed solution: fix the comment ("one 800ms delay before the single retry" /
  "retried twice, 800ms between attempts").
- Tests to write: none (comment only).

### [E] Test gaps in the specs

- Affected: `ByokClient.spec.js`, `ByokErrors.spec.js`.
- Explanation: (a) the 15s `/models` timeout (`MODELS_TIMEOUT_MS`,
  `ByokClient.js:22,91`) is never asserted on the axios.get config, unlike the chat
  timeout which is (`ByokClient.spec.js:236-250`); (b) `sendByokChatCompletionWithRetries`
  has no 429 or timeout-kind retry case (only 500/network —
  `ByokClient.spec.js:361-438`); (c) no test that the degraded (reasoning-effort-free)
  attempt failing, e.g. with a 500, propagates the classified error; (d) no test of
  `classifyByokError` with a non-object `response.data` (HTML error page string →
  generic fallback), though the code path exists (`ByokErrors.js:78-90`).
- Proposed solution: add the four cases.
- Tests to write: as listed.

### [E] Naming: `describeInvalidRequestForReasoningEffort` returns a boolean

- Affected: `ByokErrors.js:195-200`.
- Explanation: "describe" suggests a string; it is a predicate (Phase2.md:129 mandates
  the name, so this is a spec nit, not an implementation error). Related tolerance
  note: only a **400** triggers the degradation retry; gateways that report unknown
  parameters as 422 classify as `unknown` and fail the chat without degradation.
- Proposed solution: rename to `isInvalidRequestForReasoningEffort` (record the spec
  deviation in the worklog); consider letting the detector also accept a 422 status.
- Tests to write: none for the rename; a 422 case if the tolerance is added.

## Checks that passed

- **API key never leaks.** Key travels in the `Authorization` header only
  (`ByokClient.js:89-92,168-175`); every thrown error passes
  `redactSecretFromByokError` (`ByokClient.js:47-50` used at `:95,:177,:221`);
  `ByokError` copies only kind/message/status so the axios `config` (which holds the
  header) is dropped (`ByokErrors.js:152-158`); retry-exhausted errors are
  already-redacted `ByokError`s because `retryIfFailed` rethrows the inner
  function's converted errors (`RetryIfFailed.js:34`, `ByokClient.js:258`);
  `redactSecretFromMessage` uses split/join so regex metacharacters in the key cannot
  break it (`ByokErrors.js:113-119`). Tested including a server echoing the key
  (`ByokClient.spec.js:334-353`).
- **Error-class coverage vs what the client throws**: 401/403/404/429/400/5xx mapped
  (`ByokErrors.js:96-104`), `ECONNABORTED`→timeout and no-response→network
  (`:161-170`; axios `^0.18.1`, `package.json:59`, emits `ECONNABORTED` with `request`
  set on XHR timeout), already-classified pass-through is idempotent (`:139-149`), so
  the consumers' re-classification (`ByokSettingsTab.js:166,201`,
  `ByokOrchestrator.js:469,484`) is safe. Malformed JSON never throws in axios 0.18
  (parse errors are swallowed, the raw string flows into the shape checks at
  `ByokClient.js:98-106,181-192`) — covered by the `unknown` kind.
- **Non-idempotent/non-transient failures are not retried**: authentication, forbidden,
  not-found, invalid-request fail after one attempt (truth table
  `ByokErrors.spec.js:132-152`; wrapper `ByokClient.js:246-248`; no-retry test
  `ByokClient.spec.js:402-417`), matching Phase2.md:203-210.
- **URL joining**: trailing slashes collapsed, `/v1` never added or removed, key never
  in URL (`ByokClient.js:37-40`; tests `ByokClient.spec.js:59-84,92-106`).
- **Reasoning-effort handling**: sent only for `low|medium|high` (`ByokClient.js:153-159`),
  degraded retry strips it exactly once and the two retry behaviors are mutually
  exclusive (`:223-244`; tests `ByokClient.spec.js:440-504`).
- **Streaming/SSE**: N/A — the client is non-streaming by design (Phase2.md:15; grep
  finds no SSE/`[DONE]`/fetch code in `Byok\`), so chunk-boundary/CRLF/abort-mid-stream
  checks do not apply to this phase.
- **Cache failure behavior**: nothing is cached when the fetch throws (tested
  `ByokModelsCache.spec.js:257-277`); per-base-URL isolation tested (`:240-249`);
  an endpoint without `/models` surfaces an actionable `unknown`/`not-found` error and
  the settings tab falls back to the free-text model field
  (`ByokSettingsTab.js:142-143,336-365`).
- **Flow/style basics**: all three modules are `// @flow` with exact object types; the
  only suppressions are the two documented `$FlowFixMe`s mirroring `Generation.js`
  precedent (`ByokClient.js:88,167`); no nested loops anywhere; no console logging of
  secrets (no `console.*` in the modules at all).

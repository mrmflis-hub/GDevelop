# Out-of-Scope Backlog — to be tackled

**Purpose:** every task, fix, or issue that **should be tackled** but fell
outside the running agent's scope or budget. This file is only "to be
tackled": an entry is **removed as soon as the fix is implemented and
verified** (all gates green) — the permanent record then lives only in
`worklog.md`. Items blocked on an owner decision stay here with a `Blocked
on:` line pointing at the numbered decision in `usertasks.md`.

Rules for agents: see `AGENTS.md` §5.2. If nothing new belongs here at the
end of a session, the worklog entry says `no OOS`.

**Seeded 2026-09-22** from `audit2209.md` §1 (the O-ids are kept for
cross-reference; that file holds the full finding detail and severity
rationale). Deferred features are NOT here — they live in `deferred.md`;
human-only work lives in `usertasks.md`.

**Owner decisions recorded 2026-09-22** (answers in `usertasks.md`): O1/O7/
O13 and D5/D10 are approved; O2 is accepted (estimate deferred); O12 closed
as by-design with D9; O3/O4 keep their standing recommendations. The three
owner-designed features are F1–F3 below.

**Phase homes assigned 2026-09-22 (replan):** every actionable item below
now lives in a committed phase step — F2's prompt half is `Phase7.md`
**step 7.1**, the Phase 8 prep is `Phase8.md` **step 8.0**, F2's watchdog
is `Phase9.md` **step 9.1**, F1 is `Phase9.md` **step 9.3**, and F3
(+ D5) is `Phase9.md` **step 9.4**.

**Cleared 2026-09-22 (Phase 8, step 8.0):** O3 was implemented + verified
(all gates green; see the Phase 8 worklog entry) and its row removed.

**Cleared 2026-09-22 (Phase 7, step 7.0):** O1, O4, O5, O6, O7, O8, O9,
O10, O11, O13 and D10 were implemented + verified (all gates green) and
their entries removed from this file — see the Phase 7 worklog entry for
the permanent record. F2's prompt half also landed in `Phase7.md` step
7.1; the entry below now tracks only the watchdog half.

---

## Approved feature work (owner-designed 2026-09-22)

### F1 — BYOK chat history to file (decision #1)

Save each chat to a human-readable file (YAML or Markdown — pick one at
implementation time and record why in the worklog):

- **Save points:** after every user message, after the AI finishes
  responding, and on app closure (best-effort).
- **Reopen behavior:** the chat window starts clear; old chats are loadable
  from a **history button in the chat tab** listing the saved chats.
- **Naming convention:** first 5 words of the chat's first prompt + the date
  of the last interaction (e.g. `create a forest scene_2026-09-24.md`).
- Design folded into `Phase9.md` (persistence step) — that phase is its
  planned home; the current in-session `ByokChatStore` + history section are
  the seams it builds on.
- **Phase home:** `Phase9.md` step 9.3.

### F2 — Progress updates + watchdog instead of streaming (decision #2 answer)

**Prompt half — DONE (Phase 7 step 7.1, `byok-v5`):** the model must keep an
obligatory to-do list (via the existing `create_or_update_plan` tool —
internal tracking; staying hidden from the user is acceptable) and **send a
one-sentence progress update to the user every time it completes a to-do
item**. A single long answer without to-dos stays acceptable. Remaining:

- **Watchdog:** notify the user **in-chat** (not toasts — owner's choice)
  when the model stops responding / work stalls / anything goes wrong with
  an in-flight turn (timeout + error paths already exist as error rows; the
  new part is a stall watchdog for silent hangs).
- **Phase home:** `Phase9.md` step 9.1.

### F3 — Multi-provider per-chat model & effort selection (decision #6)

ZCode-style provider management, replacing the single-endpoint global
setting as the chat-facing surface:

- **Provider registration:** the user registers providers (name + endpoint +
  API key) in Preferences (existing key storage reused per provider).
- **Chat dropdown 1 — model:** available models pulled from each provider's
  `/models`, displayed as `provider name/model name`.
- **Chat dropdown 2 — effort:** defaults to low/medium/high; when the server
  lists per-model supported effort levels, show those instead.
- Scope note: this supersedes the global model/effort settings for new chats
  (keep the globals as fallback); per-model context windows continue to
  apply.
- **Phase home:** `Phase9.md` step 9.4 (with the D5 badge/token row folded
  in).

---

## Findings backlog (O-items)

| ID | What | Where | Status / phase home |
|----|------|-------|---------------------|
| O2 | ~~The context guard silently disappears when the endpoint omits `usage`~~ | `ByokUsageTracker.js`, `ByokOrchestrator.js` | **Accepted (#12)** — round cap holds; char-estimate fallback → `deferred.md` (conditional) |
| O12 | ~~Precise Flow types for the transcript content array and the orchestrator's `chatOptions`~~ | `ByokTranscript.js`, `ByokOrchestrator.js:391` | **Closed by-design (#8/D9)** — no upstreaming, so the `any` escapes stay (documented in `audit2209.md` §6) |
| D5 | BYOK badge in the chat header + exact token row (`getTotals` provides the data). | `AiRequestChat` header | **Approved (#5)** → step 9.4 (with F3) |

---

## New items from the Phase 7 session (2026-09-22)

| What | Where | What blocks it |
|------|-------|----------------|
| Project-notes identifier is captured once per orchestrator (a project "Save as…" mid-chat keeps writing notes under the pre-save identifier until the chat is reopened — reopen after save works). Re-read `fileMetadata` live (a ref like `byokProjectRef`) at notes read/write time. | `AskAiEditorContainer.js` (`getProjectNotesIdentifier` in `createByokOrchestratorForChat`), `ByokOrchestrator.js` | None — small follow-up; surfaced during Phase 7 step 7.8, deliberately kept simple in v1. |

---

## New items from the Phase 8 session (2026-09-22)

| What | Where | What blocks it |
|------|-------|----------------|
| Two-argument project self-unserialization corrupts the project: `unserializeFromJSObject(project, obj, 'unserializeFrom', project)` crashes the WASM with memory-access-out-of-bounds when the serializable IS the project (the single-argument `project.unserializeFrom(element)` works in place — the form MainFrame's `loadFromSerializedProject` uses). A guard in `Utils/Serializer.js` (refuse `optionalProject === serializable`, or route projects to the 1-arg form) would prevent the next caller from hitting it. | `src/Utils/Serializer.js` (`unserializeFromJSObject`), discovered via `ByokFork.js` restore | None — small upstream-safe fix; Phase 8 worked around it (ByokFork uses `gd.Serializer.fromJSON` + the 1-arg `unserializeFrom`). |
| Duplicate `onOpenAskAi` key in `AskAiEditorContainer`'s Props type (an older `{\| aiRequestId, paneIdentifier \|}` shape at ~line 228 and the current `(?OpenAskAiOptions) => void` at ~line 234 — the second silently wins). Pre-existing; noticed while wiring the Phase 8 entry points. | `src/AiGeneration/AskAiEditorContainer.js` Props | None — one-line cleanup at the file's next churn. |
| In-place BYOK restore refreshes the project under open editors, but deeply-held views (scene editors) may show stale content until their next interaction or reopen. v1 accepts this (the phase's full-fidelity-restore disclaimer); a full editor refresh (like `onCheckoutVersion`'s project reload) would remove it. | `src/AiGeneration/AskAiEditorContainer.js` (`onRestoreByokChat`) | A design decision on how hard to refresh (reopening editors is disruptive mid-session). |
| Repeated in-place project restores inside ONE jest/WASM instance are flaky (embind `null function or function signature mismatch` on the second restore of the same project). The production path does one restore per user action; the ByokFork tool test mocks the restore and the round-trip test covers the real path once. | `src/AiGeneration/Byok/ByokFork.spec.js` | Unknown WASM/embind lifetime cause; affects tests only. |

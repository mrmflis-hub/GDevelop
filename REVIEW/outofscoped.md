# Out-of-Scope Backlog — to be tackled

**Purpose:** every task, fix, or issue that **should be tackled** but fell
outside the running agent's scope or budget. This file is only "to be
tackled": an entry is **removed as soon as the fix is implemented and
verified** (all gates green) — the permanent record then lives only in
`worklog.md`. Items blocked on an owner decision stay here with a `Blocked
on:` line pointing at the numbered decision in `usertasks.md`.

Rules for agents: see `AGENTS.md` §5.2. If nothing new belongs here at the
end of a session, the worklog entry says `no OOS`.

**Status: 2 open entries (filed by the Phase 11+12 session, 2026-09-24).**
Previously emptied by the Phase 10 order ("nothing can remain deferred or broken
unless specifically approved by me earlier"); the last actionable rows were
fixed and verified in that session:

- **Project-notes identifier captured once per orchestrator** (surfaced
  Phase 7, step 7.8) — FIXED: `useByokChatSeam.js` now reads
  `fileMetadata` live through `byokFileMetadataRef` in both
  `getProjectNotesIdentifier` closures (chat orchestrator + MCP host), so a
  mid-chat "Save as…" moves the notes to the new identifier.
- **Two-argument `unserializeFromJSObject` project corruption** (surfaced
  Phase 8 via ByokFork) — FIXED: `Utils/Serializer.js` routes the
  `optionalProject === serializable` case to the single-argument in-place
  form; covered by the new `Serializer.spec.js`.
- **Duplicate `onOpenAskAi` key in AskAiEditorContainer's Props** — FIXED:
  the older `{| aiRequestId, paneIdentifier |}` shape was removed; the
  current `(?OpenAskAiOptions) => void` shape remains the only declaration.
- F1, F2 (watchdog half) and F3 (+ D5) were implemented and verified in
  Phase 9 (`Phase9.md` steps 9.1/9.3/9.4) and their entries were removed.
- The two accepted-limitation notes (in-place-restore stale deep views;
  repeated in-jest restores flakiness) moved to `deferred.md` as
  by-design/accepted entries.

The permanent record for all of the above is in `worklog.md`
(2026-09-23 Phase 10 entry and the phase entries cited above).

## Open entries

- **Polygon2d wrapper leak + lifecycle asymmetry in the collision-mask
  editors** (surfaced 2026-09-24 while porting sprite mask editing).
  `ObjectEditor/Editors/SpriteEditor/CollisionMasksEditor/PolygonsList.js:224-235`
  and `CollisionMaskHelper.js:148-156` `new`/`createRectangle` a
  `gd.Polygon2d` and `push_back` it into the live mask vector but never
  `delete()` the wrapper — unlike `gd.Sprite`/`gd.Point`/`gd.Vector2f`
  wrappers, which the same editors DO delete after their `push_back`s.
  Deleting the Polygon2d the same way corrupts the WASM heap (repro:
  memory access out of bounds in later libGD calls — hit while testing
  `ByokSpriteTools`), so the asymmetry looks deliberate-but-undocumented
  and the price is a small wrapper leak per polygon edit. Blocked on: an
  owner call whether to align the lifecycle (needs a libGD-side check of
  `VectorPolygon2d::push_back` copy semantics) or document it where the
  editor code lives. BYOK side already encodes the safe pattern
  (`ByokSpriteTools.js` `applyPolygonMaskToFrame`).

- **External-events/external-layout editors do not live-redraw after BYOK
    writes** (Phase 11 v1 limitation, recorded in the tool outputs): a
  `put_external_layout_instances`/`add_external_events` call applies
  immediately in the project, but an already-open editor tab shows the
  changes only after close/reopen — MainFrame's
  `onInstancesModifiedOutsideEditor`/`onSceneEventsModifiedOutsideEditor`
  fan-out only knows scene editors (it keys on `changes.scene !==
  this.getLayout()`). Small enhancement when wanted: route external-item
  changes to their containers too. Not blocking (the BYOK tools say so in
  their outputs).

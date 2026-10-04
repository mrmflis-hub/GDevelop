# BYOK — Outstanding User Tasks

Everything here still needs **you**: a desktop session, a real endpoint, a file
you must author, or a decision only you can make. Work top to bottom — the
order is roughly "what breaks something if it stays broken" first.

**Everything not listed here is done or assumed verified.** The full history —
every completed checklist, every answered decision, every superseded phase QA
list — is in [`deprecated/usertasks.md`](deprecated/usertasks.md). Per your
instruction (2026-10-03), **basic functionality of Phases 1–12 is treated as
verified**, so the old per-phase QA matrices are retired, not skipped.

**A note on the old task numbers.** The audit records (`audit011026.md`,
`audit100226.md`), the phase plans and the worklog still say things like
"usertasks Task 18" or "Task 15". Those numbers point into the **archive**
(`deprecated/usertasks.md`), where the full context lives — those documents
are permanent records and were not rewritten.

**Housekeeping:** `outofscoped.md` is empty (no agent backlog).
`deferred.md` holds the deliberately-postponed items.

---

## 1. Phase 15 desktop QA — game code on disk `[do this one first]`

*Newest code, least proven, and the only feature whose acceptance criteria
cannot be checked headlessly.* Plan: `Phase15.md`. Built 2026-10-03, committed
`0b82098612`.

1. **The pane.** Home page → the new "Game code" button (index 0, above
   Preferences) opens a three-pane tab: tree | Monaco | Ask AI chat.
   - The tree root is the game-code folder (`<project>/<GameName>Code/`) and
     nothing above it is reachable or draggable into.
   - Create a file from the tree, rename it, delete it — each updates the
     **project's resource registry**, not just the file (a rename that skipped
     the registry would ship the old path).
   - Opening the game-code tab closes the standalone Ask AI tab and back again
     (D15-11: exactly one chat UI at a time).
2. **D15-7, the single-writer guard.** With a file open in Monaco, type into it
   and do NOT save. Then have the AI write that same file
   (`write_game_code_file`). The editor must show a notice offering "Load the
   new version" / "Keep my version" — it must **never silently replace your
   unsaved typing**.
3. **A15-2, hot reload.** Start a preview, then:
   - edit one game-code file → **only that file** reloads, no page reload;
   - create a new file → it loads;
   - delete a file → the page hard-reloads (D15-13: a script cannot be
     unloaded from a running page).
4. **A15-8, the D15-12 condition.** This is the one the owner made the design
   conditional on ("as long as it works with the GD engine"). Have the AI
   create `character/spawn.js` assigning `GameCode.character.spawn`, then:
   - call it from **another game-code file**; and
   - call it from a **scene's JS code event** (which sees `runtimeScene` and
     the `gdjs` scope).
   Both must work against the live engine, not just in a unit test.
5. **A15-1, the last hop.** Preview a project with two game-code files in
   different folders and confirm the exported `index.html` carries one
   `<script src>` per file, in D15-3a order (folder root + `core/` first, then
   the other groupings alphabetically). This is **not assertable in Jest** —
   `UsedExtensionsFinder.ScanProject` is blind in the test WASM (it reports
   only `BuiltinObject`, even for the app's own event writer), and the
   exporter uses the same finder. See `deferred.md` `[P15-a15-1-tail]`.
   **If the tags are absent**, the "marker action makes the carrier extension
   structurally used" mechanism needs another hook; the next candidate is a
   project-level object of a carrier-declared type.

---

## 2. Rebuild and upload the v3 RAG bundle `[blocks a shipped feature]`

The corpus hash changed on 2026-10-01 (tags folded into the hash, map-chunk
tag split, two EventScript example fixes, fence-aware chunking), so the
published **v2 bundle is stale and the app correctly refuses it**.

1. Rebuild:
   ```
   cd newIDE\app
   node scripts/byok-embedder/build-byok-rag-bundle.js
   ```
2. Upload the **new** file from `newIDE/app/build/byok-rag-bundle/` as a
   release asset on `mrmflis-hub/GDevelop` (release tag
   `byok-rag-bundle-v3`; the RAG tab finds any tag with the
   `byok-rag-bundle-` prefix). **Do not re-upload v2** (`…-571d1b30.json`).
3. Optional second asset on the same release: a Qdrant snapshot (name it
   `…-qdrant-snapshot`), produced by restoring the JSON bundle into a local
   Qdrant and taking a collection snapshot. Skip it — the in-process import
   path is complete without it.
4. Verify with a fresh profile: RAG tab → download the bundle (one consent
   dialog) → semantic search works with no ~30-minute build. Then feed it a
   tampered file → it must be refused with a rebuild offer, never accepted.
5. Confirm **GitHub Releases on `mrmflis-hub/GDevelop` may carry these
   assets** (no keys, no secrets, ever).

Also confirm a hosting answer for the finetuned embedder — a free public
Hugging Face repo you create, or release-only. **Low urgency: 14.3 (the
finetune) was deferred by your own order ("move on without finetuned model"),
so items 17.1 (the 200-query set) and 17.4 (the Colab training run) are
moot until you revisit that.**

---

## 3. Electron-main and upstream-guard QA

*`newIDE\electron-app` has **no test runner** by project rule, so everything
below is genuinely unexercised. It accumulated across the audit011026,
audit100226 and outofscoped-closure sessions — one pass covers all of it.*

**MCP server lifecycle**
- Double-toggle the MCP server → exactly **one** endpoint starts (mutex).
- Kill GDevelop with the server on (no clean quit) → the next start takes over
  the stale discovery file.
- Start a second GDevelop instance with the server enabled → it refuses with
  the "another instance owns the endpoint" message; the first is unaffected.
- Disable the endpoint **mid-request** → the caller gets 403, not a forward.
- MCP client cancellation actually reaches the window that received it.
- Reload the editor window while MCP is enabled → the next call fails fast
  instead of hanging ~150 s.
- With MCP read-write, have a client call `add_scene_events` and confirm the
  **save prompt appears** — before the fix, MCP edits were silently discarded
  on close (`A1002-UP-9`).
- The Preferences activity log lists calls made through **other editor
  windows**, and "Clear" clears everywhere.

**RAG / bundle**
- The bundle info/download channels refuse any host but `api.github.com` /
  `github.com`.
- Snapshot restore refuses a non-release URL, and no longer destroys the
  collection on a slow import.
- A resource URL containing a colon or a reserved device name is sanitized.
- Closing a preview whose window is already destroyed does not reject.

**Upstream guards**
- An unparseable `create_scene` background color is refused **without**
  creating the scene.
- An empty event replacement no longer deletes the target event.

**One deliberate behaviour change to confirm by hand:** a long chat tool (a
preview wait, a sub-agent) now holds the project mutation lock, so an MCP
call issued at that moment **waits** for it instead of interleaving. Nothing
hangs (the client-side timeout still answers), but it is a serialization you
did not have before — worth one manual pass.

---

## 4. Remaining edge behaviours (beyond "does it work")

*Specific known gaps, not a re-run of the basic QA.*

1. **40+ round build session.** Watch the `Context summarized:` row appear
   around 75% context and the loop **continue** — it must not dead-end with
   `byok-context-full` (this was a real bug class; the fix is in, untested
   against a real long chat).
2. **Command palette / shortcut on the desktop build.** "Open Ask AI" is
   listed; `Ctrl+Alt+A` opens the panel; reassigning the shortcut through
   Preferences works; no clash with your other shortcuts. Not safely testable
   on the remote VM — needs your machine.
3. **Offline behaviour.** Catalog tools fail with the explicit offline
   message; runtime tools fail typed when no BYOK preview runs;
   `read_doc_page` answers the docs-min drill-down with the network blocked.
4. **One online-export smoke test.** `local-file-download` / `-save-from-arraybuffer`
   are now confined (path containment + gdevelop.io-only cookie). Confirm a
   normal online export still downloads its resources.
5. **Per-provider and chat behaviours from the audit fixes** (cheap, one
   sitting): the effort pill no longer re-routes a providers-only chat to the
   global endpoint; a failed resource download reports a failure instead of
   registering a broken resource; the rail's BYOK Rename works; deleting a
   working chat stops the loop; restore is refused while a chat works; a
   restarted app recovers the persisted RAG index (semantic mode, no rebuild);
   the Qdrant setup survives a restart on the same port.

---

## 5. Decisions you may want to revisit

*Each was answered or taken during the sessions; each is a real fork, not an
oversight.*

1. **Prompt budget: 12,703 tokens vs the 8–10k aim.** Taken on your behalf,
   with a recommendation to accept the landing rather than cut real teaching to
   hit an advisory number. The budget spec now prints the six largest sections
   and schemas every time it warns, so there is data if you want to revisit.
   Levers are listed in `deferred.md` `[BYOK-D-prompt-budget]`.
   *Recommendation: leave it.*
2. **Game-code pane layout is not persisted between sessions.** The
   preference key would have to join the closed `EditorMosaicName` union,
   which was outside the approved upstream budget. The pane opens at a 22/62
   split; in-session resizing works. *Recommendation: leave it — it is a
   clean standalone change later if the annoyance is real.*
3. **Report the upstream fixes to GDevelop. BOTH PACKAGES ARE READY
   (2026-10-04).** `REVIEW/upstream/` now holds:
   - `upstream.md` — the self-contained report;
   - `UP-1-local-file-download/` — the security fix, four annotated files +
     two patches. **File this one first**; the redirect detail (axios 0.19
     forwards headers cross-host) is the part worth a maintainer's attention;
   - `UP-2-to-UP-8-correctness-and-lifetime/` — the other seven, as six
     annotated patch files, with a **recommended four-PR split** in its
     README (they should not be bundled into one PR).
   Remaining owner-only action: decide which PRs to open, and in what order.

---

## Reference (no action)

- `REVIEW/audit011026.md`, `audit100226.md` — the two full audits, every
  finding marked `[fixed]`.
- `REVIEW/deferred.md` — by-design items and accepted limitations, including
  the CometAPI endpoint quirks (gpt-6-luna rejects `tools` +
  `reasoning_effort`; glm-5.3-flash returns garbage after very large tool
  outputs).
- `REVIEW/deprecated/usertasks.md` — the historical record: 22 tasks,
  every answered owner decision, and every retired per-phase QA matrix.

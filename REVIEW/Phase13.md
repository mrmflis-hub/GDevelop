# Phase 13 — Chat panel consolidation, settings redesign, knowledge harness, on-device RAG

*Planned 2026-09-25 from the owner's QA-session-5 notes (fifth session) and
their follow-up decisions. **Docs were approved first; implementation starts
only on the owner's go** (the owner said "write the docs only, do not
implement"). The owner answered the open decisions of 2026-09-24/25 in chat —
they are recorded here as **OWNER-DECIDED**, not as recommendations awaiting
answer.*

Owner decisions already locked in (D13-1…D13-9, see §2):

- Recents panel absorbs chat history; hosted history **stays visible**
  (D13-4) — the separate "Chat history" button is removed.
- Effort moves into the **existing** effort pill at the bottom of the chat
  input; model picker moves next to it (D13-2, owner note 2).
- Header becomes a **BYOK toggle** (green/red) with the token count below
  it, hidden when BYOK is off (D13-4, owner note 4).
- A **"+" attach button** left of Send (text file / image; hide image
  without vision; hide the whole button when BYOK is off) (D13-5, owner
  note 5).
- RAG stack = **bundled Transformers.js ONNX embedder + in-process index**;
  a new **RAG preferences tab** (embedder picker + "set up permanent
  indexing with Qdrant" button that downloads/installs Qdrant and starts it
  with the app) (D13-1, owner decision 1).
- Local generation via fine-tuned models is **NOT in this phase** — it
  lives in `FTmodel.md` as an explicitly long-term track (D13-3, owner
  decision 2/3).

**Design constraint set by the owner (binding for 13.5/13.6/13.7):** aim to
fit the *initially advertised tool list + system prompt* in **8–10k tokens,
hard maximum 15k**. Nobody runs the game engine on a model under 60k context
(almost nobody under 128k; people below that run local setups they already
maintain). The budget must be spent on a stable core that (a) advertises one
tool that searches the other tools, (b) advertises grep/knowledge search over
the docs, and (c) names the most common tasks explicitly so the model knows
what to search for.

---

## 1. Background — why (from QA session 5, 2026-09-24 fifth session)

- glm-5.3-flash failed to write valid EventScript in 3 attempts across two
  chats; every attempt was correctly rejected by the local validator with an
  actionable message, but the model kept emitting pseudo-syntax. The same
  family of models (GLM 5.3 Flash) *can* write valid EventScript when the
  harness puts the syntax and examples in front of it — so the harness
  (prompt/knowledge/tooling) is at fault, not the model class.
- The owner watched the QA run and filed five UX/product notes (chat
  history placement, duplicated effort/model controls, stranded homepage
  chats, knowledge harness, settings confusion) — items 13.1–13.4 below.
- The MCP/QA sessions also proved the on-device corpora we already bundle
  (engine-reference 1,962 entries, bundled docs, skills, DOCs clone at the
  repo root) are enough material for retrieval — what is missing is an
  embedding index and a search tool the model is *told* about.

## 2. Decisions (owner-answered 2026-09-25 — no open decisions in this phase)

1. **D13-1 — RAG stack.** Bundled default = Transformers.js
   (`@huggingface/transformers`) with a MiniLM-class ONNX embedder
   (≈25 MB, CPU/WASM, no native module) + in-process vector index (chunk
   list + Float32 vectors, cosine brute-force — the corpus is thousands of
   chunks, not millions). New Preferences tab **RAG**: embedder picker
   (bundled default + alternatives) and a **"Set up permanent indexing
   with Qdrant"** button that downloads the Qdrant binary online, installs
   it under the GDevelop user-data folder, and starts it automatically
   every time the app starts. **OWNER-DECIDED.**
2. **D13-2 — No local generation in this phase.** Fine-tuned local
   generation (bigger base model + LoRA via Unsloth-style tooling, ternary
   Bonsai-class models on a dedicated llama fork, mostly CPU-bound) is
   documented in `FTmodel.md` as an explicitly **long-term, not-next**
   track. **OWNER-DECIDED.**
3. **D13-3 — Docs first.** This file is written before any implementation
   line; implementation begins on the owner's order. **OWNER-DECIDED.**
4. **D13-4 — Header + history.** Hosted chat history stays visible in
   Recents (BYOK chats are added, hosted is not hidden). Header: BYOK
   toggle (green/red) top-left, token count below it hidden when BYOK is
   off; model/effort controls move to the bottom input bar; the separate
   Chat history button is removed. **OWNER-DECIDED.**
5. **D13-5 — Attach button.** "+" to the left of Send: *Attach text
   file…* and *Attach image…*; hide *Attach image* when the selected
   model has no vision; hide the whole "+" when BYOK is off.
   **OWNER-DECIDED.**
6. **D13-6 — Prompt budget.** 8–10k target / 15k hard cap for advertised
   tools + system prompt; tiered tool advertisement (core tools inline,
   the rest discoverable via a search tool); grep/knowledge search
   advertised; common tasks advertised **by name**. **OWNER-DECIDED.**
7. **D13-7 — Settings layout.** The settings tab is rebuilt to the exact
   layout in 13.4 (three checkboxes → PROVIDERS with unrollable per-model
   advanced settings → Add a provider → DEFAULT STRONG MODEL /
   DEFAULT FAST MODEL as provider+model dropdown pairs → WHILE THE AI IS
   WORKING → CHAT HISTORY STORAGE → MCP SERVER unchanged). **OWNER-DECIDED.**
8. **D13-8 — New npm dependency.** `@huggingface/transformers` (embeddings
   only, lazy-loaded when RAG is first enabled) is approved as the single
   new dependency of this phase. Qdrant ships as a downloaded binary, not
   an npm dependency. **OWNER-DECIDED** (per the stack decision D13-1).
9. **D13-9 — Privacy invariant.** Embeddings, corpus, vectors, and the
   optional Qdrant instance stay on-device (loopback only). No corpus or
   query text leaves the machine for indexing; the only network calls are
   the one-time embedder/Qdrant downloads, shown with explicit size and
   consent.

---

## 3. Steps

> Files named below are today's locations; per `AGENTS.md` §8, re-locate
> anything that moved. New BYOK code goes to `newIDE/app/src/AiGeneration/
> Byok/` (+ RAG: `Byok/Rag/`), shared-file touchpoints are listed per step
> and are owner-budgeted by this document.

### Step 13.1 — Chat panel: header toggle, bottom model/effort bar, Recents merge

**Goal:** one header control (BYOK on/off + tokens), one bottom bar (effort
pill + provider/model picker), one history surface (Recents).

**How to implement:**

1. **Header.** Replace the current BYOK header row (model dropdown, effort
   dropdown, token text, Chat history button) with:
   - a toggle button top-left: **BYOK**, green when routing is on, red
     when off — it flips the same global "Use BYOK for Ask AI" setting the
     Preferences checkbox drives (stay in sync both ways; it routes *new*
     chats, an in-flight chat continues as started — same semantics as
     today);
   - the token/turns counter (D5 row) directly below the toggle,
     **hidden when BYOK is off**.
2. **Bottom bar.** Wire the *existing* effort pill at the bottom of the
   chat input to the BYOK per-chat effort when BYOK is on (today BYOK
   ignores it and renders its own header dropdown); add a compact
   provider/model dropdown next to the pill: entries
   `providerName/modelName` from each registered provider's `/models`
   (fetched once per provider, cached) plus a leading
   **"Model from settings"** default. Both controls write the same
   per-chat selection stored today (`byokModelSelection` / effort on the
   chat record). When BYOK is off the pill behaves exactly as the hosted
   control does today and the model dropdown is hidden.
3. **Recents merge.** The Recents rail lists, in this order: (a) BYOK
   chats from `ByokChatPersistence` when BYOK is on (name = first 5 words
   + date as today), each row with Open / Archive / Delete inline (the
   actions the Chat history dialog had), then (b) the hosted chat list as
   today. BYOK-off shows only (b). Remove the "Chat history" button and
   the history dialog (its storage-usage line and export button move to
   Preferences → CHAT HISTORY STORAGE, which already has them).
4. **Persistence contract unchanged:** durable Markdown transcripts,
   image sidecars, quarantine, 200 MB quota — only the surface moves.

**Tests:** header toggle syncs with the preferences setting both ways;
toggle hidden-state of the token row; Recents renders BYOK + hosted
sections and routes row actions; bottom pill writes per-chat effort/model;
history-dialog removal leaves no dead imports.

**Depends on:** nothing.

### Step 13.2 — Homepage-form chat carries into the editor panel

**Goal:** a chat started from the homepage form is visible, selected and
scrolling in the editor's Ask AI panel the moment its project opens/creates.

**How to implement:**

1. Trace the current path (`AskAiStandAloneForm.js` → chat creation →
   project open) and find where the editor Ask AI tab is (not) selected
   today — Task 10's "keeps running" works, the *selection/rendering* is
   the gap the owner saw.
2. When the form's chat triggers (or coincides with) a project being
   opened: open the editor Ask AI tab, select the form's chat, and render
   its live transcript (the chat loop must not restart or fork — same
   chat id).
3. If the form is still open when the project opens, close it (the
   editor panel is now the surface).
4. Hosted (BYOK off) form behavior unchanged.

**Tests:** with a fake endpoint, form-started chat that calls
`initialize_project` results in the editor panel selected on that chat id
with the transcript visible; no duplicate chat records.

**Depends on:** nothing.

### Step 13.3 — "+" attach button (text file / image) next to Send

**Goal:** the user can hand the model reference material: a text file or
an image.

**How to implement:**

1. A **"+"** button immediately left of Send. Hidden entirely when BYOK
   is off (hosted AI payload shapes are upstream). Clicking opens a small
   menu: *Attach text file…* / *Attach image…*.
2. *Attach image…* hidden when the chat cannot use vision (image support
   setting = No, or the selected model probed no-vision).
3. **Text file:** pick via the existing desktop file-picker IPC; read via
   the same file handlers the skills/history readers use; reject likely
   binaries (extension + NUL-byte sniff) with a friendly error; inline
   into the user message as a fenced block with a filename header; hard
   cap (start at 100 KB) with a truncation note above the cap; multiple
   attachments join in one message.
4. **Image:** pick png/jpg/webp; attach as an `image_url` data-URL part
   exactly like `capture_scene_screenshot` output; persist to the chat's
   image sidecar (`byok-chats/*.images.json`) so reloaded transcripts
   still render; counts against the vision degradation path.
5. Attachments are part of the user message: they persist in the durable
   transcript, count toward context, and flow through compaction like any
   content part.

**Tests:** menu gating (BYOK off / no vision); text inline + cap + binary
rejection; image part + sidecar round-trip; transcript replay renders the
attachment.

**Depends on:** nothing.

### Step 13.4 — Settings tab redesign (owner's layout, verbatim structure)

**Goal:** the Preferences → BYOK tab reads top-to-bottom in the owner's
order, with advanced knobs tucked into per-provider unrollers.

**How to implement (top to bottom):**

1. Three checkboxes:
   - **Use BYOK as is** (today's "Use BYOK for Ask AI"; keeps the legacy
     single-endpoint Connection fields — endpoint, API key, model — as the
     simple no-providers path; when providers exist, this block is
     visually secondary to the provider list),
   - **Fetch missing documentation pages online** (existing),
   - **Auto-load the build workflow for game requests** (existing).
2. **PROVIDERS** — one card per registered provider:
   - row 1: Provider name text field + Remove button;
   - Endpoint base URL field;
   - API key field (with show/hide);
   - **Test** button and **Fetch models** button on one row;
   - **Advanced provider settings** (collapsed by default) unrolling:
     **PER MODEL SETTINGS** — "Pick model" dropdown (populated from that
     provider's fetched model list), temperature field, max tokens field,
     context-window field, **Run benchmark** button (runs the 4-task
     benchmark against *that* model; stored results stay keyed
     endpoint+model), and a **Customize another model** button that adds
     another per-model block.
3. Break, **Add a provider** button (creates a card as today), break.
4. **DEFAULT STRONG MODEL**: Provider dropdown + Model dropdown.
   **DEFAULT FAST MODEL**: Provider dropdown + Model dropdown.
   (Routing profiles upgrade from model-name strings to
   `{provider, model}` pairs — the actual functional upgrade; migrate
   existing settings on load, provider falls back to the first provider
   for old profiles.)
5. **WHILE THE AI IS WORKING**: warn-me checkbox, stall-warning seconds,
   suggest-follow-up checkbox (all existing controls, moved).
6. **CHAT HISTORY STORAGE**: storage-usage line + Export button (moved
   from the removed history dialog).
7. **MCP SERVER (external agents)**: unchanged, below.
8. Global Image support / Reasoning effort stay near the "Use BYOK as is"
   block (they are connection-level defaults); per-model context windows
   move into the per-model unrollers.

**Tests:** settings spec re-anchored to the new structure; routing-pair
migration (old string profile → provider+model pair); per-model benchmark
button invokes the runner with that provider+model; no orphaned controls
(each old control appears exactly once in the new tree).

**Depends on:** 13.1 (the export/usage line it inherits comes from the
removed dialog — can be built in parallel).

### Step 13.5 — Prompt/tool budget pass (the owner's 8–10k/15k directive)

**Goal:** advertised tools + system prompt fit **8–10k target, ≤15k hard**,
and teach the model what it can search for.

**How to implement:**

1. **Measure first:** a spec that renders the real composer + real tool
   schemas and prints/asserts the token estimate (char/4 baseline is fine
   for CI; print the number in the failure message).
2. **Tiered tool advertisement.** Keep ~20–25 *core* tools inline
   (scene/object/instance/variable/events/preview/notes + the knowledge
   tools). The remaining advertised surface moves behind a
   **`search_tools`** meta-tool: `search_tools(query)` returns name +
   one-line description + full schema for matches, and executing a
   discovered tool works immediately (schema injection on next request;
   no mid-request schema swap needed — the model emits the call, the
   executor already knows every tool). `tools/list` over MCP stays full
   (external clients are not budget-bound).
3. **Schema slimming.** First sentences stay stable (Phase 11 lesson),
   long tails move to parameter descriptions; drop duplicated prose
   between schema and knowledge sections.
4. **Advertise the retrieval surface by name.** The system prompt gains a
   short, non-degradable block: "You can search: tools (`search_tools`),
   engine reference & EventScript examples (`search_reference`), bundled
   docs (`read_doc`/`search_docs` or `search_knowledge` once 13.7 lands),
   skills (`load_skill`)" plus a **task catalog** — 10–20 lines naming
   common tasks and the search that solves them ("add a collision
   counter → search_reference 'collision variable increment'; build a
   platformer → load_skill build-workflow; …").
5. **Grep advertisement.** Once 13.7 lands, the knowledge search tool is
   advertised as grep-over-the-docs ("you can grep the full engine
   documentation on-device").
6. The prompt-version constant bumps (`byok-v8` → `byok-v9`) and the
   prompt/schemas sync tests are updated to assert the **15k hard cap**
   (fail loudly if a future edit blows the budget).

**Tests:** budget spec (target ≤ 8–10k asserted as a warning band, ≤ 15k
as hard failure); `search_tools` returns the right schemas for known
queries; every advertised-by-name task in the catalog resolves to a real
tool/query result.

**Depends on:** nothing (13.7 upgrades the advertised knowledge tool
later).

### Step 13.6 — EventScript harness fixes (Tier 1 — no new deps)

**Goal:** the model stops free-styling pseudo-syntax: the syntax and
examples are always in view, and a rejected batch is answered with a
*targeted* example.

**How to implement:**

1. **Always-include block (non-degradable):** EventScript syntax block +
   3 canonical complete examples (collision→variable increment, timer
   spawn, scene switch) pinned in the prompt (outside the degradable
   knowledge packs; counted in the 13.5 budget).
2. **Example bank with tags:** extend the generated engine-reference
   corpus (`scripts/generate-byok-engine-reference.js` pipeline) with
   curated EventScript examples, each with tags (`collision`, `variable`,
   `timer`, `spawn`, `scene`, `animation`, `score`, `camera`, …) so
   `search_reference` returns runnable examples.
3. **Validator-repair injection:** when `add_scene_events` /
   `update_scene_events` is rejected by the writer, the tool result
   gains a `retryHint` carrying the example most relevant to the
   failing construct (error class → example id map, maintained in the
   writer) instead of only the syntax complaint.
4. **Benchmark sanity:** after 13.5+13.6, re-run the built-in benchmark —
   "Write a working event batch" should pass for a mid-tier model even
   with the WASM crash from `outofscoped.md` worked around or fixed
   (fixing that crash is **not** in this phase; it is a separate open
   entry).

**Tests:** composer renders the pinned block in every request;
validator rejection output carries a `retryHint` whose example parses;
example bank entries all validate through the real writer (round-trip
test — every shipped example must be accepted by `ByokLocalEventWriter`).

**Depends on:** 13.5 (budget headroom for the pinned block).

### Step 13.7 — On-device RAG core (bundled embedder + in-process index + `search_knowledge`)

**Goal:** semantic search ("grep") over the full engine corpus, on-device,
CPU-bound, no data leaving the machine.

**How to implement:**

1. **Dependency:** `@huggingface/transformers` (lazy-loaded on first
   enable; D13-8). Embedder default: `Xenova/all-MiniLM-L6-v2` ONNX
   (quantized, ≈25 MB download at first enable, with explicit size +
   consent UI).
2. **Corpus:** engine-reference entries, bundled docs pages, skills,
   curated EventScript examples (13.6), and an opt-in extension indexing
   the repo-root `DOCs\` clone. Chunked by section (~400 tokens, small
   overlap), each chunk keeps `source`, `title`, `tags`.
3. **Index:** built under `<userData>/byok-rag/` — vectors + manifest
   (embedder id, corpus hashes, schema version). First build runs with a
   progress UI; later builds are incremental (only changed corpus
   versions re-embed). Query path: embed (WASM, CPU, tens of ms) +
   brute-force cosine over the chunk list.
4. **Tool:** `search_knowledge(query, tags?, kind?)` — hybrid retrieval
   (tag/exact hit first, vector top-k second) returning chunks with
   source + title + a stable id, so the model can request neighboring
   chunks. Advertised in the 13.5 core set and named in the task
   catalog ("grep the docs").
5. **Privacy (D13-9):** all indexing/querying is local; the only network
   traffic is the one-time embedder download (consented).

**Tests:** index build determinism (same corpus → same manifest hash);
`search_knowledge` eval set (20–30 queries with expected sources — e.g.
"collision variable" → collision example + events docs page) with a
top-3 hit-rate threshold; lazy-load does not affect startup or the
RAG-off path; RAG-off `search_knowledge` falls back to tag/exact search.

**Depends on:** 13.6 (example bank feeds the corpus); 13.5 (advertisement
budget).

### Step 13.8 — RAG preferences tab + permanent Qdrant setup

**Goal:** a new **RAG** tab in Preferences: embedder picker for users who
do not like the bundled one, and one-click permanent Qdrant indexing.

**How to implement:**

1. **Tab contents:** status card (enabled/disabled, index size, corpus
   version, last build), embedder picker (bundled default + a curated
   alternative list, e.g. `bge-small-en` int8 — better recall, bigger
   download; each entry shows size and language coverage), rebuild
   progress + "Rebuild index" button, and the **Qdrant** card.
2. **Qdrant card:** a **"Set up permanent indexing with Qdrant"** button
   that: downloads the official Qdrant binary for the platform (GitHub
   releases; the machine used for QA already runs
   `qdrant-x86_64-pc-windows-msvc`, so the artifact shape is known),
   installs under `<userData>/qdrant/`, writes a loopback-only config
   (disabled external interface or API-key), and registers an autostart
   entry so the Electron main spawns it on every app start (same
   lifecycle pattern as the MCP server: spawn → health check → ready;
   child killed on quit). If a healthy Qdrant already answers on
   localhost, offer "use existing instance" instead of installing.
3. **Index backend switch:** a small storage interface with two
   implementations — in-process (default) and Qdrant (REST loopback,
   collection `gdevelop-byok`, same chunk schema). Switching triggers a
   rebuild/upload; the manifest records the backend.
4. If Qdrant setup fails (offline, antivirus), fall back cleanly to the
   in-process index with a clear message — RAG never hard-depends on
   Qdrant.

**Tests:** storage interface contract (both implementations pass the same
suite: upsert/search/delete/rebuild); setup script idempotency; autostart
spawn + health check + clean shutdown; fallback path.

**Depends on:** 13.7.

---

## 4. Phase 13 acceptance criteria (phase gate)

- [ ] Header shows the BYOK toggle (green/red, synced with the
      Preferences switch) and the token/turns counter below it, hidden
      when BYOK is off; old header dropdowns and the Chat history button
      are gone.
- [ ] The bottom effort pill drives BYOK per-chat effort; the
      provider/model dropdown sits next to it with "Model from settings"
      default; both persist on the chat record.
- [ ] Recents lists BYOK chats (open/archive/delete inline) above the
      hosted list; durable transcripts unchanged; hosted history remains
      visible.
- [ ] A homepage-form chat that opens/creates a project appears selected
      with its live transcript in the editor Ask AI panel; no forked or
      duplicated chats.
- [ ] "+" attach button: hidden when BYOK off, image entry hidden without
      vision, text files capped and binary-rejected, images persist via
      the sidecar and survive transcript reload.
- [ ] Settings tab matches §13.4 top-to-bottom; routing profiles are
      provider+model pairs with migration; per-model benchmark runs;
      storage line + export live under CHAT HISTORY STORAGE; MCP card
      unchanged.
- [ ] Spec asserts advertised tools + system prompt ≤ 15k tokens with the
      8–10k target reported; `search_tools` meta-tool serves the
      non-core surface; task catalog + knowledge/grep advertisement
      present in the prompt; prompt version bumped (`byok-v9`).
- [ ] EventScript pinned block in every request; example bank round-trips
      through the real writer; validator rejections carry targeted
      `retryHint`s.
- [ ] `search_knowledge` passes the eval hit-rate threshold on-device;
      RAG-off degrades to tag search; embedder download is consented and
      lazy.
- [ ] RAG tab: embedder picker works; Qdrant setup installs, autostarts
      with the app, passes health check, and the index backend switch
      round-trips; clean fallback when setup fails.
- [ ] All four repo gates green; worklog entry complete; `AGENTS.md` §2
      updated.

## 5. Explicitly deferred from this phase

- **Local generation via fine-tuned models** — `FTmodel.md` (long-term
  track; not scheduled).
- **Fixing the benchmark WASM crash** — remains `outofscoped.md` (but
  re-run the benchmark at the end of 13.6 to measure the knowledge fixes
  against tasks it can complete without the crash).
- **MCP-side attachment/search_knowledge parity** — external clients can
  already list/read the corpora; exposing `search_knowledge` over MCP can
  ride a later MCP revision.
- **Speech/audio attachments, multi-file project upload** — not requested;
  note for a future UX pass if the owner asks.

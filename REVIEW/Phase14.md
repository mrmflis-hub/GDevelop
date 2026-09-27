# Phase 14 — Retrieval & cost track: prompt-cache stability, minified docs layer, prebuilt RAG bundle, embedder finetuning

*Planned 2026-09-26 from the owner's review of an external LLM consultation
(`REVIEW/improvements-discussion.txt`). The owner deliberately gave the
consultant incomplete premises about the fork to elicit unanchored ideas;
every idea in that conversation was re-verified against the real tree before
adoption or rejection (see §1). **Docs first; implementation starts only on
the owner's go.** All decisions below were answered by the owner in chat
2026-09-26 and are recorded as **OWNER-DECIDED**, not recommendations.*

Owner decisions locked in (D14-1…D14-7, see §2):

- **Cache stability first** (D14-1): the system prompt is composed once per
  chat and reused byte-identical for the chat's life, so provider prefix
  caches survive note writes and skill-list churn.
- **Minified docs layer** (D14-2): the whole `gdevelop5` wiki minified to a
  40–60 % band, shipped **bundled with the fork**, organized by category,
  searchable with RAG **off** (lexical), with per-category index chunks —
  no monolithic index file, no new skill.
- **Prebuilt RAG bundle** (D14-3): a download of ready-made index state
  (plus the embedder) on the fork's GitHub Releases, **opt-in, never a
  dependency, never automatic**, with a Qdrant snapshot-restore branch.
- **Zero-shot classification** (D14-4) and the **triage→coding split /
  prefilling** (D14-5) from the consultation are **rejected**.
- **Embedder finetuning** (D14-6) is in scope as a **gated** step: synthetic
  pairs over the corpus + ~200 owner-written human queries; ship-if-better.

---

## 1. Background — what the consultation proposed vs. what the tree already had

- The consultant (Gemini) proposed: client-side RAG, a compressed DSL with
  few-shot examples, tool discovery with compact signatures, prompt caching,
  a triage→coding "execution blueprint" split, a local zero-shot classifier
  for 2D/3D/genre routing, an LLM doc-minification pipeline, and assistant
  prefilling.
- Already built before this phase: RAG with a hybrid on-device index
  (Phase 13.7), the EventScript DSL with canonical examples (13.6), and
  two-tier tool advertisement with the `search_tools` meta-tool (13.5,
  `Byok/ByokExtraTools.js:457`). The consultation independently reinvented
  the first three — external validation, no work.
- The load-bearing correction to the consultant's premises: our agent loop
  is stateless chat/completions, so **every tool-call round re-sends the
  system prompt, the 27 advertised tool schemas, and the whole transcript**
  (`Byok/ByokOrchestrator.js:716-722`). The consultant priced a large prompt
  as paid once per chat; we pay it ~10–20 times per task. That makes prompt
  caching the highest-leverage idea in the conversation, and prompt-budget
  work stays relevant anyway (local endpoints cache nothing).
- The one real cache-buster found in the tree: `buildSystemPrompt()` re-runs
  every round (`Byok/ByokOrchestrator.js:653`, `:668`) and re-reads the live
  project notes into the prompt (`Byok/Knowledge/ByokKnowledgeSections.js:424-446`,
  fed from `Byok/ByokOrchestrator.js:620-635`). The first
  `update_project_notes` call mid-chat changes the system prompt bytes and
  invalidates every provider prefix cache from position zero.
- Everything else in the request is already cache-friendly: no timestamps in
  the prompt, a fixed-order 27-tool `tools` array, an append-only
  transcript, and the dynamic project snapshot folded into the **last user
  message** (`Byok/ByokOrchestrator.js:675-689`) — dynamic content at the
  tail, where it cannot bust the prefix.
- Docs coverage facts that shaped D14-2: the bundled docs subset is 15
  pages, all under `events/` (`Byok/docs/gdevelop-docs/BundledDocs.generated.js`);
  `read_doc_page` fetches non-bundled pages from upstream when online
  (`Byok/ByokDocs.js:29-31`) and caps reads at 12k chars; the DOCs clone at
  the repo root holds **~601 markdown pages** under `DOCs/docs/gdevelop5`,
  and its mkdocs nav / folder tree provides the category taxonomy for free
  (deterministic, no LLM classification needed).
- Finetuning facts that shaped D14-6: the bundled default embedder is
  `Xenova/all-MiniLM-L6-v2` (22M params, 384 dims, ≈25 MB int8,
  Apache-2.0 — `Byok/Rag/ByokRagTypes.js:51-68`), the most-finetuned
  sentence-transformer in existence; the loader passes the id straight to
  `transformers.pipeline('feature-extraction', id)` (`Byok/Rag/ByokRagEmbedder.js:89-93`),
  so a finetuned model is a new catalog entry with **zero loader changes**.
- Sequencing rationale: 14.1 and 14.2 are independent and land first;
  14.3 (finetuning) runs after 14.2 (better corpus → better synthetic
  queries) and **before 14.4** generates the prebuilt artifact, because the
  prebuilt vectors must be built with the embedder we finally ship
  (the bundle manifest is keyed by embedder id, so both orders *work* —
  this order avoids generating the artifact twice).

## 2. Decisions (owner-answered 2026-09-26)

1. **D14-1 — Prompt-cache stability, snapshot-once.** The system prompt is
   composed on the first round of a chat and reused byte-identical for the
   chat's lifetime. Freeze scope is the **simple version**: everything
   (notes, skills list, custom instructions) freezes with it; staleness from
   mid-chat settings edits is accepted until the chat ends. Invalidation
   happens only on a project open/close flip and on a new chat. Mid-chat
   note changes are semantically safe to freeze because they are caused by
   the model's own `update_project_notes` calls, which are already in the
   transcript. **OWNER-DECIDED.**
2. **D14-2 — Minified docs layer.** Minify the **whole** `gdevelop5` wiki
   (~601 pages) to a **40–60 % compression** band (keep exact syntax,
   parameter names, constraints ("Rule:" lines) and compact examples; drop
   narrative/tutorial prose — NOT the consultant's 70–90 % strip-the-why).
   Ship the artifact **bundled with the fork**; organize it **by category**
   derived from the mkdocs/folder taxonomy; expose it to the model as
   **per-category index ("map") chunks + minified page chunks** in the
   existing corpus — **no monolithic index file, no new skill** (a skill can
   auto-load into the prompt; the index must stay behind search). One
   degradable hint line in the retrieval map teaches the drill-down habit.
   **OWNER-DECIDED.**
3. **D14-3 — Prebuilt RAG bundle.** Users may download ready-made index
   state instead of the ~30-minute local build. Hosted on the fork's
   **GitHub Releases**; the download UX is **one consent, one download**
   covering index + embedder; **opt-in only** — Qdrant stays a downloaded
   binary, not a dependency, and nothing downloads automatically. A Qdrant
   path restores a prebuilt collection snapshot via Qdrant's native
   snapshot-upload API. The bundle manifest records embedder id +
   dimensions + corpus/chunker versions + sha256; on mismatch offer a local
   rebuild, never serve silently stale vectors. **OWNER-DECIDED.**
4. **D14-4 — Zero-shot local classifier: rejected.** Query-driven hybrid
   retrieval (`search_knowledge`) plus the machine-checked task catalog
   already inject conditionally on what the model asks for; a fixed-label
   classifier adds a ~40 MB download, a second warm model, and a misroute
   risk. Revisit only if future evals show categorical retrieval misses.
   **OWNER-DECIDED** ("fully ignore").
5. **D14-5 — Triage→coding split and prefilling: rejected.** The two-phase
   "execution blueprint" pipeline contradicts the single-loop architecture
   all 13 phases built around (durable history, compaction, watchdog,
   per-chat routing), doubles latency, and adds a JSON-out failure mode on
   endpoints we know are flaky. Its good kernel already exists: the
   compaction preserved block is the state handoff; strong/fast per-chat
   routing is the cheap-model lever. Prefilling stays out (Anthropic-only
   over an OpenAI-compatible surface = another endpoint-compat row).
   **OWNER-DECIDED.**
6. **D14-6 — Embedder finetuning: in scope, gated, last-but-B.** Train the
   default MiniLM on synthetic pairs (2–3 per chunk, mixed registers, judge-
   passed) + the owner's ~200 human queries (150 labeled exemplars rotated
   into the generator prompt, 50 held out purely for eval); training on free
   Colab/Kaggle (sentence-transformers, MultipleNegativesRankingLoss;
   Unsloth optional but unnecessary at 22M params); export ONNX int8; add a
   third `BYOK_RAG_EMBEDDERS` catalog entry. **Ship-if-better gate:** the
   finetuned model ships as a picker option; it becomes the **default**
   (and the 14.4 bundle embedder) only if it beats the stock MiniLM by
   ≥5 pp top-3 on the owner's held-out 50 with no regression on the
   existing 24-query eval set; otherwise it stays an option and the default
   is unchanged. **OWNER-DECIDED.**
7. **D14-7 [open — decide at 14.4 start] — Bundle packaging.** The owner
   approved the "one consent, one download" UX goal. Mechanism options:
   (a) **index-only JSON bundle** (the file-backend export format already
   exists) + the embedder weights via their existing consented HF download —
   zero new dependencies, two downloads shown as one dialog;
   (b) true single-file bundle including the ONNX weights — needs either a
   custom transformers.js cache injection (no dep, fragile against
   upstream) or a tiny unzip dependency (`fflate`, ~30 KB, needs explicit
   owner approval per the no-new-deps rule). **Default plan: (a)**; upgrade
   to (b) only if the owner approves the dependency. **OPEN.**

## 3. Steps

> Files named below are today's locations; per `AGENTS.md` §8, re-locate
> anything that moved. New BYOK code goes to `newIDE/app/src/AiGeneration/
> Byok/`; maintainer-side pipeline scripts go to `newIDE/app/scripts/`
> (same pattern as `run-byok-evals.js`); Electron main touchpoints stay thin
> per the no-test-runner rule.

### Step 14.1 — Prompt-cache stability: snapshot-once system prompt

**Goal:** the system message bytes never change within a chat, so provider
prefix caches survive note writes, skill churn, and settings edits.

**Depends on:** nothing.

**Files modified:** `Byok/ByokOrchestrator.js` (+ spec),
`Byok/Knowledge/ByokKnowledgeSections.js` (only if the freeze boundary
needs a helper; keep changes minimal), `REVIEW/worklog.md`.

**How to implement:**

1. Compose the system prompt **once** per orchestrator lifetime: on the
   first `buildMessagesForModel()` call, run today's
   `buildSystemPrompt()` (notes, skills, custom instructions, auto-suggested
   skill banner) and store the resulting **string**; every later round
   reuses the stored string verbatim (prompt build today:
   `ByokOrchestrator.js:620-642`, called per round at `:653`/`:668`).
2. Invalidate the stored string only on: (a) the `hasOpenedProject()` value
   flipping (project opened or closed mid-chat), and (b) a new chat /
   orchestrator recreation. Everything else — `update_project_notes`,
   skill-list changes, custom-instruction edits — is accepted as stale until
   chat end (D14-1).
3. Leave the transcript handling, the tail-folded project snapshot, and the
   fixed `tools` array exactly as they are — they are already
   cache-friendly; add no dynamics to the system message.
4. Compaction keeps the same system string (the history rewrite busts the
   cache once regardless; that is accepted and rare by design).

**AMENDMENT (owner order 2026-09-27, implemented the same day).** Point 3's
"tail-folded project snapshot … already cache-friendly" was verified after
implementation and found only half true: the fold targeted the last USER
message, which sits mid-request once tool rounds append after it, and the
Phase 9.7 per-round refresh rewrote it after every editing round — so an
edit-heavy turn (50–100 rounds in a real build) re-busted the prefix from
that message on each round. The owner ordered the fix: the snapshot now
rides its OWN synthetic trailing user message at the very tail of the
request (`buildMessagesForModel`), so the transcript replay is purely
append-only and a refresh only ever changes the request's final message;
everything before it (system + tools + the whole transcript) stays
cacheable prefix. Spec-proven across editing rounds AND a completion-gate
nudge round. The transcript itself still never contains the snapshot (the
UI never renders the JSON blob), and the message stays valid OpenAI
protocol (a user message may follow tool results).

**Tests:**

- Spec: a simulated multi-round conversation including a round where the
  model calls `update_project_notes` asserts byte-equal system messages
  across all rounds.
- Spec: opening/closing a project mid-chat invalidates the snapshot exactly
  once and only then.
- Existing budget spec stays green (the prompt content itself is unchanged).

**ACs:**

- [ ] Byte-identical system message across rounds, including after note
      writes and settings edits, until project state flips or the chat ends.
- [ ] Request `tools` array identical across rounds (asserted in the same
      spec).
- [ ] All four repo gates green.

### Step 14.2 — Minified docs layer: pipeline, corpus source, retrieval-map hint

**Goal:** the whole wiki is available to the model **offline, bundled, and
with RAG off** (lexical), organized by category maps, with full-depth pages
one `read_doc_page` call away.

**Depends on:** owner Task 17.3 budget approval (pipeline tokens). Can run
in parallel with 14.1.

**Files created:** `newIDE/app/scripts/build-byok-minified-docs.js`
(maintainer-run pipeline: read `DOCs/docs/gdevelop5/**/*.md`, category =
top-level folder, one cheap-endpoint call per page at temperature 0.1 with
the constraint-preserving compression prompt (40–60 % band), structured
per-page output `{path, title, category, summary, body, suggestedTags}`,
tag whitelist validation (folder-derived + 2d/3d heuristics win over LLM
suggestions), deterministic **sanity pass**: every engine-looking
action/condition/expression token in `body` must exist in the bundled
engine reference (build fails on unknown names, explicit allowlist for
false positives)); the committed artifact
`Byok/docs/gdevelop-docs/MinifiedDocs.generated.js` (same
"generated data, validated once, still untrusted" pattern as
`BundledDocs.generated.js`); `Byok/ByokMinifiedDocs.js` (+spec:
validate + accessors).

**Files modified:** `Byok/Rag/ByokRagCorpus.js` (+spec: two new chunk
grades in the stable corpus order), `Byok/Knowledge/ByokKnowledgeSections.js`
(+spec: one degradable hint line in the retrieval-map section),
`Byok/ByokPrompts.js` (prompt version bump `byok-v9` → `byok-v10`),
`REVIEW/worklog.md`.

**How to implement:**

1. **Category-map chunks** — one per top-level category: id
   `docs-min-map:<category>`, tags `[docs-min, map, <category>]`, text =
   one line per page in that category: `path — title — summary`
   (~100–200 tokens each). These are the "index" the model browses.
2. **Minified page chunks** — id `docs-min:<path>`, tags
   `[docs-min, <category>, ...whitelisted tags]`, text = `summary` +
   minified `body` + the trailing line
   `Full page: read_doc_page('<path>').` for depth.
3. Register both grades in `ByokRagCorpus` after the existing sources (same
   deterministic order guarantee: same inputs → same chunks). No
   `search_knowledge` / `search_tools` / `read_doc_page` code changes —
   they already filter by kind/tags and address by path.
4. Add the retrieval-map hint line (degradable, 13.5 budget machinery):
   when unsure what is documented, search the `docs-min` category maps
   first, then pull specific pages; use `read_doc_page` when the minified
   chunk is not enough.
5. Coexistence: the existing 15 bundled full-doc chunks stay as they are;
   this is an added layer, not a replacement. Whether `docs-min` chunks
   later displace anything is decided by eval data, not by this phase.
6. Re-run the pipeline whenever `DOCs/` updates (maintainer task; the
   artifact is committed so users never run it).

**Tests:**

- Artifact validation spec (untrusted-generated pattern: every field, path
  keys matching `ByokDocs` page-path shape).
- Corpus spec: determinism, kinds/tags, category maps listing exactly the
  pages of their category.
- Sanity-checker unit tests (known-good token passes, invented token fails
  the build).
- `search_knowledge` with RAG off (lexical fallback) hits `docs-min`
  chunks in the existing spec harness (hashing embedder).
- Budget spec: hint line inside the degradable budget; measured totals
  reported as today.

**ACs:**

- [ ] Artifact covers the whole `gdevelop5` wiki (count in the worklog;
      expected ~601 pages minus redirect/stub skips, with skips listed).
- [ ] With RAG **disabled** (lexical only) and **offline**, a chat can
      discover the right page via a category map and read its minified body.
- [ ] Sanity pass passes with zero unknown engine tokens (allowlist
      documented in the script header).
- [ ] Prompt budget spec green with the hint line; prompt version `byok-v10`.
- [ ] All four repo gates green.

### Step 14.3 — Embedder finetuning: data, training, catalog entry (gated)

**Goal:** a GDevelop-tuned MiniLM as a **picker option**, promoted to
default only if measurably better (D14-6 ship-if-better gate).

**Depends on:** owner Tasks 17.1 (queries) and 17.4 (training run); 14.2
(the minified/full corpus is the pair-generation substrate). Do **not**
start 14.4's artifact generation before this step's embedder decision lands.

**Files created:** `newIDE/app/scripts/byok-embedder/build-byok-rag-pairs.js`
(synthetic pair generation over the corpus: 2–3 questions per chunk, mixed
registers (vague/medium/precise) via persona instructions, **rotating**
samples of 5–10 exemplars drawn from the owner's 150 labeled queries,
generator self-check + LLM-as-judge pass (Phase 10 pattern) that the chunk
actually answers the question, near-duplicate filtering, holdout leak
guard: no held-out query text may appear in any generated prompt or pair);
`newIDE/app/scripts/byok-embedder/train.ipynb` (Colab-ready:
sentence-transformers, MultipleNegativesRankingLoss with in-batch negatives,
2–4 epochs, export to ONNX int8); the owner-queries data file
`Byok/docs/rag-eval-queries.json` (delivered by owner Task 17.1:
`{query, target, bucket, register, holdout}`); the eval runner
`newIDE/app/scripts/byok-embedder/eval-embedder.js` (top-3 hit-rate of a
given embedder over the 24-query set + the 50 holdout queries, run
Node-side with the real model — CI never downloads models).

**Files modified:** `Byok/Rag/ByokRagTypes.js` (+spec: third catalog entry
with size/consent/dimensions/languageNote), `REVIEW/worklog.md` (eval
numbers).

**How to implement:**

1. Build the dataset: ~150 owner pairs + ~5–7k synthetic pairs (2.4k chunks
   × 2–3), judge-passed and deduped; emit `pairs.jsonl` for the notebook.
2. Owner runs the notebook on free Colab (minutes at 22M params); ONNX
   int8 weights go to the hosting from Task 17.2 (HF Hub repo or a
   transformers.js-compatible release layout).
3. Add the catalog entry (id = the hosted repo id; ≈25 MB; 384 dims;
   English-centric note). The existing loader needs no changes.
4. Run the eval runner for stock MiniLM vs finetuned; record both numbers
   in the worklog; apply the D14-6 gate and record the outcome (default
   flip or option-only).
5. If the default flips, note that 14.4 must build the bundle with the new
   default (its manifest is keyed by embedder id, so a later flip would
   mean a second artifact).

**Tests:**

- Dataset spec: pair counts, zero holdout leakage (string match on
  holdout queries against all generation inputs), all pairs judge-passed.
- Catalog spec: the new entry loads through the existing loader contract
  (dimensions, unit-length vectors) using the injected fake loader.
- Eval runner spec: ranking math verified with the hashing embedder.

**ACs:**

- [ ] Eval numbers recorded (stock vs finetuned, 24-query set + holdout).
- [ ] Ship-if-better decision applied and recorded.
- [ ] New embedder usable end-to-end in the picker (desktop QA confirms).
- [ ] All four repo gates green.

### Step 14.4 — Prebuilt RAG bundle: download, import, Qdrant restore, RAG tab

**Goal:** a user gets full semantic RAG in one consented download instead
of a ~30-minute local build (D14-3), with Qdrant users served by a
restored prebuilt snapshot.

**Depends on:** 14.2 (final corpus version), 14.3 (final embedder choice),
owner Tasks 17.2 (hosting) and D14-7 (packaging mechanism).

**Files created:** `newIDE/app/scripts/byok-embedder/build-byok-rag-bundle.js`
(maintainer-run: build the index over the full bundled corpus with the
final embedder; export the file-backend JSON shape `ByokRagStorage` already
persists; wrap with manifest `{embedderId, dimensions, corpusVersion,
chunkerVersion, artifactSha256, created}`); Electron main handler
extension in `newIDE/electron-app/app/` (`ByokRagFiles.js`: download-bundle
→ verify sha256 → hand the parsed index to the renderer for import;
reuse the `ByokQdrant.js` download precedent; no new dependencies unless
D14-7 lands on (b)).

**Files modified:** `Byok/Rag/ByokRagStorage.js` (+spec: import/merge from
a bundle), `Byok/Knowledge/ByokQdrantSetupCore.js` (+spec: new
"restore prebuilt snapshot" branch after the health check: download
snapshot → `POST /collections/gdevelop-byok/snapshots/upload?wait=true` →
verify point count), `Byok/Rag/ByokRagSettingsTab.js` (+spec: the
**Prebuilt index** card: download button with sizes and one consent
dialog (D14-7 (a): index + embedder shown together), version status
(up-to-date / update available / incompatible → "rebuild locally"),
"build locally instead" always visible), `Byok/Rag/ByokRagTypes.js`
(bundle manifest type + version constants).

**How to implement:**

1. Hosting layout: a release tag per bundle generation (e.g.
   `byok-rag-bundle-v1`) on `mrmflis-hub/GDevelop` carrying
   `byok-rag-bundle-v<corpus>-<embedder>.json` (and, for Qdrant users, the
   prebuilt collection snapshot). Assets are owner-uploaded (Task 17.2).
2. Version check on RAG tab mount: compare the bundled corpus version +
   default embedder id against the newest release manifest; surface
   "update available" when they differ (never auto-download).
3. Import path: verified bundle → in-process / file backend (the JSON the
   file backend already persists), embedding **queries** still uses the
   consented embedder download — the UI copy must say the bundle includes
   or pairs with the embedder download honestly (D14-7).
4. Mismatch handling: wrong embedder id / dimensions / corpus version →
   refuse the import with a clear message and offer the local rebuild.
5. Qdrant branch: same hosting, snapshot variant; state machine validates
   the manifest, uploads, verifies, then flips the backend.
6. Offline / failed download → exactly today's behavior (local build).

**Tests:**

- Manifest validation spec (all mismatch dimensions; sha256 wrong →
  refuse).
- Import round-trip spec for both built-in backends.
- `ByokQdrantSetupCore` branch spec (pure CJS, fake HTTP).
- Settings tab spec (jsdom): consent dialog content, version states,
  disabled-when-offline.

**ACs:**

- [ ] Fresh profile: download bundle → semantic `search_knowledge` works
      with no local build (desktop QA, Task 17.5).
- [ ] Mismatched/stale bundle is refused with a rebuild offer, never
      silently served.
- [ ] Qdrant restore branch round-trips on a real Qdrant (desktop QA).
- [ ] Nothing downloads without explicit consent; RAG-off path unchanged.
- [ ] All four repo gates green.

### Step 14.5 — Verification & eval round

**Goal:** measure everything the phase claimed and record it.

**Depends on:** 14.1–14.4.

**How to implement:**

1. Run `eval-embedder.js` for: hashing embedder (CI parity), stock MiniLM,
   finetuned (if shipped); record top-3 numbers for the 24-query set and
   the owner holdout in the worklog.
2. Re-measure the prompt budget totals with the 14.2 hint line; keep the
   8–10k aim reporting.
3. Run all four gates; desktop QA is Task 17.5 (owner).
4. Update `AGENTS.md` §2.

## 4. Phase 14 acceptance criteria (phase gate)

- [ ] System prompt byte-stable within a chat (spec-proven), invalidation
      only on project flip / new chat.
- [ ] Minified docs layer: whole wiki bundled, category maps + page chunks
      in the corpus, lexical discovery works with RAG off and offline,
      depth via `read_doc_page`, hint line in budget, prompt `byok-v10`.
- [ ] Pipeline sanity pass green (zero unknown engine tokens outside the
      documented allowlist).
- [ ] Embedder finetuning executed per D14-6 with recorded eval numbers and
      an applied ship-if-better decision (or the gate documented as
      not-yet-run if the owner defers Tasks 17.1/17.4 — the step is then
      marked blocked, not skipped).
- [ ] Prebuilt bundle: download → consent → import → semantic search with
      no local build; manifest mismatches refused; Qdrant restore branch
      works; nothing automatic.
- [ ] All four repo gates green; worklog entry complete; `AGENTS.md` §2
      updated.

## 5. Explicitly not in this phase

- **Zero-shot classification routing** — rejected (D14-4, `deferred.md`).
- **Triage→coding pipeline / execution blueprint; assistant prefilling** —
  rejected (D14-5, `deferred.md`).
- **Multilingual embedders / translated queries** — the default embedder is
  English-centric and the corpus is English; a multilingual pass is a
  separate decision.
- **Qdrant or any RAG component as a bundled dependency** — stays opt-in
  download forever (D14-3).
- **Replacing the RAG-off lexical path or the hosted AI behavior** — the
  phase only adds layers.
- **MCP-side `search_knowledge` parity** — still deferred from Phase 13.
- **Displacing full-doc corpus chunks with minified chunks** — only on
  future eval data.

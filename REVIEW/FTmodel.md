# FTmodel — Local fine-tuned generation model (long-term track, NOT scheduled)

> **Status: explicitly NOT a next step.** This is a long-term research and
> engineering track, filed 2026-09-25 by the owner (decision 2 of the
> Phase 13 planning round). Nothing here is scheduled, budgeted, or
> green-lit for implementation. It is written in the phase-doc style so it
> can be lifted into a real phase later, but the name is deliberate: this
> is the *fine-tuning model* file, kept apart from the numbered phases so
> nobody reads it as "do soon". Do not start any of this without a fresh
> owner order.
>
> Prereading: `Phase13.md` §13.7 covers the on-device RAG track that IS
> scheduled. This file is the much heavier sibling: making the *generator*
> local, not the retriever.

## 1. Goal

A locally-running GDevelop generation model — private, offline, no
per-token cost — that is good enough at BYOK-style tool calling and
EventScript to be a real daily-driver option, not a demo. The owner's
direction (2026-09-25):

- **Bigger base model + LoRA**, rather than training a tiny model from
  scratch. A 300M-param RAG embedder can be trained casually (and Phase
  13 deliberately avoids even that by using an off-the-shelf embedder);
  a *generator* that plans multi-step builds and emits valid EventScript
  needs a 7–8B-class base with a LoRA/QLoRA adaptation.
- **Ternary Bonsai-class bases are the interesting candidate**: BitNet
  b1.58-style ternary models run on dedicated llama.cpp forks with
  ternary kernels and stay **mostly CPU-bound** — which fits the BYOK
  users who run local setups, and avoids GPU requirements for inference.
- **Training tooling: Unsloth-style** (single-GPU or rented-GPU LoRA
  runs, notebook-driven, cheap iterations).
- Inference ships as an **OpenAI-compatible local endpoint** — BYOK
  already speaks that dialect, so integration cost is near zero (point
  BYOK at `http://127.0.0.1:<port>/v1`).

## 2. Why this is NOT scheduled with Phase 13

- Phase 13's RAG (retrieval) needs a ~25 MB embedder; a competitive local
  *generator* means a 1–8 GB model download at minimum, a training run,
  and an ongoing retraining cadence every time the engine surface changes
  (new tools, prompt version bumps like byok-v8→v9, EventScript grammar
  evolution).
- Quality risk is real: hosted frontier models set the bar users compare
  against; a LoRA'd 7–8B (or a ternary 2–4B) will trail on long
  multi-tool builds. It only wins on privacy/cost/offline.
- The right time is **after Phase 13 lands**, so the fine-tune can target
  the settled prompt/tool contract (byok-v9 + `search_knowledge`) and the
  RAG gap analysis can tell us which tasks a local model must cover.

## 3. Candidate approach (for the future phase doc)

### Step FT.1 — Freeze the target contract

- Pick the prompt/tool version to train against (byok-v9 post-Phase 13)
  and freeze the corpus generator against it. A model trained on a
  shifting contract is waste.

### Step FT.2 — Corpus assembly

- Sources: engine-reference corpus, EventScript example bank (Phase 13
  step 13.6), bundled docs, the owner's `DOCs\` clone, and — the most
  valuable part — **synthetic tool-call transcripts**: run the existing
  eval harness (`scripts/run-byok-evals.js`) against a strong hosted
  model, capture successful trajectories, and format them as
  chat-completions training examples (system prompt + tool schemas +
  assistant tool_calls + tool outputs + final answers).
- Privacy: only synthetic or owner-consented transcripts; never ship
  third-party users' `byok-chats`.
- Volume target: a few thousand clean trajectories + corpus QA pairs;
  quality over quantity for a LoRA.

### Step FT.3 — Base model + training run

- Candidates to benchmark at that time: a mainstream 7–8B instruct base
  (safe quality floor) vs a ternary Bonsai-class base (CPU-friendly
  inference, softer quality). Decision gate: measure the ternary fork's
  tool-call reliability *before* training on it.
- Training: QLoRA via Unsloth-style notebooks on a rented GPU (hours, not
  days); export merged weights → GGUF (and the ternary format if a Bonsai
  base wins).

### Step FT.4 — Inference packaging

- CPU path: the ternary/llama fork with BitNet kernels; fallback: generic
  llama.cpp with Q4/Q8 GGUF (still CPU-viable at 7–8B for chat latencies
  on a desktop).
- Ship as a managed local endpoint (download-with-consent, spawn on
  demand like the Phase 13 Qdrant pattern: download → install under
  userData → health check → OpenAI-compatible `/v1` on loopback), then a
  one-click "Use my local model" provider entry in BYOK settings.

### Step FT.5 — Evaluation

- `run-byok-evals` with the LLM-as-judge pass, judged by a *hosted*
  model, comparing the local model against a hosted reference on the
  same tasks; EventScript validity rate via the real writer (the same
  round-trip test Phase 13 uses for the example bank).

## 4. Risks / open questions for the future owner review

- Inference speed of the chosen base on the owner's target hardware.
- Retraining cadence vs engine evolution (who pays attention when tools
  change?).
- Context window of small/ternary models vs the Phase 13 budget
  (8–15k prompt + tool outputs) — likely fine, must be measured.
- Distribution/licensing of the base model and the trained adapter.

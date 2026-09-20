# Agents Working in This Repository — Operating Manual

You are an AI agent (or a human following agent-style discipline) working in
`D:\Projects\GDevelop`. Read this file fully before touching anything. The style
rules live in [styleguide.md](styleguide.md); this file is the operating manual:
what the project is, what you may do, and what makes a run pass or fail.

---

## 1. What this project is

Adding **BYOK (Bring Your Own Key)** to the GDevelop IDE: the user provides an
OpenAI-compatible endpoint and API key; the existing "Ask AI" chat then runs
against that endpoint instead of GDevelop's hosted backend. GDevelop's current AI
runs its agent loop **server-side** (see `REVIEW/report.md` section 2), so BYOK
means building a client-side orchestrator that reuses the existing tool registry
(`src\EditorFunctions`), chat UI (`src\AiGeneration\AiRequestChat`), and message
types (`src\Utils\GDevelopServices\Generation.js`), while adding as little code
as possible to existing files.

Read `REVIEW/report.md` first. Then work phase by phase from
`REVIEW/Phase1.md` → `REVIEW/Phase4.md`. Do not skip ahead: each phase assumes
the previous one's acceptance criteria (ACs) all pass.

## 2. Non-negotiable rules

A run **fails** if any of these is violated:

1. **Worklog.** After every working session, append an entry to
   `REVIEW/worklog.md` containing all five mandatory items (date, description of
   actions, bugs found, issues found, full list of files worked on). Subagents
   must **not** write worklog entries — only the orchestrating agent writes them,
   one consolidated entry per session. Missing any of the 5 items = failed run.
2. **Max 5 subagents at once.** The provider rate-limits more. Waves of ≤ 5.
3. **Windows 11 machine.** Shell is the classic Command Prompt: `dir`, `findstr`,
   `type` work; `ls`, `head`, `grep`, `cat`, `sed`, `awk` do not. Prefer the
   dedicated Read/Glob/Grep tools over shell text-mangling. Paths with spaces
   need quotes. npm is the package manager in this checkout.
4. **Every function gets a test.** Co-located `*.spec.js`, same style as
   `AiRequestUtils.spec.js` (small `makeXxx()` factories). DOM-dependent tests
   need `@jest-environment jsdom` docblock. All of `npm test`, `npm run lint`,
   `npm run flow`, `npm run check-format` must pass from `newIDE\app` before you
   declare a step done.
5. **Code is written for humans.** No nested loops, no nested ifs (guard clauses
   and early returns instead), no clever one-liners, longer-but-readable wins.
   Flow-typed (`// @flow`, exact object types), Prettier-formatted, Lingui
   `<Trans>` for every user-visible string. Details in styleguide.md section 5.

## 3. Scope rules

- **New BYOK code goes in `newIDE\app\src\AiGeneration\Byok\`** (plus one new
  helper module and one small handler block in `newIDE\electron-app\app` in
  Phase 3). Existing files may only be changed at the exact touchpoints listed in
  the phase documents (`report.md` section 5 is the full budget). If you find
  yourself editing anything else, stop and record why in the worklog under
  "Issues found" before doing it.
- **Documentation only in `/REVIEW`.** Never create `.md` files elsewhere.
- **No new npm dependencies** without explicit user approval.
- **Never** edit anything under `newIDE\app\src\locales` by hand (Lingui
  pipeline owns it), and never modify files under `Binaries`, `Core`, `GDJS`,
  `Extensions`, `GDevelop.js` for this project — the BYOK feature is IDE-only.
- Git: this checkout is not a git repository, so there is no committing. Do not
  initialize one, do not delete or "clean up" files you did not create.

## 4. Environment cheat sheet

```
cd /d D:\Projects\GDevelop\newIDE\app     (cd needs /d to switch drives in cmd)
dir /b src\AiGeneration                    list a folder
findstr /n /s /i "Byok" src\*.js           search (n=line numbers, s=subfolders, i=case-insensitive)
type src\SomeFile.js                       print a file (prefer the Read tool)
npm test -- --watchAll=false               run the Jest suite once
npm run lint                               ESLint, zero warnings allowed
npm run flow                               Flow type check
npm run check-format                       Prettier diff check
npm run format                             Prettier write
```

Electron main process (`newIDE\electron-app\app`) has **no test runner** — keep
anything you add there trivial (thin handlers delegating to renderer-tested
logic) and verify it with the manual checklist in `Phase3.md`.

## 5. Using subagents

- Use subagents for **read-only mapping and verification** ("find where X
  happens, with file:line evidence"), not for writing code. Code is written by
  the orchestrating agent so the style rules are enforced consistently.
- A subagent prompt must be self-contained: absolute repo path, the question,
  what files/areas to look at, the required output format, and "READ-ONLY, do not
  modify anything".
- Dispatch at most 5 per wave; wait for results before the next wave.
- After a wave: consolidate findings, then write the single worklog entry for the
  session yourself (the subagents do not).

## 6. Working a step (per-phase loop)

For each step in the current `PhaseN.md`:

1. Read the step, its "Depends on", and every file it references.
2. Implement following the numbered guide. Stay inside the step's
   files-created / files-modified lists.
3. Write the tests the step requires (every function = one test minimum).
4. Run `npm test -- --watchAll=false`, `npm run lint`, `npm run flow`,
   `npm run check-format` from `newIDE\app`. Fix until green.
5. Check every AC of the step. An AC you cannot verify goes in the worklog under
   "Issues found" — never silently skip it.
6. After the phase's last step: run the phase's manual QA checklist (if any),
   then write the worklog entry.

## 7. When something doesn't match the docs

The repository moves; the phase docs were written on 2026-09-13. If a line
number, function name, or structure has shifted upstream:

- Re-locate the equivalent spot yourself (search, don't guess).
- Record the difference in the worklog under "Issues found" with the new
  `file:line`.
- Keep the *intent* of the step (the ACs), not the literal line numbers.

---

*Last updated: 2026-09-13.*

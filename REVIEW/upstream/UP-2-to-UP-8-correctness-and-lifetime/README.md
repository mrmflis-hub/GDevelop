# UP-2 … UP-8 — correctness and object-lifetime fixes

Companion package to `../upstream.md` (UP-1, the security fix, which should
be filed on its own and first). These seven are **not security issues**. They
are correctness and memory-lifetime bugs found in the same audit, all fixed in
our fork since 2026-10-02, all with tests.

Each one is a self-contained patch in `patches/`. **They are deliberately NOT
bundled into one PR** — see the recommended split below.

---

## The findings, ordered by how much they matter

| # | Severity | One line | Patch |
|---|---|---|---|
| UP-2 | medium | Closing ANY preview window fires the WRONG launch's capture callback | `UP-2-preview-window-closed-routing.diff` |
| UP-3 | medium | "Replace event but keep sub-events" silently DELETED the sub-events | `UP-3-preserve-sub-events-reports-loss.diff` |
| UP-4 | low | Six `SerializerElement` wrappers leak when serialization throws | `UP-4-UP-5-wasmm-wrapper-lifetime.diff` |
| UP-5 | low | The exporter + export options leak when a preview export throws | `UP-4-UP-5-wasmm-wrapper-lifetime.diff` |
| UP-6 | low | An explicit `didModifyProject: false` collapsed into "not reported" | `UP-6-didModifyProject-false-survives.diff` |
| UP-7 | low-med | A short instance-id prefix can match several instances and mutate them all | `UP-7-instance-id-resolution.diff` |
| UP-8 | low | `gd.Polygon2d` ownership on `push_back` is undocumented — and deleting corrupts the heap | `UP-8-polygon2d-ownership-document.diff` |

---

## Recommended split into PRs

Seven unrelated bug fixes in one PR is a PR nobody merges. Suggested grouping,
each independently reviewable and independently landable:

**PR A — "Fix wrong-callback and silent-data-loss bugs"** (the two mediums;
the ones a user can actually lose work to)
- UP-2, UP-3. Touches `PreviewWindow.js`, `LocalPreviewLauncher/index.js`,
  new `PreviewClosedTracker.js` (+ spec), `ApplyEventsChanges.js` (+ spec).

**PR B — "Release WASM wrappers on the throw path"**
- UP-4, UP-5. One idea, one pattern, two files: `Utils/Serializer.js`,
  `LocalPreviewLauncher/index.js` (+ specs).

**PR C — "Don't widen instance-id prefixes"**
- UP-7. `EditorFunctions/InstanceTools.js`, `EditorFunctions/index.js`,
  (+ spec). Self-contained and the highest-value of the lows.

**PR D — "Small contract and documentation fixes"**
- UP-6, UP-8. Two tiny changes; UP-8 is comments plus inverse tests only, so
  it can also ride along with anything.

---

## What is in this folder

```
patches/UP-2-preview-window-closed-routing.diff
patches/UP-3-preserve-sub-events-reports-loss.diff
patches/UP-4-UP-5-wasmm-wrapper-lifetime.diff
patches/UP-6-didModifyProject-false-survives.diff
patches/UP-7-instance-id-resolution.diff
patches/UP-8-polygon2d-ownership-document.diff
newIDE/app/src/ExportAndShare/LocalPreviewers/LocalPreviewLauncher/
    PreviewClosedTracker.js          <- the one NEW source file, in full
    PreviewClosedTracker.spec.js     <- its spec, in full
```

Only `PreviewClosedTracker.js` is included as a whole file, because it is new
and it is where the substance of UP-2 lives. For the rest, the patches are
annotated diffs: the changes are a handful of lines inside files that are
hundreds or thousands of lines long, and pasting those files in full would
bury the fix. Each diff file opens with the issue in prose, then the change,
then what a reviewer should check.

---

## Two things worth reading even if you apply none of these

1. **UP-8's inverse tests.** The leak that must NOT be fixed is pinned by
   asserting `delete` is never called. A test that asserts a leak does not
   happen cannot catch a leak that does. That pattern transfers.

2. **UP-2's `preview-window-closed` payload change.** It goes from
   no-argument to one number. That is a behavioural change to a shared IPC
   channel, and any other listener on it in upstream would receive an argument
   it does not expect. It is the only change in this package with that
   property, so it is the one to grep for.

---

## How these were verified

All eight findings (UP-2 … UP-8) are fixed in our fork with co-located tests,
and the full suite passes: **252 suites / 2,959 tests**, lint clean, Flow
clean, Prettier clean for both packages. Each finding's patch file names the
specific test cases, including the regressions that assert the previous
behaviour still holds — so a reviewer can check both "does the bug fail before"
and "does everything else still pass after" from the test names alone.

# Upstream report — UP-1: the `local-file-download` IPC is unconfined and leaks the GDevelop cloud session cookie

**Status:** ready to file as a PR against GDevelop. Prepared 2026-10-03 from
our own fork (`mrmflis-hub/GDevelop`), where the fix is applied in-tree with
tests and has been in production use on our side since 2026-10-02.

This document is self-contained: you should be able to read it, agree or
disagree with the finding, and review the patch without reading anything else
in this repository.

---

## 1. The short version

The desktop app exposes two Electron IPC channels that write to the local
filesystem on behalf of the renderer:

- `local-file-download` — download a URL to an arbitrary path
- `local-file-save-from-arraybuffer` — write an `ArrayBuffer` to an arbitrary
  path

Both took the target path and the URL straight from the renderer, with **no
validation at all**, and the download handler attached the user's **GDevelop
cloud session cookie** (`gd_resource`) to **whatever host the URL named**.

So any code running in the renderer — including content that reached it from
outside, such as a project file, a remote template, or an AI model that
proposes a URL — could:

1. **Steal the user's GDevelop cloud session.** Name any host it liked and
   the handler sent `Cookie: gd_resource=<session>` to it.
2. **Write anywhere on the filesystem.** `outputPath` was never checked, so
   it could drop an executable or a startup item anywhere the user could
   write.
3. **Read local files through the same channel in reverse**, since a
   `file://` URL was not excluded either.
4. **Exhaust disk or memory**, with no size cap and no timeout.

The fix confines the channel: the URL must be `http`/`https`, the cloud
cookie is attached only to `gdevelop.io` and its subdomains, the output path
must stay inside a caller-declared base folder, and the transfer is capped in
bytes and time.

---

## 2. The issue, with the original code

### 2.1 The cookie was attached to every host

```js
// newIDE/electron-app/app/LocalFileDownloader.js — BEFORE
const findGDevelopCloudCookieValue = async () => {
  let cookies = await session.defaultSession.cookies.get({
    domain: 'gdevelop.io',
    name: 'gd_resource',
  });
  return cookies[0] ? cookies[0].value : null;
};

module.exports = {
  downloadLocalFile: async (url, outputPath) => {
    const gdevelopCloudCookieValue = await findGDevelopCloudCookieValue();
    //                       ^^^^^^^^^^^^^^^^ read unconditionally,
    //                                    never consulted about `url`
    const response = await axios.get(url, {
      responseType: 'stream',
      headers: gdevelopCloudCookieValue
        ? { Cookie: `gd_resource=${gdevelopCloudCookieValue}` }
        : {},
    });
```

The cookie is the user's authenticated GDevelop cloud session. It is read
from the Electron cookie store, where the browser's own same-origin policy
never applies — an `axios` call from the main process bypasses it entirely.

### 2.2 Nothing checked the URL scheme

`axios.get('file:///C:/Users/me/.ssh/id_rsa')` — the response is streamed
straight into a file the caller chose. `axios.get('ftp://…')` and similar
schemes behaved the same way.

### 2.3 Nothing checked the destination path

```js
// newIDE/electron-app/app/main.js — BEFORE
ipcMain.handle('local-file-download', async (event, url, outputPath) => {
  const result = await downloadLocalFile(url, outputPath);
  return result;
});
ipcMain.handle(
  'local-file-save-from-arraybuffer',
  async (event, arrayBuffer, outputPath) => {
    const result = await saveLocalFileFromArrayBuffer(arrayBuffer, outputPath);
    return result;
  }
);
```

Two arguments, both renderer-supplied, neither checked. `outputPath` could be
`C:\Users\<you>\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\evil.exe`.

### 2.4 Nothing bounded the transfer

No byte cap, no timeout. A malicious or misconfigured server could stream
forever, filling the disk.

### 2.5 How reachable is it in practice?

The renderer is not a hostile environment by default — but it is not a
trusted one either. In our fork the BYOK feature lets a **large language
model** propose URLs that are then passed to this channel. That turns a
"model hallucinated a plausible URL" failure mode into a credential-exfiltration
one. The same channel is also reachable from anything that can influence a
project: a shared `.json` project file can name an arbitrary resource URL,
and `import_project_resources`-style flows download it.

We are not claiming an active exploit in stock GDevelop. We are reporting a
**missing trust boundary** in a privileged channel, because every consumer of
it has to re-implement the checks, and none of them did.

---

## 3. Why this is worth fixing upstream

**Severity: high.** Impact is credential theft and arbitrary file write,
requiring only renderer-level code execution. Likelihood in stock GDevelop is
lower than in our fork (no model-in-the-loop), but the channel is a
**privilege escalation primitive**: anything that reaches the renderer inherits
it.

**Blast radius is the user's whole session.** `gd_resource` is the
GDevelop cloud session cookie. It is sent with `SameSite` semantics that do
not apply here, because this is not a browser navigation — it is a
`session.defaultSession.cookies.get()` read followed by a hand-built header.
A hostile host receives the exact value.

**It is a two-line-ish fix for the security half.** Protocol check and a
host allow-list for the cookie are trivial and have no realistic downside.
The containment, cap and timeout are more code but equally mechanical.

**It is already proven.** Our fork has shipped this exact patch since
2026-10-02, with 16 unit tests, and it has not broken a single export in
normal use (we specifically re-verified the online-export path, since that is
the feature that legitimately uses the channel heavily).

---

## 4. The fix

Five rules, all enforced in the **main process** (the privileged side), with
the pure logic extracted into a module that can be unit-tested without
Electron.

| # | Rule | Why |
|---|---|---|
| 1 | URL scheme must be `http` or `https` | Blocks `file://` local-file reads |
| 2 | `gd_resource` cookie attached **only** to `gdevelop.io` / `*.gdevelop.io` | Stops credential exfiltration |
| 3 | Output path must resolve inside a caller-declared `basePath` | Blocks arbitrary write |
| 4 | 200 MB byte cap | Blocks disk exhaustion |
| 5 | 60 s overall timeout + 5-hop redirect cap | Blocks resource exhaustion and redirect loops |

Plus one subtlety that is easy to miss and that we got wrong on the first
attempt:

> **The bundled `axios@0.19.1` forwards request headers across cross-host
> redirects.** So even with rule 2 implemented on the initial request, a
> `gdevelop.io` URL that 302s to `evil.example` would carry the cookie on the
> *second* hop. The fix therefore disables axios's automatic redirect
> following (`maxRedirects: 0`) and walks the chain itself, re-validating and
> re-deciding the cookie at **every hop**.

### 4.1 The new module: `newIDE/app/src/Utils/LocalFileDownloadCore.js`

Pure, dependency-free, CommonJS, no Electron — so it can be required by the
main process *and* specced by the renderer test suite.

- `validateLocalFileDownloadRequest({url, outputPath, basePath, pathLib})`
  — pure; every argument is untrusted.
- `validateLocalFileSavePath({outputPath, basePath, pathLib})` — the sibling
  handler's rule (path only, no URL).
- `shouldAttachGDevelopCloudCookie(hostname)`.
- `isPathInsideFolder(pathLib, folder, candidate)` — **segment-aware**, so
  `/projects/game2/x` is not treated as inside `/projects/game`. A naive
  `startsWith` check has this bug.
- `makeByteCapGuard(maxBytes)` — a streaming counter that returns `false`
  from then on once exceeded, so the caller can destroy the stream.

### 4.2 The main-process handler: `newIDE/electron-app/app/LocalFileDownloader.js`

Same exported names and same success contract (`true` on success), so callers
are unaffected apart from the new required argument. Changes:

- Both functions take a third `basePath` argument and validate first.
- The download follows redirects manually, re-validating each hop and
  re-deciding the cookie per host.
- The byte cap is enforced as the stream arrives; an overall watchdog timer
  rejects a transfer that does not finish in 60 s (axios's own `timeout` only
  covers connection setup and socket inactivity, not total transfer time).
- On any failure the partially written file is removed, as before.

### 4.3 The IPC registration: `newIDE/electron-app/app/main.js`

Threads `basePath` through. That is the entire diff — see
`UP-1-local-file-download/patches/main.js.diff`.

### 4.4 The renderer: `newIDE/app/src/Utils/LocalFileDownloader.js`

`downloadUrlsToLocalFiles` already destructured a `basePath` for its *own*
progress bookkeeping but never sent it. It now passes it as the third IPC
argument. **This is the API-breaking part**: every caller of
`downloadUrlsToLocalFiles` must now supply a meaningful `basePath`, and
every caller of the raw `local-file-download` / `local-file-save-from-arraybuffer`
channels must send one. In our tree that is ten renderer call sites in total — eight
exporters, `CloudProjectResourcesHandler`, and the one blob path in
`LocalFileResourceMover` — each itemised with a line number in
`patches/renderer-callers.diff`, which also lists the four spellings to grep
for when checking that nothing was missed.

---

## 5. Behaviour changes a reviewer should check

1. **`basePath` is now mandatory** on both channels. A caller that omits it
   gets a refusal, not a permissive default. We chose a loud failure over a
   silent fallback precisely so that new call sites cannot inherit the
   vulnerability by accident.
2. **A download to a path outside the declared base folder now fails.** In
   our tree no legitimate caller relied on that; the exporters all write under
   the project's own folder. If upstream has a caller that writes elsewhere
   (e.g. to a temp dir chosen at runtime), it needs to declare that folder as
   its base — which is the point: the base becomes explicit and reviewable.
3. **`http://` is allowed, not just `https://`.** Local-network exports during
   development are legitimate and forcing TLS everywhere would be a regression
   for some users. The scheme restriction is what blocks `file://`.
4. **The cookie is no longer sent to non-GDevelop hosts even when they are
   legitimately downloading a resource.** In practice, GDevelop's own asset
   and storage CDN is a `gdevelop.io` subdomain, so this is a no-op for real
   traffic — but it is worth a sanity check against any CDN host that is not
   under `gdevelop.io`.
5. **Partial files are still cleaned up** on failure, unchanged from before.

---

## 6. Files in this package

```
upstream.md                                          <- this document
UP-1-local-file-download/
  newIDE/app/src/Utils/LocalFileDownloadCore.js           NEW      full file
  newIDE/app/src/Utils/LocalFileDownloadCore.spec.js      NEW      full file (16 tests)
  newIDE/electron-app/app/LocalFileDownloader.js         MODIFIED full file
  newIDE/app/src/Utils/LocalFileDownloader.js            MODIFIED full file (renderer side)
  patches/main.js.diff                                             IPC registration only
  patches/renderer-callers.diff                                the basePath call-site updates
```

Every copied file carries a banner at the top explaining the general issue and
inline comments explaining the particulars — what each rule does and why it is
there. Strip the banners and the inline `// UP-1:` comments if you would
rather review it as a plain diff.

---

## 7. How the fix was tested

`LocalFileDownloadCore.spec.js`, 16 cases, all of which fail against the
unpatched code and pass against the patched code:

- accepts `gdevelop.io` and its subdomains for the cookie; refuses everything
  else, including `notgdevelop.io`, `gdevelop.io.evil.example`, and
  `GDEVELOP.IO.evil.example`;
- refuses `file://`, `ftp://` and unparseable URLs;
- refuses `outputPath` escaping the base folder via `..`;
- refuses an absolute `outputPath` outside the base folder;
- refuses a **sibling folder whose name merely extends the base folder**
  (`/projects/game2` inside `/projects/game`) — the regression that a naive
  `startsWith` would have;
- refuses empty and non-string arguments for both channels;
- byte cap: accepts chunks up to the cap, refuses the first byte over it, and
  keeps refusing afterwards.

The integration side (real HTTP server, real Electron session) was exercised
manually on our fork: a normal online export downloads its resources
correctly through the confined channel.

---

## 8. What we did not change

- We did not add an allow-list of permitted *hosts* for downloading. The
  exporter legitimately downloads from user-specified asset and resource URLs
  (a project file can name any URL), so a host allow-list would break the
  feature. The cookie rule is host-scoped instead, which is the part that
  matters for credential safety.
- We did not sandbox the renderer or add a permission prompt. That is a much
  larger change and belongs to a security design discussion, not a patch.
- We did not change the return contract or the error type of either channel.
  Callers still `await` and catch; they now just get a thrown `Error` with a
  readable message instead of silently writing wherever they liked.

---

## 9. The other seven findings — packaged separately

Our audit found seven further upstream issues in this repository, fixed in our
fork but not security issues, so they belong in their own reviewable patches
rather than riding along with a security fix.

They are packaged in **`UP-2-to-UP-8-correctness-and-lifetime/`** — see its
`README.md` for a summary table and a recommended four-PR split.

| ID | Severity | Summary |
|---|---|---|
| UP-2 | medium | `preview-window-closed` is broadcast with no window discriminator, so one launch's capture callback fires for another preview's window |
| UP-3 | medium | `replace_event_but_keep_existing_sub_events` silently deletes the sub-events it was asked to preserve |
| UP-4 | low | `SerializerElement` WASM wrappers leak when (un)serialization throws (six functions) |
| UP-5 | low | Exporter + `PreviewExportOptions` leak when a preview export throws |
| UP-6 | low | `didModifyProject: false` is squashed to `undefined` by `false || undefined`, losing the "reported, did not modify" case |
| UP-7 | low-med | Instance ids match by `startsWith`, so a short prefix can over-match and mutate several instances |
| UP-8 | low | `gd.Polygon2d` ownership on `push_back` is undocumented and binding-specific — deleting corrupts the WASM heap, so the fix documents it and pins it with INVERSE tests |

Two of these are worth an upstream reviewer's attention beyond the fix itself:

- **UP-8's inverse tests.** The leak that must *not* be fixed is pinned by
  asserting `delete` is never called. A test asserting a leak does not happen
  cannot catch a leak that does — that pattern transfers to any WASM-backed
  codebase.
- **UP-2 changes an IPC payload** from no-argument to one number, so any
  other listener on that channel upstream would need to tolerate the extra
  argument. It is the only change across both packages with that property.

File UP-1 first (it is the security one and the one worth a maintainer's
attention), then pick from the split.

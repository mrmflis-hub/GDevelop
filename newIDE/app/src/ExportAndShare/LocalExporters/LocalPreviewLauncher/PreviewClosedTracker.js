// @flow
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
      await onCaptureFinished(captureOptions);
    },

    releaseAll: () => {
      ownedPreviewWindows.clear();
    },
  };
};

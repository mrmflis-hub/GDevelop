// @flow
import { createPreviewClosedTracker } from './PreviewClosedTracker';
import type { CaptureOptions } from '../../PreviewLauncher.flow';

const makeCaptureOptions = (signedUrl: string): CaptureOptions => ({
  screenshots: [
    {
      signedUrl,
      delayTimeInSeconds: 2,
      publicUrl: `${signedUrl}/public`,
    },
  ],
});

describe('PreviewClosedTracker', () => {
  it('fires the capture handling of the launch owning the closed window, and only of that launch', async () => {
    const onCaptureFinished = jest.fn<[CaptureOptions], Promise<void>>(() =>
      Promise.resolve()
    );
    const tracker = createPreviewClosedTracker(onCaptureFinished);
    const firstLaunchCaptureOptions = makeCaptureOptions('first-launch');
    const secondLaunchCaptureOptions = makeCaptureOptions('second-launch');

    tracker.own([1], firstLaunchCaptureOptions);
    tracker.own([2], secondLaunchCaptureOptions);

    await tracker.handleClosed(1);

    expect(onCaptureFinished).toHaveBeenCalledTimes(1);
    expect(onCaptureFinished).toHaveBeenCalledWith(firstLaunchCaptureOptions);
    expect(onCaptureFinished).not.toHaveBeenCalledWith(
      secondLaunchCaptureOptions
    );

    await tracker.handleClosed(2);

    expect(onCaptureFinished).toHaveBeenCalledTimes(2);
    expect(onCaptureFinished).toHaveBeenLastCalledWith(
      secondLaunchCaptureOptions
    );
  });

  it('fires the capture handling only once for a window, even if its closing is reported twice', async () => {
    const onCaptureFinished = jest.fn<[CaptureOptions], Promise<void>>(() =>
      Promise.resolve()
    );
    const tracker = createPreviewClosedTracker(onCaptureFinished);

    tracker.own([1], makeCaptureOptions('launch'));
    await tracker.handleClosed(1);
    await tracker.handleClosed(1);

    expect(onCaptureFinished).toHaveBeenCalledTimes(1);
  });

  it('does nothing for the closing of a window that no launch owns', async () => {
    const onCaptureFinished = jest.fn<[CaptureOptions], Promise<void>>(() =>
      Promise.resolve()
    );
    const tracker = createPreviewClosedTracker(onCaptureFinished);

    tracker.own([1], makeCaptureOptions('launch'));
    await tracker.handleClosed(42);

    expect(onCaptureFinished).not.toHaveBeenCalled();
  });

  it('replaces the ownership of a window id when it is launched again', async () => {
    const onCaptureFinished = jest.fn<[CaptureOptions], Promise<void>>(() =>
      Promise.resolve()
    );
    const tracker = createPreviewClosedTracker(onCaptureFinished);
    const firstLaunchCaptureOptions = makeCaptureOptions('first-launch');
    const secondLaunchCaptureOptions = makeCaptureOptions('second-launch');

    tracker.own([1], firstLaunchCaptureOptions);
    tracker.own([1], secondLaunchCaptureOptions);
    await tracker.handleClosed(1);

    expect(onCaptureFinished).toHaveBeenCalledTimes(1);
    expect(onCaptureFinished).toHaveBeenCalledWith(secondLaunchCaptureOptions);
  });

  it('handles a launch owning multiple windows', async () => {
    const onCaptureFinished = jest.fn<[CaptureOptions], Promise<void>>(() =>
      Promise.resolve()
    );
    const tracker = createPreviewClosedTracker(onCaptureFinished);
    const captureOptions = makeCaptureOptions('multi-window-launch');

    tracker.own([3, 4], captureOptions);
    await tracker.handleClosed(3);
    await tracker.handleClosed(4);

    expect(onCaptureFinished).toHaveBeenCalledTimes(2);
    expect(onCaptureFinished).toHaveBeenNthCalledWith(1, captureOptions);
    expect(onCaptureFinished).toHaveBeenNthCalledWith(2, captureOptions);
  });

  it('forgets every owned window on releaseAll, without firing the capture handling', async () => {
    const onCaptureFinished = jest.fn<[CaptureOptions], Promise<void>>(() =>
      Promise.resolve()
    );
    const tracker = createPreviewClosedTracker(onCaptureFinished);

    tracker.own([1], makeCaptureOptions('launch'));
    tracker.releaseAll();
    await tracker.handleClosed(1);

    expect(onCaptureFinished).not.toHaveBeenCalled();
  });
});

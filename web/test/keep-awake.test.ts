// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScreenAwake } from '../src/ui/keep-awake.ts';

function setWakeLock(request: (type: 'screen') => Promise<WakeLockSentinel>): void {
  Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } });
}

function mockPlay(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(HTMLVideoElement.prototype, 'play').mockImplementation(function (this: HTMLVideoElement) {
    Object.defineProperty(this, 'paused', { configurable: true, value: false });
    return Promise.resolve();
  });
}

afterEach(() => {
  delete window.ReaderAndroid;
  document.body.replaceChildren();
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  delete (HTMLCanvasElement.prototype as { captureStream?: unknown }).captureStream;
  vi.restoreAllMocks();
});

describe('ScreenAwake', () => {
  it('uses the window flag when this app is installed', () => {
    const setKeepScreenOn = vi.fn();
    window.ReaderAndroid = { setKeepScreenOn } as unknown as NonNullable<Window['ReaderAndroid']>;
    const request = vi.fn();
    setWakeLock(request);
    const awake = new ScreenAwake();
    awake.start();
    expect(setKeepScreenOn).toHaveBeenCalledWith(true);
    expect(request).not.toHaveBeenCalled();
    awake.stop();
    expect(setKeepScreenOn).toHaveBeenCalledWith(false);
  });

  it('takes the screen wake lock used by iOS and the mobile browsers, then releases it', async () => {
    const release = vi.fn(async () => undefined);
    const sentinel = { released: false, addEventListener: vi.fn(), release } as unknown as WakeLockSentinel;
    const request = vi.fn(async () => sentinel);
    setWakeLock(request);
    const awake = new ScreenAwake();
    awake.start();
    await Promise.resolve();
    expect(request).toHaveBeenCalledWith('screen');
    awake.stop();
    expect(release).toHaveBeenCalledOnce();
  });

  it('asks for the lock again after the page was hidden and the system dropped it', async () => {
    let released = false;
    const sentinel = {
      get released() { return released; },
      addEventListener: vi.fn(),
      release: vi.fn(async () => undefined),
    } as unknown as WakeLockSentinel;
    const request = vi.fn(async () => sentinel);
    setWakeLock(request);
    const awake = new ScreenAwake();
    awake.start();
    await Promise.resolve();
    released = true;
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(2);
    awake.stop();
  });

  it('plays an inline clip when the browser has no wake lock', async () => {
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: undefined });
    const play = mockPlay();
    const awake = new ScreenAwake();
    awake.start();
    await Promise.resolve();
    const video = document.querySelector('video');
    expect(play).toHaveBeenCalledOnce();
    expect(video?.getAttribute('playsinline')).toBe('');
    expect(video?.getAttribute('x5-video-player-type')).toBe('h5');
    expect(video?.src.startsWith('data:video/mp4')).toBe(true);
    awake.stop();
    expect(document.querySelector('video')).toBeNull();
  });

  it('plays the clip when a phone browser grants the lock and then drops it', async () => {
    let released = false;
    let onRelease = (): void => undefined;
    const sentinel = {
      get released() { return released; },
      addEventListener: (_type: string, listener: () => void) => { onRelease = listener; },
      release: vi.fn(async () => undefined),
    } as unknown as WakeLockSentinel;
    setWakeLock(async () => sentinel);
    mockPlay();
    const awake = new ScreenAwake();
    awake.start();
    await Promise.resolve();
    released = true;
    onRelease();
    await Promise.resolve();
    expect(document.querySelector('video')).toBeNull();
    released = true;
    onRelease();
    expect(document.querySelector('video')?.getAttribute('x5-video-player-type')).toBe('h5');
    awake.stop();
  });
});

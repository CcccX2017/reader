import { SILENT_MP4 } from './silent-frame.ts';

/**
 * Holds the screen on while a book is open, and lets it sleep again afterwards.
 *
 * 鸿蒙 is Huawei's phone system and 澎湃 is Xiaomi's. On those phones the page
 * is usually open in 华为浏览器 or 小米浏览器, not in this project's app.
 *
 *  - Our Android shell, when it is actually installed, sets the window flag.
 *    That covers a Xiaomi phone and a Huawei phone that can still run the APK.
 *  - iOS, and a Huawei or Xiaomi browser that implements it, get the Screen
 *    Wake Lock. The lock is released when the page is hidden and taken again
 *    when the page comes back.
 *  - A browser that has no lock, or grants one and drops it while the page is
 *    still open (what those two phone browsers do), plays a silent inline clip.
 *    Playback is what the phone already knows how to keep on screen. The clip
 *    stays in the page: those browsers otherwise hand a video to the system
 *    player and leave the book.
 */

export class ScreenAwake {
  private want = false;
  private native = false;
  private sentinel: WakeLockSentinel | null = null;
  private video: HTMLVideoElement | null = null;
  private tries = 0;
  /** Times a granted lock was dropped while the page stayed visible. */
  private drops = 0;

  private readonly onVisible = (): void => {
    if (!this.want || document.visibilityState !== 'visible') return;
    this.tries = 0;
    this.drops = 0;
    void this.acquire();
  };

  /** A tap is a user gesture, which is what iOS requires before it grants the lock. */
  private readonly onGesture = (): void => {
    if (!this.want || this.holding()) return;
    this.tries = 0;
    this.drops = 0;
    void this.acquire();
  };

  start(): void {
    if (this.want) return;
    this.want = true;
    this.tries = 0;
    this.drops = 0;
    document.addEventListener('visibilitychange', this.onVisible);
    window.addEventListener('pageshow', this.onVisible);
    document.addEventListener('pointerdown', this.onGesture, true);
    void this.acquire();
  }

  stop(): void {
    this.want = false;
    document.removeEventListener('visibilitychange', this.onVisible);
    window.removeEventListener('pageshow', this.onVisible);
    document.removeEventListener('pointerdown', this.onGesture, true);
    this.release();
  }

  private holding(): boolean {
    if (this.native) return true;
    if (this.sentinel && !this.sentinel.released) return true;
    return !!this.video && !this.video.paused;
  }

  private async acquire(): Promise<void> {
    if (!this.want || this.holding() || document.visibilityState === 'hidden') return;
    if (this.tries >= 3) {
      this.startVideo();
      return;
    }
    this.tries += 1;
    const native = window.ReaderAndroid?.setKeepScreenOn;
    if (typeof native === 'function') {
      native.call(window.ReaderAndroid, true);
      this.native = true;
      this.tries = 0;
      this.stopVideo();
      return;
    }
    const request = navigator.wakeLock?.request;
    if (typeof request === 'function') {
      try {
        const sentinel = await request.call(navigator.wakeLock, 'screen');
        if (!this.want) {
          void sentinel.release();
          return;
        }
        this.sentinel = sentinel;
        this.tries = 0;
        this.stopVideo();
        sentinel.addEventListener('release', () => {
          if (this.sentinel === sentinel) this.sentinel = null;
          if (!this.want || document.visibilityState !== 'visible') return;
          this.drops += 1;
          if (this.drops >= 2) {
            this.startVideo();
            return;
          }
          queueMicrotask(() => void this.acquire());
        });
        return;
      } catch {
        // The browser listed the API and refused it. The clip below is what
        // a Huawei or Xiaomi phone still treats as a reason to stay awake.
      }
    }
    if (this.want) this.startVideo();
  }

  private startVideo(): void {
    if (this.video) {
      const playing = this.video.play();
      if (playing) void playing.catch(() => undefined);
      return;
    }
    const video = document.createElement('video');
    video.muted = true;
    video.defaultMuted = true;
    video.loop = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.setAttribute('muted', '');
    // 小米浏览器 and 华为浏览器 otherwise open the system player and leave the book.
    video.setAttribute('x5-playsinline', '');
    video.setAttribute('x5-video-player-type', 'h5');
    video.setAttribute('x5-video-player-fullscreen', 'false');
    video.setAttribute('aria-hidden', 'true');
    video.tabIndex = -1;
    // Painted, not display:none. A hidden video never starts, so it cannot hold the screen.
    video.style.cssText = 'position:fixed;inset:auto 0 0 auto;width:1px;height:1px;opacity:0.01;pointer-events:none';
    video.src = SILENT_MP4;
    document.body.append(video);
    this.video = video;
    const playing = video.play();
    if (playing) void playing.catch(() => undefined);
  }

  private release(): void {
    if (this.native) {
      window.ReaderAndroid?.setKeepScreenOn?.call(window.ReaderAndroid, false);
      this.native = false;
    }
    const sentinel = this.sentinel;
    this.sentinel = null;
    if (sentinel && !sentinel.released) void sentinel.release().catch(() => undefined);
    this.stopVideo();
    this.tries = 0;
    this.drops = 0;
  }

  private stopVideo(): void {
    const video = this.video;
    this.video = null;
    if (!video) return;
    video.pause();
    const stream = video.srcObject as { getTracks?: () => Array<{ stop(): void }> } | null;
    if (stream && typeof stream.getTracks === 'function') for (const track of stream.getTracks()) track.stop();
    video.srcObject = null;
    video.removeAttribute('src');
    video.remove();
  }
}

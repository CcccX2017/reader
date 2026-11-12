import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, watch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';

/** What this process is running, and which web bundle it is serving. */
export interface Release {
  server: string;
  web: string;
}

const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/**
 * In-process publish/subscribe for the release currently being served.
 * A subscriber receives the current release at once, then each later change.
 */
export class ReleaseHub {
  private readonly listeners = new Set<(release: Release) => void>();

  constructor(private current: Release) {}

  snapshot(): Release {
    return this.current;
  }

  subscribe(listener: (release: Release) => void): () => void {
    this.listeners.add(listener);
    listener(this.current);
    return () => { this.listeners.delete(listener); };
  }

  /** Notifies subscribers only when the server version or the web bundle changed. */
  publish(next: Release): void {
    if (next.server === this.current.server && next.web === this.current.web) return;
    this.current = next;
    for (const listener of this.listeners) {
      try { listener(next); } catch { /* one client must not stop the others */ }
    }
  }
}

export function serverVersion(): string {
  const fromNpm = process.env.npm_package_version?.trim();
  if (fromNpm) return fromNpm;
  try {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version?: string };
    return pkg.version?.trim() || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** Identity of the served bundle. `sw.js` already digests every built file. */
export function webBuildId(webDir: string): string {
  if (!webDir) return 'none';
  const sw = join(webDir, 'sw.js');
  const index = join(webDir, 'index.html');
  const file = existsSync(sw) ? sw : existsSync(index) ? index : '';
  if (!file) return 'none';
  return createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 20);
}

export function currentRelease(webDir: string, server = serverVersion()): Release {
  return { server, web: webBuildId(webDir) };
}

/**
 * Watches the served bundle and publishes when it, or the server version, changes.
 * The interval covers filesystems that do not emit watch events.
 */
export function watchRelease(hub: ReleaseHub, webDir: string, intervalMs = 2000): () => void {
  let stopped = false;
  let lastKey = '';
  const tick = () => {
    if (stopped) return;
    try {
      const file = !webDir ? '' : existsSync(join(webDir, 'sw.js')) ? join(webDir, 'sw.js') : existsSync(join(webDir, 'index.html')) ? join(webDir, 'index.html') : '';
      const key = file ? `${file}:${statSync(file).mtimeMs}:${statSync(file).size}` : '';
      if (key === lastKey && hub.snapshot().server === serverVersion()) return;
      lastKey = key;
      hub.publish(currentRelease(webDir));
    } catch { /* an unreadable file keeps the last release */ }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  let pending: ReturnType<typeof setTimeout> | undefined;
  let watcher: FSWatcher | undefined;
  if (webDir && existsSync(webDir)) {
    try {
      watcher = watch(webDir, { persistent: false }, () => {
        clearTimeout(pending);
        pending = setTimeout(tick, 200);
      });
    } catch { /* the interval still notices a replaced bundle */ }
  }
  return () => {
    stopped = true;
    clearInterval(timer);
    clearTimeout(pending);
    watcher?.close();
  };
}

/** One Server-Sent Events response. Ends when the request goes away. */
export function releaseEvents(hub: ReleaseHub, signal: AbortSignal, heartbeatMs = 20_000): Readable {
  return Readable.from((async function* () {
    const queue: Release[] = [];
    let wake: (() => void) | undefined;
    const stop = hub.subscribe(release => {
      queue.push(release);
      wake?.();
    });
    const onAbort = () => wake?.();
    signal.addEventListener('abort', onAbort, { once: true });
    let heart: ReturnType<typeof setTimeout> | undefined;
    try {
      while (!signal.aborted) {
        if (queue.length === 0) {
          await new Promise<void>(resolve => {
            wake = () => { wake = undefined; resolve(); };
            heart = setTimeout(wake, heartbeatMs);
            heart.unref?.();
          });
          clearTimeout(heart);
          if (signal.aborted) break;
          if (queue.length === 0) { yield ': ping\n\n'; continue; }
        }
        while (queue.length > 0 && !signal.aborted) {
          const release = queue.shift();
          if (release) yield frame('release', release);
        }
      }
    } finally {
      clearTimeout(heart);
      signal.removeEventListener('abort', onAbort);
      stop();
    }
  })());
}

import '../styles/pwa.css';

let registration: ServiceWorkerRegistration | undefined;
let promptUpdate: (() => void) | undefined;

function createProgress(): HTMLDivElement {
  const progress = document.createElement('div');
  progress.className = 'pwa-update-progress';
  progress.hidden = true;
  progress.setAttribute('role', 'progressbar');
  progress.setAttribute('aria-label', '更新进度');
  progress.append(document.createElement('span'));
  return progress;
}

function showProgress(progress: HTMLElement, message: HTMLElement, text: string): void {
  message.textContent = text;
  progress.hidden = false;
}

function waitForWaiting(worker: ServiceWorkerRegistration, ms: number): Promise<boolean> {
  if (worker.waiting) return Promise.resolve(true);
  if (typeof worker.addEventListener !== 'function') return Promise.resolve(false);
  return new Promise((resolve) => {
    let done = false;
    let installing: ServiceWorker | null = worker.installing;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      worker.removeEventListener('updatefound', onFound);
      installing?.removeEventListener('statechange', onState);
      resolve(ok);
    };
    const onState = () => {
      if (worker.waiting) finish(true);
    };
    const onFound = () => {
      installing?.removeEventListener('statechange', onState);
      installing = worker.installing;
      installing?.addEventListener('statechange', onState);
      onState();
    };
    const timer = setTimeout(() => finish(false), ms);
    worker.addEventListener('updatefound', onFound);
    installing?.addEventListener('statechange', onState);
  });
}

/** The registration from this page, or the one the browser already has for this scope. */
async function resolveRegistration(): Promise<ServiceWorkerRegistration | undefined> {
  const container = navigator.serviceWorker;
  if (container && typeof container.getRegistration === 'function') {
    try {
      const found = await container.getRegistration();
      if (found) {
        registration = found;
        return found;
      }
    } catch {
      /* fall back to the registration captured at register() */
    }
  }
  return registration;
}

/** Asks the installed worker to download a new bundle. The ready banner follows from there. */
export function requestServiceWorkerUpdate(): void {
  void resolveRegistration().then((reg) => {
    void reg?.update().catch(() => undefined);
  });
}

/**
 * A newer web bundle is published.
 *
 * Reloading while a service worker is active opens the shell that worker already
 * cached, so the build id on the page does not change and the next check still
 * says an update is available. The check shows 立即更新 before the worker script
 * check returns — that check can sit until the browser finishes it, and the button
 * never appeared. The click downloads the new worker, shows that progress, and only
 * then reloads. A page with no worker reloads directly.
 */
export function beginWebUpdate(): void {
  if (promptUpdate) promptUpdate();
  else offerReload();
  void resolveRegistration().then((reg) => {
    void reg?.update()?.catch(() => undefined);
  });
}

/** A reload is enough when no service worker is holding the previous bundle. */
export function offerReload(): void {
  if (document.querySelector('.pwa-update')) return;
  const banner = document.createElement('aside');
  banner.className = 'pwa-update';
  banner.setAttribute('aria-label', '应用更新');
  const message = document.createElement('span');
  message.setAttribute('role', 'status');
  message.textContent = '新版本已准备好';
  const button = document.createElement('button');
  button.className = 'button primary';
  button.type = 'button';
  button.textContent = '立即更新';
  const progress = createProgress();
  const giveUp = () => {
    progress.hidden = true;
    button.disabled = false;
    button.textContent = '重试更新';
    message.textContent = '更新未完成，请重试';
  };
  const activate = (waiting: ServiceWorker) =>
    new Promise<void>((resolve, reject) => {
      const onChange = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        navigator.serviceWorker.removeEventListener('controllerchange', onChange);
        reject(new Error('timeout'));
      }, 15_000);
      navigator.serviceWorker.addEventListener('controllerchange', onChange);
      waiting.postMessage({ type: 'SKIP_WAITING' });
    });
  button.addEventListener('click', () => {
    if (button.disabled) return;
    button.disabled = true;
    message.textContent = '正在保存阅读进度…';
    void (async () => {
      try {
        await window.__readerFlush?.();
        const reg = await resolveRegistration();
        let waiting = reg?.waiting ?? null;
        // A waiting worker is the new shell. Reloading first is served by the
        // active worker, and the build id stays on the previous version.
        if (!waiting && reg && (reg.active || navigator.serviceWorker?.controller)) {
          showProgress(progress, message, '正在下载新版本…');
          await reg.update().catch(() => undefined);
          if (!(await waitForWaiting(reg, 15_000))) {
            giveUp();
            return;
          }
          waiting = reg.waiting ?? null;
        }
        if (waiting && navigator.serviceWorker) {
          showProgress(progress, message, '正在切换到新版本…');
          await activate(waiting);
        }
        location.reload();
      } catch {
        giveUp();
      }
    })();
  });
  banner.append(message, button, progress);
  document.body.append(banner);
}

/** Native shells and development builds keep their existing loading lifecycle. */
export function registerPwa(): void {
  if (
    !import.meta.env.PROD ||
    window.ReaderAndroid ||
    !window.isSecureContext ||
    !['http:', 'https:'].includes(location.protocol) ||
    !('serviceWorker' in navigator)
  )
    return;

  const register = () => {
    const base = new URL(import.meta.env.BASE_URL, document.baseURI);
    void navigator.serviceWorker
      .register(new URL('sw.js', base), {
        scope: base.pathname,
        updateViaCache: 'none',
      })
      .then((worker) => {
        registration = worker;
        watchPwaUpdates(worker);
      })
      .catch((error: unknown) => {
        // PWA availability must not prevent ordinary online reading.
        console.warn('离线应用缓存注册失败', error);
      });
  };
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}

/** Keep activation opt-in, including when another tab activates the new worker. */
export function watchPwaUpdates(
  registration: ServiceWorkerRegistration,
  save: () => Promise<void> = async () => {
    await window.__readerFlush?.();
  },
  reload: () => void = () => location.reload(),
): () => void {
  const banner = document.createElement('aside');
  banner.className = 'pwa-update';
  banner.setAttribute('aria-label', '应用更新');
  const message = document.createElement('span');
  message.setAttribute('role', 'status');
  message.textContent = '新版本已准备好';
  const button = document.createElement('button');
  button.className = 'button primary';
  button.type = 'button';
  button.textContent = '立即更新';
  const progress = createProgress();
  banner.append(message, button, progress);
  let updating = false;
  let changed = false;
  let reloaded = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let installing: ServiceWorker | null = null;
  // Kept for the click: `registration.waiting` can clear after the reader asks
  // to save, and reloading then would open the old shell again.
  let ready: ServiceWorker | null = null;
  const show = (force = false) => {
    const worker = registration.waiting;
    // No controller check. A page that is not controlled yet still has to
    // activate the waiting worker; a plain reload would be served by the
    // active one and the build id would not change.
    if (banner.isConnected) {
      if (worker) ready = worker;
      return;
    }
    if (!force && !worker) return;
    if (document.querySelector('.pwa-update')) return;
    if (worker) ready = worker;
    document.body.append(banner);
  };
  const reveal = () => show(true);
  promptUpdate = reveal;
  const finish = () => {
    if (reloaded) return;
    reloaded = true;
    clearTimeout(timeout);
    reload();
  };
  const failed = () => {
    clearTimeout(timeout);
    updating = false;
    progress.hidden = true;
    button.disabled = false;
    button.textContent = '重试更新';
    message.textContent = '更新未完成，请重试';
  };
  const onControllerChange = () => {
    // First installation only claims the page; it is not an update.
    changed = true;
    if (updating) finish();
    else if (banner.isConnected) message.textContent = '新版本已启用，刷新后使用';
  };
  button.addEventListener('click', () => {
    if (updating) return;
    button.disabled = true;
    message.textContent = '正在保存阅读进度…';
    void (async () => {
      try {
        await save();
        updating = true;
        if (changed) {
          finish();
          return;
        }
        let worker = registration.waiting ?? ready;
        if (!worker) {
          showProgress(progress, message, '正在下载新版本…');
          void registration.update().catch(() => undefined);
          if (!(await waitForWaiting(registration, 15_000))) {
            failed();
            return;
          }
          worker = registration.waiting;
          ready = worker;
        }
        if (!worker) {
          failed();
          return;
        }
        showProgress(progress, message, '正在切换到新版本…');
        timeout = setTimeout(failed, 15_000);
        worker.postMessage({ type: 'SKIP_WAITING' });
      } catch {
        failed();
      }
    })();
  });
  const onStateChange = () => show();
  const onUpdateFound = () => {
    installing?.removeEventListener('statechange', onStateChange);
    installing = registration.installing;
    installing?.addEventListener('statechange', onStateChange);
    show();
  };
  const check = () => {
    if (document.visibilityState !== 'visible') return;
    show();
    void registration.update().catch(() => {
      /* Offline: try again on return. */
    });
  };
  // Only changes after initial control represent upgrades of an existing page.
  let controlled = !!navigator.serviceWorker.controller;
  const controllerChange = () => {
    // The first claim of a brand-new worker is not an update. A claim while
    // the reader is applying one, or while the ready banner is up, is.
    if (controlled || updating || banner.isConnected) onControllerChange();
    controlled = true;
  };
  navigator.serviceWorker.addEventListener('controllerchange', controllerChange);
  registration.addEventListener('updatefound', onUpdateFound);
  document.addEventListener('visibilitychange', check);
  window.addEventListener('online', check);
  const interval = setInterval(check, 60 * 60 * 1000);
  onUpdateFound();
  // A visit is a check. Coming back to a frozen phone does not always fire
  // visibilitychange, and a replaced container has nothing left to publish.
  check();
  return () => {
    if (promptUpdate === reveal) promptUpdate = undefined;
    clearTimeout(timeout);
    clearInterval(interval);
    banner.remove();
    installing?.removeEventListener('statechange', onStateChange);
    registration.removeEventListener('updatefound', onUpdateFound);
    navigator.serviceWorker.removeEventListener('controllerchange', controllerChange);
    document.removeEventListener('visibilitychange', check);
    window.removeEventListener('online', check);
  };
}

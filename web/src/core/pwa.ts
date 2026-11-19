import '../styles/pwa.css';

let registration: ServiceWorkerRegistration | undefined;

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
    } catch { /* fall back to the registration captured at register() */ }
  }
  return registration;
}

/** Asks the installed worker to download a new bundle. The ready banner follows from there. */
export function requestServiceWorkerUpdate(): void {
  void resolveRegistration().then(reg => { void reg?.update().catch(() => undefined); });
}

/**
 * A newer web bundle is published.
 *
 * Reloading while a service worker is active opens the shell that worker already
 * cached, so the build id on the page does not change and the next check still
 * says an update is available. Download the new worker; its ready banner is what
 * activates it. A page with no worker reloads, because nothing is holding the old shell.
 */
export function beginWebUpdate(): void {
  const controlled = !!navigator.serviceWorker?.controller;
  const container = navigator.serviceWorker;
  if (!container || (typeof container.getRegistration !== 'function' && !container.controller && !registration)) {
    offerReload();
    return;
  }
  void (async () => {
    const reg = await resolveRegistration();
    // `active` covers a page this worker will serve on the next navigation even
    // when `controller` is still null, which is what kept the old build id.
    if (controlled || reg?.active || reg?.waiting) {
      await reg?.update().catch(() => undefined);
      return;
    }
    offerReload();
  })();
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
  const giveUp = () => {
    button.disabled = false;
    button.textContent = '重试更新';
    message.textContent = '更新未完成，请重试';
  };
  button.addEventListener('click', () => {
    if (button.disabled) return;
    button.disabled = true;
    message.textContent = '正在保存阅读进度…';
    void (async () => {
      try {
        await window.__readerFlush?.();
        const waiting = (await resolveRegistration())?.waiting;
        // A waiting worker is the new shell. Reloading first is served by the
        // active worker, and the build id stays on the previous version.
        if (waiting && navigator.serviceWorker) {
          message.textContent = '正在更新…';
          await new Promise<void>((resolve, reject) => {
            const onChange = () => { clearTimeout(timer); resolve(); };
            const timer = setTimeout(() => {
              navigator.serviceWorker.removeEventListener('controllerchange', onChange);
              reject(new Error('timeout'));
            }, 15_000);
            navigator.serviceWorker.addEventListener('controllerchange', onChange);
            waiting.postMessage({ type: 'SKIP_WAITING' });
          });
        }
        location.reload();
      } catch {
        giveUp();
      }
    })();
  });
  banner.append(message, button);
  document.body.append(banner);
}

/** Native shells and development builds keep their existing loading lifecycle. */
export function registerPwa(): void {
  if (!import.meta.env.PROD || window.ReaderAndroid || !window.isSecureContext
    || !['http:', 'https:'].includes(location.protocol) || !('serviceWorker' in navigator)) return;

  const register = () => {
    const base = new URL(import.meta.env.BASE_URL, document.baseURI);
    void navigator.serviceWorker.register(new URL('sw.js', base), {
      scope: base.pathname,
      updateViaCache: 'none',
    }).then((worker) => { registration = worker; watchPwaUpdates(worker); }).catch((error: unknown) => {
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
    save: () => Promise<void> = async () => { await window.__readerFlush?.(); },
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
  banner.append(message, button);
  let updating = false;
  let changed = false;
  let reloaded = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let installing: ServiceWorker | null = null;
  // Kept for the click: `registration.waiting` can clear after the reader asks
  // to save, and reloading then would open the old shell again.
  let ready: ServiceWorker | null = null;
  const show = () => {
    const worker = registration.waiting;
    // No controller check. A page that is not controlled yet still has to
    // activate the waiting worker; a plain reload would be served by the
    // active one and the build id would not change.
    if (!worker || banner.isConnected) return;
    ready = worker;
    document.body.append(banner);
  };
  const finish = () => {
    if (reloaded) return;
    reloaded = true;
    clearTimeout(timeout);
    reload();
  };
  const failed = () => {
    clearTimeout(timeout);
    updating = false;
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
        message.textContent = '正在更新…';
        const worker = registration.waiting ?? ready;
        if (changed || !worker) { finish(); return; }
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
    void registration.update().catch(() => { /* Offline: try again on return. */ });
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

import './styles/theme-tokens.css';
import './styles/reader.css';
import './app/app.css';
import './features/media/styles/media.css';
import './features/media/styles/presentation.css';
import './features/media/styles/v2.css';
import './features/media/styles/manager.css';
import './app/shell.css';
import './styles/glass.css';
import './styles/safari-27.2.scss';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { AppProviders } from './app/providers/AppProviders.tsx';
import { createAppRuntime, inferDefaultUrl } from './app/runtime.ts';
import { router } from './app/router/router.tsx';
import { beginWebUpdate, offerReload, registerPwa } from './core/pwa.ts';
import { pageWebBuild, subscribeReleases } from './core/release-events.ts';
import { dismissAppStartup } from './app/startup.ts';
import { applySafariVersion } from './shared/safari-version.ts';
import { paintStoredTheme } from './shared/theme/theme.ts';

// The head script paints the saved theme before the first frame. Repeat it here so
// a reload still corrects the top bar when that script did not run.
if (typeof document !== 'undefined') paintStoredTheme();

/**
 * Entry point.
 *
 * The shell exposes the app on `window` for two reasons: the Android bridge
 * needs to reach in for lifecycle and diagnostics, and browser devtools are the
 * primary debugging surface for a self-hosted product, where asking a user to
 * attach a remote debugger is not realistic.
 */
const root = document.getElementById('app');
if (!root) throw new Error('missing #app root element');
const appRoot: HTMLElement = root;

applySafariVersion();
// The WebView reports display-mode: browser, so the stylesheet cannot tell it
// from a tab. The installed shell is marked here before the nav paints.
if (window.ReaderAndroid || location.hostname === 'appassets.androidplatform.net') {
  document.documentElement.dataset.shell = 'android';
}

declare global {
  interface Window {
    readerApp?: Awaited<ReturnType<typeof createAppRuntime>>;
    /**
     * Flush hook called by the Android shell from `Activity.onPause`.
     *
     * The shell cannot know when a reading position changed, and the reader's own
     * debounce will never fire if the app is frozen first. Exposing one function
     * is the whole contract: "the app is going away, write what you have".
     */
    __readerFlush?: () => Promise<void>;
  }
}
async function start(): Promise<void> {
  const runtime = await createAppRuntime(import.meta.env.VITE_SERVER_URL ?? inferDefaultUrl());
  window.readerApp = runtime;
  window.__readerFlush = () => runtime.flush();
  createRoot(appRoot).render(
    <AppProviders runtime={runtime}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  registerPwa();
  // The Android shell serves its own copy of the bundle. The server's web id
  // belongs to the image, so comparing them would offer an update the shell
  // cannot apply.
  const runningWeb = window.ReaderAndroid ? undefined : pageWebBuild();
  subscribeReleases(
    runtime.api.baseUrl,
    (change) => {
      // Server-only: the shell is unchanged, so a reload is the whole update.
      // A new web bundle has to be installed by the worker first. Reloading over
      // the active worker would keep the previous build id.
      if (change === 'server') offerReload();
      else beginWebUpdate();
    },
    runningWeb,
  );
}

void start().catch((err: unknown) => {
  root.textContent = `客户端启动失败：${err instanceof Error ? err.message : String(err)}`;
  dismissAppStartup();
});

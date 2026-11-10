import { appName, pageTitle, subscribeAppName } from './page-title.ts';
import { applySiteBrand } from './site-branding.ts';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, Outlet, UNSAFE_LocationContext, useLocation, useNavigate, useNavigationType, useOutlet } from 'react-router-dom';
import { useAuthStore } from '../shared/stores/auth.store.ts';
import { useRuntime } from './providers/runtime-context.tsx';
import { LoginPage } from '../features/auth/pages/LoginPage.tsx';
import { AppNav, navMode } from './AppNav.tsx';
import { playerPath } from '../features/media/stores/playback.store.ts';
import { ThemeController } from '../shared/theme/theme.ts';
import { useMediaEnabled } from '../shared/stores/features.ts';

export function AppShell() {
  return <AuthBoundary><AuthenticatedShell /></AuthBoundary>;
}

function AuthenticatedShell() {
  const runtime = useRuntime();
  const location = useLocation();
  const navigationType = useNavigationType();
  const outlet = useOutlet();
  const navigate = useNavigate();
  const media=useMediaEnabled();
  // Opening a book used to unmount the shelf. iOS then threw away the scrolling
  // layer under the book grid and, on the way back, painted it empty for a frame.
  // The page stays mounted, covered, at the same size; the reader is an overlay.
  const reading = location.pathname.startsWith('/book/');
  const underlay = useRef<{ node: ReactNode; location: typeof location; navigationType: typeof navigationType } | null>(null);
  if (!reading && outlet) underlay.current = { node: outlet, location, navigationType };
  const covered = reading && underlay.current != null;
  const shellPath = covered ? underlay.current!.location.pathname : location.pathname;
  useEffect(() => {
    if(!media)return;
    const openControls = () => {
      navigate(playerPath(runtime.playback.snapshot()));
    };
    runtime.player.addEventListener('open-controls', openControls);
    return () => runtime.player.removeEventListener('open-controls', openControls);
  }, [runtime, navigate,media]);
  useEffect(() => {if(media)runtime.player.setVisible(location.pathname.startsWith('/media/'));}, [runtime, location.pathname,media]);
  const mode = !media&&shellPath.startsWith('/media')?'push':navMode(shellPath);
  const [brand, setBrand] = useState(appName);
  useEffect(() => subscribeAppName(() => setBrand(appName())), []);
  useEffect(() => {
    let live = true;
    void runtime.api.instance().then(info => { if (live) applySiteBrand(info, runtime.api.baseUrl); }).catch(() => undefined);
    return () => { live = false; };
  }, [runtime]);
  // A book sets its own title. Updating the site name must not replace that.
  useEffect(() => { if (!location.pathname.startsWith('/book/')) document.title = pageTitle(location.pathname); }, [location.pathname, brand]);
  // "/" goes to search from anywhere a keystroke is not already text or a reading/playback command.
  // The reader covers the page, so the shortcut stays with the page underneath.
  useEffect(() => {
    if (mode === 'hidden' || covered) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable], dialog[open]') || document.querySelector('dialog[open]')) return;
      const field = document.querySelector<HTMLInputElement>('.search-page-form input, .app-nav-search:not([hidden]) input');
      event.preventDefault();
      if (field && field.offsetParent !== null) { field.focus(); field.select(); } else navigate('/search');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, navigate, covered]);
  // One app theme for every page; the reader may wear its own reading theme on top.
  useEffect(() => {
    const theme = new ThemeController(runtime.mediaApi.preferenceScope());
    return () => theme.dispose();
  }, [runtime]);
  useEffect(() => {
    if (mode === 'hidden') delete document.body.dataset.appNav; else document.body.dataset.appNav = mode;
    return () => { delete document.body.dataset.appNav; };
  }, [mode]);
  const here = covered ? underlay.current! : { node: outlet, location, navigationType };
  return <>
    <div className="app-shell" inert={covered || undefined}>
      <div className="app-shell-body">
        <div className="app-shell-page">
          {/* The provider keeps the covered page on its own URL. Without it, a
              refetch while the book is open would read the book's location. */}
          <UNSAFE_LocationContext.Provider value={{ location: here.location, navigationType: here.navigationType }}>
            {here.node}
          </UNSAFE_LocationContext.Provider>
        </div>
      </div>
      {mode !== 'hidden' && <AppNav mode={mode} />}
    </div>
    {covered && <div className="app-shell-reader">{outlet}</div>}
  </>;
}

export function AuthBoundary({ children }: { children?: ReactNode }) {
  const session = useAuthStore(state => state.session);
  if (!session) return <LoginPage />;
  return <>{children}</>;
}

/** Media routes: the page itself. Theme and navigation belong to AuthenticatedShell. */
export function MediaLayout() {
  const enabled=useMediaEnabled();
  if(!enabled)return <section className="media-screen media-page" role="status"><h1>影音模块未启用</h1><p>请联系管理员检查全站开关及你的影音权限。</p><Link to="/">返回首页</Link></section>;
  return <Outlet />;
}

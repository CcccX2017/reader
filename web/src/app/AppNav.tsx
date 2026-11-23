import { Icon, type IconName } from '../ui/icon.tsx';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { channelPath, mediaChannels } from '../features/media/components/channel-navigation.tsx';
import { useAuthStore } from '../shared/stores/auth.store.ts';
import { useSyncStore } from '../shared/stores/sync.store.ts';
import type { SyncStatus } from '../core/sync.ts';
import { useRuntime } from './providers/runtime-context.tsx';
import { useMediaEnabled } from '../shared/stores/features.ts';
import { useSettingsStore } from '../shared/stores/settings.store.ts';

/**
 * hidden: the book and the player own the whole screen.
 * top:    a top-level destination; the bar shows everywhere.
 * push:   a page reached from a top-level one (detail, settings, library files):
 *         on a phone it replaces the bar with its own back arrow, on desktop the
 *         sidebar stays.
 */
export type NavMode = 'hidden' | 'top' | 'push';

const mediaTop = /^\/media\/(video|music|audiobook)(?:\/([^/]+))?$/;
// 演播者 (audiobook/narrators) is not here: it is the channel's second catalog tab, a
// sibling of 有声书, so it keeps the bar. A narrator's own page is deeper and pushes.
const pushed = new Set(['favorites', 'queue', 'settings', 'history', 'folders', 'player']);

export function navMode(pathname: string): NavMode {
  if (pathname.startsWith('/book/') || /^\/media\/[^/]+\/player(\/|$)/.test(pathname)) return 'hidden';
  if (pathname === '/' || pathname === '/shelf' || pathname === '/me') return 'top';
  const media = mediaTop.exec(pathname);
  if (media) return media[2] && pushed.has(media[2]) ? 'push' : 'top';
  return 'push';
}

interface Destination {
  to: string;
  label: string;
  icon: IconName;
  current(path: string): boolean;
}
/** Phone tab bar, the same cutoff as `shell.css`. */
const PHONE_BAR = '(max-width: 700px)';

/** 首页、书架、我的，以及仍显示底栏的影音页。 */
const GLASS_TABS = new Set(['/', '/shelf', '/me']);

function showsGlassTab(pathname: string): boolean {
  if (GLASS_TABS.has(pathname)) return true;
  return navMode(pathname) === 'top' && pathname.startsWith('/media/');
}

function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      if (typeof matchMedia !== 'function') return () => undefined;
      const media = matchMedia(query);
      media.addEventListener('change', notify);
      return () => media.removeEventListener('change', notify);
    },
    () => (typeof matchMedia === 'function' ? matchMedia(query).matches : false),
    () => false,
  );
}

/** The lens wipes its own layer when the page behind it changes. A child of that layer cannot travel. */
function motionMs(raw: string): number {
  const value = raw.trim();
  const amount = Number.parseFloat(value);
  if (!Number.isFinite(amount) || amount < 0) return 0;
  return value.endsWith('ms') ? amount : amount * 1000;
}

/** iOS 27 tab motion, fitted from UITabBar presentation frames. */
const TRAVEL_OMEGA = (2 * Math.PI) / 0.4;
const TRAVEL_ZETA = 0.85;
const LIFT_OMEGA = (2 * Math.PI) / 0.25;
const RETURN_OMEGA = (2 * Math.PI) / 0.4;
const BAR_OMEGA = 17.6;
const BAR_ZETA = 0.59;

/** Advance an offset toward 0. Underdamped springs overshoot; critical ones do not. */
function stepSpring(
  offset: number,
  velocity: number,
  omega: number,
  zeta: number,
  dt: number,
): { offset: number; velocity: number } {
  if (dt <= 0) return { offset, velocity };
  if (zeta >= 0.999) {
    const decay = Math.exp(-omega * dt);
    const slope = velocity + omega * offset;
    const next = (offset + slope * dt) * decay;
    return { offset: next, velocity: (slope - omega * (offset + slope * dt)) * decay };
  }
  const damped = omega * Math.sqrt(1 - zeta * zeta);
  const decay = Math.exp(-zeta * omega * dt);
  const cosine = Math.cos(damped * dt);
  const sine = Math.sin(damped * dt);
  const sineWeight = (velocity + zeta * omega * offset) / damped;
  const next = decay * (offset * cosine + sineWeight * sine);
  const velocityNext = -zeta * omega * next + decay * damped * (-offset * sine + sineWeight * cosine);
  return { offset: next, velocity: velocityNext };
}

const destinations: Destination[] = [
  { to: '/', label: '首页', icon: 'home', current: (path) => path === '/' },
  { to: '/shelf', label: '书架', icon: 'book', current: (path) => /^\/(shelf|library|sources)(\/|$)/.test(path) },
  { to: '/media/video', label: '影音', icon: 'video', current: (path) => path.startsWith('/media') },
  { to: '/me', label: '我的', icon: 'account', current: (path) => path === '/me' || path.startsWith('/me/') },
];

/** The one navigation: a tab bar on a phone, a sidebar from 701px up. */
export function AppNav({ mode }: { mode: Exclude<NavMode, 'hidden'> }) {
  const { pathname } = useLocation();
  const runtime = useRuntime();
  const phone = useMediaQuery(PHONE_BAR);
  const still = useMediaQuery('(prefers-reduced-motion: reduce)');
  const navStyle = useSettingsStore((state) => state.settings.navStyle);
  const liquid = phone && showsGlassTab(pathname) && navStyle === 'glass';
  const media = useMediaEnabled();
  const user = useAuthStore((state) => state.verifiedUser ?? state.session?.user ?? null);
  const channel = /^\/media\/(video|music|audiobook)/.exec(pathname)?.[1];
  const name = user?.displayName || user?.username || '';
  const sync = useSyncStore((state) => state.status.state);
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const search = (event: FormEvent) => {
    event.preventDefault();
    const q = query.trim();
    if (q) navigate(`/search?q=${encodeURIComponent(q)}`);
  };
  const connection = connectionLabel(sync);
  useEffect(() => {
    if (!liquid) return;
    document.body.dataset.navGlass = 'true';
    return () => {
      delete document.body.dataset.navGlass;
    };
  }, [liquid]);
  const visible = destinations.filter((item) => media || item.to !== '/media/video');
  const activeIndex = visible.findIndex((item) => item.current(pathname));
  const thumbRef = useRef<HTMLSpanElement>(null);
  const faceRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const motionRef = useRef({ index: activeIndex, velocity: 0 });
  useLayoutEffect(() => {
    const node = thumbRef.current;
    const face = faceRef.current;
    const bar = barRef.current;
    const target = activeIndex;
    const from = motionRef.current.index;
    const velocity = motionRef.current.velocity;
    if (!node || target < 0) return;
    const rest = () => {
      node.style.transition = 'none';
      node.style.transform = `translateX(${target * 100}%)`;
      if (face) {
        face.style.transition = 'none';
        face.style.transform = 'scale(1)';
        face.style.opacity = '1';
      }
      if (bar) {
        bar.style.transition = 'none';
        bar.style.transform = 'scale(1)';
      }
      motionRef.current = { index: target, velocity: 0 };
    };
    const stepMs = motionMs(getComputedStyle(node).getPropertyValue('--motion-duration'));
    if (still || stepMs <= 1 || Math.abs(target - from) < 0.001) {
      rest();
      return;
    }
    node.style.transition = 'none';
    if (face) face.style.transition = 'none';
    if (bar) bar.style.transition = 'none';
    let position = from;
    let speed = velocity;
    let lift = 0;
    let liftSpeed = 0;
    let liftTarget = 1;
    let liftOmega = LIFT_OMEGA;
    let barScale = 1;
    let barSpeed = 0;
    let barTarget = 1.08;
    let returning = false;
    const trip = Math.max(Math.abs(target - from), 1);
    const started = performance.now();
    let last = started;
    let frame = 0;
    let cancelled = false;
    const tick = (now: number) => {
      if (cancelled) return;
      const dt = Math.min(1 / 30, Math.max(0, (now - last) / 1000));
      last = now;
      const traveled = stepSpring(position - target, speed, TRAVEL_OMEGA, TRAVEL_ZETA, dt);
      position = target + traveled.offset;
      speed = traveled.velocity;
      const lifted = stepSpring(lift - liftTarget, liftSpeed, liftOmega, 1, dt);
      lift = liftTarget + lifted.offset;
      liftSpeed = lifted.velocity;
      const grown = stepSpring(barScale - barTarget, barSpeed, BAR_OMEGA, BAR_ZETA, dt);
      barScale = barTarget + grown.offset;
      barSpeed = grown.velocity;
      if (!returning && (now - started > 450 || (now - started > 120 && Math.abs(position - target) < trip * 0.45))) {
        returning = true;
        liftTarget = 0;
        liftOmega = RETURN_OMEGA;
        barTarget = 1;
      }
      const norm = Math.min(1, Math.abs(speed) / (TRAVEL_OMEGA * trip));
      const stretch = norm * (0.16 + 0.07 * Math.min(trip, 4));
      const approaching = (target - position) * speed >= 0;
      const scaleX = (approaching ? 1 + stretch : 1 - stretch * 0.65) * (1 + 0.14 * lift);
      const scaleY = (1 / (approaching ? 1 + stretch : 1 - stretch * 0.65)) * (1 + 0.14 * lift);
      node.style.transform = `translateX(${position * 100}%)`;
      if (face) {
        face.style.transform = `scaleX(${scaleX}) scaleY(${scaleY})`;
        face.style.opacity = '1';
      }
      if (bar) bar.style.transform = `scale(${barScale})`;
      motionRef.current = { index: position, velocity: speed };
      const arrived =
        returning &&
        Math.abs(position - target) < 0.004 &&
        Math.abs(speed) < 0.05 &&
        Math.abs(lift) < 0.02 &&
        Math.abs(barScale - 1) < 0.004;
      if (arrived) {
        rest();
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [activeIndex, liquid, still]);
  const tabs = (
    <ul className="app-nav-list">
      {visible.map(({ to, label, icon, current }) => {
        const active = current(pathname);
        return (
          <li key={to}>
            <Link className="app-nav-item" to={to} aria-current={active ? 'page' : undefined}>
              <span className="app-nav-icon" aria-hidden="true">
                <Icon name={icon} size={24} strong={active} />
              </span>
              <span className="app-nav-label">{label}</span>
            </Link>
            {to === '/media/video' && (
              <ul className="app-nav-sub" aria-label="影音频道">
                {mediaChannels.map((item) => (
                  <li key={item.id}>
                    <Link
                      className="app-nav-subitem"
                      data-channel={item.id}
                      to={channelPath(item.id)}
                      aria-current={channel === item.id ? 'page' : undefined}
                    >
                      <i aria-hidden="true" />
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
  return (
    <nav className={liquid ? 'app-nav is-liquid' : 'app-nav'} aria-label="主导航" data-mode={mode}>
      {liquid ? (
        <div className="app-nav-magnify" ref={barRef}>
          <div className="app-nav-float">
            {activeIndex >= 0 ? (
              <span
                ref={thumbRef}
                className="app-nav-thumb"
                style={{ width: `calc((100% - 8px) / ${visible.length})` }}
                aria-hidden="true"
              >
                <span ref={faceRef} className="app-nav-thumb-face" />
              </span>
            ) : null}
            {tabs}
          </div>
        </div>
      ) : (
        tabs
      )}
      <Link className="app-nav-brand" to="/" aria-label="reader. 首页">
        reader.
      </Link>
      {/* Desktop only: one search across books and media (the page is /search). */}
      <form className="app-nav-search" role="search" onSubmit={search} hidden={pathname === '/search'}>
        <Icon name="search" size={16} />
        <input
          type="search"
          aria-label={media ? '搜索书籍和影音' : '搜索书籍'}
          placeholder={media ? '搜索书籍和影音' : '搜索书籍'}
          value={query}
          maxLength={200}
          onInput={(event) => setQuery(event.currentTarget.value)}
        />
      </form>
      {user && (
        <Link
          className="app-nav-user"
          to={connection.state === 'online' ? '/me' : '/me/account'}
          aria-label={`我的账号：${name}，${connection.label}`}
        >
          <span className="app-nav-avatar" aria-hidden="true">
            {Array.from(name)[0]}
          </span>
          <span className="app-nav-user-text">
            <strong>{name}</strong>
            <small title={host(runtime.api.baseUrl)}>
              <i className="app-nav-status" data-state={connection.state} aria-hidden="true" />
              {connection.label}
            </small>
          </span>
        </Link>
      )}
    </nav>
  );
}

function host(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

/** The sync engine's view of the server, in the sidebar's words. */
export function connectionLabel(state: SyncStatus['state']): { state: 'online' | 'offline' | 'error'; label: string } {
  if (state === 'offline') return { state: 'offline', label: '离线' };
  if (state === 'error') return { state: 'error', label: '同步出错' };
  if (state === 'syncing') return { state: 'online', label: '正在同步' };
  return { state: 'online', label: '已连接' };
}

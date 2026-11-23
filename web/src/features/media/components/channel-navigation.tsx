import { useLayoutEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useSettingsStore } from '../../../shared/stores/settings.store.ts';
import { channelCategories, channelLabels } from '../hooks/use-media-channel.ts';
import type { MediaChannel } from '../api/media-api.ts';

/** The three media channels. Reading, home and the account page live in the app navigation. */
export const mediaChannels = [
  { id: 'video', label: '影视', icon: 'video' },
  { id: 'music', label: '音乐', icon: 'music' },
  { id: 'audiobook', label: '有声书', icon: 'audiobook' },
] as const;

/** Landing URL of a channel. Music and audiobook must not stop at `/media/music` or
 * `/media/audiobook`: those routes are redirects, and the redirect unmounts the
 * switch before the thumb can travel. */
export const channelPath = (id: string) => {
  const first = channelCategories[id as keyof typeof channelCategories]?.[0];
  return first?.path ? `/media/${id}/${first.path}` : `/media/${id}`;
};

/** Last segment the thumb was sent to, including a position mid-travel. Survives a remount. */
let channelThumbAt: number | null = null;

/**
 * Phone tab-bar travel (AppNav `TRAVEL_OMEGA` / `TRAVEL_ZETA`), position only.
 * One segment or two settles in the same time as 首页 ↔ 书架. The overshoot is
 * under a hundredth of a segment. The bar's scale and the thumb's stretch stay
 * on the tab bar.
 */
const CHANNEL_TRAVEL_OMEGA = (2 * Math.PI) / 0.4;
const CHANNEL_TRAVEL_ZETA = 0.85;

function motionMs(raw: string): number {
  const value = raw.trim();
  const amount = Number.parseFloat(value);
  if (!Number.isFinite(amount) || amount < 0) return 0;
  return value.endsWith('ms') ? amount : amount * 1000;
}

function stepChannelTravel(offset: number, velocity: number, dt: number): { offset: number; velocity: number } {
  if (dt <= 0) return { offset, velocity };
  const damped = CHANNEL_TRAVEL_OMEGA * Math.sqrt(1 - CHANNEL_TRAVEL_ZETA * CHANNEL_TRAVEL_ZETA);
  const decay = Math.exp(-CHANNEL_TRAVEL_ZETA * CHANNEL_TRAVEL_OMEGA * dt);
  const cosine = Math.cos(damped * dt);
  const sine = Math.sin(damped * dt);
  const sineWeight = (velocity + CHANNEL_TRAVEL_ZETA * CHANNEL_TRAVEL_OMEGA * offset) / damped;
  const next = decay * (offset * cosine + sineWeight * sine);
  const velocityNext =
    -CHANNEL_TRAVEL_ZETA * CHANNEL_TRAVEL_OMEGA * next + decay * damped * (-offset * sine + sineWeight * cosine);
  return { offset: next, velocity: velocityNext };
}

/**
 * Phone channel switch: three always-visible segments instead of a hidden menu.
 * On wider screens the sidebar lists the same channels, so this is hidden there.
 * With liquid glass the gray thumb uses the phone tab bar's travel, so a single
 * step (影视 → 音乐) takes as long as 首页 → 书架 and a jump still crosses 音乐.
 */
export function ChannelSegments({ current }: { current: string }) {
  const glass = useSettingsStore((state) => state.settings.navStyle) === 'glass';
  const index = Math.max(
    0,
    mediaChannels.findIndex((item) => item.id === current),
  );
  const thumbRef = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const node = thumbRef.current;
    const from = channelThumbAt;
    if (!node) {
      channelThumbAt = index;
      return;
    }
    node.style.transition = 'none';
    if (from === null || Math.abs(index - from) < 0.001) {
      channelThumbAt = index;
      node.style.transform = `translateX(${index * 100}%)`;
      return;
    }
    const stepMs = motionMs(getComputedStyle(node).getPropertyValue('--motion-duration'));
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (still || stepMs <= 1) {
      channelThumbAt = index;
      node.style.transform = `translateX(${index * 100}%)`;
      return;
    }
    // A node created already on the destination would otherwise appear there.
    node.style.transform = `translateX(${from * 100}%)`;
    let position = from;
    let speed = 0;
    let last = performance.now();
    let frame = 0;
    let cancelled = false;
    const tick = (now: number) => {
      if (cancelled) return;
      const dt = Math.min(1 / 30, Math.max(0, (now - last) / 1000));
      last = now;
      const traveled = stepChannelTravel(position - index, speed, dt);
      position = index + traveled.offset;
      speed = traveled.velocity;
      channelThumbAt = position;
      node.style.transform = `translateX(${position * 100}%)`;
      if (Math.abs(position - index) < 0.004 && Math.abs(speed) < 0.05) {
        channelThumbAt = index;
        node.style.transform = `translateX(${index * 100}%)`;
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [index, glass]);
  return (
    <nav className="media-channel-segments" aria-label="切换内容频道">
      {glass ? (
        <span
          ref={thumbRef}
          className="media-channel-thumb"
          style={{ width: `calc((100% - 8px) / ${mediaChannels.length})` }}
          aria-hidden="true"
        >
          <span className="media-channel-thumb-face" />
        </span>
      ) : null}
      {mediaChannels.map(({ id, label }) => (
        <a key={id} href={'#' + channelPath(id)} aria-current={id === current ? 'page' : undefined}>
          {label}
        </a>
      ))}
    </nav>
  );
}

/**
 * A channel's category tabs (影视: 首页 电影 剧集; 有声书: 有声书 演播者 …), shared by the
 * generic catalog and the narrator page so both draw the same row.
 */
export function CatalogTabs({ channel }: { channel: MediaChannel }) {
  const { pathname } = useLocation();
  const categories = channelCategories[channel];
  return (
    <nav className="media-tabs" aria-label={`${channelLabels[channel]}分类`}>
      {categories.map((item, index) => {
        const isDefault = index === 0;
        // The first category answers at both the channel's bare path and its own one
        // (/media/music redirects to /media/music/albums), so either marks it current.
        const own = item.path ? `/media/${channel}/${item.path}` : `/media/${channel}`;
        const selected = pathname === own || (isDefault && pathname === `/media/${channel}`);
        return (
          <Link
            key={item.path}
            className="media-tab-link"
            to={isDefault ? `/media/${channel}` : own}
            aria-current={selected ? 'page' : undefined}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Every catalog tab on one line, channel by channel: 影视（首页 电影 剧集）, 音乐（专辑
 * 歌手 曲目）, 有声书（有声书 演播者）. A swipe past a channel's last category is
 * the next channel's first, which is where the channel switch above would go.
 */
const catalogTabs = mediaChannels.flatMap(({ id }) =>
  channelCategories[id].map((category, index) => ({
    channel: id,
    path: category.path ? `/media/${id}/${category.path}` : `/media/${id}`,
    // A channel's bare path is its first category: /media/music redirects to albums.
    alias: index === 0 ? `/media/${id}` : undefined,
  })),
);

/**
 * The catalog tab a swipe from `pathname` lands on, or null at either end and on
 * any page that is not a catalog tab. Library and sort carry over within a channel
 * (they name that channel's libraries); a new channel starts unfiltered.
 *
 * `step: 'channel'` is for a channel with no library at all: its categories are all
 * the same empty page with no tab row to show which one is current, so stepping
 * through them looks like the swipe did nothing. The swipe then moves a whole
 * channel, to its first category — what the channel switch above would do.
 */
export function swipeCatalogTarget(
  pathname: string,
  search: string,
  direction: 'next' | 'previous',
  step: 'category' | 'channel' = 'category',
): string | null {
  const index = catalogTabs.findIndex((tab) => tab.path === pathname || tab.alias === pathname);
  const from = catalogTabs[index];
  if (from && step === 'channel') {
    const channel = mediaChannels.findIndex((item) => item.id === from.channel);
    const to = mediaChannels[channel + (direction === 'next' ? 1 : -1)];
    return to ? catalogTabs.find((tab) => tab.channel === to.id)!.path : null;
  }
  const to = catalogTabs[index + (direction === 'next' ? 1 : -1)];
  if (!from || !to) return null;
  if (from.channel !== to.channel) return to.path;
  const params = new URLSearchParams(search),
    kept = new URLSearchParams();
  for (const key of ['library', 'sort']) {
    const value = params.get(key);
    if (value) kept.set(key, value);
  }
  const query = kept.toString();
  return query ? `${to.path}?${query}` : to.path;
}

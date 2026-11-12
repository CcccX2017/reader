import { useEffect, useState } from 'react';
import type { ReaderApi } from '../../api/client.ts';

/**
 * Avatar pictures already turned into object URLs, keyed by the API client so a
 * new session does not reuse another account's picture. Kept for the life of
 * that client: dropping the URL when a page unmounts made the next page paint
 * the letter again while the same bytes were downloaded once more.
 */
const avatarCache = new WeakMap<object, Map<string, string>>();
const avatarLoads = new WeakMap<object, Map<string, Promise<string | null>>>();

function cachedAvatar(api: object, avatarUrl: string): string | undefined {
  return avatarCache.get(api)?.get(avatarUrl);
}

function storeAvatarObjectUrl(api: object, avatarUrl: string, objectUrl: string): void {
  let cache = avatarCache.get(api);
  if (!cache) {
    cache = new Map();
    avatarCache.set(api, cache);
  }
  const previous = cache.get(avatarUrl);
  if (previous && previous !== objectUrl) URL.revokeObjectURL(previous);
  cache.set(avatarUrl, objectUrl);
}

/** Shows this file at `avatarUrl` on the next render, without waiting for another download. */
export function rememberAvatar(api: object, avatarUrl: string, file: Blob): void {
  storeAvatarObjectUrl(api, avatarUrl, URL.createObjectURL(file));
}

function loadAvatar(api: Pick<ReaderApi, 'coverBytes'> & object, avatarUrl: string): Promise<string | null> {
  const hit = cachedAvatar(api, avatarUrl);
  if (hit) return Promise.resolve(hit);
  let loads = avatarLoads.get(api);
  const pending = loads?.get(avatarUrl);
  if (pending) return pending;
  const task = api.coverBytes(avatarUrl).then(bytes => {
    const again = cachedAvatar(api, avatarUrl);
    if (again) return again;
    const objectUrl = URL.createObjectURL(new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer]));
    storeAvatarObjectUrl(api, avatarUrl, objectUrl);
    return objectUrl;
  }).catch(() => null).finally(() => {
    avatarLoads.get(api)?.delete(avatarUrl);
  });
  if (!loads) {
    loads = new Map();
    avatarLoads.set(api, loads);
  }
  loads.set(avatarUrl, task);
  return task;
}

export interface AvatarPicture {
  /** Object URL of the uploaded picture, or null when there is nothing to show. */
  src: string | null;
  /** An uploaded picture is on the way. The letter stands for "no avatar", so it stays hidden. */
  pending: boolean;
}

function pictureFor(api: object | undefined, avatarUrl: string | null | undefined): AvatarPicture {
  if (!api || !avatarUrl) return { src: null, pending: false };
  const hit = cachedAvatar(api, avatarUrl);
  return hit ? { src: hit, pending: false } : { src: null, pending: true };
}

/**
 * Loads an avatar URL through the API (Authorization header) into an object URL.
 * A picture fetched earlier in this session is ready on the first render.
 */
export function useAvatar(api: (Pick<ReaderApi, 'coverBytes'> & object) | undefined, avatarUrl: string | null | undefined): AvatarPicture {
  const [picture, setPicture] = useState<AvatarPicture>(() => pictureFor(api, avatarUrl));
  const [seen, setSeen] = useState({ api, avatarUrl });
  if (api !== seen.api || avatarUrl !== seen.avatarUrl) {
    setSeen({ api, avatarUrl });
    setPicture(pictureFor(api, avatarUrl));
  }
  useEffect(() => {
    if (!api || !avatarUrl || cachedAvatar(api, avatarUrl)) return;
    let live = true;
    void loadAvatar(api, avatarUrl).then(src => {
      if (live) setPicture(src ? { src, pending: false } : { src: null, pending: false });
    });
    return () => { live = false; };
  }, [api, avatarUrl]);
  return picture;
}

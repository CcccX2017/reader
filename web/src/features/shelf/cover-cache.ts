/** Blob URLs for covers, keyed by the API client so a new session does not reuse another user's pictures. */
const coverCache = new WeakMap<object, Map<string, string>>();

export function cachedCover(api: object, coverUrl: string): string | undefined {
  return coverCache.get(api)?.get(coverUrl);
}

/** Shows this file at `coverUrl` on the next render, without waiting for another download. */
export function rememberCover(api: object, coverUrl: string, file: Blob): void {
  let cache = coverCache.get(api);
  if (!cache) {
    cache = new Map();
    coverCache.set(api, cache);
  }
  const previous = cache.get(coverUrl);
  if (previous) URL.revokeObjectURL(previous);
  cache.set(coverUrl, URL.createObjectURL(file));
}

export function storeCoverObjectUrl(api: object, coverUrl: string, objectUrl: string): void {
  let cache = coverCache.get(api);
  if (!cache) {
    cache = new Map();
    coverCache.set(api, cache);
  }
  cache.set(coverUrl, objectUrl);
}

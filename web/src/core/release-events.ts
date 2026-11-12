export interface Release {
  server: string;
  web: string;
}

export type ReleaseChange = 'web' | 'server' | 'both';

export function releaseChange(prev: Release, next: Release): ReleaseChange | 'none' {
  const web = prev.web !== next.web;
  const server = prev.server !== next.server;
  if (web && server) return 'both';
  if (web) return 'web';
  if (server) return 'server';
  return 'none';
}

/**
 * A controlling service worker must install the new bundle before a reload,
 * or the reload would open the copy it still controls. A server-only change
 * has no new bundle, so the page reloads straight away.
 */
export function releaseResponse(change: ReleaseChange, swControlled: boolean): { updateWorker: boolean; reload: boolean } {
  return {
    updateWorker: change !== 'server',
    reload: !swControlled || change === 'server',
  };
}

/** Listens for `release` events. The first one is the version this page opened with. */
export function subscribeReleases(baseUrl: string, onChange: (change: ReleaseChange) => void): () => void {
  const root = baseUrl || (typeof location === 'undefined' ? '' : location.origin);
  if (!root || typeof EventSource === 'undefined') return () => undefined;
  const source = new EventSource(new URL('/api/v1/events', root.endsWith('/') ? root : `${root}/`).href);
  let seen: Release | undefined;
  const onRelease = (event: Event) => {
    let next: Release;
    try { next = JSON.parse((event as MessageEvent<string>).data) as Release; }
    catch { return; }
    if (!next || typeof next.server !== 'string' || typeof next.web !== 'string') return;
    if (!seen) { seen = next; return; }
    const change = releaseChange(seen, next);
    seen = next;
    if (change !== 'none') onChange(change);
  };
  source.addEventListener('release', onRelease);
  return () => {
    source.removeEventListener('release', onRelease);
    source.close();
  };
}

export interface Release {
  server: string;
  web: string;
  /** First 12 hex digits of the published image for this version and CPU. Absent outside that image. */
  image?: string;
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

const BUILD_ID = /^[a-f0-9]{20}$/;

export type UpdateCheck = 'current' | 'ready' | 'shell' | 'dev';

const UPDATE_LABEL: Record<UpdateCheck, string> = {
  current: '已是最新',
  ready: '发现新版本',
  shell: '已是安装包中的版本',
  dev: '当前是开发页面',
};

/**
 * Whether this page is behind the bundle the server is serving.
 *
 * The Android shell ships its own copy and cannot take the server's bundle.
 * A development page has no build stamp, so there is nothing to compare.
 */
export function judgeUpdate(release: Release, nativeShell: boolean, runningWeb: string | undefined): { state: UpdateCheck; label: string } {
  if (nativeShell) return { state: 'shell', label: UPDATE_LABEL.shell };
  if (!runningWeb) return { state: 'dev', label: UPDATE_LABEL.dev };
  const state = runningWeb === release.web ? 'current' : 'ready';
  return { state, label: UPDATE_LABEL[state] };
}

/** One read of the release now in service. The event stream is for pages that stay open. */
export async function fetchRelease(baseUrl: string): Promise<Release> {
  const root = baseUrl || (typeof location === 'undefined' ? '' : location.origin);
  if (!root) throw new Error('没有服务地址');
  const response = await fetch(new URL('/api/v1/release', root.endsWith('/') ? root : `${root}/`));
  if (!response.ok) throw new Error(String(response.status));
  const body: unknown = await response.json();
  if (!body || typeof body !== 'object') throw new Error('版本响应无法读取');
  const record = body as { server?: unknown; web?: unknown; image?: unknown };
  if (typeof record.server !== 'string' || typeof record.web !== 'string') throw new Error('版本响应无法读取');
  const image = typeof record.image === 'string' && /^[a-f0-9]{12}$/.test(record.image) ? record.image : undefined;
  return image ? { server: record.server, web: record.web, image } : { server: record.server, web: record.web };
}

/** The build id stamped into this document. Absent in dev, and on a page that predates the stamp. */
export function pageWebBuild(doc: Document | undefined = typeof document === 'undefined' ? undefined : document): string | undefined {
  const content = doc?.querySelector('meta[name="reader-web-build"]')?.getAttribute('content')?.trim() ?? '';
  return BUILD_ID.test(content) ? content : undefined;
}

/**
 * Listens for `release` events.
 *
 * The first event is the release the server is running now. A replaced
 * container never emits a second "it changed" event, so that snapshot is
 * compared with the build id this page was actually served. Later events
 * are compared with the previous snapshot, which is how a page that stayed
 * open hears a rebuild without a restart.
 */
export function subscribeReleases(baseUrl: string, onChange: (change: ReleaseChange) => void, runningWeb?: string): () => void {
  const root = baseUrl || (typeof location === 'undefined' ? '' : location.origin);
  if (!root || typeof EventSource === 'undefined') return () => undefined;
  const source = new EventSource(new URL('/api/v1/events', root.endsWith('/') ? root : `${root}/`).href);
  let seen: Release | undefined;
  const onRelease = (event: Event) => {
    let next: Release;
    try { next = JSON.parse((event as MessageEvent<string>).data) as Release; }
    catch { return; }
    if (!next || typeof next.server !== 'string' || typeof next.web !== 'string') return;
    if (!seen) {
      seen = next;
      if (runningWeb && runningWeb !== next.web) onChange('web');
      return;
    }
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

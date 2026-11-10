import { pageTitle, setAppName } from './page-title.ts';

export interface SiteBrand {
  name?: string;
  iconUrl?: string | null;
}

/** An icon path from the API, resolved against the server the client is using. */
export function siteAssetUrl(baseUrl: string, path: string): string {
  try { return new URL(path, baseUrl || window.location.origin).href; }
  catch { return path; }
}

const SITE_BRAND_CACHE = 'reader.site-brand';

function serverKey(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

/** The name and icon last confirmed for this server, so the login page can paint them immediately. */
export function readCachedSiteBrand(baseUrl: string): { name: string; iconUrl: string | null } | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SITE_BRAND_CACHE) ?? 'null');
    if (!parsed || typeof parsed !== 'object') return null;
    const record = parsed as { baseUrl?: unknown; name?: unknown; iconUrl?: unknown };
    if (typeof record.baseUrl !== 'string' || serverKey(record.baseUrl) !== serverKey(baseUrl)) return null;
    if (typeof record.name !== 'string' || !record.name.trim()) return null;
    return { name: record.name.trim(), iconUrl: typeof record.iconUrl === 'string' && record.iconUrl ? record.iconUrl : null };
  } catch { return null; }
}

function rememberSiteBrand(baseUrl: string, brand: SiteBrand): void {
  const url = serverKey(baseUrl);
  const name = brand.name?.trim() || 'reader';
  if (!url) return;
  try { localStorage.setItem(SITE_BRAND_CACHE, JSON.stringify({ baseUrl: url, name, iconUrl: brand.iconUrl || null })); }
  catch { /* the login page still learns the name from the server */ }
}

/** Puts the configured name into the tab, and the icon into the favicon links. */
export function applySiteBrand(brand: SiteBrand, baseUrl = ''): void {
  if (baseUrl.trim()) rememberSiteBrand(baseUrl, brand);
  setAppName(brand.name ?? '');
  const hash = window.location.hash.replace(/^#/, '');
  const pathname = hash.split('?')[0] || '/';
  if (!pathname.startsWith('/book/')) document.title = pageTitle(pathname);
  const appleTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]');
  if (appleTitle) appleTitle.setAttribute('content', brand.name?.trim() || 'reader');
  const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  const touch = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');
  const alternate = document.querySelector<HTMLLinkElement>('link[rel="alternate icon"]');
  if (brand.iconUrl) {
    const href = siteAssetUrl(baseUrl, brand.iconUrl);
    if (icon) { icon.removeAttribute('type'); icon.href = href; }
    if (touch) touch.href = href;
    if (alternate) { alternate.removeAttribute('type'); alternate.href = href; }
  } else {
    if (icon) { icon.type = 'image/svg+xml'; icon.href = './icons/reader.svg'; }
    if (touch) touch.href = './icons/apple-touch-icon.png';
    if (alternate) { alternate.type = 'image/png'; alternate.href = './icons/icon-192.png'; }
  }
}

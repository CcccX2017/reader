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

/** Puts the configured name into the tab, and the icon into the favicon links. */
export function applySiteBrand(brand: SiteBrand, baseUrl = ''): void {
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

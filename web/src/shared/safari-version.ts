/** Device-local Safari version. The account page can override the UA on iOS; the
 *  value is `html[data-safari]`, which the version patch matches. */

const STORAGE_KEY = 'reader.safari.version';
const VERSION = /^\d+(?:\.\d+){0,3}$/;

export function isIos(ua: string): boolean {
  return /iPhone|iPad|iPod/i.test(ua);
}

export function safariVersionFromUa(ua: string): string {
  return ua.match(/Version\/(\d+(?:\.\d+)*)/i)?.[1] ?? '';
}

export function readSafariOverride(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY) ?? '';
    return VERSION.test(stored) ? stored : '';
  } catch {
    return '';
  }
}

export function writeSafariOverride(version: string): void {
  const next = version.trim();
  if (next && !VERSION.test(next)) throw new Error('版本号写成 27.2 这样');
  try {
    if (next) localStorage.setItem(STORAGE_KEY, next);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    throw new Error('无法保存这个版本，请检查设备存储');
  }
}

/** A saved version wins only on iOS. Everywhere else the UA Version/ token is used. */
export function resolveSafariVersion(ua: string, override: string): string {
  if (isIos(ua) && VERSION.test(override)) return override;
  return safariVersionFromUa(ua);
}

export function applySafariVersion(ua: string = navigator.userAgent): void {
  const version = resolveSafariVersion(ua, readSafariOverride());
  if (version) document.documentElement.dataset.safari = version;
  else delete document.documentElement.dataset.safari;
}

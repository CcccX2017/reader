import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** Site icons live under DATA_DIR/site/icon.{ext}. */
export const SITE_ICON_MAX_BYTES = 2 * 1024 * 1024;
const SITE_ICON_EXTENSIONS = ['.jpg', '.png', '.gif', '.webp'] as const;

export function siteIconRel(ext: string): string {
  return `site/icon${ext}`;
}

/** Writes the icon and removes a previous one stored under another extension. */
export async function writeSiteIcon(dataDir: string, buf: Buffer, ext: string): Promise<string> {
  const rel = siteIconRel(ext);
  const abs = join(dataDir, rel);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, buf);
  await Promise.all(
    SITE_ICON_EXTENSIONS
      .filter((other) => other !== ext)
      .map((other) => rm(join(dataDir, siteIconRel(other)), { force: true })),
  );
  return rel;
}

export async function removeSiteIcon(dataDir: string): Promise<void> {
  await Promise.all(SITE_ICON_EXTENSIONS.map((ext) => rm(join(dataDir, siteIconRel(ext)), { force: true })));
}

/** The name shown in the tab and on the login page. Blank stays the built-in name. */
export function siteDisplayName(name: string | undefined): string {
  const value = name?.trim() ?? '';
  return value || 'reader';
}

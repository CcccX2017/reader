import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { sniffCoverImage } from '../indexer/metadata.ts';

/** Avatar files live under DATA_DIR/avatars/{userId}.{ext}. */
export const AVATAR_MAX_BYTES = 10 * 1024 * 1024;
const AVATAR_EXTENSIONS = ['.jpg', '.png', '.gif', '.webp'] as const;

export function avatarRel(userId: string, ext: string): string {
  return `avatars/${userId}${ext}`;
}

export function sniffAvatarImage(buf: Buffer): { ext: '.jpg' | '.png' | '.gif' | '.webp' } | null {
  return sniffCoverImage(buf);
}

/** Writes the avatar and removes a previous one stored under another extension. */
export async function writeAvatar(dataDir: string, userId: string, buf: Buffer, ext: string): Promise<string> {
  const rel = avatarRel(userId, ext);
  const abs = join(dataDir, rel);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, buf);
  await Promise.all(
    AVATAR_EXTENSIONS
      .filter((other) => other !== ext)
      .map((other) => rm(join(dataDir, avatarRel(userId, other)), { force: true })),
  );
  return rel;
}

export async function removeAvatar(dataDir: string, userId: string): Promise<void> {
  await Promise.all(AVATAR_EXTENSIONS.map((ext) => rm(join(dataDir, avatarRel(userId, ext)), { force: true })));
}

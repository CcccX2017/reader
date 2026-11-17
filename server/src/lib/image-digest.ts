import { existsSync } from 'node:fs';

/** The image published by `.github/workflows/release.yml`. */
const REPOSITORY = 'hectorqin/reader-pro';

/**
 * A container cannot see the digest of the image it was started from: that
 * digest is computed when the image is pushed. A deployment of the published
 * image is identified by its version and CPU, which is enough to read the
 * digest Docker Hub lists for that tag.
 */
export function runningInContainer(): boolean {
  return existsSync('/.dockerenv') || existsSync('/run/.containerenv');
}

/** The 12 hex digits Docker shows for a `sha256:` digest. */
export function shortDigest(digest: string): string | null {
  const hex = digest.startsWith('sha256:') ? digest.slice('sha256:'.length) : digest;
  if (!/^[a-f0-9]{12,64}$/.test(hex)) return null;
  return hex.slice(0, 12);
}

export function digestForPlatform(
  images: ReadonlyArray<{ os?: string; architecture?: string; digest?: string }>,
  arch: string,
): string | null {
  const want = arch === 'x64' ? 'amd64' : arch;
  const match = images.find((image) => image.os === 'linux' && image.architecture === want);
  return match?.digest ? shortDigest(match.digest) : null;
}

let cached: Promise<string | null> | undefined;

/** The published digest for this version and CPU, or nothing when this process is not that image. */
export function publishedImageDigest(version: string, arch: string = process.arch): Promise<string | null> {
  if (!runningInContainer()) return Promise.resolve(null);
  const pinned = process.env.READER_IMAGE_DIGEST?.trim();
  if (pinned) return Promise.resolve(shortDigest(pinned));
  cached ??= lookupPublishedDigest(version, arch);
  return cached;
}

async function lookupPublishedDigest(version: string, arch: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const url = `https://hub.docker.com/v2/repositories/${REPOSITORY}/tags?page_size=50&name=${encodeURIComponent(version)}`;
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    const body = await response.json() as {
      results?: Array<{ name?: string; images?: Array<{ os?: string; architecture?: string; digest?: string }> }>;
    };
    const tag = body.results?.find((item) => item.name === version);
    return digestForPlatform(tag?.images ?? [], arch);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

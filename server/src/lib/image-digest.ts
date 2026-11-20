import { existsSync } from 'node:fs';

/** The image published by `.github/workflows/release.yml`. */
const REPOSITORY = 'ccccx2022/reader';

const VERSION_TAG = /^\d+\.\d+\.\d+$/;
const SHA_TAG = /^sha-[a-f0-9]{4,40}$/;

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

export interface PublishedTag {
  name?: string;
  images?: ReadonlyArray<{ os?: string; architecture?: string; digest?: string }>;
}

/**
 * The tag in a compose `image:` or `READER_IMAGE` value.
 * `ccccx2022/reader:latest`, `:1.0.13` and `:sha-66ee335` are the three publish tags.
 */
export function imageTagFromRef(ref: string | undefined): string | null {
  const value = ref?.trim();
  if (!value || value.includes('@')) return null;
  const slash = value.lastIndexOf('/');
  const colon = value.lastIndexOf(':');
  const tag = colon > slash ? value.slice(colon + 1) : slash >= 0 ? '' : value;
  if (tag === 'latest' || VERSION_TAG.test(tag) || SHA_TAG.test(tag)) return tag;
  return null;
}

export function digestForTag(tags: readonly PublishedTag[], name: string, arch: string): string | null {
  const tag = tags.find((item) => item.name === name);
  return digestForPlatform(tag?.images ?? [], arch);
}

/**
 * Which published tag this process is.
 *
 * An explicit version or `sha-` tag is that build. An explicit `latest` is Hub's
 * `latest` even after it has moved past the package version: the package version
 * stays on the version fields, and the image line follows the tag that was pulled.
 * With no pin, `latest` is the label only while it is still the same digest as
 * this version. A newer `latest` on Hub does not rename an unpinned older container.
 */
export function resolvePublishedImage(
  tags: readonly PublishedTag[],
  version: string,
  arch: string,
  configured: string | null,
): { digest: string; tag: string } | null {
  if (configured && configured !== 'latest') {
    const pinned = digestForTag(tags, configured, arch);
    if (pinned) return { digest: pinned, tag: configured };
  }
  if (configured === 'latest') {
    const latest = digestForTag(tags, 'latest', arch);
    if (latest) return { digest: latest, tag: 'latest' };
  }
  const digest = digestForTag(tags, version, arch);
  if (!digest) return null;
  if (digestForTag(tags, 'latest', arch) === digest) return { digest, tag: 'latest' };
  return { digest, tag: version };
}

let cached: Promise<{ digest: string; tag: string } | null> | undefined;

/** The published digest for this process, or nothing when it is not that image. */
export function publishedImageDigest(version: string, arch: string = process.arch): Promise<{ digest: string; tag: string } | null> {
  if (!runningInContainer()) return Promise.resolve(null);
  const pinned = shortDigest(process.env.READER_IMAGE_DIGEST?.trim() ?? '');
  if (pinned) return Promise.resolve({ digest: pinned, tag: imageTagFromRef(process.env.READER_IMAGE) ?? version });
  cached ??= lookupPublishedDigest(version, arch);
  return cached;
}

async function lookupPublishedDigest(version: string, arch: string): Promise<{ digest: string; tag: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const url = `https://hub.docker.com/v2/repositories/${REPOSITORY}/tags?page_size=100`;
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    const body = await response.json() as { results?: PublishedTag[] };
    return resolvePublishedImage(body.results ?? [], version, arch, imageTagFromRef(process.env.READER_IMAGE));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

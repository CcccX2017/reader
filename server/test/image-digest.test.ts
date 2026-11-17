import { test } from 'node:test';
import assert from 'node:assert/strict';
import { digestForPlatform, imageTagFromRef, resolvePublishedImage, shortDigest, type PublishedTag } from '../src/lib/image-digest.ts';

const images = [
  { os: 'linux', architecture: 'amd64', digest: 'sha256:017daf908bf9aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
  { os: 'linux', architecture: 'arm64', digest: 'sha256:cbb2edb1c777bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
  { os: 'unknown', architecture: 'unknown', digest: 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' },
];

test('a published image is named by the first 12 digits of its platform digest', () => {
  assert.equal(shortDigest('sha256:017daf908bf9aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), '017daf908bf9');
  assert.equal(shortDigest('not-a-digest'), null);
  assert.equal(digestForPlatform(images, 'x64'), '017daf908bf9');
  assert.equal(digestForPlatform(images, 'arm64'), 'cbb2edb1c777');
  assert.equal(digestForPlatform(images, 'ia32'), null);
});

const current = [
  { os: 'linux', architecture: 'amd64', digest: 'sha256:7e64e6f9a27baaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
  { os: 'linux', architecture: 'arm64', digest: 'sha256:4cf8e7ecaf93bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
];
const published: PublishedTag[] = [
  { name: '1.0.13', images: current },
  { name: 'latest', images: current },
  { name: 'sha-66ee335', images: current },
];

test('a deployment tag is latest, a version, or a short commit', () => {
  assert.equal(imageTagFromRef('ccccx2022/reader:latest'), 'latest');
  assert.equal(imageTagFromRef('ccccx2022/reader:1.0.13'), '1.0.13');
  assert.equal(imageTagFromRef('ccccx2022/reader:sha-66ee335'), 'sha-66ee335');
  assert.equal(imageTagFromRef('sha-66ee335'), 'sha-66ee335');
  assert.equal(imageTagFromRef('ccccx2022/reader'), null);
});

test('latest counts only while it is still this version', () => {
  assert.deepEqual(resolvePublishedImage(published, '1.0.13', 'x64', 'latest'), { digest: '7e64e6f9a27b', tag: 'latest' });
  assert.deepEqual(resolvePublishedImage(published, '1.0.13', 'x64', null), { digest: '7e64e6f9a27b', tag: 'latest' });
  assert.deepEqual(resolvePublishedImage(published, '1.0.13', 'x64', '1.0.13'), { digest: '7e64e6f9a27b', tag: '1.0.13' });
  assert.deepEqual(resolvePublishedImage(published, '1.0.13', 'x64', 'sha-66ee335'), { digest: '7e64e6f9a27b', tag: 'sha-66ee335' });
  const moved = published.map(tag => tag.name === 'latest'
    ? { name: 'latest', images: [{ os: 'linux', architecture: 'amd64', digest: 'sha256:017daf908bf9aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }] }
    : tag);
  assert.deepEqual(resolvePublishedImage(moved, '1.0.13', 'x64', null), { digest: '7e64e6f9a27b', tag: '1.0.13' });
  assert.deepEqual(resolvePublishedImage(moved, '1.0.13', 'x64', 'latest'), { digest: '7e64e6f9a27b', tag: '1.0.13' });
});

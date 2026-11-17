import { test } from 'node:test';
import assert from 'node:assert/strict';
import { digestForPlatform, shortDigest } from '../src/lib/image-digest.ts';

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

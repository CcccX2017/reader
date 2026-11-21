import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { ReleaseHub, releaseEvents, watchRelease, webBuildId } from '../src/lib/release.ts';
import { registerEventRoutes } from '../src/http/routes/events.ts';
import type { AppContext } from '../src/http/context.ts';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test('subscribers hear the current release and later changes only', () => {
  const hub = new ReleaseHub({ server: '1', web: 'a' });
  const heard: string[] = [];
  const stop = hub.subscribe((release) => heard.push(`${release.server}:${release.web}`));
  hub.publish({ server: '1', web: 'a' });
  hub.publish({ server: '1', web: 'b' });
  hub.publish({ server: '2', web: 'b' });
  stop();
  hub.publish({ server: '3', web: 'c' });
  assert.deepEqual(heard, ['1:a', '1:b', '2:b']);
});

test('the event stream sends the open release and the next one', async () => {
  const hub = new ReleaseHub({ server: '1', web: 'a' });
  const controller = new AbortController();
  const stream = releaseEvents(hub, controller.signal, 60_000);
  const first = await new Promise<string>((resolve, reject) => {
    stream.once('data', (chunk: Buffer) => resolve(String(chunk)));
    stream.once('error', reject);
  });
  assert.match(first, /event: release/);
  assert.match(first, /"web":"a"/);
  hub.publish({ server: '1', web: 'b' });
  let ended = false;
  stream.on('end', () => {
    ended = true;
  });
  const second = await new Promise<string>((resolve, reject) => {
    stream.once('data', (chunk: Buffer) => resolve(String(chunk)));
    stream.once('error', reject);
  });
  assert.match(second, /"web":"b"/);
  controller.abort();
  for (let i = 0; i < 20 && !ended; i++) await wait(10);
  assert.equal(ended, true);
});

test('a check reads the release the event stream would open with', async () => {
  const app = Fastify();
  registerEventRoutes(app, { release: new ReleaseHub({ server: '1.0.12', web: 'abc' }) } as AppContext);
  const found = await app.inject({ method: 'GET', url: '/api/v1/release' });
  assert.equal(found.statusCode, 200);
  assert.deepEqual(found.json(), { server: '1.0.12', web: 'abc' });
  await app.close();

  const missing = Fastify();
  registerEventRoutes(missing, {} as AppContext);
  const down = await missing.inject({ method: 'GET', url: '/api/v1/release' });
  assert.equal(down.statusCode, 503);
  await missing.close();
});

test('a recorded bundle id is the release id, not a hash of the worker', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reader-release-'));
  try {
    await writeFile(join(root, 'sw.js'), 'const cacheName = `${prefix}0123456789abcdef0123`;\n');
    assert.equal(webBuildId(root), '0123456789abcdef0123');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('replacing the served bundle publishes the new web id', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reader-release-'));
  try {
    await writeFile(join(root, 'sw.js'), 'one');
    const hub = new ReleaseHub({ server: '1.0.11', web: 'old' });
    const stop = watchRelease(hub, root, 40);
    const first = webBuildId(root);
    for (let i = 0; i < 40 && hub.snapshot().web !== first; i++) await wait(40);
    assert.equal(hub.snapshot().web, first);
    await writeFile(join(root, 'sw.js'), 'two');
    const second = webBuildId(root);
    for (let i = 0; i < 40 && hub.snapshot().web !== second; i++) await wait(40);
    assert.equal(hub.snapshot().web, second);
    assert.notEqual(first, second);
    stop();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

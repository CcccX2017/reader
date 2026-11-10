import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Db } from '../src/db/index.ts';
import type { AppConfig } from '../src/config/index.ts';
import type { AppContext } from '../src/http/context.ts';
import { UserService } from '../src/services/users.ts';
import { buildApp } from '../src/http/app.ts';
import { signAccessToken } from '../src/services/tokens.ts';

function config(root: string): AppConfig {
  return { booksDir: root, dataDir: root, host: '127.0.0.1', port: 0, jwtSecret: 'preferences-test-secret-16', accessTokenTtl: 604800, refreshTokenTtl: 31536000, scanInterval: 1800, watchInterval: 60, logLevel: 'silent', publicUrl: '', corsOrigins: [], webDir: join(root, 'web') };
}

const body = (updatedAt: number, fontScale = 1) => ({
  updatedAt,
  app: { fontScale },
  theme: { theme: 'warm' },
  media: { density: 'compact' },
  playback: { defaultRate: 1 },
});

test('preferences follow the account and keep the newer write', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'preferences-'));
  const db = new Db(':memory:');
  const cfg = config(root);
  const ctx = { config: cfg, db, users: new UserService(db, cfg) } as AppContext;
  for (const id of ['ada', 'bao']) db.run('INSERT INTO users(id,username,display_name,password_hash,role,created_at,updated_at) VALUES(?,?,?,?,?,0,0)', id, id, id, 'unused', 'member');
  const app = buildApp(ctx);
  await app.ready();
  t.after(async () => { await app.close(); db.close(); await rm(root, { recursive: true, force: true }); });
  const ada = { authorization: 'Bearer ' + signAccessToken(cfg, { id: 'ada', role: 'member' }).token };
  const bao = { authorization: 'Bearer ' + signAccessToken(cfg, { id: 'bao', role: 'member' }).token };

  assert.equal((await app.inject({ url: '/api/v1/preferences' })).statusCode, 401);
  assert.equal((await app.inject({ url: '/api/v1/preferences', headers: ada })).json().preferences, null);

  const saved = await app.inject({ method: 'PUT', url: '/api/v1/preferences', headers: ada, payload: body(10, 1.4) });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().preferences.app.fontScale, 1.4);
  assert.equal(saved.json().preferences.updatedAt, 10);

  const older = await app.inject({ method: 'PUT', url: '/api/v1/preferences', headers: ada, payload: body(9, 2) });
  assert.equal(older.json().preferences.app.fontScale, 1.4);
  assert.equal(older.json().preferences.updatedAt, 10);

  const newer = await app.inject({ method: 'PUT', url: '/api/v1/preferences', headers: ada, payload: body(11, 1.1) });
  assert.equal(newer.json().preferences.app.fontScale, 1.1);

  assert.equal((await app.inject({ url: '/api/v1/preferences', headers: bao })).json().preferences, null);
  assert.equal((await app.inject({ url: '/api/v1/preferences', headers: ada })).json().preferences.updatedAt, 11);

  assert.equal((await app.inject({ method: 'PUT', url: '/api/v1/preferences', headers: ada, payload: { updatedAt: 12 } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'PUT', url: '/api/v1/preferences', headers: ada, payload: body(12, 1) })).statusCode, 200);
  const huge = body(13);
  huge.app = { blob: 'x'.repeat(70_000) };
  assert.equal((await app.inject({ method: 'PUT', url: '/api/v1/preferences', headers: ada, payload: huge })).statusCode, 400);
  assert.equal((await app.inject({ url: '/api/v1/preferences', headers: ada })).json().preferences.updatedAt, 12);
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KeyValueStore } from '../src/core/platform.ts';
import type { PreferenceDocument } from '../src/api/types.ts';
import { PreferenceSync } from '../src/store/preference-sync.ts';
import { usePreferencePlaceStore } from '../src/shared/stores/preference-place.store.ts';

function memory(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    async get(key) { return map.has(key) ? map.get(key)! : null; },
    async set(key, value) { map.set(key, value); },
    async remove(key) { map.delete(key); },
  };
}

function document(updatedAt: number, fontScale = 1): PreferenceDocument {
  return {
    updatedAt,
    app: { fontScale },
    theme: { theme: 'warm', mode: 'system' },
    media: { density: 'compact', showContinue: true, showLibraryName: true },
    playback: { defaultRate: 1, continuous: true },
  };
}

function harness(options?: { signedIn?: boolean; remote?: PreferenceDocument | null }) {
  const store = memory();
  const pushed: PreferenceDocument[] = [];
  const applied: PreferenceDocument[] = [];
  const reports: string[] = [];
  let remote = options?.remote === undefined ? null : options.remote;
  let local = document(0, 1.2);
  let signedIn = options?.signedIn !== false;
  const sync = new PreferenceSync({
    kv: store,
    scope: () => 'server:ada',
    signedIn: () => signedIn,
    read: () => ({ app: local.app, theme: local.theme, media: local.media, playback: local.playback }),
    write: (snapshot) => { applied.push(snapshot); local = snapshot; },
    pull: async () => remote,
    push: async (snapshot) => { pushed.push(snapshot); remote = snapshot; return snapshot; },
    report: (message) => { reports.push(message); },
  });
  return { store, sync, pushed, applied, reports, remote: () => remote, local: () => local, signIn: () => { signedIn = true; } };
}

afterEach(() => {
  usePreferencePlaceStore.getState().replace('local');
  vi.useRealTimers();
});

describe('preference place', () => {
  it('keeps edits on the device until the reader chooses the account', async () => {
    const { sync, pushed } = harness();
    await sync.ready();
    sync.note();
    expect(pushed).toHaveLength(0);
    expect(usePreferencePlaceStore.getState().place).toBe('local');
  });

  it('uploads this device when persistent storage is turned on, and debounces later edits', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { sync, pushed, reports } = harness();
    await sync.ready();
    await sync.setPlace('account');
    expect(pushed).toHaveLength(1);
    expect((pushed[0]!.app as { fontScale: number }).fontScale).toBe(1.2);
    expect(pushed[0]!.updatedAt).toBeGreaterThan(0);
    expect(reports.at(-1)).toContain('已写入账号');
    sync.note();
    sync.note();
    expect(pushed).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(600);
    expect(pushed).toHaveLength(2);
  });

  it('adopts a newer account copy, and sends a newer local one', async () => {
    const { store, sync, applied, pushed, remote } = harness({ remote: document(50, 1.8) });
    await store.set('reader.preferences.place', 'account');
    await store.set('reader.preferences.updatedAt:server:ada', '10');
    await sync.ready();
    expect(applied).toHaveLength(1);
    expect(applied[0]!.updatedAt).toBe(50);
    expect((applied[0]!.app as { fontScale: number }).fontScale).toBe(1.8);
    expect(pushed).toHaveLength(0);

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    sync.note();
    await vi.advanceTimersByTimeAsync(600);
    expect(pushed).toHaveLength(1);
    expect(remote()!.updatedAt).toBeGreaterThan(50);
    expect((remote()!.app as { fontScale: number }).fontScale).toBe(1.8);
  });

  it('does not let an older account copy replace this device', async () => {
    const { store, sync, applied, pushed, remote } = harness({ remote: document(40, 2) });
    await store.set('reader.preferences.place', 'account');
    await store.set('reader.preferences.updatedAt:server:ada', '100');
    await sync.ready();
    expect(applied).toHaveLength(0);
    expect(pushed).toHaveLength(1);
    expect(remote()!.updatedAt).toBe(100);
    expect((remote()!.app as { fontScale: number }).fontScale).toBe(1.2);
  });

  it('stops sending once the reader switches back to this device', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { sync, pushed, reports } = harness();
    await sync.ready();
    await sync.setPlace('account');
    await sync.setPlace('local');
    expect(reports.at(-1)).toContain('本地存储');
    pushed.length = 0;
    sync.note();
    await vi.advanceTimersByTimeAsync(600);
    expect(pushed).toHaveLength(0);
  });

  it('loads the account copy on a device that has not chosen yet', async () => {
    const { sync, applied, pushed } = harness({ remote: document(50, 1.8) });
    await sync.ready();
    expect(usePreferencePlaceStore.getState().place).toBe('account');
    expect(applied).toHaveLength(1);
    expect((applied[0]!.app as { fontScale: number }).fontScale).toBe(1.8);
    expect(pushed).toHaveLength(0);
  });

  it('does not upload this device over a copy another device already saved', async () => {
    const { sync, applied, pushed, reports } = harness({ remote: document(50, 1.8) });
    await sync.setPlace('account');
    expect(pushed).toHaveLength(0);
    expect((applied[0]!.app as { fontScale: number }).fontScale).toBe(1.8);
    expect(reports.at(-1)).toContain('已用账号里保存的设置');
  });

  it('waits for a login, then uploads this device instead of an older account copy', async () => {
    const { sync, pushed, reports, remote, signIn } = harness({ signedIn: false, remote: document(10, 2) });
    await sync.ready();
    await sync.setPlace('account');
    expect(pushed).toHaveLength(0);
    expect(reports.at(-1)).toContain('登录后');
    signIn();
    await sync.onSession();
    expect(pushed).toHaveLength(1);
    expect((remote()!.app as { fontScale: number }).fontScale).toBe(1.2);
    expect(remote()!.updatedAt).toBeGreaterThan(10);
  });
});

import type { KeyValueStore } from '../core/platform.ts';
import type { PreferenceDocument } from '../api/types.ts';
import type { PreferencePlace } from '../shared/stores/preference-place.store.ts';
import { usePreferencePlaceStore } from '../shared/stores/preference-place.store.ts';
import { silencePreferenceWrites } from './preference-writes.ts';

const PLACE_KEY = 'reader.preferences.place';
const stampKey = (scope: string) => 'reader.preferences.updatedAt:' + scope;

export interface PreferenceSyncDeps {
  kv: KeyValueStore;
  /** Server and account. Stamps are per scope so two servers do not share a clock. */
  scope(): string;
  signedIn(): boolean;
  read(): Omit<PreferenceDocument, 'updatedAt'>;
  write(snapshot: PreferenceDocument): Promise<void> | void;
  pull(): Promise<PreferenceDocument | null>;
  /** Returns the row the account kept, which may be newer than the one sent. */
  push(snapshot: PreferenceDocument): Promise<PreferenceDocument>;
  report?(message: string, kind: 'success' | 'error'): void;
}

/**
 * Keeps the account copy in step with this device when 保存位置 is 持久化存储.
 *
 * Local storage stays the copy the screens read. The account's choice is what
 * another signed-in device follows: opening it loads the saved settings instead
 * of keeping its own defaults. A later stamp still wins, so an offline edit is
 * sent when the network returns.
 */
export class PreferenceSync {
  private place: PreferencePlace = 'local';
  private updatedAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pushing = false;
  private again = false;
  /** Set when 持久化 is chosen before a login, so the first session uploads this device. */
  private uploadLocal = false;
  private scopeSeen = '';

  constructor(private readonly deps: PreferenceSyncDeps, private readonly debounceMs = 600) {}

  /** Loads the device's choice and, when it is the account, catches up. */
  async ready(): Promise<void> {
    const stored = await this.deps.kv.get(PLACE_KEY);
    this.place = stored === 'account' ? 'account' : 'local';
    usePreferencePlaceStore.getState().replace(this.place);
    await this.onSession();
  }

  /** A login, a logout, or a switch of account. */
  async onSession(): Promise<void> {
    this.cancel();
    const scope = this.deps.signedIn() ? this.deps.scope() : '';
    const sameAccount = scope !== '' && scope === this.scopeSeen;
    this.scopeSeen = scope;
    if (!scope) {
      this.updatedAt = 0;
      return;
    }
    if (this.uploadLocal && this.place === 'account') {
      this.uploadLocal = false;
      this.updatedAt = Date.now();
      await this.deps.kv.set(stampKey(scope), String(this.updatedAt));
      await this.pushNow().catch(() => undefined);
      return;
    }
    // A different account must not inherit the previous account's stamp, or this
    // device would overwrite that account with the previous one's settings.
    if (!sameAccount) this.updatedAt = 0;
    await this.catchUp();
  }

  /** Focus or a network return: send a failed write, or pick up another device. */
  refresh(): void {
    if (!this.deps.signedIn()) return;
    void this.catchUp();
  }

  /** A local edit of reader settings, appearance, or a preference. */
  note(): void {
    if (this.place !== 'account' || !this.deps.signedIn()) return;
    this.updatedAt = Date.now();
    void this.deps.kv.set(stampKey(this.deps.scope()), String(this.updatedAt));
    this.schedule();
  }

  async setPlace(next: PreferencePlace): Promise<void> {
    if (next === this.place) return;
    const previous = this.place;
    this.place = next;
    usePreferencePlaceStore.getState().replace(next);
    try {
      await this.deps.kv.set(PLACE_KEY, next);
    } catch (error) {
      this.place = previous;
      usePreferencePlaceStore.getState().replace(previous);
      this.deps.report?.('无法保存这个选择，请检查设备存储', 'error');
      throw error;
    }
    this.cancel();
    if (next === 'local') {
      this.uploadLocal = false;
      if (this.deps.signedIn()) {
        this.updatedAt = Date.now();
        await this.deps.kv.set(stampKey(this.deps.scope()), String(this.updatedAt));
        await this.send().catch(() => undefined);
      }
      this.deps.report?.('已改为本地存储，之后的修改只留在这台设备', 'success');
      return;
    }
    if (!this.deps.signedIn()) {
      this.uploadLocal = true;
      this.updatedAt = Date.now();
      this.deps.report?.('已改为持久化存储，登录后会写入账号', 'success');
      return;
    }
    this.uploadLocal = false;
    await this.loadStamp();
    try {
      const remote = await this.deps.pull();
      // Another device already saved the account copy. Loading it is the point
      // of opening 持久化 here; uploading this device's defaults would wipe it.
      if (remote && remote.place !== 'local' && remote.updatedAt > this.updatedAt) {
        await this.apply(remote);
        this.deps.report?.('已改为持久化存储，已用账号里保存的设置', 'success');
        return;
      }
      this.updatedAt = Date.now();
      await this.deps.kv.set(stampKey(this.deps.scope()), String(this.updatedAt));
      await this.pushNow();
      this.deps.report?.('已改为持久化存储，当前设置已写入账号', 'success');
    } catch {
      this.deps.report?.('已改为持久化存储。账号暂时没写上，连上后会再试', 'error');
    }
  }

  /** Follows the account: a saved 持久化 copy is applied even on a device that was still local. */
  private async catchUp(): Promise<void> {
    if (!this.deps.signedIn()) return;
    await this.loadStamp();
    let remote: PreferenceDocument | null;
    try {
      remote = await this.deps.pull();
    } catch {
      return;
    }
    if (!remote) {
      if (this.place === 'account') await this.pushNow().catch(() => undefined);
      return;
    }
    // Only a newer row decides the mode. An older row must not undo a switch
    // this device just made, such as turning persistence off.
    if (remote.updatedAt > this.updatedAt) {
      if (remote.place === 'local') {
        await this.remember('local');
        return;
      }
      await this.remember('account');
      await this.apply(remote);
      return;
    }
    if (this.updatedAt > remote.updatedAt) {
      await (this.place === 'account' ? this.pushNow() : this.send()).catch(() => undefined);
    }
  }

  private async remember(place: PreferencePlace): Promise<void> {
    if (this.place === place) return;
    this.place = place;
    usePreferencePlaceStore.getState().replace(place);
    await this.deps.kv.set(PLACE_KEY, place);
  }

  private async loadStamp(): Promise<void> {
    const raw = Number(await this.deps.kv.get(stampKey(this.deps.scope())));
    const stored = Number.isSafeInteger(raw) && raw > 0 ? raw : 0;
    if (stored > this.updatedAt) this.updatedAt = stored;
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.pushNow().catch(() => undefined);
    }, this.debounceMs);
  }

  private cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private async pushNow(): Promise<void> {
    if (this.place !== 'account' || !this.deps.signedIn()) return;
    await this.send();
  }

  private async send(): Promise<void> {
    if (!this.deps.signedIn()) return;
    if (this.pushing) { this.again = true; return; }
    this.pushing = true;
    try {
      do {
        this.again = false;
        if (this.updatedAt <= 0) {
          this.updatedAt = Date.now();
          await this.deps.kv.set(stampKey(this.deps.scope()), String(this.updatedAt));
        }
        const sentAt = this.updatedAt;
        const stored = await this.deps.push({ ...this.deps.read(), place: this.place, updatedAt: sentAt });
        if (stored.place !== 'local' && stored.updatedAt > this.updatedAt) await this.apply(stored);
        else if (this.updatedAt > sentAt) this.again = true;
      } while (this.again && this.deps.signedIn());
    } finally {
      this.pushing = false;
    }
  }

  private async apply(snapshot: PreferenceDocument): Promise<void> {
    if (snapshot.updatedAt < this.updatedAt) return;
    this.updatedAt = snapshot.updatedAt;
    await this.deps.kv.set(stampKey(this.deps.scope()), String(snapshot.updatedAt));
    const release = silencePreferenceWrites();
    try { await this.deps.write(snapshot); }
    finally { release(); }
  }
}

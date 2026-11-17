// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { judgeUpdate, pageWebBuild, releaseChange, releaseResponse, subscribeReleases, type Release } from '../src/core/release-events.ts';

class FakeSource extends EventTarget {
  static latest: FakeSource | undefined;
  closed = false;
  constructor(readonly url: string) {
    super();
    FakeSource.latest = this;
  }
  close(): void { this.closed = true; }
  emit(release: Release): void {
    this.dispatchEvent(new MessageEvent('release', { data: JSON.stringify(release) }));
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeSource.latest = undefined;
});

describe('release events', () => {
  it('compares this page with the bundle the server is serving', () => {
    const release = { server: '1.0.12', web: 'abc' };
    expect(judgeUpdate(release, false, 'abc')).toEqual({ state: 'current', label: '已是最新' });
    expect(judgeUpdate(release, false, 'def')).toEqual({ state: 'ready', label: '发现新版本' });
    expect(judgeUpdate(release, true, 'def').state).toBe('shell');
    expect(judgeUpdate(release, false, undefined).state).toBe('dev');
  });

  it('tells a controlled page to install a new bundle, and to reload for a server-only change', () => {
    expect(releaseChange({ server: '1', web: 'a' }, { server: '1', web: 'a' })).toBe('none');
    expect(releaseChange({ server: '1', web: 'a' }, { server: '1', web: 'b' })).toBe('web');
    expect(releaseChange({ server: '1', web: 'a' }, { server: '2', web: 'a' })).toBe('server');
    expect(releaseResponse('web', true)).toEqual({ updateWorker: true, reload: false });
    expect(releaseResponse('server', true)).toEqual({ updateWorker: false, reload: true });
    expect(releaseResponse('both', true)).toEqual({ updateWorker: true, reload: false });
    expect(releaseResponse('web', false)).toEqual({ updateWorker: true, reload: true });
  });

  it('treats the first push as the open page and reports the next change', () => {
    vi.stubGlobal('EventSource', FakeSource);
    const changes: string[] = [];
    const stop = subscribeReleases('http://127.0.0.1:5888', (change) => changes.push(change));
    const source = FakeSource.latest!;
    expect(source.url).toBe('http://127.0.0.1:5888/api/v1/events');
    source.emit({ server: '1.0.11', web: 'aaa' });
    source.emit({ server: '1.0.11', web: 'aaa' });
    source.emit({ server: '1.0.12', web: 'bbb' });
    expect(changes).toEqual(['both']);
    stop();
    expect(source.closed).toBe(true);
    source.emit({ server: '9', web: 'z' });
    expect(changes).toEqual(['both']);
  });

  it('treats the snapshot after a restart as an update when this page is older', () => {
    vi.stubGlobal('EventSource', FakeSource);
    const changes: string[] = [];
    const stop = subscribeReleases('http://127.0.0.1:5888', (change) => changes.push(change), 'aaaaaaaaaaaaaaaaaaaa');
    FakeSource.latest!.emit({ server: '1.0.11', web: 'bbbbbbbbbbbbbbbbbbbb' });
    FakeSource.latest!.emit({ server: '1.0.11', web: 'bbbbbbbbbbbbbbbbbbbb' });
    expect(changes).toEqual(['web']);
    stop();
  });

  it('reads only a stamped 20-character build id', () => {
    document.head.innerHTML = '<meta name="reader-web-build" content="__READER_WEB_BUILD__">';
    expect(pageWebBuild()).toBeUndefined();
    document.head.innerHTML = '<meta name="reader-web-build" content="0123456789abcdef0123">';
    expect(pageWebBuild()).toBe('0123456789abcdef0123');
    document.head.innerHTML = '';
  });
});

// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render } from '../src/shared/ui/render-root.ts';
import { MinePage } from '../src/features/account/pages/MinePage.tsx';
import { AboutPage } from '../src/features/account/pages/AboutPage.tsx';
import { RuntimeContext } from '../src/app/providers/runtime-context.tsx';
import { useAuthStore } from '../src/shared/stores/auth.store.ts';
import { saveThemePreference } from '../src/shared/theme/theme.ts';

const root = document.createElement('div');
document.body.append(root);
const signOut = vi.fn(async () => undefined);
const runtime = {
  api: { baseUrl: 'https://reader.example.com/app', signOut },
  mediaApi: { preferenceScope: () => 'mine-test' },
} as any;
const user = (role: 'admin' | 'member') => ({ id: 'u', username: 'lin', displayName: '林间', role, createdAt: 0 });
const paint = () => act(() => render(
  <RuntimeContext.Provider value={runtime}>
    <MemoryRouter initialEntries={['/me']}>
      <Routes><Route path="/me" element={<MinePage />} /></Routes>
    </MemoryRouter>
  </RuntimeContext.Provider>,
  root,
));

afterEach(() => {
  act(() => render(null, root));
  useAuthStore.setState({ session: null, verifiedUser: null });
  localStorage.clear();
  signOut.mockClear();
});

describe('我的', () => {
  it('pure reading hides media management but keeps administrator recovery controls',()=>{
    useAuthStore.setState({verifiedUser:{...user('admin'),features:{media:false}}});
    paint();
    const links=[...root.querySelectorAll<HTMLAnchorElement>('a')];
    expect(links.some(link=>link.getAttribute('href')?.startsWith('/media/'))).toBe(false);
    expect(links.some(link=>link.getAttribute('href')==='/me/admin/users')).toBe(true);
    expect(links.some(link=>link.getAttribute('href')==='/me/admin/services')).toBe(true);
    expect(root.textContent).not.toContain('观影');
  });
  it('shows who is signed in, which server, and opens every row as a page', () => {
    useAuthStore.setState({ verifiedUser: user('member') });
    paint();
    expect(root.querySelector('.mine-profile')?.textContent).toContain('林间');
    expect(root.querySelector('.mine-profile')?.textContent).toContain('reader.example.com');
    expect(root.querySelector('.mine-profile')?.textContent).toContain('成员');
    const links = [...root.querySelectorAll<HTMLAnchorElement>('a.mine-row')].map(a => [a.textContent, a.getAttribute('href')]);
    expect(links).toEqual([
      ['书库', '/sources?tab=explore&source=local'], ['书源', '/sources'], ['读书笔记高亮、批注、书签', '/me/notes'], ['时长统计阅读、观影、听书', '/me/stats'],
      ['偏好设置跟随系统', '/me/settings'],
      ['账号与连接', '/me/account'], ['外部阅读器OPDS', '/me/opds'],
      ['关于', '/me/about'],
    ]);
    // Signing out asks first. Checking for an update reports on the row.
    expect([...root.querySelectorAll('button.mine-row')].map(b => b.textContent)).toEqual(['退出登录', '检查更新']);
    // Members see no administration group.
    expect(root.querySelector('[aria-label="管理"]')).toBeNull();
  });

  it('gathers administration under 管理 for administrators, one page per job, and shows the chosen theme', () => {
    saveThemePreference('mine-test', { theme: 'blue', mode: 'dark' });
    useAuthStore.setState({ verifiedUser: user('admin') });
    paint();
    const labels = [...root.querySelectorAll('.mine-row-label')].map(el => el.textContent);
    expect(labels).toContain('媒体库');
    const admin = [...root.querySelectorAll<HTMLAnchorElement>('[aria-label="管理"] a.mine-row')].map(a => [a.querySelector('.mine-row-label')?.textContent, a.getAttribute('href')]);
    expect(admin).toEqual([
      ['用户管理', '/me/admin/users'], ['注册与邀请', '/me/admin/registration'], ['服务配置', '/me/admin/services'],
      ['扫描与刮削', '/media/video/settings/tasks'],
    ]);
    expect(root.textContent).toContain('雾蓝 · 深色');
    expect(root.querySelector('.mine-profile')?.textContent).toContain('管理员');
  });

  it('offers the site banner when this page is behind the bundle being served', async () => {
    const meta = document.createElement('meta');
    meta.name = 'reader-web-build';
    meta.content = 'aaaaaaaaaaaaaaaaaaaa';
    document.head.append(meta);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ server: '1.0.12', web: 'bbbbbbbbbbbbbbbbbbbb' }) })));
    useAuthStore.setState({ verifiedUser: user('member') });
    paint();
    const check = [...root.querySelectorAll<HTMLButtonElement>('button.mine-row')].find(button => button.textContent?.startsWith('检查更新'))!;
    await act(async () => { check.click(); });
    expect(check.textContent).toContain('发现新版本');
    expect(document.querySelector('.pwa-update button')?.textContent).toBe('立即更新');
    document.querySelector('.pwa-update')?.remove();
    meta.remove();
    vi.unstubAllGlobals();
  });

  it('does not reload over an active worker that would keep the previous build', async () => {
    const meta = document.createElement('meta');
    meta.name = 'reader-web-build';
    meta.content = 'aaaaaaaaaaaaaaaaaaaa';
    document.head.append(meta);
    const update = vi.fn(async () => undefined);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ server: '1.0.12', web: 'bbbbbbbbbbbbbbbbbbbb' }) })));
    vi.stubGlobal('navigator', {
      serviceWorker: {
        controller: null,
        getRegistration: async () => ({ active: {}, waiting: null, update }),
      },
    });
    useAuthStore.setState({ verifiedUser: user('member') });
    paint();
    const check = [...root.querySelectorAll<HTMLButtonElement>('button.mine-row')].find(button => button.textContent?.startsWith('检查更新'))!;
    await act(async () => { check.click(); });
    expect(check.textContent).toContain('发现新版本');
    expect(update).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.pwa-update button')?.textContent).toBe('立即更新');
    document.querySelector('.pwa-update')?.remove();
    meta.remove();
    vi.unstubAllGlobals();
  });

  it('lets a controlling service worker install the bundle before reloading', async () => {
    const meta = document.createElement('meta');
    meta.name = 'reader-web-build';
    meta.content = 'aaaaaaaaaaaaaaaaaaaa';
    document.head.append(meta);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ server: '1.0.12', web: 'bbbbbbbbbbbbbbbbbbbb' }) })));
    vi.stubGlobal('navigator', { serviceWorker: { controller: {} } });
    useAuthStore.setState({ verifiedUser: user('member') });
    paint();
    const check = [...root.querySelectorAll<HTMLButtonElement>('button.mine-row')].find(button => button.textContent?.startsWith('检查更新'))!;
    await act(async () => { check.click(); });
    expect(check.textContent).toContain('发现新版本');
    expect(document.querySelector('.pwa-update button')?.textContent).toBe('立即更新');
    document.querySelector('.pwa-update')?.remove();
    meta.remove();
    vi.unstubAllGlobals();
  });

  it('reports a development page as having no build to compare', () => {
    useAuthStore.setState({ verifiedUser: user('member') });
    paint();
    const check = [...root.querySelectorAll<HTMLButtonElement>('button.mine-row')].find(button => button.textContent?.startsWith('检查更新'))!;
    act(() => { check.click(); });
    expect(check.textContent).toContain('当前是开发页面');
  });

  it('lists the server version on 关于', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ server: '1.0.12', web: 'abcabcabcabcabcabcab' }) })));
    await act(async () => {
      render(
        <RuntimeContext.Provider value={runtime}>
          <MemoryRouter initialEntries={['/me/about']}>
            <Routes><Route path="/me/about" element={<AboutPage />} /></Routes>
          </MemoryRouter>
        </RuntimeContext.Provider>,
        root,
      );
    });
    expect(root.querySelector('.media-heading')?.textContent).toContain('关于');
    expect(root.textContent).toContain('客户端');
    expect(root.textContent).toContain('1.0.13');
    expect(root.textContent).toContain('网页构建');
    expect(root.textContent).toContain('开发构建');
    const repos = root.querySelector('.about-repos');
    expect(repos?.querySelectorAll('a')).toHaveLength(2);
    expect(repos?.querySelector('a[href="https://github.com/CcccX2017/reader"]')?.textContent).toContain('Current');
    expect(repos?.querySelector('a[href="https://github.com/hectorqin/reader"]')?.textContent).toContain('Fork');
    expect(root.querySelectorAll('a[href^="https://github.com/"] .icon')).toHaveLength(2);
    expect(root.textContent).not.toContain('镜像');
    vi.unstubAllGlobals();
  });

  it('signs out through the API, after a confirmation', () => {
    useAuthStore.setState({ verifiedUser: user('member') });
    paint();
    act(() => { root.querySelector<HTMLButtonElement>('.mine-row.is-danger')!.click(); });
    expect(signOut).not.toHaveBeenCalled();
    const confirm = [...document.querySelectorAll<HTMLButtonElement>('dialog button')].find(button => button.textContent === '退出登录')!;
    act(() => { confirm.click(); });
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});

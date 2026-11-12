// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '../src/shared/ui/render-root.ts';
import { rememberAvatar, useAvatar } from '../src/shared/ui/use-avatar.ts';

const root = document.createElement('div');
document.body.append(root);

function Probe({ api, url }: { api: { coverBytes: (url: string) => Promise<Uint8Array> }; url?: string | null }) {
  const avatar = useAvatar(api, url);
  return <output data-pending={avatar.pending ? 'yes' : 'no'} data-src={avatar.src ?? ''} />;
}

beforeEach(() => {
  let n = 0;
  vi.stubGlobal('URL', { createObjectURL: () => `blob:avatar-${++n}`, revokeObjectURL: () => undefined });
});

afterEach(() => {
  act(() => render(null, root));
  vi.unstubAllGlobals();
});

describe('useAvatar', () => {
  it('shows nothing to fetch when the account has no avatar', () => {
    const api = { coverBytes: vi.fn() };
    act(() => render(<Probe api={api} url={null} />, root));
    expect(root.querySelector('output')?.dataset).toMatchObject({ pending: 'no', src: '' });
    expect(api.coverBytes).not.toHaveBeenCalled();
  });

  it('hides the picture until the bytes arrive, and reuses them for the next page', async () => {
    let release: (bytes: Uint8Array) => void = () => undefined;
    const api = { coverBytes: vi.fn(() => new Promise<Uint8Array>(resolve => { release = resolve; })) };
    act(() => render(<Probe api={api} url="/api/v1/users/u/avatar?v=1" />, root));
    expect(root.querySelector('output')?.dataset).toMatchObject({ pending: 'yes', src: '' });
    await act(async () => { release(new Uint8Array([9, 8, 7])); });
    const src = root.querySelector('output')?.dataset.src ?? '';
    expect(src.startsWith('blob:')).toBe(true);
    expect(root.querySelector('output')?.dataset.pending).toBe('no');
    act(() => render(null, root));
    act(() => render(<Probe api={api} url="/api/v1/users/u/avatar?v=1" />, root));
    expect(root.querySelector('output')?.dataset).toMatchObject({ pending: 'no', src });
    expect(api.coverBytes).toHaveBeenCalledTimes(1);
  });

  it('falls back to no picture when the download fails', async () => {
    const api = { coverBytes: vi.fn().mockRejectedValue(new Error('missing')) };
    await act(async () => { render(<Probe api={api} url="/api/v1/users/u/avatar?v=2" />, root); });
    expect(root.querySelector('output')?.dataset).toMatchObject({ pending: 'no', src: '' });
  });

  it('uses a just-uploaded file before the new address is fetched', () => {
    const api = { coverBytes: vi.fn() };
    rememberAvatar(api, '/api/v1/users/u/avatar?v=3', new Blob([new Uint8Array([1])]));
    act(() => render(<Probe api={api} url="/api/v1/users/u/avatar?v=3" />, root));
    expect(root.querySelector('output')?.dataset.pending).toBe('no');
    expect(root.querySelector('output')?.dataset.src?.startsWith('blob:')).toBe(true);
    expect(api.coverBytes).not.toHaveBeenCalled();
  });
});

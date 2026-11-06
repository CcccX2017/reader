// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '../src/shared/ui/render-root.ts';
import { RuntimeContext } from '../src/app/providers/runtime-context.tsx';
import { useBookMetadata } from '../src/features/shelf/book-metadata.tsx';

const root = document.createElement('div');
document.body.append(root);
afterEach(() => { act(() => render(null, root)); });

function Host() {
  const meta = useBookMetadata(() => undefined);
  return <>
    <button type="button" onClick={() => meta.open({ id: 'b1', title: '射雕英雄传', author: '', manualFields: [] })}>打开</button>
    {meta.ui}
  </>;
}

it('saves a novel author through the manual override API', async () => {
  const patchBookMetadata = vi.fn(async () => ({
    book: { id: 'b1', title: '射雕英雄传', author: '金庸', manualFields: ['author'] },
  }));
  const runtime = { api: { patchBookMetadata, clearBookMetadataField: vi.fn() } } as any;
  await act(async () => render(
    <RuntimeContext.Provider value={runtime}>
      <QueryClientProvider client={new QueryClient()}><Host /></QueryClientProvider>
    </RuntimeContext.Provider>,
    root,
  ));
  await act(async () => root.querySelector('button')!.click());
  await act(async () => {
    const input = root.querySelector<HTMLInputElement>('[aria-label="作者"]')!;
    input.value = '金庸';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => [...root.querySelectorAll('button')].find(button => button.textContent === '保存')!.click());
  expect(patchBookMetadata).toHaveBeenCalledWith('b1', { author: '金庸' });
});

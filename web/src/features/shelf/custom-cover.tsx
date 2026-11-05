import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type JSX } from 'react';
import type { Book, BookListPage, ContinueReadingItem } from '../../api/types.ts';
import { useRuntime } from '../../app/providers/runtime-context.tsx';
import type { MenuItems } from '../../ui/action-menu.tsx';
import { rememberCover } from './cover-cache.ts';

/**
 * Sets or restores one book's cover from the ⋯ menu.
 *
 * The file picker has to open inside the menu click, so the chosen book is
 * remembered on a ref and the hidden input is clicked immediately. The chosen
 * file is shown at once; the lists then pick up the new cover address without
 * a success toast.
 */
export function useCustomCover(onError: (message: string) => void) {
  const runtime = useRuntime();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const bookId = useRef('');
  const [busy, setBusy] = useState(false);

  const show = (book: Book, file?: Blob) => {
    if (file && book.coverUrl) rememberCover(runtime.api, book.coverUrl, file);
    const merge = <T extends { id: string }>(item: T): T => item.id === book.id ? { ...item, coverUrl: book.coverUrl, manualFields: book.manualFields } : item;
    const pages = (data: unknown): unknown => {
      if (!data || typeof data !== 'object' || !Array.isArray((data as BookListPage).items)) return data;
      const page = data as BookListPage;
      return { ...page, items: page.items.map(merge) };
    };
    queryClient.setQueriesData({ queryKey: ['shelf'] }, pages);
    queryClient.setQueriesData({ queryKey: ['library-books'] }, pages);
    queryClient.setQueriesData({ queryKey: ['search', 'books'] }, pages);
    queryClient.setQueriesData({ queryKey: ['home', 'reading'] }, (data: unknown) => Array.isArray(data) ? (data as ContinueReadingItem[]).map(merge) : data);
  };

  const pick = (id: string) => {
    bookId.current = id;
    inputRef.current?.click();
  };

  const upload = async (file: File | undefined) => {
    const id = bookId.current;
    if (!file || !id) return;
    setBusy(true);
    onError('');
    try {
      const { book } = await runtime.api.setBookCover(id, file);
      show(book, file);
    } catch (error) {
      onError(error instanceof Error ? error.message : '封面更新失败，请稍后重试。');
    } finally {
      setBusy(false);
    }
  };

  const clear = async (id: string) => {
    setBusy(true);
    onError('');
    try {
      const { book } = await runtime.api.clearBookCover(id);
      show(book);
    } catch (error) {
      onError(error instanceof Error ? error.message : '恢复封面失败，请稍后重试。');
    } finally {
      setBusy(false);
    }
  };

  const input: JSX.Element = <input ref={inputRef} hidden type="file" accept="image/jpeg,image/png,image/gif,image/webp" aria-label="选择封面图片" onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; void upload(file); }} />;

  const menu = (book: { id: string; manualFields?: string[] }): MenuItems => [
    { label: '设置封面', disabled: busy, onSelect: () => pick(book.id) },
    book.manualFields?.includes('cover') ? { label: '恢复原封面', disabled: busy, onSelect: () => void clear(book.id) } : undefined,
  ];

  return { input, menu, busy, pick, clear };
}

import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type JSX } from 'react';
import type { Book, BookListPage, ContinueReadingItem } from '../../api/types.ts';
import { useRuntime } from '../../app/providers/runtime-context.tsx';
import type { MenuItems } from '../../ui/action-menu.tsx';
import { ChangeCoverSheet, type CoverBook } from '../../ui/change-cover-sheet.tsx';
import { DialogView, type Dialog } from '../../ui/dialog.tsx';
import { rememberCover } from './cover-cache.ts';

/**
 * Sets or restores one book's cover from the ⋯ menu.
 *
 * "设置封面" opens a short choice: a local image, an http(s) URL the server
 * downloads, or a cover found on a book source. The file picker still has to
 * open inside the menu/choice click so the browser allows it.
 */
export function useCustomCover(onError: (message: string) => void) {
  const runtime = useRuntime();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const bookRef = useRef<CoverBook | null>(null);
  const [busy, setBusy] = useState(false);
  const [chooser, setChooser] = useState(false);
  const [urlAsk, setUrlAsk] = useState(false);
  const [sourceBook, setSourceBook] = useState<CoverBook | null>(null);

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

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['shelf'] });
    await queryClient.invalidateQueries({ queryKey: ['library-books'] });
    await queryClient.invalidateQueries({ queryKey: ['search'] });
    await queryClient.invalidateQueries({ queryKey: ['home'] });
  };

  /** Opens the local / URL / book-source choice for one book. */
  const open = (book: CoverBook) => {
    bookRef.current = book;
    setChooser(true);
  };

  const pickFile = () => {
    inputRef.current?.click();
  };

  const upload = async (file: File | undefined) => {
    const id = bookRef.current?.id;
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

  const applyUrl = async (url: string) => {
    const id = bookRef.current?.id;
    const trimmed = url.trim();
    if (!id || !trimmed) return;
    setBusy(true);
    onError('');
    try {
      const { book } = await runtime.api.setBookCoverFromUrl(id, trimmed);
      show(book);
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

  const ui: JSX.Element = <>
    {chooser && <DialogView
      dialog={{ kind: 'pick', title: '设置封面', options: [
        { value: 'file', label: '选择本地图片' },
        { value: 'url', label: '使用网络链接' },
        { value: 'source', label: '从书源选择' },
      ], resolve: (_value: string | null) => undefined } satisfies Dialog}
      destructive=""
      onClose={answer => {
        setChooser(false);
        if (answer === 'file') pickFile();
        else if (answer === 'url') setUrlAsk(true);
        else if (answer === 'source' && bookRef.current) setSourceBook(bookRef.current);
      }}
    />}
    {urlAsk && <DialogView
      dialog={{ kind: 'prompt', title: '封面图片链接', value: '', resolve: (_value: string | null) => undefined } satisfies Dialog}
      destructive=""
      onClose={answer => {
        setUrlAsk(false);
        if (typeof answer === 'string' && answer.trim()) void applyUrl(answer);
      }}
    />}
    {sourceBook && <ChangeCoverSheet
      book={sourceBook}
      onClose={() => setSourceBook(null)}
      onChanged={() => { void refresh(); }}
    />}
  </>;

  const menu = (book: CoverBook): MenuItems => [
    { label: '设置封面', disabled: busy, onSelect: () => open(book) },
    book.manualFields?.includes('cover') ? { label: '恢复原封面', disabled: busy, onSelect: () => void clear(book.id) } : undefined,
  ];

  return { input, ui, menu, busy, open, pick: open, clear };
}

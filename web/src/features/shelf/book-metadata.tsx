import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent, type JSX } from 'react';
import type { Book, BookListPage, ContinueReadingItem } from '../../api/types.ts';
import { useRuntime } from '../../app/providers/runtime-context.tsx';
import type { MenuItems } from '../../ui/action-menu.tsx';
import { Button } from '../../ui/toolkit.tsx';
import { Sheet } from '../../ui/sheet.tsx';

export interface EditableBook {
  id: string;
  title: string;
  author?: string;
  description?: string;
  manualFields?: string[];
}

/**
 * Edits a novel's title, author and blurb from the ⋯ menu.
 *
 * Filename parsing deliberately leaves author empty when unsure; this is the
 * place the reader fills it in. Writes go to the manual override layer, so a
 * later scan cannot wipe them.
 */
export function useBookMetadata(onError: (message: string) => void, onChanged?: (book: Book) => void) {
  const runtime = useRuntime();
  const queryClient = useQueryClient();
  const [target, setTarget] = useState<EditableBook | null>(null);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!target) return;
    setTitle(target.title);
    setAuthor(target.author ?? '');
    setDescription(target.description ?? '');
  }, [target]);

  const show = (book: Book) => {
    const merge = <T extends { id: string }>(item: T): T => (
      item.id === book.id
        ? { ...item, title: book.title, author: book.author, description: book.description, manualFields: book.manualFields }
        : item
    );
    const pages = (data: unknown): unknown => {
      if (!data || typeof data !== 'object' || !Array.isArray((data as BookListPage).items)) return data;
      const page = data as BookListPage;
      return { ...page, items: page.items.map(merge) };
    };
    queryClient.setQueriesData({ queryKey: ['shelf'] }, pages);
    queryClient.setQueriesData({ queryKey: ['library-books'] }, pages);
    queryClient.setQueriesData({ queryKey: ['search', 'books'] }, pages);
    queryClient.setQueriesData({ queryKey: ['home', 'reading'] }, (data: unknown) => (
      Array.isArray(data) ? (data as ContinueReadingItem[]).map(merge) : data
    ));
  };

  const open = (book: EditableBook) => {
    setTarget(book);
    onError('');
  };

  const close = () => {
    if (busy) return;
    setTarget(null);
  };

  const save = async () => {
    if (!target || busy) return;
    const nextTitle = title.trim();
    if (!nextTitle) {
      onError('书名不能为空');
      return;
    }
    const nextAuthor = author.trim();
    const nextDescription = description.trim();
    const patch: { title?: string; author?: string; description?: string } = {};
    if (nextTitle !== target.title) patch.title = nextTitle;
    if (nextAuthor !== (target.author ?? '').trim()) patch.author = nextAuthor;
    if (nextDescription !== (target.description ?? '').trim()) patch.description = nextDescription;
    if (!Object.keys(patch).length) {
      setTarget(null);
      return;
    }
    setBusy(true);
    onError('');
    try {
      const { book } = await runtime.api.patchBookMetadata(target.id, patch);
      show(book);
      onChanged?.(book);
      setTarget(null);
    } catch (error) {
      onError(error instanceof Error ? error.message : '保存失败，请稍后重试。');
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void save();
  };

  const clearField = async (field: 'title' | 'author' | 'description') => {
    if (!target || busy) return;
    setBusy(true);
    onError('');
    try {
      const { book } = await runtime.api.clearBookMetadataField(target.id, field);
      show(book);
      onChanged?.(book);
      setTarget({ id: book.id, title: book.title, author: book.author, description: book.description, manualFields: book.manualFields });
      setTitle(book.title);
      setAuthor(book.author);
      setDescription(book.description);
    } catch (error) {
      onError(error instanceof Error ? error.message : '恢复失败，请稍后重试。');
    } finally {
      setBusy(false);
    }
  };

  const menu = (book: EditableBook): MenuItems => [
    { label: '编辑信息', disabled: busy, onSelect: () => open(book) },
  ];

  const ui: JSX.Element | null = target ? (
    <Sheet
      title="编辑信息"
      busy={busy}
      onClose={close}
      initialFocus='[aria-label="作者"]'
      footer={<>
        <Button disabled={busy} onClick={close}>取消</Button>
        <Button className="primary" disabled={busy} onClick={() => void save()}>{busy ? '正在保存…' : '保存'}</Button>
      </>}
    >
      <form className="sheet-form" onSubmit={onSubmit}>
        <p className="sheet-text">修改书名、作者或简介后作为人工修正保存，重新扫描不会覆盖。</p>
        <label className="sheet-field">书名
          <input aria-label="书名" value={title} required disabled={busy} maxLength={500} onInput={event => setTitle(event.currentTarget.value)} />
        </label>
        {target.manualFields?.includes('title') && (
          <Button type="button" disabled={busy} onClick={() => void clearField('title')}>恢复原书名</Button>
        )}
        <label className="sheet-field">作者
          <input aria-label="作者" value={author} disabled={busy} maxLength={500} placeholder="未知作者时可在此补全" onInput={event => setAuthor(event.currentTarget.value)} />
        </label>
        {target.manualFields?.includes('author') && (
          <Button type="button" disabled={busy} onClick={() => void clearField('author')}>恢复原作者</Button>
        )}
        <label className="sheet-field">简介
          <textarea aria-label="简介" value={description} disabled={busy} maxLength={8000} rows={6} placeholder="没有简介时可在此补上" onInput={event => setDescription(event.currentTarget.value)} />
        </label>
        {target.manualFields?.includes('description') && (
          <Button type="button" disabled={busy} onClick={() => void clearField('description')}>恢复原简介</Button>
        )}
      </form>
    </Sheet>
  ) : null;

  return { ui, menu, busy, open };
}

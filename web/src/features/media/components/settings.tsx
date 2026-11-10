import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MediaSelect } from './select.tsx';
import type { MediaAccount } from '../api/media-api.ts';
import { readMediaPreferences, saveMediaPreferences, type MediaPreferences } from '../services/preferences.ts';
import { useAvatar } from '../../../shared/ui/use-avatar.ts';
import type { ReaderApi } from '../../../api/client.ts';
import type { User } from '../../../api/types.ts';


/**
 * 影音浏览: the media screens' per-device browsing preferences, the 影音浏览 section
 * of 我的 › 偏好设置. Like every other section there, a change applies at once;
 * a storage failure is reported and the control returns to what is stored.
 */
export function MediaBrowseSettings({ scope }: { scope: string }) {
  const [value, setValue] = useState(() => readMediaPreferences(scope));
  const [error, setError] = useState('');
  function change(patch: Partial<MediaPreferences>) {
    try {
      setValue(saveMediaPreferences(scope, { ...value, ...patch }));
      setError('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '保存失败');
    }
  }
  return <div className="media-settings-panel">
    <label className="media-setting-field">封面密度
      <MediaSelect aria-label="封面密度" value={value.density} onChange={event => change({ density: event.currentTarget.value as MediaPreferences['density'] })}>
        <option value="compact">紧凑（手机三列）</option>
        <option value="comfortable">宽松（手机两列）</option>
      </MediaSelect>
    </label>
    <label className="media-setting-field">默认排序
      <MediaSelect aria-label="默认排序" value={value.sort ?? 'default'} onChange={event => change({ sort: event.currentTarget.value as NonNullable<MediaPreferences['sort']> })}>
        <option value="default">默认顺序</option>
        <option value="title-asc">名称升序</option>
        <option value="title-desc">名称降序</option>
      </MediaSelect>
    </label>
    <label className="media-settings-check"><span>首页显示最近续播</span><input type="checkbox" role="switch" checked={value.showContinue} onChange={event => change({ showContinue: event.currentTarget.checked })} /></label>
    <label className="media-settings-check"><span>列表工具栏显示来源库</span><input type="checkbox" role="switch" checked={value.showLibraryName} onChange={event => change({ showLibraryName: event.currentTarget.checked })} /></label>
    {error && <p role="alert">{error}</p>}
  </div>;
}

/** 账号与连接: who is signed in and to which server. Never shows tokens. */
export function MediaAccountPanel({ account, api, onDisplayName, onAvatar, onClearAvatar, extraDirty = false, onExtraSave, children }: {
  account: MediaAccount;
  /** Needed to fetch the current avatar through Authorization. */
  api?: ReaderApi;
  /** Saves the display name; empty clears it back to the username. */
  onDisplayName?(displayName: string): Promise<void>;
  /** Uploads a new avatar; the previous file is overwritten. */
  onAvatar?(file: File): Promise<User>;
  /** Removes the avatar so the initial letter shows again. */
  onClearAvatar?(): Promise<User>;
  /** Another field in this form, such as the iOS version, has an unsaved edit. */
  extraDirty?: boolean;
  /** Runs with the display-name save. A throw keeps the one error line. */
  onExtraSave?(): void;
  children?: ReactNode;
}) {
  const stored = account.displayName === account.username ? '' : account.displayName;
  const [draft, setDraft] = useState(stored);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const remote = useAvatar(api, account.avatarUrl);
  useEffect(() => { setDraft(stored); }, [stored]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const name = account.displayName || account.username;
  const dirty = draft.trim() !== stored.trim();
  const face = preview ?? remote;
  const upload = async (file: File | undefined) => {
    if (!file || !onAvatar) return;
    setAvatarBusy(true); setAvatarError('');
    const local = URL.createObjectURL(file);
    setPreview(prev => { if (prev) URL.revokeObjectURL(prev); return local; });
    try {
      await onAvatar(file);
    } catch (reason) {
      setPreview(prev => { if (prev) URL.revokeObjectURL(prev); return null; });
      setAvatarError(reason instanceof Error ? reason.message : '头像更新失败');
    } finally {
      setAvatarBusy(false);
    }
  };
  const clear = async () => {
    if (!onClearAvatar) return;
    setAvatarBusy(true); setAvatarError('');
    try {
      await onClearAvatar();
      setPreview(prev => { if (prev) URL.revokeObjectURL(prev); return null; });
    } catch (reason) {
      setAvatarError(reason instanceof Error ? reason.message : '清除头像失败');
    } finally {
      setAvatarBusy(false);
    }
  };
  const avatar = onAvatar ? <>
    <button type="button" className="media-account-avatar is-upload" aria-label="更换头像" disabled={avatarBusy} onClick={() => inputRef.current?.click()}>
      {face ? <img src={face} alt="" /> : Array.from(name)[0]}
    </button>
    <input ref={inputRef} hidden type="file" accept="image/jpeg,image/png,image/gif,image/webp" aria-label="选择头像图片" onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; void upload(file); }} />
  </> : <div className="media-account-avatar" aria-hidden="true">{face ? <img src={face} alt="" /> : Array.from(name)[0]}</div>;
  return <section className="media-account-panel">
    <h2>{name}</h2>
    <p>@{account.username} · {account.role === 'admin' ? '管理员' : '普通用户'}</p>
    <p className="media-manager-note">共享作品资料，收藏、队列和播放进度按账号隔离</p>
    <dl><dt>当前服务器</dt><dd>{account.server || window.location.origin}</dd></dl>
    {(onDisplayName || onAvatar || children) && <form className="media-account-profile" onSubmit={event => {
      event.preventDefault();
      if (busy || (!dirty && !extraDirty)) return;
      setBusy(true); setError(''); setSaved(false);
      void (async () => {
        if (dirty && onDisplayName) await onDisplayName(draft.trim());
        if (extraDirty) onExtraSave?.();
        setSaved(true);
      })().catch(reason => {
        setError(reason instanceof Error ? reason.message : '保存失败');
      }).finally(() => setBusy(false));
    }}>
      {(onAvatar || face) && <div className="media-setting-field media-account-avatar-field">
        <span>头像</span>
        <div className="media-account-avatar-control">
          {avatar}
          {(account.avatarUrl || preview) && onClearAvatar && <button type="button" className="button" disabled={avatarBusy} onClick={() => void clear()}>{avatarBusy ? '处理中…' : '清除'}</button>}
        </div>
      </div>}
      {onDisplayName && <label className="media-setting-field">显示名
        <input
          aria-label="显示名"
          maxLength={100}
          value={draft}
          placeholder={account.username}
          disabled={busy}
          onChange={event => { setDraft(event.currentTarget.value); setSaved(false); setError(''); }}
        />
      </label>}
      {children}
      <div className="media-account-name-actions">
        {(onDisplayName || children) && <button type="submit" className="button primary" disabled={(!dirty && !extraDirty) || busy}>{busy ? '保存中…' : '保存'}</button>}
        {saved && !dirty && <span role="status">已保存</span>}
        {(error || avatarError) && <span role="alert">{error || avatarError}</span>}
      </div>
    </form>}
  </section>;
}

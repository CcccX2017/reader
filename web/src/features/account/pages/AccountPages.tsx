import { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useSyncStore } from '../../../shared/stores/sync.store.ts';
import type { SyncState } from '../../../core/sync.ts';
import { MediaPageFrame } from '../../media/components/MediaPageFrame.tsx';
import { MediaAccountPanel } from '../../media/components/settings.tsx';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { useAuthStore } from '../../../shared/stores/auth.store.ts';
import { OpdsAccess } from '../../../ui/opds-access.tsx';
import { applySafariVersion, isIos, readSafariOverride, safariVersionFromUa, writeSafariOverride } from '../../../shared/safari-version.ts';

/** 账号与连接 (/me/account): who is signed in, and to which server. */
export function AccountPage() {
  const runtime = useRuntime();
  const user = useAuthStore((state) => state.verifiedUser ?? state.session?.user ?? null);
  const account = runtime.mediaApi.accountInfo();
  if (!account || !user) return <Navigate to="/me" replace />;
  // Prefer the store's user so a just-saved display name / avatar shows without a reload.
  const shown = {
    ...account,
    displayName: user.displayName,
    username: user.username,
    role: user.role,
    avatarUrl: user.avatarUrl ?? null,
  };
  const ios = isIos(navigator.userAgent);
  const [version, setVersion] = useState(() => readSafariOverride());
  const detected = safariVersionFromUa(navigator.userAgent);
  const versionDirty = version.trim() !== readSafariOverride();
  return (
    <MediaPageFrame className="media-secondary-page account-page" title="账号与连接" backTo="/me" backLabel="返回我的">
      <MediaAccountPanel
        account={shown}
        api={runtime.api}
        extraDirty={versionDirty}
        onExtraSave={() => {
          writeSafariOverride(version);
          applySafariVersion();
        }}
        onDisplayName={async (displayName) => {
          const next = await runtime.api.updateDisplayName(displayName);
          useAuthStore.getState().setUser(next);
        }}
        onAvatar={async (file) => {
          const next = await runtime.api.setAvatar(file);
          useAuthStore.getState().setUser(next);
          return next;
        }}
        onClearAvatar={async () => {
          const next = await runtime.api.clearAvatar();
          useAuthStore.getState().setUser(next);
          return next;
        }}
      >
        {ios && (
          <>
            <label className="media-setting-field">
              iOS 版本
              <input
                aria-label="iOS 版本"
                inputMode="decimal"
                autoComplete="off"
                spellCheck={false}
                maxLength={16}
                value={version}
                placeholder={detected || '例如 27.2'}
                onChange={(event) => setVersion(event.target.value)}
              />
            </label>
            <p className="media-manager-note">只保存在这台设备，用来匹配页面留白。留空则使用浏览器报告的{detected ? ` ${detected}` : '版本'}。</p>
          </>
        )}
      </MediaAccountPanel>
      <SyncPanel />
    </MediaPageFrame>
  );
}

const SYNC_LABELS: Record<SyncState, string> = { idle: '已连接', syncing: '正在同步', offline: '离线', error: '同步出错', 'signed-out': '登录已失效' };

/**
 * 同步状态: the sidebar and 我的 only have room for the verdict ("同步出错"); this is
 * where it is explained — what the engine last said, when it last succeeded, and a
 * way to try again now instead of waiting out the backoff.
 */
function SyncPanel() {
  const runtime = useRuntime();
  const status = useSyncStore((state) => state.status);
  const [busy, setBusy] = useState(false);
  const retry = () => {
    setBusy(true);
    void runtime.sync.syncNow().finally(() => setBusy(false));
  };
  const working = busy || status.state === 'syncing';
  return (
    <section className="media-account-panel account-sync" aria-label="同步状态">
      <h3>同步</h3>
      <dl>
        <dt>状态</dt>
        <dd data-state={status.state} role="status">
          {SYNC_LABELS[status.state]}
          {status.state === 'idle' && status.pending ? '，有改动等待上传' : ''}
        </dd>
        {status.message && (
          <>
            <dt>{status.state === 'error' ? '原因' : '说明'}</dt>
            <dd>{status.message}</dd>
          </>
        )}
        <dt>上次同步</dt>
        <dd>{status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleString() : '尚未同步'}</dd>
      </dl>
      {status.state !== 'signed-out' && (
        <button type="button" className="media-primary" disabled={working} onClick={retry}>
          {working ? '正在同步…' : '立即同步'}
        </button>
      )}
    </section>
  );
}

/**
 * 外部阅读器 (/me/opds). Reached from 我的, from 偏好设置 › 书架 and from the shelf's
 * settings sheet; back returns to whichever of them opened it (`state.returnTo`).
 */
export function OpdsPage() {
  const runtime = useRuntime();
  const returnTo = useLocation().state?.returnTo;
  const back = typeof returnTo === 'string' && returnTo.startsWith('/') ? returnTo : '/me';
  return (
    <MediaPageFrame className="media-secondary-page opds-page" title="连接外部阅读器" backTo={back} backLabel={back === '/me' ? '返回我的' : '返回上一页'}>
      <OpdsAccess
        api={runtime.api}
        onSignedOut={() => {
          void runtime.api.signOut();
        }}
      />
    </MediaPageFrame>
  );
}

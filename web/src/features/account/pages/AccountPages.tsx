import { Navigate, useLocation } from 'react-router-dom';
import { MediaPageFrame } from '../../media/components/MediaPageFrame.tsx';
import { MediaAccountPanel } from '../../media/components/settings.tsx';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { useAuthStore } from '../../../shared/stores/auth.store.ts';
import { OpdsAccess } from '../../../ui/opds-access.tsx';

/** 账号与连接 (/me/account): who is signed in, and to which server. */
export function AccountPage() {
  const runtime = useRuntime();
  const user = useAuthStore(state => state.verifiedUser ?? state.session?.user ?? null);
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
  return <MediaPageFrame className="media-secondary-page" title="账号与连接" backTo="/me" backLabel="返回我的">
    <MediaAccountPanel
      account={shown}
      api={runtime.api}
      onDisplayName={async displayName => {
        const next = await runtime.api.updateDisplayName(displayName);
        useAuthStore.getState().setUser(next);
      }}
      onAvatar={async file => {
        const next = await runtime.api.setAvatar(file);
        useAuthStore.getState().setUser(next);
        return next;
      }}
      onClearAvatar={async () => {
        const next = await runtime.api.clearAvatar();
        useAuthStore.getState().setUser(next);
        return next;
      }}
    />
  </MediaPageFrame>;
}

/**
 * 外部阅读器 (/me/opds). Reached from 我的, from 偏好设置 › 书架 and from the shelf's
 * settings sheet; back returns to whichever of them opened it (`state.returnTo`).
 */
export function OpdsPage() {
  const runtime = useRuntime();
  const returnTo = useLocation().state?.returnTo;
  const back = typeof returnTo === 'string' && returnTo.startsWith('/') ? returnTo : '/me';
  return <MediaPageFrame className="media-secondary-page opds-page" title="连接外部阅读器" backTo={back} backLabel={back === '/me' ? '返回我的' : '返回上一页'}>
    <OpdsAccess api={runtime.api} onSignedOut={() => { void runtime.api.signOut(); }} />
  </MediaPageFrame>;
}

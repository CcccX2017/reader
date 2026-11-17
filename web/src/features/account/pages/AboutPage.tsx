import { useEffect, useState } from 'react';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { appName } from '../../../app/page-title.ts';
import { fetchRelease, pageWebBuild, type Release } from '../../../core/release-events.ts';
import { MediaPageFrame } from '../../media/components/MediaPageFrame.tsx';
import { Icon } from '../../../ui/icon.tsx';
import '../styles/mine.css';

const REPOS = [
  { label: 'Current(CcccX2017)', name: 'CcccX2017/reader', href: 'https://github.com/CcccX2017/reader' },
  { label: 'Fork(hectorqin)', name: 'hectorqin/reader', href: 'https://github.com/hectorqin/reader' },
] as const;

function installedAppVersion(): string | undefined {
  try {
    const raw = window.ReaderAndroid?.diagnostics?.();
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return undefined;
    const version = (parsed as { appVersion?: unknown }).appVersion;
    return typeof version === 'string' && version.trim() ? version.trim() : undefined;
  } catch {
    return undefined;
  }
}

/** 关于 (/me/about): the name in use, and the versions of the server and this page. */
export function AboutPage() {
  const runtime = useRuntime();
  const [release, setRelease] = useState<Release | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let gone = false;
    void fetchRelease(runtime.api.baseUrl).then(
      (next) => {
        if (!gone) setRelease(next);
      },
      () => {
        if (!gone) setFailed(true);
      },
    );
    return () => {
      gone = true;
    };
  }, [runtime.api.baseUrl]);
  const app = installedAppVersion();
  return (
    <MediaPageFrame className="media-secondary-page about-page" title="关于" backTo="/me" backLabel="返回我的">
      <div className="account-scroll">
        <dl className="about-list">
          <div>
            <dt>名称</dt>
            <dd>{appName()}</dd>
          </div>
          <div>
            <dt>服务端版本</dt>
            <dd>{release ? release.server : failed ? '暂时读不到' : '正在读取…'}</dd>
          </div>
          <div>
            <dt>客户端版本</dt>
            <dd>{__READER_CLIENT_VERSION__}</dd>
          </div>
          <div>
            <dt>网页构建</dt>
            <dd>{pageWebBuild() ?? '开发构建'}</dd>
          </div>
          {release?.image && (
            <div>
              <dt>镜像</dt>
              <dd>{release.imageTag ? `${release.imageTag} · ${release.image}` : release.image}</dd>
            </div>
          )}
          <div className="about-repos">
            {REPOS.map((repo) => (
              <a key={repo.href} href={repo.href} title={repo.name} target="_blank" rel="noreferrer">
                <Icon name="github" size={16} />
                {repo.label}
              </a>
            ))}
          </div>
          {app && (
            <div>
              <dt>应用</dt>
              <dd>{app}</dd>
            </div>
          )}
        </dl>
        <p className="about-note">GNU Affero General Public License v3.0。</p>
      </div>
    </MediaPageFrame>
  );
}

import { Icon } from './icon.tsx';
import type { PullToRefreshState } from '../shared/ui/use-pull-to-refresh.ts';
import '../styles/pull-refresh.css';

/** Hint that sits at the top of a pull-to-refresh scroller. */
export function PullRefreshIndicator({ distance, refreshing, armed }: PullToRefreshState) {
  if (!distance && !refreshing) return null;
  const label = refreshing ? '正在同步书库…' : armed ? '松开同步书库' : '下拉同步书库';
  return <div className="pull-refresh" data-armed={armed || refreshing ? 'true' : undefined} data-refreshing={refreshing ? 'true' : undefined} style={{ height: distance || undefined }} role="status" aria-live="polite">
    <span className="pull-refresh-mark" aria-hidden="true"><Icon name="refresh" size={16} /></span>
    <span className="pull-refresh-label">{label}</span>
  </div>;
}

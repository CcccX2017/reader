import { SectionTitle, Segmented } from './toolkit.tsx';
import { usePreferencePlaceStore, type PreferencePlace } from '../shared/stores/preference-place.store.ts';
import { requestPreferencePlace } from '../store/preference-writes.ts';

/**
 * Where the reader's 设置 and 外观, and everything under 我的 › 偏好设置, are kept.
 * One control, because the two screens are the same settings.
 */
export function PreferencePlaceControl() {
  const place = usePreferencePlaceStore(state => state.place);
  return <div className="preference-place">
    <SectionTitle>保存位置</SectionTitle>
    <Segmented<PreferencePlace>
      label="保存位置"
      options={[{ value: 'local', label: '本地存储' }, { value: 'account', label: '持久化存储' }]}
      value={place}
      onChange={value => { void requestPreferencePlace(value); }}
    />
    <p className="muted">本地只留在这台设备。持久化写入当前账号，换一台登录后仍在。阅读页的设置、外观和偏好设置都按这个选择保存。</p>
  </div>;
}

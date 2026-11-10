import type { AppSettings } from './settings.ts';
import type { PreferencePlace } from '../shared/stores/preference-place.store.ts';

/**
 * The seam between a preference write and the account copy.
 *
 * The stores keep writing locally, which is what the screen reads. When the
 * device has chosen the account, the sync listens here and sends that copy on.
 * Applying a copy that just arrived must not call the listener again.
 */

let silenced = 0;
let onWrite: (() => void) | null = null;
let onPlace: ((place: PreferencePlace) => Promise<void>) | null = null;

export function silencePreferenceWrites(): () => void {
  silenced += 1;
  return () => { silenced -= 1; };
}

export function notePreferenceWrite(): void {
  if (silenced === 0) onWrite?.();
}

export function bindPreferenceWrites(listener: () => void): void {
  onWrite = listener;
}

/** The reader's chrome has no runtime context, so the switch asks here. */
export function requestPreferencePlace(place: PreferencePlace): Promise<void> {
  return onPlace?.(place) ?? Promise.resolve();
}

export function bindPreferencePlace(listener: (place: PreferencePlace) => Promise<void>): void {
  onPlace = listener;
}

export const preferencesAppliedEvent = 'reader-preferences-applied';

export function emitPreferencesApplied(app: AppSettings): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(preferencesAppliedEvent, { detail: { app } }));
}

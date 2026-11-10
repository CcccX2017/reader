import { create } from 'zustand';

/** Where personal preferences are kept. The device chooses; the default is this device. */
export type PreferencePlace = 'local' | 'account';

interface PreferencePlaceState {
  place: PreferencePlace;
  replace(place: PreferencePlace): void;
}

export const usePreferencePlaceStore = create<PreferencePlaceState>(set => ({
  place: 'local',
  replace: place => set({ place }),
}));

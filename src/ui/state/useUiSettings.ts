import { useSyncExternalStore } from 'react';
import { uiSettings } from '../../app/runtime';
import type { UiSettings } from '../../app/UiSettingsStore';

export function useUiSettings(): UiSettings {
  return useSyncExternalStore(uiSettings.subscribe, uiSettings.getSettings, uiSettings.getSettings);
}

export { uiSettings };
export type { UiSettings };

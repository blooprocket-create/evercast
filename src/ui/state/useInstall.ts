import { useSyncExternalStore } from 'react';
import { installStore } from '../../app/runtime';
import type { InstallState } from '../../app/Installable';

export function useInstallState(): InstallState {
  return useSyncExternalStore(installStore.subscribe, installStore.getState, installStore.getState);
}

export { installStore };

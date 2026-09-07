import { DEFAULT_ENGINE_CONFIG } from '../engine/config';
import { EvercastSimulation } from '../engine/EvercastSimulation';
import { OfflineProgressor, type OfflineSummary } from '../engine/offline/OfflineProgressor';
import { BrowserSaveStore } from './BrowserSaveStore';

const saveStore = new BrowserSaveStore(DEFAULT_ENGINE_CONFIG);
const loaded = saveStore.load();

export const simulation = new EvercastSimulation({ initialState: loaded?.state });
export const offlineSummary: OfflineSummary | null = loaded
  ? new OfflineProgressor(simulation.config.maxOfflineSeconds).apply(
      simulation,
      Math.max(0, (Date.now() - loaded.savedAt.getTime()) / 1000),
    )
  : null;

export function saveGame(): void {
  saveStore.save(simulation.getState());
}

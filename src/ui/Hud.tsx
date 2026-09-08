import type { OfflineSummary } from '../engine/offline/OfflineProgressor';
import type { GearSlot } from '../engine/gear/types';
import type { SimulationSnapshot } from '../engine/types';
import { GameMenu } from './GameMenu';

interface HudProps {
  snapshot: SimulationSnapshot;
  offlineSummary: OfflineSummary | null;
  onRetry: () => void;
  onLevelGear: (slot: GearSlot) => void;
  onBuySpellPoint: () => void;
  onActivateSpellNode: (nodeId: string) => void;
  onRespecSpellTree: () => void;
}

export function Hud({
  snapshot,
  offlineSummary,
  onRetry,
  onLevelGear,
  onBuySpellPoint,
  onActivateSpellNode,
  onRespecSpellTree,
}: HudProps) {
  return (
    <div className="hud">
      <header className="topbar">
        <div>
          <span className="eyebrow">EVERCAST</span>
          <strong>{snapshot.zoneName} · Frontier {snapshot.stage}</strong>
          <small className={`mode-pill ${snapshot.mode}`}>{snapshot.mode === 'push' ? 'Pushing' : `Farming ${snapshot.farmStage}`}</small>
        </div>
        <div className="resource-stack">
          <div className="resource"><span>Gold</span><strong>{snapshot.gold.display}</strong></div>
          <div className="resource"><span>Arcane Essence</span><strong>{snapshot.essence.display}</strong></div>
          {snapshot.mode === 'farm' && <button className="retry-button" type="button" onClick={onRetry}>Retry Frontier</button>}
        </div>
      </header>

      {snapshot.phase === 'combat' && (
        <div className="enemy-card">
          <div className="enemy-row">
            <strong>{snapshot.boss ? '★ ' : ''}{snapshot.enemyName}</strong>
            <span>{snapshot.enemyHp.display} / {snapshot.enemyMaxHp.display} HP</span>
          </div>
          <div className="health-track"><div className="health-fill" style={{ width: `${snapshot.enemyHpPercent}%` }} /></div>
          <div className="mage-row">
            <span>Wave · {snapshot.encounterAliveEnemies} alive · {snapshot.encounterSpawnedEnemies}/{snapshot.encounterTotalEnemies} spawned</span>
            <span>{snapshot.boss ? 'Guardian' : `Stage ${snapshot.encounterStage}`}</span>
          </div>
          <div className="mage-row"><span>Mage</span><span>{snapshot.mageHp.display} / {snapshot.mageMaxHp.display}</span></div>
          <div className="health-track mage"><div className="health-fill" style={{ width: `${snapshot.mageHpPercent}%` }} /></div>
        </div>
      )}

      {offlineSummary && offlineSummary.secondsApplied >= 5 && (
        <div className="offline-card">
          Away progress: +{offlineSummary.essenceGained.display} Essence · {offlineSummary.kills} kills · stage {offlineSummary.stageBefore} → {offlineSummary.stageAfter}
        </div>
      )}

      {import.meta.env.DEV && <div className="prototype-hint">N · next region &nbsp; Shift N · preview transition</div>}
      <div className="event-line">{snapshot.lastEvent.replace(/\d+\.\d{3,}/g, (value) => Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 }))}</div>
      <GameMenu
        snapshot={snapshot}
        onLevelGear={onLevelGear}
        onBuySpellPoint={onBuySpellPoint}
        onActivateSpellNode={onActivateSpellNode}
        onRespecSpellTree={onRespecSpellTree}
      />
    </div>
  );
}

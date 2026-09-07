import type { OfflineSummary } from '../engine/offline/OfflineProgressor';
import type { SimulationSnapshot } from '../engine/types';

interface HudProps {
  snapshot: SimulationSnapshot;
  offlineSummary: OfflineSummary | null;
  onRetry: () => void;
}

export function Hud({ snapshot, offlineSummary, onRetry }: HudProps) {
  return (
    <div className="hud">
      <header className="topbar">
        <div>
          <span className="eyebrow">EVERCAST</span>
          <strong>{snapshot.zoneName} · Frontier {snapshot.stage}</strong>
          <small className={`mode-pill ${snapshot.mode}`}>{snapshot.mode === 'push' ? 'Pushing' : `Farming ${snapshot.farmStage}`}</small>
        </div>
        <div className="resource">
          <span>Arcane Essence</span>
          <strong>{snapshot.essence.display}</strong>
          {snapshot.rebirths > 0 && <small>{snapshot.knowledge.display} Knowledge</small>}
        </div>
      </header>

      {snapshot.phase === 'combat' && (
        <div className="enemy-card">
          <div className="enemy-row">
            <strong>{snapshot.boss ? '★ ' : ''}{snapshot.enemyName}</strong>
            <span>{snapshot.enemyHp.display} / {snapshot.enemyMaxHp.display} HP</span>
          </div>
          <div className="health-track"><div className="health-fill" style={{ width: `${snapshot.enemyHpPercent}%` }} /></div>
          <div className="mage-row"><span>Mage</span><span>{snapshot.mageHp.display} / {snapshot.mageMaxHp.display}</span></div>
          <div className="health-track mage"><div className="health-fill" style={{ width: `${snapshot.mageHpPercent}%` }} /></div>
        </div>
      )}

      {offlineSummary && offlineSummary.secondsApplied >= 5 && (
        <div className="offline-card">
          Away progress: +{offlineSummary.essenceGained.display} Essence · {offlineSummary.kills} kills · stage {offlineSummary.stageBefore} → {offlineSummary.stageAfter}
        </div>
      )}

      <footer className="bottom-panel">
        <div className="stat"><span>Spell</span><strong>Arcane Bolt</strong></div>
        <div className="stat"><span>Damage</span><strong>{snapshot.damagePerProjectile.display}</strong></div>
        <div className="stat"><span>Cast</span><strong>{snapshot.castInterval.toFixed(2)}s</strong></div>
        <div className="stat"><span>Kills / Deaths</span><strong>{snapshot.kills} / {snapshot.deaths}</strong></div>
        {snapshot.mode === 'farm' ? (
          <button type="button" onClick={onRetry}>Retry Frontier</button>
        ) : (
          <button type="button" disabled title="Skill tree comes after the core loop is locked">Spell Tree — Soon</button>
        )}
      </footer>

      <div className="event-line">{snapshot.lastEvent}</div>
    </div>
  );
}

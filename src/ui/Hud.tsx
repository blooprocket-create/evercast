import type { SimulationSnapshot } from '../engine/types';

interface HudProps {
  snapshot: SimulationSnapshot;
}

export function Hud({ snapshot }: HudProps) {
  const hpPercent = snapshot.enemyMaxHp > 0 ? (snapshot.enemyHp / snapshot.enemyMaxHp) * 100 : 0;

  return (
    <div className="hud">
      <header className="topbar">
        <div>
          <span className="eyebrow">EVERCAST</span>
          <strong>Zone {snapshot.zone} · Stage {snapshot.stage}</strong>
        </div>
        <div className="resource"><span>Arcane Essence</span><strong>{snapshot.essence.toLocaleString()}</strong></div>
      </header>

      {snapshot.phase !== 'travel' && (
        <div className="enemy-card">
          <div className="enemy-row"><strong>{snapshot.enemyName}</strong><span>{snapshot.enemyHp} / {snapshot.enemyMaxHp} HP</span></div>
          <div className="health-track"><div className="health-fill" style={{ width: `${hpPercent}%` }} /></div>
        </div>
      )}

      <footer className="bottom-panel">
        <div className="stat"><span>Spell</span><strong>Arcane Bolt</strong></div>
        <div className="stat"><span>Damage</span><strong>{snapshot.damagePerProjectile}</strong></div>
        <div className="stat"><span>Cast</span><strong>{snapshot.castInterval.toFixed(2)}s</strong></div>
        <div className="stat"><span>Kills</span><strong>{snapshot.kills}</strong></div>
        <button type="button" disabled title="Skill tree comes after the core loop is locked">Spell Tree — Soon</button>
      </footer>

      <div className="event-line">{snapshot.lastEvent}</div>
    </div>
  );
}

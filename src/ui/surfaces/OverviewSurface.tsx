import { formatBig } from '../../engine/numbers';
import { Dashboard } from '../archetypes/Dashboard';
import { NumberCell } from '../format/NumberCell';
import { effectiveDps } from '../format/dps';
import { Panel } from '../primitives/Panel';
import { Stat } from '../primitives/Stat';
import { useSnapshotSelector } from '../state/snapshot';
import styles from './OverviewSurface.module.css';

export function OverviewSurface() {
  const dps = useSnapshotSelector((s) => formatBig(effectiveDps(s)));
  const projectiles = useSnapshotSelector((s) => s.projectileCount);
  const castInterval = useSnapshotSelector((s) => s.castInterval);
  const damage = useSnapshotSelector((s) => s.damagePerProjectile.display);
  const mageMaxHp = useSnapshotSelector((s) => s.mageMaxHp.display);
  const gearHealth = useSnapshotSelector((s) => s.gearHealthBonus.display);
  const critChance = useSnapshotSelector((s) => s.critChance);
  const critMultiplier = useSnapshotSelector((s) => s.critMultiplier);
  const stage = useSnapshotSelector((s) => s.stage);
  const best = useSnapshotSelector((s) => s.highestStageEver);
  const totalPoints = useSnapshotSelector((s) => s.spellTreeTotalPoints);
  const unspent = useSnapshotSelector((s) => s.spellTreeUnspentPoints);
  const nextPointCost = useSnapshotSelector((s) => s.nextSpellPointCost.display);
  const essence = useSnapshotSelector((s) => s.essence.display);
  const kills = useSnapshotSelector((s) => s.kills);
  const deaths = useSnapshotSelector((s) => s.deaths);

  // The one place a list is read whole; a signature keeps it value-stable.
  const gearSignature = useSnapshotSelector((s) =>
    s.gear.map((piece) => `${piece.slot}:${piece.level}`).join('|'),
  );
  const gear = useSnapshotSelector((s) => s.gear, () => false);

  return (
    <Dashboard
      stats={
        <>
          <Stat
            emphasis
            label="Effective DPS"
            value={<NumberCell value={dps} inline />}
            detail={`${projectiles} bolt${projectiles === 1 ? '' : 's'} - ${castInterval.toFixed(2)}s`}
          />
          <Stat
            label="Arcane Bolt"
            value={<NumberCell value={damage} inline />}
            detail="per projectile"
          />
          <Stat
            label="Vitality"
            value={<NumberCell value={mageMaxHp} inline />}
            detail={<>+<NumberCell value={gearHealth} inline /> from gear</>}
          />
          <Stat
            label="Critical"
            value={`${Math.round(critChance * 100)}%`}
            detail={`${critMultiplier.toFixed(2)}x multiplier`}
          />
          <Stat label="Frontier" value={String(stage)} detail={`Best ever ${best}`} />
          <Stat
            label="Spell Tree"
            value={String(totalPoints)}
            detail={`${unspent} unspent`}
          />
        </>
      }
      sections={
        <Panel title="Equipment" note={`${gear.length} equipped`}>
          <div className={styles.rows} key={gearSignature}>
            {gear.map((piece) => (
              <div className={styles.row} key={piece.slot}>
                <span className={styles.name}>
                  {piece.name}
                  <span className={styles.level}> Lv {piece.level}</span>
                </span>
                <span className={styles.contribution}>
                  <NumberCell value={piece.contribution} prefix="+" />
                  <span className={styles.unit}>{piece.primaryStatLabel}</span>
                </span>
              </div>
            ))}
          </div>
        </Panel>
      }
      aside={
        <>
          <Panel title="Coming up">
            <div className={styles.upcoming}>
              <span className={styles.upcomingLabel}>Next spell point</span>
              <span className={styles.upcomingValue}>
                <NumberCell value={nextPointCost} /> essence
              </span>
            </div>
            <div className={styles.upcoming}>
              <span className={styles.upcomingLabel}>Banked</span>
              <span className={styles.upcomingValue}>
                <NumberCell value={essence} />
              </span>
            </div>
          </Panel>
          <Panel title="This run">
            <div className={styles.upcoming}>
              <span className={styles.upcomingLabel}>Enemies felled</span>
              <span className={styles.upcomingValue}>
                <NumberCell value={kills.toLocaleString('en-US')} />
              </span>
            </div>
            <div className={styles.upcoming}>
              <span className={styles.upcomingLabel}>Falls</span>
              <span className={styles.upcomingValue}>
                <NumberCell value={String(deaths)} />
              </span>
            </div>
          </Panel>
        </>
      }
    />
  );
}

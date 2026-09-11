import { NumberCell } from '../format/NumberCell';
import { Button } from '../primitives/Button';
import { Meter } from '../primitives/Meter';
import { useCommand } from '../state/CommandContext';
import { useSnapshotSelector } from '../state/snapshot';
import styles from './HudOverlay.module.css';

/** Always-on chrome over the diorama. The shelf is rendered by the shell. */
export function HudOverlay() {
  const run = useCommand();
  const zoneName = useSnapshotSelector((s) => s.zoneName);
  const stage = useSnapshotSelector((s) => s.stage);
  const best = useSnapshotSelector((s) => s.highestStageEver);
  const mode = useSnapshotSelector((s) => s.mode);
  const farmStage = useSnapshotSelector((s) => s.farmStage);
  const gold = useSnapshotSelector((s) => s.gold.display);
  const essence = useSnapshotSelector((s) => s.essence.display);
  const starlight = useSnapshotSelector((s) => s.starlight.display);
  const phase = useSnapshotSelector((s) => s.phase);
  const enemyName = useSnapshotSelector((s) => s.enemyName);
  const enemyHp = useSnapshotSelector((s) => s.enemyHp.display);
  const enemyMaxHp = useSnapshotSelector((s) => s.enemyMaxHp.display);
  const enemyPercent = useSnapshotSelector((s) => s.enemyHpPercent);
  const boss = useSnapshotSelector((s) => s.boss);
  const alive = useSnapshotSelector((s) => s.encounterAliveEnemies);
  const spawned = useSnapshotSelector((s) => s.encounterSpawnedEnemies);
  const total = useSnapshotSelector((s) => s.encounterTotalEnemies);

  return (
    <div className={styles.chrome}>
      <div className={styles.place}>
        <div className={styles.wordmark}>EVERCAST</div>
        <div className={styles.zone}>
          <span className={styles.zoneDot} />
          {zoneName}
        </div>
        <div className={styles.frontier}>
          <span className={styles.frontierLabel}>Frontier</span>
          <span className={styles.frontierValue}>{stage}</span>
          <span className={styles.best}>Best {best}</span>
        </div>
        <span className={styles.mode}>{mode === 'push' ? 'Pushing' : `Farming ${farmStage}`}</span>
      </div>

      <div className={styles.wallets}>
        <div className={styles.wallet}>
          <div className={styles.walletItem}>
            <span className={styles.walletLabel}>Gold</span>
            <span className={styles.gold}>
              <NumberCell value={gold} />
            </span>
          </div>
          <div className={styles.walletItem}>
            <span className={styles.walletLabel}>Essence</span>
            <span className={styles.essence}>
              <NumberCell value={essence} />
            </span>
          </div>
          <div className={styles.walletItem}>
            <span className={styles.walletLabel}>Starlight</span>
            <span className={styles.starlight}>
              <NumberCell value={starlight} />
            </span>
          </div>
        </div>
        {mode === 'farm' && (
          <Button variant="primary" onClick={() => run({ type: 'retry_frontier' })}>
            Retry Frontier
          </Button>
        )}
      </div>

      {phase === 'combat' && boss && (
        <div className={styles.enemy}>
          <div className={styles.enemyHead}>
            <span className={styles.enemyName}>
              {boss ? '\u2605 ' : ''}
              {enemyName}
            </span>
            <span>
              <NumberCell value={enemyHp} inline /> / <NumberCell value={enemyMaxHp} inline />
            </span>
          </div>
          <Meter percent={enemyPercent} tone="foe" />
          <div className={styles.wave}>
            <span>
              {alive} alive - {spawned}/{total} spawned
            </span>
          </div>
        </div>
      )}

    </div>
  );
}

/** Player vitals, shown in the shelf so they are not buried in the enemy card. */
export function ShelfVitals() {
  const hp = useSnapshotSelector((s) => s.mageHp.display);
  const maxHp = useSnapshotSelector((s) => s.mageMaxHp.display);
  const percent = useSnapshotSelector((s) => s.mageHpPercent);
  const castInterval = useSnapshotSelector((s) => s.castInterval);
  const projectiles = useSnapshotSelector((s) => s.projectileCount);
  const party = useSnapshotSelector((s) => s.party);

  const standing = party.filter((member) => member && !member.downed).length;
  const fielded = party.filter(Boolean).length;

  return (
    <>
      <Meter
        label="Vitality"
        percent={percent}
        tone="you"
        readout={
          <>
            <NumberCell value={hp} inline /> / <NumberCell value={maxHp} inline />
          </>
        }
      />
      <Meter
        label="Cast"
        percent={100}
        slim
        readout={`${castInterval.toFixed(2)}s - ${projectiles}x`}
      />
      {fielded > 0 && (
        <div className={styles.party}>
          <span className={styles.partyLabel}>Party</span>
          <span className={styles.partyPips}>
            {party.map((member, slot) =>
              member ? (
                <span
                  key={slot}
                  className={member.downed ? `${styles.pip} ${styles.pipDown}` : styles.pip}
                  style={{ '--fill': `${member.hpPercent ?? 100}%` } as React.CSSProperties}
                  title={`${member.name} - ${member.downed ? 'down' : `${Math.round(member.hpPercent ?? 100)}%`}`}
                />
              ) : (
                <span key={slot} className={`${styles.pip} ${styles.pipEmpty}`} />
              ),
            )}
          </span>
          <span className={styles.partyCount}>
            {standing}/{fielded}
          </span>
        </div>
      )}
    </>
  );
}

/** The event line, formatted at the source rather than patched here. */
export function ShelfLog() {
  const lastEvent = useSnapshotSelector((s) => s.lastEvent);
  return <span>{lastEvent}</span>;
}

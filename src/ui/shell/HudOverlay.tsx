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
  const income = useSnapshotSelector((s) => s.income);
  const zoneStage = useSnapshotSelector((s) => s.zoneStage);
  const zoneLength = useSnapshotSelector((s) => s.zoneLength);
  const phase = useSnapshotSelector((s) => s.phase);
  const enemyName = useSnapshotSelector((s) => s.enemyName);
  const enemyHp = useSnapshotSelector((s) => s.enemyHp.display);
  const enemyMaxHp = useSnapshotSelector((s) => s.enemyMaxHp.display);
  const enemyPercent = useSnapshotSelector((s) => s.enemyHpPercent);
  const boss = useSnapshotSelector((s) => s.boss);
  const alive = useSnapshotSelector((s) => s.encounterAliveEnemies);
  const spawned = useSnapshotSelector((s) => s.encounterSpawnedEnemies);
  const total = useSnapshotSelector((s) => s.encounterTotalEnemies);

  const WALLETS = [
    { id: 'gold', label: 'Gold', value: gold, rate: income.gold },
    { id: 'essence', label: 'Essence', value: essence, rate: income.essence },
    { id: 'starlight', label: 'Starlight', value: starlight, rate: income.starlight },
  ] as const;

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
        <div className={styles.modeRow}>
          <span className={styles.mode}>{mode === 'push' ? 'Pushing' : `Farming ${farmStage}`}</span>
          {/*
            How far through the zone the road has come. The HUD named the zone
            and said nothing about progress through it, so "Gravehollow" was a
            label rather than a place on a journey.
          */}
          <span className={styles.zoneProgress} title={`Stage ${zoneStage} of ${zoneLength} in ${zoneName}`}>
            <span className={styles.zoneTrack}>
              <span className={styles.zoneFill} style={{ width: `${(zoneStage / zoneLength) * 100}%` }} />
            </span>
            {zoneStage}/{zoneLength}
          </span>
        </div>
      </div>

      <div className={styles.wallets}>
        {/*
          The balance and what is filling it. An incremental game is a set of
          rates and the HUD showed none of them, so a player could read
          `1.21e47` of gold against a `5.92e50` price with no way to tell
          whether that gap was ten seconds or ten hours. The rate is omitted
          rather than zeroed while the meter is cold - see `RateMeter`.
        */}
        <div className={styles.wallet}>
          {WALLETS.map(({ id, label, value, rate }) => (
            <div key={id} className={styles.walletItem}>
              <span className={styles.walletLabel}>{label}</span>
              <span className={styles[id]}>
                <NumberCell value={value} />
              </span>
              <span className={styles.walletRate}>
                {rate === null ? '' : <><NumberCell value={rate.display} inline />/s</>}
              </span>
            </div>
          ))}
        </div>
        {mode === 'farm' && (
          <Button variant="primary" onClick={() => run({ type: 'retry_frontier' })}>
            Retry Frontier
          </Button>
        )}
      </div>

      {/*
        Every encounter, not only a boss.

        This was gated on `boss` as well as `combat`, so for the whole of an
        ordinary fight - which is nearly the whole game - the HUD carried no
        enemy name, no enemy health and no wave progress. The only readouts
        were a 10px world-space bar over the mesh and one line in a log that is
        not rendered below 860px at all. The snapshot has carried the counts
        the entire time.
      */}
      {phase === 'combat' && (
        <div className={boss ? `${styles.enemy} ${styles.enemyBoss}` : styles.enemy}>
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
              {alive} alive &middot; {spawned}/{total} spawned
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

/**
 * How many lines the shelf renders. How many are *shown* is CSS - three on a
 * desktop, two on a tablet, one on a phone - because the shelf's own height
 * changes with the same breakpoints, and a count computed in JS would need a
 * resize observer to agree with a media query.
 */
const SHELF_LOG_LINES = 3;

/** The tail of the chronicle, formatted at the source rather than patched here. */
export function ShelfLog() {
  const chronicle = useSnapshotSelector((s) => s.chronicle);
  const recent = chronicle.slice(-SHELF_LOG_LINES);
  const newest = recent[recent.length - 1];

  return (
    <>
      {/*
        One live region, carrying one line.

        It used to be the visible line itself, announcing `lastEvent` - every
        event, several a second at late game, which `polite` queues rather than
        drops, so a screen-reader user was handed a backlog of `Direct hits for
        9.97e47.` they could never get to the end of. The chronicle keeps the
        events worth announcing (see `logWeight`), and only the newest is
        spoken; the stack beside it is for the eye, and scrollback is the
        Chronicle surface's job.
      */}
      <span className={styles.announcer} aria-live="polite" aria-atomic="true">
        {newest?.text ?? ''}
      </span>
      <span className={styles.logLines} aria-hidden="true">
        {recent.length === 0 ? (
          <span className={styles.logLine}>The Evercast stirs.</span>
        ) : (
          recent.map((line) => (
            <span key={line.seq} className={styles.logLine}>
              {line.text}
            </span>
          ))
        )}
      </span>
    </>
  );
}

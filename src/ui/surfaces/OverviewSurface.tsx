import { useMemo } from 'react';
import { formatBig } from '../../engine/numbers';
import { Dashboard } from '../archetypes/Dashboard';
import { NumberCell } from '../format/NumberCell';
import { formatRunClock } from '../format/runClock';
import { formatWait, timeToAfford } from '../format/timeToAfford';
import { effectiveDps } from '../format/dps';
import { Panel } from '../primitives/Panel';
import { Stat } from '../primitives/Stat';
import { useSnapshotSelector } from '../state/snapshot';
import styles from './OverviewSurface.module.css';

/** Knowledge is left out: it is paid at a Rebirth, not earned per second. */
const INCOME_ROWS = [
  { id: 'gold', label: 'Gold' },
  { id: 'essence', label: 'Essence' },
  { id: 'starlight', label: 'Starlight' },
] as const;

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
  const income = useSnapshotSelector((s) => s.income);
  const pointWait = useSnapshotSelector((s) => {
    const answer = timeToAfford(s.nextSpellPointCost.raw, s.essence.raw, s.income.essence?.raw);
    return answer.now ? 'now' : answer.seconds === null ? null : formatWait(answer.seconds);
  });
  const stagesPerHour = useSnapshotSelector((s) => s.stagesPerHour);
  // Newest first, and only as many as the panel can hold without becoming the
  // Chronicle surface; that one is a click away.
  const chronicle = useSnapshotSelector((s) => s.chronicle);
  const recent = useMemo(() => chronicle.slice(-10).reverse(), [chronicle]);
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
        <>
        <Panel title="Equipment" note={`${gear.length} equipped`}>
          <div className={styles.rows} key={gearSignature}>
            {gear.map((piece) => (
              <div className={styles.row} key={piece.slot}>
                {/*
                  The slot leads and the level trails, both at their natural
                  width, so only the piece name gives way when the row is
                  narrow. Before this the name and the level shared one
                  ellipsised span, and a phone rendered "Evercast Codex Lv
                  15..." - truncating the one number on the row that changes.
                  The slot is also what tells the two rings apart: they reach
                  the same authored name at the final tier.
                */}
                <span className={styles.identity}>
                  <span className={styles.slot}>{piece.slotLabel}</span>
                  <span className={styles.name}>{piece.name}</span>
                  <span className={styles.level}>Lv {piece.level}</span>
                </span>
                <span className={styles.contribution}>
                  <NumberCell value={piece.contribution} prefix="+" />
                  <span className={styles.unit}>{piece.primaryStatLabel}</span>
                </span>
              </div>
            ))}
          </div>
        </Panel>

        {/*
          The spare height, spent on something.
          
          This surface ended around three fifths of the way down a 1440x900
          window and a quarter of the way down a 1920x1080 one, with nothing
          under it - which the audit called the single biggest "does not feel
          finished" signal in the product. The chronicle is the thing the game
          most obviously had nowhere to put: the shelf can show three lines of
          it and the surface has room for ten.
        */}
        {recent.length > 0 && (
          <Panel title="Recent" note="The Chronicle keeps the rest">
            <div className={styles.chronicle}>
              {recent.map((line) => (
                <div className={styles.entry} key={line.seq}>
                  <span className={styles.entryAt}>{formatRunClock(line.at)}</span>
                  <span className={styles.entryText}>{line.text}</span>
                </div>
              ))}
            </div>
          </Panel>
        )}
        </>
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
            {/*
              The panel named a price and a balance and left the subtraction,
              in `e`-notation, to the player. This is the answer they were
              doing it for. Absent while the meter is cold rather than guessed.
            */}
            {pointWait !== null && (
              <div className={styles.upcoming}>
                <span className={styles.upcomingLabel}>Affordable</span>
                <span className={styles.upcomingValue}>{pointWait}</span>
              </div>
            )}
          </Panel>
          {/*
            What the run earns, which is the number every decision in the game
            is actually made against - and which nothing anywhere showed.
          */}
          <Panel title="Per second" note="Averaged over the last half minute">
            {INCOME_ROWS.map(({ id, label }) => (
              <div key={id} className={styles.upcoming}>
                <span className={styles.upcomingLabel}>{label}</span>
                <span className={styles.upcomingValue}>
                  {income[id] === null ? (
                    <span className={styles.pending}>measuring</span>
                  ) : (
                    <NumberCell value={income[id].display} />
                  )}
                </span>
              </div>
            ))}
          </Panel>
          <Panel title="This run">
            {/*
              How fast the frontier is climbing, which is the other rate the
              interface never carried. Farming reads as zero, and that is the
              honest answer rather than a gap.
            */}
            <div className={styles.upcoming}>
              <span className={styles.upcomingLabel}>Frontier pace</span>
              <span className={styles.upcomingValue}>
                {stagesPerHour === null ? (
                  <span className={styles.pending}>measuring</span>
                ) : (
                  `${stagesPerHour < 10 ? stagesPerHour.toFixed(1) : Math.round(stagesPerHour)} stages/h`
                )}
              </span>
            </div>
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

import { useState } from 'react';
import { BASE_RATES } from '../../content/companionTuning';
import { COMPANION_RARITIES } from '../../engine/companions/types';
import { Dashboard } from '../archetypes/Dashboard';
import { RARITY_LABEL, rarityStyle } from '../companions/rarity';
import { NumberCell } from '../format/NumberCell';
import { Field, Toggle } from '../primitives/Field';
import { Meter } from '../primitives/Meter';
import { Panel } from '../primitives/Panel';
import { Stat } from '../primitives/Stat';
import { SummonReveal } from '../summon/SummonReveal';
import { useCommand } from '../state/CommandContext';
import { useSnapshot } from '../state/snapshot';
import { uiSettings, useUiSettings } from '../state/useUiSettings';
import styles from './SummonSurface.module.css';

/**
 * One banner today. A chip row rather than a ledger, so a second is still a
 * data change - but one entry no longer costs a whole list pane.
 */
const BANNERS = [
  {
    id: 'standard',
    name: 'The Long Road',
    blurb:
      'Everything that walks, crawls or drifts the road between Greenfields and Gravehollow can answer.',
  },
] as const;

/**
 * A dashboard rather than a detail.
 *
 * This was a Detail, and on a phone that was the wrong shape: the list pane
 * spent a fifth of the screen on a single banner row, and the thing the surface
 * exists for - the two draw buttons - sat below the fold at every phone size.
 * At 320px wide neither button was reachable without scrolling. A dashboard has
 * no list to pay for, so the actions come first and the reading matter follows.
 */
export function SummonSurface() {
  const snapshot = useSnapshot();
  const run = useCommand();
  const settings = useUiSettings();
  const [revealing, setRevealing] = useState<number | null>(null);

  const banner = BANNERS[0];
  if (!banner) return null;

  const summon = (count: number) => {
    if (!run({ type: 'summon_draw', count })) return;
    // The engine has already granted everything; the reveal only replays it.
    // Skipping the animation still has to say what was drawn.
    setRevealing((serial) => (serial === null ? 0 : serial + 1));
  };

  // Pity is shown as progress toward the guarantee, because the published
  // rate is not the experienced one and a bare percentage would mislead.
  const toGuarantee = Math.max(0, snapshot.pityHard - snapshot.pityCounter);
  const pityPercent = Math.min(100, (snapshot.pityCounter / snapshot.pityHard) * 100);

  return (
    <>
      <Dashboard
        stats={
          <>
            <Stat
              label="Starlight"
              emphasis
              value={<NumberCell value={snapshot.starlight} />}
              detail="Earned from every kill"
            />
            <Stat
              label="Pity"
              value={`${snapshot.pityCounter} / ${snapshot.pityHard}`}
              detail={`${toGuarantee} to a guaranteed Legendary`}
            />
          </>
        }
        sections={
          <>
            {/* First, deliberately: on a phone everything else can wait. */}
            <div className={styles.draws}>
              <button
                type="button"
                className={styles.draw}
                disabled={!snapshot.canSummon}
                onClick={() => summon(1)}
              >
                <span className={styles.drawLabel}>Summon</span>
                <span className={styles.drawPrice}>
                  <NumberCell value={snapshot.summonCost} inline />
                </span>
              </button>
              <button
                type="button"
                className={`${styles.draw} ${styles.drawTen}`}
                disabled={!snapshot.canSummonTen}
                onClick={() => summon(10)}
              >
                <span className={styles.drawLabel}>
                  Summon ten
                  <span className={styles.drawSub}>One free, an Epic guaranteed</span>
                </span>
                <span className={styles.drawPrice}>
                  <NumberCell value={snapshot.summonCostTen} inline />
                </span>
              </button>
            </div>

            <Meter
              label="To a guaranteed Legendary"
              percent={pityPercent}
              readout={`${toGuarantee} draws`}
              slim
            />

            <Panel title="Rates" note="Before pity">
              <div className={styles.rates}>
                {[...COMPANION_RARITIES].reverse().map((rarity) => (
                  <div key={rarity} style={rarityStyle(rarity)} className={styles.rate}>
                    <span className={styles.rateName}>{RARITY_LABEL[rarity]}</span>
                    <span className={styles.rateValue}>{(BASE_RATES[rarity] * 100).toFixed(1)}%</span>
                  </div>
                ))}
              </div>
              <p className={styles.hint}>
                The odds of a Legendary climb the longer you go without one, and at{' '}
                {snapshot.pityHard} draws it is certain. A companion you already have banks shards
                instead of a second copy, and one you have fully ascended pays Starlight back.
              </p>
            </Panel>

            <Field label="Skip the animation" hint="Go straight to what you pulled.">
              <Toggle
                label="Skip the summoning animation"
                checked={settings.display.skipSummonAnimation}
                onChange={(skipSummonAnimation) => uiSettings.setDisplay({ skipSummonAnimation })}
              />
            </Field>
          </>
        }
        aside={
          <Panel title="Banner" note={BANNERS.length > 1 ? `${BANNERS.length} running` : 'Standard'}>
            {BANNERS.length > 1 && (
              <div className={styles.banners}>
                {BANNERS.map((entry) => (
                  <span
                    key={entry.id}
                    className={
                      entry.id === banner.id ? `${styles.banner} ${styles.bannerOn}` : styles.banner
                    }
                  >
                    {entry.name}
                  </span>
                ))}
              </div>
            )}
            <h2 className={styles.name}>{banner.name}</h2>
            <p className={styles.description}>{banner.blurb}</p>
          </Panel>
        }
      />

      {revealing !== null && snapshot.lastSummon && (
        <SummonReveal
          key={snapshot.lastSummon.serial}
          results={snapshot.lastSummon.results}
          immediate={settings.display.skipSummonAnimation}
          onDone={() => setRevealing(null)}
        />
      )}
    </>
  );
}

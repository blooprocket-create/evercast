import { useState } from 'react';
import { BASE_RATES } from '../../content/companionTuning';
import { COMPANION_RARITIES } from '../../engine/companions/types';
import { Detail } from '../archetypes/Detail';
import { Ledger } from '../archetypes/Ledger';
import { RARITY_LABEL, rarityStyle } from '../companions/rarity';
import { NumberCell } from '../format/NumberCell';
import { Field, Toggle } from '../primitives/Field';
import { Meter } from '../primitives/Meter';
import { Panel } from '../primitives/Panel';
import { Row } from '../primitives/Row';
import { SummonReveal } from '../summon/SummonReveal';
import { useCommand } from '../state/CommandContext';
import { useSnapshot } from '../state/snapshot';
import { uiSettings, useUiSettings } from '../state/useUiSettings';
import styles from './SummonSurface.module.css';

/**
 * One banner today. The list exists so a second is a data change rather than a
 * new layout - the same bet the destination registry makes.
 */
const BANNERS = [
  {
    id: 'standard',
    name: 'The Long Road',
    blurb:
      'Everything that walks, crawls or drifts the road between Greenfields and Gravehollow can answer.',
  },
] as const;

export function SummonSurface() {
  const snapshot = useSnapshot();
  const run = useCommand();
  const settings = useUiSettings();
  const [revealing, setRevealing] = useState<number | null>(null);

  const banner = BANNERS[0];
  if (!banner) return null;

  const summon = (count: number) => {
    if (!run({ type: 'summon_draw', count })) return;
    if (settings.display.skipSummonAnimation) return;
    // The engine has already granted everything; the reveal only replays it.
    setRevealing((serial) => (serial === null ? 0 : serial + 1));
  };

  // Pity is shown as progress toward the guarantee, because the published
  // rate is not the experienced one and a bare percentage would mislead.
  const pityPercent = Math.min(100, (snapshot.pityCounter / snapshot.pityHard) * 100);

  return (
    <>
      <Detail
        list={
          <Ledger
            items={BANNERS}
            rowKey={(entry) => entry.id}
            header={<span className={styles.eyebrow}>Banners</span>}
            renderRow={(entry) => (
              <Row icon="summon" label={entry.name} sub="Standard" selected onSelect={() => {}} />
            )}
          />
        }
      >
        <span className={styles.eyebrow}>Summoning</span>
        <h2 className={styles.name}>{banner.name}</h2>
        <p className={styles.description}>{banner.blurb}</p>

        <div className={styles.wallet}>
          <span className={styles.walletLabel}>Starlight</span>
          <span className={styles.walletValue}>
            <NumberCell value={snapshot.starlight} />
          </span>
        </div>

        <div className={styles.draws}>
          <button
            type="button"
            className={styles.draw}
            disabled={!snapshot.canSummon}
            onClick={() => summon(1)}
          >
            <span className={styles.drawLabel}>Summon</span>
            <span className={styles.drawPrice}>
              <NumberCell value={snapshot.summonCost} />
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
              <span className={styles.drawSub}>One free, and an Epic guaranteed</span>
            </span>
            <span className={styles.drawPrice}>
              <NumberCell value={snapshot.summonCostTen} />
            </span>
          </button>
        </div>

        <Panel title="Pity" note={`${snapshot.pityCounter} / ${snapshot.pityHard}`}>
          <Meter
            percent={pityPercent}
            readout={`${Math.max(0, snapshot.pityHard - snapshot.pityCounter)} to a guaranteed Legendary`}
          />
          <p className={styles.hint}>
            The odds of a Legendary climb the longer you go without one, and at{' '}
            {snapshot.pityHard} draws it is certain. The counter resets whenever one answers.
          </p>
        </Panel>

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
            A companion you already have banks shards instead of a second copy, and one you have
            fully ascended pays Starlight back.
          </p>
        </Panel>

        <Field label="Skip the animation" hint="Go straight to what you pulled.">
          <Toggle
            label="Skip the summoning animation"
            checked={settings.display.skipSummonAnimation}
            onChange={(skipSummonAnimation) => uiSettings.setDisplay({ skipSummonAnimation })}
          />
        </Field>
      </Detail>

      {revealing !== null && snapshot.lastSummon && (
        <SummonReveal
          key={snapshot.lastSummon.serial}
          results={snapshot.lastSummon.results}
          onDone={() => setRevealing(null)}
        />
      )}
    </>
  );
}

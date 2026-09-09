import { useState } from 'react';
import { GEAR_EVOLUTION_MILESTONES } from '../../engine/gear/GearCatalog';
import type { GearSlot } from '../../engine/gear/types';
import { big } from '../../engine/numbers';
import type { GearSnapshot } from '../../engine/types';
import { Detail } from '../archetypes/Detail';
import { Ledger } from '../archetypes/Ledger';
import { NumberCell } from '../format/NumberCell';
import type { IconName } from '../icons/names';
import { Panel } from '../primitives/Panel';
import { Row } from '../primitives/Row';
import { useRepeatCommand } from '../state/CommandContext';
import { useSnapshot } from '../state/snapshot';
import styles from './GearSurface.module.css';

const SLOT_LABELS: Record<GearSlot, string> = {
  helm: 'Helm',
  staff: 'Staff',
  spellbook: 'Spellbook',
  robe: 'Robe',
  boots: 'Boots',
  necklace: 'Necklace',
  ringLeft: 'Ring I',
  ringRight: 'Ring II',
};

/**
 * Silhouettes stand in for the paperdoll this replaces. The old one pinned
 * eight slots at hardcoded pixel offsets, so it could never hold a ninth.
 */
const SLOT_ICONS: Record<GearSlot, IconName> = {
  helm: 'slotHelm',
  staff: 'slotStaff',
  spellbook: 'slotSpellbook',
  robe: 'slotRobe',
  boots: 'slotBoots',
  necklace: 'slotNecklace',
  ringLeft: 'slotRing',
  ringRight: 'slotRing',
};

const QUANTITIES = [
  { id: 1, label: '1x' },
  { id: 10, label: '10x' },
  { id: Number.POSITIVE_INFINITY, label: 'Max' },
] as const;

const MAX_BULK_LEVELS = 5000;

export function GearSurface() {
  const snapshot = useSnapshot();
  const runMany = useRepeatCommand();
  const [selectedSlot, setSelectedSlot] = useState<GearSlot>('staff');
  const [quantity, setQuantity] = useState<number>(1);

  const gear = snapshot.gear;
  const selected = gear.find((piece) => piece.slot === selectedSlot) ?? gear[0];
  if (!selected) return null;

  const gold = big(snapshot.gold.raw);
  const canAfford = (piece: GearSnapshot) => gold.cmp(big(piece.nextLevelCost.raw)) >= 0;
  const affordableCount = gear.filter(canAfford).length;
  const affordable = canAfford(selected);

  const tier = selected.evolutionTier;
  const buyLabel =
    quantity === 1
      ? 'Level up'
      : quantity === 10
        ? 'Level 10x'
        : 'Level to the most you can afford';

  return (
    <Detail
      list={
        <Ledger
          items={gear}
          rowKey={(piece) => piece.slot}
          header={
            <>
              <span className={styles.eyebrow} style={{ color: 'var(--ink-low)' }}>
                Equipped
              </span>
              <span className={styles.affordable}>{affordableCount} affordable</span>
            </>
          }
          renderRow={(piece) => (
            <Row
              icon={SLOT_ICONS[piece.slot]}
              iconLive={canAfford(piece)}
              label={piece.name}
              sub={`${SLOT_LABELS[piece.slot]} - Lv ${piece.level}`}
              value={
                <NumberCell
                  value={piece.contribution}
                  prefix="+"
                  title={`${piece.contribution.raw} ${piece.primaryStatLabel}`}
                />
              }
              selected={piece.slot === selected.slot}
              onSelect={() => setSelectedSlot(piece.slot)}
            />
          )}
        />
      }
    >
      <span className={styles.eyebrow}>
        {SLOT_LABELS[selected.slot]} - Evolution {tier + 1} of {GEAR_EVOLUTION_MILESTONES.length}
      </span>
      <h2 className={styles.name}>{selected.name}</h2>
      <p className={styles.description}>{selected.description}</p>

      <div className={styles.facts}>
        <div className={styles.fact}>
          <span>Level</span>
          <NumberCell value={String(selected.level)} />
        </div>
        <div className={styles.fact}>
          <span>Contributing</span>
          <NumberCell value={selected.contribution} prefix="+" suffix={` ${selected.primaryStatLabel}`} />
        </div>
        <div className={styles.fact}>
          <span>Each level</span>
          <NumberCell value={String(selected.perLevel)} prefix="+" suffix={` ${selected.primaryStatLabel}`} />
        </div>
      </div>

      <div className={styles.buy}>
        <div className={styles.buyHead}>
          <span className={styles.eyebrow} style={{ color: 'var(--ink-low)' }}>
            Buy
          </span>
          <div className={styles.quantities}>
            {QUANTITIES.map((option) => (
              <button
                key={option.label}
                type="button"
                className={
                  quantity === option.id ? `${styles.quantity} ${styles.quantityOn}` : styles.quantity
                }
                onClick={() => setQuantity(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          className={styles.buyButton}
          disabled={!affordable}
          onClick={() =>
            runMany(
              { type: 'level_gear', slot: selected.slot },
              Math.min(quantity, MAX_BULK_LEVELS),
            )
          }
        >
          <span>{affordable ? buyLabel : 'Not enough gold'}</span>
          <span className={styles.price}>
            <NumberCell value={selected.nextLevelCost} />
            {quantity !== 1 && affordable ? ' each' : ''}
          </span>
        </button>
      </div>

      <Panel
        title="Evolution"
        note={
          selected.nextEvolutionLevel
            ? `${selected.nextEvolutionLevel - selected.level} levels to the next`
            : 'Final tier'
        }
      >
        <div className={styles.track}>
          {GEAR_EVOLUTION_MILESTONES.map((milestone, index) => (
            <span
              key={milestone}
              className={index <= tier ? `${styles.pip} ${styles.pipOn}` : styles.pip}
              title={`Level ${milestone}`}
            />
          ))}
        </div>
        {selected.nextEvolutionLevel !== null && (
          <div className={styles.next}>
            <span className={styles.nextText}>
              <span className={styles.nextLabel}>At level {selected.nextEvolutionLevel}</span>
              <span className={styles.nextName}>A new form, and deeper tree tiers</span>
            </span>
          </div>
        )}
      </Panel>
    </Detail>
  );
}

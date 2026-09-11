import { useState } from 'react';
import { MAX_COMPANION_STARS, PARTY_SIZE } from '../../engine/companions/types';
import type { FormationRow } from '../../engine/companions/types';
import type { CompanionSnapshot } from '../../engine/types';
import { Detail } from '../archetypes/Detail';
import { Ledger } from '../archetypes/Ledger';
// prettier-ignore
import { ABILITY_LABEL, ABILITY_NOTE, CLASS_ICON, CLASS_LABEL, RARITY_LABEL, ROW_LABEL, ROW_NOTE, rarityStyle, starText } from '../companions/rarity';
import { NumberCell } from '../format/NumberCell';
import { Icon } from '../icons/Icon';
import { Meter } from '../primitives/Meter';
import { Panel } from '../primitives/Panel';
import { Row } from '../primitives/Row';
import { useCommand } from '../state/CommandContext';
import { useSnapshot } from '../state/snapshot';
import styles from './CompanionsSurface.module.css';

const ROWS: readonly FormationRow[] = ['front', 'flank', 'back'];

export function CompanionsSurface() {
  const snapshot = useSnapshot();
  const run = useCommand();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const roster = snapshot.companions;
  const selected = roster.find((entry) => entry.definitionId === selectedId) ?? roster[0];

  if (roster.length === 0) {
    return (
      <Detail list={<Ledger items={[]} rowKey={() => ''} renderRow={() => null} empty="Nobody yet." />}>
        <span className={styles.eyebrow}>No companions</span>
        <h2 className={styles.name}>You walk this road alone</h2>
        <p className={styles.description}>
          Summon your first companion and it will stand with you in the next fight. Five can fight
          alongside you at once.
        </p>
      </Detail>
    );
  }
  if (!selected) return null;

  const equippedCount = snapshot.party.filter(Boolean).length;

  return (
    <Detail
      list={
        <Ledger
          items={roster}
          rowKey={(companion) => companion.definitionId}
          header={
            <>
              <span className={styles.eyebrow}>Roster</span>
              <span className={styles.count}>
                {equippedCount}/{PARTY_SIZE} fighting
              </span>
            </>
          }
          renderRow={(companion) => (
            <span style={rarityStyle(companion.rarity)} className={styles.rowWrap}>
              <Row
                icon={CLASS_ICON[companion.companionClass]}
                iconLive={companion.canAscend}
                label={companion.name}
                sub={`${RARITY_LABEL[companion.rarity]} · ${CLASS_LABEL[companion.companionClass]}${
                  companion.slot === null ? '' : ` · ${companion.slot + 1}`
                }`}
                value={<span className={styles.stars}>{starText(companion.stars)}</span>}
                selected={companion.definitionId === selected.definitionId}
                onSelect={() => setSelectedId(companion.definitionId)}
              />
            </span>
          )}
        />
      }
    >
      <div style={rarityStyle(selected.rarity)} className={styles.pane}>
        <span className={styles.eyebrow}>
          {RARITY_LABEL[selected.rarity]} · {CLASS_LABEL[selected.companionClass]} ·{' '}
          {selected.kind === 'humanoid' ? 'Humanoid' : 'Creature'}
        </span>
        <h2 className={styles.name}>{selected.name}</h2>
        <p className={styles.description}>{selected.description}</p>

        <div className={styles.facts}>
          <div className={styles.fact}>
            <span>Health</span>
            <NumberCell value={selected.maxHp} />
          </div>
          <div className={styles.fact}>
            <span>Damage</span>
            <NumberCell value={selected.damage} suffix=" / hit" />
          </div>
          <div className={styles.fact}>
            <span>Attacks every</span>
            <NumberCell value={`${selected.attackInterval.toFixed(2)}s`} />
          </div>
          <div className={styles.fact} title={ROW_NOTE[selected.row]}>
            <span>Stands</span>
            <NumberCell value={ROW_LABEL[selected.row]} />
          </div>
          <div
            className={styles.fact}
            title="How hard enemies want to hit this companion. The mage's own threat is 1."
          >
            <span>Threat</span>
            <NumberCell value={selected.threat.toFixed(1)} />
          </div>
        </div>

        <Panel
          title={ABILITY_LABEL[selected.ability.id] ?? selected.ability.id}
          note={selected.ability.cooldown > 0 ? `Every ${selected.ability.cooldown}s` : 'Always on'}
        >
          <p className={styles.description}>{ABILITY_NOTE[selected.ability.id]}</p>
        </Panel>

        <Panel
          title="Ascension"
          note={
            selected.shardsForNextStar === null
              ? 'Fully ascended'
              : `${selected.shards} / ${selected.shardsForNextStar} shards`
          }
        >
          <div className={styles.track}>
            {Array.from({ length: MAX_COMPANION_STARS }, (_, index) => (
              <span
                key={index}
                className={index < selected.stars ? `${styles.pip} ${styles.pipOn}` : styles.pip}
                title={`${index + 1} star${index === 0 ? '' : 's'}`}
              />
            ))}
          </div>
          {selected.shardsForNextStar !== null && (
            <Meter
              percent={Math.min(100, (selected.shards / selected.shardsForNextStar) * 100)}
              slim
              readout={`${selected.shards} / ${selected.shardsForNextStar}`}
            />
          )}
          <button
            type="button"
            className={styles.ascend}
            disabled={!selected.canAscend}
            onClick={() => run({ type: 'ascend_companion', definitionId: selected.definitionId })}
          >
            {selected.shardsForNextStar === null
              ? 'Nothing left to ascend'
              : selected.canAscend
                ? `Ascend to ${selected.stars + 1} stars`
                : `Needs ${selected.shardsForNextStar - selected.shards} more shards`}
          </button>
          <p className={styles.hint}>
            Summoning a companion you already have banks shards instead of a second copy.
          </p>
        </Panel>

        <Panel title="Party" note={`${equippedCount} of ${PARTY_SIZE}`}>
          <p className={styles.hint}>
            Any companion fits any slot. Where it stands is decided by what it is.
          </p>
          <div className={styles.formation}>
            {ROWS.map((row) => (
              <div className={styles.formationRow} key={row}>
                <span className={styles.rowLabel} title={ROW_NOTE[row]}>
                  {ROW_LABEL[row]}
                </span>
                <span className={styles.rowMembers}>
                  {snapshot.party.filter((entry) => entry?.row === row).length === 0 ? (
                    <span className={styles.rowEmpty}>—</span>
                  ) : (
                    snapshot.party
                      .filter((entry): entry is CompanionSnapshot => entry?.row === row)
                      .map((entry) => (
                        <span
                          key={entry.definitionId}
                          style={rarityStyle(entry.rarity)}
                          className={entry.downed ? `${styles.chip} ${styles.chipDown}` : styles.chip}
                          title={entry.downed ? `${entry.name} — down` : entry.name}
                        >
                          <Icon name={CLASS_ICON[entry.companionClass]} size={13} />
                          {entry.name}
                        </span>
                      ))
                  )}
                </span>
              </div>
            ))}
          </div>

          <div className={styles.slots}>
            {snapshot.party.map((entry, slot) => (
              <button
                key={slot}
                type="button"
                style={entry ? rarityStyle(entry.rarity) : undefined}
                className={entry ? `${styles.slot} ${styles.slotFilled}` : styles.slot}
                onClick={() =>
                  entry
                    ? run({ type: 'unequip_companion', slot })
                    : run({ type: 'equip_companion', definitionId: selected.definitionId, slot })
                }
                title={entry ? `Remove ${entry.name}` : `Put ${selected.name} here`}
              >
                <span className={styles.slotIndex}>{slot + 1}</span>
                <span className={styles.slotName}>{entry ? entry.name : 'Empty'}</span>
              </button>
            ))}
          </div>
        </Panel>
      </div>
    </Detail>
  );
}

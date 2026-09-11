import { useState } from 'react';
import { PARTY_SIZE } from '../../engine/companions/types';
import type { FormationRow } from '../../engine/companions/types';
import type { CompanionSnapshot } from '../../engine/types';
import { Detail } from '../archetypes/Detail';
import { Ledger } from '../archetypes/Ledger';
// prettier-ignore
import { CLASS_ICON, CLASS_LABEL, RARITY_LABEL, ROW_LABEL, ROW_NOTE, rarityStyle, starText } from '../companions/rarity';
import { Icon } from '../icons/Icon';
import { Meter } from '../primitives/Meter';
import { Panel } from '../primitives/Panel';
import { Row } from '../primitives/Row';
import { useCommand } from '../state/CommandContext';
import { useSnapshot } from '../state/snapshot';
import styles from './PartySurface.module.css';

/** Front rank first: the order they stand in, nearest the enemy. */
const ROWS: readonly FormationRow[] = ['front', 'flank', 'back'];

/**
 * Where companions are deployed, as opposed to where they are managed.
 *
 * This was a panel at the bottom of the Companions surface, which meant
 * fielding someone was: find them in the roster, scroll past their stats and
 * their ascension track, then click a slot. Deploying is its own job and it
 * reads the other way round - pick the slot, then pick who fills it.
 */
export function PartySurface() {
  const snapshot = useSnapshot();
  const run = useCommand();
  const [selectedSlot, setSelectedSlot] = useState(0);

  const party = snapshot.party;
  const occupant = party[selectedSlot] ?? null;
  const fielded = party.filter(Boolean).length;
  const standing = party.filter((member) => member && !member.downed).length;

  // Anyone owned and not already on the field is available for this slot.
  const bench = snapshot.companions.filter((companion) => companion.slot === null);

  const slots = Array.from({ length: PARTY_SIZE }, (_, slot) => ({
    slot,
    member: party[slot] ?? null,
  }));

  return (
    <Detail
      list={
        <Ledger
          items={slots}
          rowKey={(entry) => String(entry.slot)}
          header={
            <>
              <span className={styles.eyebrow}>Deployed</span>
              <span className={styles.count}>
                {standing}/{fielded} standing
              </span>
            </>
          }
          renderRow={({ slot, member }) => (
            <span style={member ? rarityStyle(member.rarity) : undefined} className={styles.rowWrap}>
              <Row
                icon={member ? CLASS_ICON[member.companionClass] : 'party'}
                iconLive={member?.downed === false}
                label={member ? member.name : `Slot ${slot + 1}`}
                sub={
                  member
                    ? `${ROW_LABEL[member.row]} · ${CLASS_LABEL[member.companionClass]}${
                        member.downed ? ' · down' : ''
                      }`
                    : 'Empty'
                }
                value={
                  member ? (
                    <span className={styles.stars}>{starText(member.stars)}</span>
                  ) : (
                    <span className={styles.empty}>—</span>
                  )
                }
                selected={slot === selectedSlot}
                onSelect={() => setSelectedSlot(slot)}
              />
            </span>
          )}
        />
      }
    >
      <span className={styles.eyebrow}>Formation</span>
      <h2 className={styles.name}>
        {fielded === 0 ? 'Nobody deployed' : `${fielded} of ${PARTY_SIZE} fielded`}
      </h2>
      <p className={styles.description}>
        Any companion fits any slot. Where it stands is decided by what it is — a vanguard holds the
        front whichever slot you put it in.
      </p>

      {/* The field itself, front rank at the top, nearest the wave. */}
      <div className={styles.formation}>
        {ROWS.map((row) => {
          const members = party.filter(
            (entry): entry is CompanionSnapshot => entry?.row === row,
          );
          return (
            <div className={styles.formationRow} key={row}>
              <span className={styles.rowLabel} title={ROW_NOTE[row]}>
                {ROW_LABEL[row]}
              </span>
              <span className={styles.rowMembers}>
                {members.length === 0 ? (
                  <span className={styles.rowEmpty}>nobody</span>
                ) : (
                  members.map((entry) => (
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
          );
        })}
      </div>

      <Panel title={`Slot ${selectedSlot + 1}`} note={occupant ? ROW_LABEL[occupant.row] : 'Empty'}>
        {occupant ? (
          <>
            <div style={rarityStyle(occupant.rarity)} className={styles.occupant}>
              <Icon name={CLASS_ICON[occupant.companionClass]} size={18} />
              <span className={styles.occupantName}>{occupant.name}</span>
              <span className={styles.stars}>{starText(occupant.stars)}</span>
            </div>
            {occupant.hp && (
              <Meter
                label={occupant.downed ? 'Down' : 'Health'}
                tone={occupant.downed ? 'foe' : 'you'}
                percent={occupant.hpPercent ?? 0}
                readout={`${occupant.hp.display} / ${occupant.maxHp.display}`}
                slim
              />
            )}
            <button
              type="button"
              className={styles.recall}
              onClick={() => run({ type: 'unequip_companion', slot: selectedSlot })}
            >
              Recall {occupant.name}
            </button>
            <p className={styles.hint}>
              A companion recalled mid-fight keeps its wounds until the encounter ends.
            </p>
          </>
        ) : (
          <p className={styles.hint}>Nothing is standing here. Pick someone below.</p>
        )}
      </Panel>

      <Panel
        title={occupant ? 'Replace with' : 'Deploy'}
        note={`${bench.length} available`}
      >
        {bench.length === 0 ? (
          <p className={styles.hint}>
            {snapshot.companions.length === 0
              ? 'Summon a companion and it will be waiting here.'
              : 'Everyone you own is already on the field.'}
          </p>
        ) : (
          <div className={styles.bench}>
            {bench.map((companion) => (
              <button
                key={companion.definitionId}
                type="button"
                style={rarityStyle(companion.rarity)}
                className={styles.pick}
                onClick={() =>
                  run({
                    type: 'equip_companion',
                    definitionId: companion.definitionId,
                    slot: selectedSlot,
                  })
                }
                title={`${RARITY_LABEL[companion.rarity]} ${CLASS_LABEL[companion.companionClass]}`}
              >
                <span className={styles.pickHead}>
                  <Icon name={CLASS_ICON[companion.companionClass]} size={14} />
                  <span className={styles.pickName}>{companion.name}</span>
                </span>
                <span className={styles.pickMeta}>
                  <span className={styles.stars}>{starText(companion.stars)}</span>
                  <span className={styles.pickRow}>{ROW_LABEL[companion.row]}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </Panel>
    </Detail>
  );
}

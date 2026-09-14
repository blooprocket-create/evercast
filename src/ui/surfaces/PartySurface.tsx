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
  // A slot with nobody in it has no rank, because a rank comes from whoever
  // stands there - so the diagram carries them in a row of their own.
  const emptySlots = slots.filter((entry) => entry.member === null).map((entry) => entry.slot);

  return (
    <Detail
      /*
        Pinned, so the slot's own action stays reachable while the roster
        picker below it scrolls - that grid was clipped at the fold at every
        viewport the audit measured.
      */
      action={
        occupant ? (
          <button
            type="button"
            className={styles.recall}
            onClick={() => run({ type: 'unequip_companion', slot: selectedSlot })}
          >
            Send {occupant.name} to the bench
          </button>
        ) : undefined
      }
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
        Any companion fits any slot, and a slot is a place in the party rather than a place on the
        field. Where one stands is decided by what it is — a vanguard holds the front whichever slot
        you put it in. Press a name below to work on that slot.
      </p>

      {/*
        The field itself, front rank at the top, nearest the wave - and every
        name in it a way in.

        It used to be a picture: three rows of chips that could not be touched,
        with the actual assignment happening in a separate grid below. A
        formation screen that draws a formation and lets you move nothing in it
        is the wrong affordance, and the audit said so. Pressing a name selects
        that companion's slot, which is what the list beside it does - so the
        diagram is navigation now rather than decoration.

        What it still will not do is let a companion be dragged between ranks,
        because a rank is not a place a player puts anyone: it is derived from
        what the companion is. The line under the heading says so, and the
        empty-slot chip is where the two models meet.
      */}
      <div className={styles.formation}>
        {ROWS.map((row) => {
          const members = slots.filter(
            (entry): entry is { slot: number; member: CompanionSnapshot } =>
              entry.member?.row === row,
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
                  members.map(({ slot, member }) => (
                    <button
                      key={member.definitionId}
                      type="button"
                      style={rarityStyle(member.rarity)}
                      className={[
                        styles.chip,
                        member.downed && styles.chipDown,
                        slot === selectedSlot && styles.chipOn,
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      aria-pressed={slot === selectedSlot}
                      title={`Slot ${slot + 1}${member.downed ? ' - down' : ''}`}
                      onClick={() => setSelectedSlot(slot)}
                    >
                      <Icon name={CLASS_ICON[member.companionClass]} size={13} />
                      {member.name}
                    </button>
                  ))
                )}
              </span>
            </div>
          );
        })}
        {emptySlots.length > 0 && (
          <div className={styles.formationRow}>
            <span className={styles.rowLabel} title="A slot nobody is standing in yet.">
              Empty
            </span>
            <span className={styles.rowMembers}>
              {emptySlots.map((slot) => (
                <button
                  key={slot}
                  type="button"
                  className={
                    slot === selectedSlot ? `${styles.chip} ${styles.chipOn}` : styles.chip
                  }
                  aria-pressed={slot === selectedSlot}
                  onClick={() => setSelectedSlot(slot)}
                >
                  Slot {slot + 1}
                </button>
              ))}
            </span>
          </div>
        )}
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
            <p className={styles.hint}>
              A companion sent to the bench mid-fight keeps its wounds until the encounter ends.
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

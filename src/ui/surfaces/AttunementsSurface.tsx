import { useState } from 'react';
import { SPELL_ATTUNEMENTS } from '../../content/spellTree';
import { big } from '../../engine/numbers';
import { Detail } from '../archetypes/Detail';
import { Ledger } from '../archetypes/Ledger';
import { NumberCell } from '../format/NumberCell';
import { Button } from '../primitives/Button';
import { Row } from '../primitives/Row';
import { useCommand } from '../state/CommandContext';
import { useSnapshot } from '../state/snapshot';
import styles from './AttunementsSurface.module.css';

/**
 * Knowledge's first sink, and the only screen that changes the tree's *rules*
 * rather than its allocations. Attunements do not add nodes; they widen the
 * exclusive groups, which is what decides how much of the graph one build can
 * hold.
 */
export function AttunementsSurface() {
  const snapshot = useSnapshot();
  const run = useCommand();
  const [selectedId, setSelectedId] = useState<string>(SPELL_ATTUNEMENTS[0].id);

  const owned = new Set(snapshot.ownedAttunementIds);
  const selected =
    SPELL_ATTUNEMENTS.find((attunement) => attunement.id === selectedId) ?? SPELL_ATTUNEMENTS[0];

  const knowledge = big(snapshot.knowledge.raw);
  const missingRequirement = selected.requires.filter((id) => !owned.has(id));
  const affordable = knowledge.cmp(big(selected.cost)) >= 0;
  const isOwned = owned.has(selected.id);
  const canBuy = !isOwned && affordable && missingRequirement.length === 0;

  const label = () => {
    if (isOwned) return 'Attuned';
    if (missingRequirement.length > 0) return 'Requires an earlier attunement';
    if (!affordable) return 'Not enough Knowledge';
    return `Attune - ${selected.cost} Knowledge`;
  };

  return (
    <Detail
      list={
        <Ledger
          items={SPELL_ATTUNEMENTS}
          rowKey={(attunement) => attunement.id}
          header={
            <>
              <span className={styles.eyebrow} style={{ color: 'var(--ink-low)' }}>
                Attunements
              </span>
              <span className={styles.banked}>
                <NumberCell value={snapshot.knowledge.raw} inline /> Knowledge
              </span>
            </>
          }
          renderRow={(attunement) => (
            <Row
              icon="rebirth"
              iconLive={
                !owned.has(attunement.id) &&
                knowledge.cmp(big(attunement.cost)) >= 0 &&
                attunement.requires.every((id) => owned.has(id))
              }
              label={attunement.name}
              sub={owned.has(attunement.id) ? 'Attuned' : `${attunement.cost} Knowledge`}
              selected={attunement.id === selected.id}
              onSelect={() => setSelectedId(attunement.id)}
            />
          )}
        />
      }
    >
      <span className={styles.eyebrow}>Permanent - survives Rebirth</span>
      <h2 className={styles.name}>{selected.name}</h2>
      <p className={styles.description}>{selected.description}</p>

      <div className={styles.facts}>
        <div className={styles.fact}>
          <span>Cost</span>
          <NumberCell value={String(selected.cost)} />
        </div>
        <div className={styles.fact}>
          <span>Banked Knowledge</span>
          <NumberCell value={snapshot.knowledge.raw} />
        </div>
        <div className={styles.fact}>
          <span>Spell points this allows</span>
          <NumberCell value={String(snapshot.spellTreeMaxPoints)} />
        </div>
      </div>

      <div className={styles.buy}>
        <Button
          variant="primary"
          disabled={!canBuy}
          onClick={() => run({ type: 'buy_attunement', attunementId: selected.id })}
        >
          {label()}
        </Button>
        <p className={styles.note}>
          Knowledge comes from Rebirth. An attunement is never refunded and a respec does not
          touch it.
        </p>
      </div>
    </Detail>
  );
}

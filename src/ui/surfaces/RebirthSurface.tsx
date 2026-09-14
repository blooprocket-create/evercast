import { useState } from 'react';
import { Moment } from '../archetypes/Moment';
import { NumberCell } from '../format/NumberCell';
import { useCommand } from '../state/CommandContext';
import { useSnapshotSelector } from '../state/snapshot';

/**
 * The first interface RebirthSystem has ever had. It is implemented and tested
 * in the engine, and the command has existed unused this whole time - all it
 * needed was a registry entry and a struct.
 */
export function RebirthSurface() {
  const run = useCommand();
  const gain = useSnapshotSelector((s) => s.rebirthKnowledgeGain.display);
  const knowledge = useSnapshotSelector((s) => s.knowledge.display);
  const best = useSnapshotSelector((s) => s.highestStageEver);
  const canRebirth = useSnapshotSelector((s) => s.canRebirth);
  const mastery = useSnapshotSelector((s) => s.mastery.display);
  const masteryAfter = useSnapshotSelector((s) => s.masteryAfterRebirth.display);
  const nextStage = useSnapshotSelector((s) => s.nextKnowledgeStage);

  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <Moment
        // A destination in the rail rather than something covering it, so the
        // nav beside it has to stay reachable. See `modal` on MomentProps.
        modal={false}
        tone="essence"
        icon="rebirth"
        headline="Unmake the spell"
        consequence="Everything resets to Frontier 1. What you learned about the Evercast does not, your gear keeps the power it has already earned, and Mastery makes the next climb faster than this one was."
        // Three is a hard cap, and Mastery has to be one of them: it is the whole
        // reason to press the button. Rebirths gave way rather than Banked - a
        // count of past rebirths is a vanity number, while the balance is what
        // decides whether an attunement is affordable, and the decision on this
        // screen is between spending depth now or going deeper first.
        cells={[
          { label: 'Knowledge', value: <NumberCell value={gain} prefix="+" /> },
          { label: 'Banked', value: <NumberCell value={knowledge} /> },
          { label: 'Mastery', value: <NumberCell value={canRebirth ? masteryAfter : mastery} prefix="x" /> },
        ]}
        primary={{
          label: canRebirth ? 'Rebirth' : 'Nothing new to learn',
          disabled: !canRebirth,
          onClick: () => setConfirming(true),
        }}
        // Knowledge is paid for depth beyond the deepest run already cashed out,
        // so the honest hint names the frontier the next point waits at. Without
        // it the button greys out with nothing to say, which reads as broken
        // rather than as not yet.
        hint={
          canRebirth
            ? `Your deepest run reached Frontier ${best}. Rebirthing now takes Mastery to x${masteryAfter}.`
            : `Knowledge is paid for new depth. The next point waits at Frontier ${nextStage}.`
        }
      />
      {/*
        Rebirth resets the run to Frontier 1 and had no confirmation at all -
        while Erase progress, which is comparable in consequence, has a full
        danger Moment with a way out and the focus on the safe half. This is the
        same treatment, and it is also where the audit's other complaint is
        answered: the screen said what happens in a paragraph of prose and never
        itemised it.
      */}
      {confirming && (
        <Moment
          tone="danger"
          icon="rebirth"
          headline="Unmake the spell?"
          consequence={`Frontier ${best} goes back to 1, and every spell point is returned to be spent again. Gear keeps every level it has bought, companions stay, attunements stay, and Mastery makes the next climb faster than this one was.`}
          cells={[
            { label: 'Knowledge', value: <NumberCell value={gain} prefix="+" /> },
            { label: 'Frontier', value: `${best} to 1` },
            { label: 'Mastery', value: <NumberCell value={masteryAfter} prefix="x" /> },
          ]}
          primary={{
            label: 'Unmake it',
            onClick: () => {
              setConfirming(false);
              run({ type: 'rebirth' });
            },
          }}
          secondary={{ label: 'Keep this run', onClick: () => setConfirming(false) }}
          onDismiss={() => setConfirming(false)}
        />
      )}
    </>
  );
}

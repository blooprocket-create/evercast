import { Moment } from '../archetypes/Moment';

/**
 * The one beat of onboarding that cannot be derived.
 *
 * Everything else a new player needs is a question about live state, and
 * retires itself when they act on it - see `ui/onboarding/coachMarks.ts`. The
 * premise is not: it describes the shape of the whole game rather than any one
 * wallet, so nothing the player does makes it stop being true, and it therefore
 * needs the only stored bit in the feature.
 *
 * It is a Moment because it is exactly what a Moment is for, and because the
 * archetype set is closed at five. Three cells is the cap the tuple type
 * enforces, and three is also the right number here: the three wallets are the
 * whole economy, and naming them is the only teaching this screen does.
 */
export function Premise({ onDismiss }: { onDismiss: () => void }) {
  return (
    <Moment
      tone="accent"
      icon="spellTree"
      headline="One spell, cast without end"
      consequence="It fights on its own, and it never stops. Everything you do makes the next cast bigger than the last."
      cells={[
        { label: 'Gold', value: 'Gear' },
        { label: 'Essence', value: 'The spell' },
        { label: 'Starlight', value: 'Companions' },
      ]}
      primary={{ label: 'Begin the cast', onClick: onDismiss }}
      hint="Nothing here needs your hands. Spend what it earns and it carries itself further each time."
    />
  );
}

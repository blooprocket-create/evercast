import { useEffect, useMemo, useRef, useState } from 'react';
import { COMPANION_RARITIES } from '../../engine/companions/types';
import type { CompanionRarity } from '../../engine/companions/types';
import type { SummonResultSnapshot } from '../../engine/types';
import { RARITY_LABEL, rarityStyle, starText } from '../companions/rarity';
import { Button } from '../primitives/Button';
import styles from './SummonReveal.module.css';

/** How long each card holds before the next one turns. */
const FLIP_MS = 260;
/** A legendary or better earns a longer beat before the next card. */
const RARE_FLIP_MS = 900;
/** The beam that tells you what is coming, before any card turns. */
const BEAM_MS = 850;

interface SummonRevealProps {
  results: readonly SummonResultSnapshot[];
  onDone: () => void;
}

function rank(rarity: CompanionRarity): number {
  return COMPANION_RARITIES.indexOf(rarity);
}

/**
 * The reveal.
 *
 * `Moment` is the game's one celebration archetype and its cell tuple is capped
 * at three by design, so a ten-pull cannot be one. This is its own overlay
 * instead, built from the same tokens and primitives - and positioned with
 * `inset: 0` rather than pixel offsets, so the surface rules still hold.
 *
 * Nothing here decides anything. The engine granted every companion before the
 * first frame; this only replays what it was told, which is why skipping is
 * free and why closing early cannot cost a pull.
 */
export function SummonReveal({ results, onDone }: SummonRevealProps) {
  const [turned, setTurned] = useState(0);
  const [skipped, setSkipped] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  const best = useMemo(
    () => results.reduce<CompanionRarity>((top, r) => (rank(r.rarity) > rank(top) ? r.rarity : top), 'common'),
    [results],
  );

  const reduced =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const done = skipped || reduced || turned >= results.length;

  useEffect(() => {
    if (done) return;
    const current = results[turned];
    const delay =
      turned === 0 ? BEAM_MS : current && rank(current.rarity) >= rank('legendary') ? RARE_FLIP_MS : FLIP_MS;
    timer.current = window.setTimeout(() => setTurned((count) => count + 1), delay);
    return () => window.clearTimeout(timer.current);
  }, [done, results, turned]);

  // Escape is the way out of every other overlay in the game.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') (done ? onDone : setSkipped.bind(null, true))();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [done, onDone]);

  return (
    <div
      className={styles.scrim}
      style={rarityStyle(best)}
      role="dialog"
      aria-modal="true"
      aria-label="Summoning results"
    >
      {!done && <span className={styles.beam} aria-hidden="true" />}

      <div className={done ? `${styles.cards} ${styles.summary}` : styles.cards}>
        {results.map((result, index) => {
          const shown = done || index < turned;
          return (
            <div
              key={`${result.definitionId}-${index}`}
              style={rarityStyle(result.rarity)}
              className={shown ? `${styles.card} ${styles.cardShown}` : styles.card}
            >
              {shown ? (
                <>
                  <span className={styles.rarity}>{RARITY_LABEL[result.rarity]}</span>
                  <span className={styles.cardName}>{result.name}</span>
                  <span className={styles.stars}>{starText(result.stars)}</span>
                  <span className={styles.note}>
                    {!result.duplicate
                      ? 'New'
                      : result.refund > 0
                        ? `+${result.refund} Starlight`
                        : `+${result.shards} shards`}
                  </span>
                </>
              ) : (
                <span className={styles.back} aria-hidden="true" />
              )}
            </div>
          );
        })}
      </div>

      <div className={styles.actions}>
        {done ? (
          <Button variant="primary" onClick={onDone}>
            Continue
          </Button>
        ) : (
          <Button onClick={() => setSkipped(true)}>Skip</Button>
        )}
      </div>

      <p className={styles.caption}>
        {done
          ? summarise(results)
          : `Summoning ${results.length === 1 ? 'a companion' : `${results.length} companions`}…`}
      </p>
    </div>
  );
}

/** One line about what the batch was actually worth. */
function summarise(results: readonly SummonResultSnapshot[]): string {
  const fresh = results.filter((result) => !result.duplicate).length;
  const shards = results.reduce((total, result) => total + result.shards, 0);
  const refund = results.reduce((total, result) => total + result.refund, 0);

  const parts: string[] = [];
  parts.push(fresh === 0 ? 'No new companions' : `${fresh} new`);
  if (shards > 0) parts.push(`${shards} shards`);
  if (refund > 0) parts.push(`${refund} Starlight back`);
  return `${parts.join(' · ')}.`;
}

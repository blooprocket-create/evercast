import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SummonResultSnapshot } from '../../engine/types';
import { SummonReveal } from './SummonReveal';

const results: SummonResultSnapshot[] = [
  { definitionId: 'sunless_knight', name: 'Sunless Knight', rarity: 'legendary', duplicate: false, shards: 0, refund: 0, stars: 1 },
  { definitionId: 'hedge_warden', name: 'Hedge Warden', rarity: 'common', duplicate: true, shards: 1, refund: 0, stars: 2 },
  { definitionId: 'pale_herald', name: 'The Pale Herald', rarity: 'mythical', duplicate: true, shards: 0, refund: 1500, stars: 5 },
];

const render = (immediate: boolean) =>
  renderToStaticMarkup(<SummonReveal results={results} immediate={immediate} onDone={() => {}} />);

describe('the summon reveal', () => {
  it('turns the cards one at a time when it is allowed to', () => {
    const html = render(false);
    // Nothing has turned on the first frame, so no name is readable yet.
    for (const result of results) expect(html).not.toContain(result.name);
    expect(html).toContain('Skip');
    expect(html).toContain('Summoning 3 companions');
  });

  it('still says what was drawn when the animation is skipped', () => {
    /*
     * Skipping used to mean the overlay never mounted at all, so a player who
     * turned the setting on was told nothing about what they had pulled - not
     * the companions, not the shards, not the refund.
     */
    const html = render(true);
    for (const result of results) expect(html).toContain(result.name);
    expect(html).toContain('Continue');
    expect(html).not.toContain('Skip');
  });

  it('accounts for new companions, shards and refunds in one line', () => {
    const html = render(true);
    expect(html).toContain('1 new');
    expect(html).toContain('1 shards');
    expect(html).toContain('1500 Starlight back');
  });

  it('marks a duplicate as shards rather than as new', () => {
    const html = render(true);
    expect(html).toContain('+1 shards');
    expect(html).toContain('+1500 Starlight');
    expect(html).toContain('New');
  });
});

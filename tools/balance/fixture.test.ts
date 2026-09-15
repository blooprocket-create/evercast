/**
 * Writes a save the way a player would have earned one.
 *
 * `BALANCE_FIXTURE_STAGE` is where to stop; `BALANCE_FIXTURE_OUT` is where to
 * write. Driven by the same bot as every other harness here, because a save
 * with hand-picked gear levels is not a save any run could have produced - see
 * the note in `surge.test.ts` about what that cost the first time.
 */
import { writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { EvercastSimulation } from '../../src/engine/EvercastSimulation';
import { SaveCodec } from '../../src/engine/save/SaveCodec';
import { DEFAULT_ENGINE_CONFIG } from '../../src/engine/config';
import { createBot, play } from './bot';

describe('fixture', () => {
  it('plays to a stage and writes the save', () => {
    const target = Number(process.env.BALANCE_FIXTURE_STAGE ?? '9');
    const out = process.env.BALANCE_FIXTURE_OUT ?? 'boss-save.json';
    const simulation = new EvercastSimulation();
    const bot = createBot();
    while (simulation.getState().run.frontierStage < target) play(simulation, bot);

    const state = simulation.getState();
    // The premise card would otherwise cover the prompt on a phone viewport.
    if (!state.meta.storyFlags.includes('premise')) state.meta.storyFlags.push('premise');
    writeFileSync(out, JSON.stringify(new SaveCodec(DEFAULT_ENGINE_CONFIG).encode(state)));
    process.stdout.write(
      `\nwrote ${out} at stage ${state.run.frontierStage}, ` +
        `${(state.run.elapsedSeconds / 60).toFixed(1)} simulated minutes in\n`,
    );
  });
});

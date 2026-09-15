/**
 * How often the Surge window actually opens, for a player who is progressing.
 *
 * This exists because the first attempt at answering it used hand-picked gear
 * levels and got an answer that was wrong by an order of magnitude - saves
 * built that way are enormously over-geared for their stage, so the boss died
 * during its walk-in and the window never opened at all. A mechanic's frequency
 * can only be measured against a run whose power matches the curve, which means
 * against the same greedy bot `sweep.test.ts` uses.
 *
 *   npx vitest run --config tools/balance/vitest.config.ts surge
 *
 * Environment:
 *   SURGE_HOURS  simulated hours (default 3)
 */
import { describe, it } from 'vitest';
import { EvercastSimulation } from '../../src/engine/EvercastSimulation';
import { createBot, play } from './bot';

const HOURS = Number(process.env.SURGE_HOURS ?? '3');

describe('the Surge', () => {
  it('opens often enough to be a mechanic', () => {
    const simulation = new EvercastSimulation();
    const bot = createBot();
    const budget = HOURS * 3600;

    let bossEncounters = 0;
    let bossesThatSurged = 0;
    let windows = 0;
    let windowTicks = 0;
    let inBoss = false;
    let surgedThisBoss = false;
    let wasOpen = false;
    let firstAtStage = 0;
    let lastTick = 0;

    while (simulation.getState().run.elapsedSeconds < budget) {
      const before = simulation.getState().run.elapsedSeconds;
      play(simulation, bot);
      lastTick = simulation.getState().run.elapsedSeconds - before;
      const snapshot = simulation.getSnapshot();

      if (snapshot.boss && !inBoss) {
        bossEncounters += 1;
        surgedThisBoss = false;
      }
      inBoss = snapshot.boss;

      const open = snapshot.surge !== null;
      if (open) {
        windowTicks += 1;
        if (!wasOpen) {
          windows += 1;
          if (!firstAtStage) firstAtStage = snapshot.stage;
        }
        if (!surgedThisBoss) {
          surgedThisBoss = true;
          bossesThatSurged += 1;
        }
      }
      wasOpen = open;
    }

    const run = simulation.getState().run;
    const share = bossEncounters ? (bossesThatSurged / bossEncounters) * 100 : 0;
    /*
     * The bot never answers a Surge, which is deliberate: this measures how
     * often the game OFFERS the moment, not how well anything plays it. Window
     * seconds are approximate - the tick is a quarter second and a window is
     * under two - so treat them as an order of magnitude, not a stopwatch.
     */
    process.stdout.write(
      [
        `\n### Surge frequency over ${HOURS}h`,
        `reached stage ${run.frontierStage}, ${run.stats.bossKills} boss kills, ${run.stats.deaths} deaths`,
        `boss encounters entered: ${bossEncounters}`,
        `...that opened at least one window: ${bossesThatSurged} (${share.toFixed(0)}%)`,
        `windows opened in total: ${windows}`,
        `first window at stage: ${firstAtStage || 'never'}`,
        `approx seconds of open window: ${(windowTicks * (lastTick || 0.25)).toFixed(1)}`,
        '',
      ].join('\n'),
    );
  });
});

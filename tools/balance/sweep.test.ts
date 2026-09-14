/**
 * Headless balance harness.
 *
 * Measurement only. It imports the engine and drives it; it must never change
 * game behaviour, and nothing in `src/` may import from here.
 *
 * It exists because the progression curve is only correct if its *shape* is
 * right, and shape is invisible to a unit test. The wall that motivated
 * `docs/PROGRESSION_CURVE_V1.md` does not appear until roughly stage 40, which
 * is hours of simulated play — so the only honest way to evaluate a tuning
 * change is to play the game for eight hours and look at the curve.
 *
 * This is a vitest file only because vitest is the sole TypeScript runner this
 * repo has (there is no tsx or vite-node). The root config scopes the default
 * suite to `src/**`, so this never runs in `npm test` or CI - and because that
 * include applies even to a file named on the command line, the harness carries
 * its own config:
 *
 *   npx vitest run --config tools/balance/vitest.config.ts
 *
 * Environment:
 *   BALANCE_HOURS  simulated hours per scenario (default 8)
 *   BALANCE_OUT    also write the report to this path
 *
 * The bot below reads marginal stat-per-gold out of `compileGearStats` itself
 * rather than reimplementing the curve, so it stays correct when the curve
 * changes shape underneath it. Sweeping several curve configurations in one
 * process arrives with the tunable constants themselves; today there is one
 * configuration — whatever the build says — and this measures it.
 */
import { describe, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type Decimal from 'break_eternity.js';
import { EvercastSimulation } from '../../src/engine/EvercastSimulation';
import { compileGearStats, createInitialEquipmentState, gearLevelCost } from '../../src/engine/gear/GearSystem';
import { GEAR_DEFINITIONS, GEAR_SLOT_ORDER } from '../../src/engine/gear/GearCatalog';
import type { GearSlot } from '../../src/engine/gear/types';
import { SPELL_ATTUNEMENTS, SPELL_TREE_NODES } from '../../src/content/spellTree';
import { big } from '../../src/engine/numbers';

const SIM_HOURS = Number(process.env.BALANCE_HOURS ?? '8');
const TICK_SECONDS = 0.25;

const report: string[] = [];
function log(line = ''): void {
  report.push(line);
  process.stdout.write(`${line}\n`);
}
function flush(): void {
  const out = process.env.BALANCE_OUT;
  if (!out) return;
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${report.join('\n')}\n`);
}

/* ------------------------------------------------------------------ bot --- */

/**
 * What one more level of a slot is worth, read out of the engine rather than
 * recomputed. A linear curve makes this a constant and a geometric one makes it
 * grow; the bot does not need to know which. Memoized because the same
 * (slot, level) is asked on every tick until it becomes affordable.
 */
const marginalCache = new Map<string, Decimal>();

function contributionOf(slot: GearSlot, level: number): Decimal {
  // Every other slot sits at level 1 and contributes nothing, so the compiled
  // stat is this slot's contribution alone.
  const equipment = createInitialEquipmentState();
  equipment.pieces[slot].level = level;
  const stats = compileGearStats(equipment);
  return GEAR_DEFINITIONS[slot].primaryStat === 'baseDamage' ? stats.baseDamageBonus : stats.maxHpBonus;
}

function marginalGain(slot: GearSlot, level: number): Decimal {
  const key = `${slot}:${level}`;
  const cached = marginalCache.get(key);
  if (cached) return cached;
  const value = contributionOf(slot, level + 1).sub(contributionOf(slot, level));
  marginalCache.set(key, value);
  return value;
}

function bestBuy(simulation: EvercastSimulation, want: 'baseDamage' | 'maxHp'): GearSlot | null {
  const { equipment } = simulation.getState();
  let best: GearSlot | null = null;
  let bestEfficiency: Decimal = big(0);
  for (const slot of GEAR_SLOT_ORDER) {
    if (GEAR_DEFINITIONS[slot].primaryStat !== want) continue;
    const level = equipment.pieces[slot].level;
    const cost = gearLevelCost(slot, level);
    if (equipment.gold.cmp(cost) < 0) continue;
    const efficiency = marginalGain(slot, level).div(cost);
    if (efficiency.cmp(bestEfficiency) > 0) {
      bestEfficiency = efficiency;
      best = slot;
    }
  }
  return best;
}

/** Spend everything affordable, alternating offence and defence. */
function spendGold(simulation: EvercastSimulation, state: { wantHp: boolean }): void {
  for (let guard = 0; guard < 500; guard += 1) {
    const first = state.wantHp ? 'maxHp' : 'baseDamage';
    const second = state.wantHp ? 'baseDamage' : 'maxHp';
    const slot = bestBuy(simulation, first) ?? bestBuy(simulation, second);
    if (!slot) return;
    simulation.execute({ type: 'level_gear', slot });
    state.wantHp = !state.wantHp;
  }
}

/** Essence into the tree, Knowledge into attunements, Starlight into the party. */
function developBuild(simulation: EvercastSimulation): void {
  while (simulation.execute({ type: 'buy_spell_point' }));
  for (let pass = 0; pass < 3; pass += 1) {
    let progressed = false;
    for (const node of SPELL_TREE_NODES) {
      if (simulation.execute({ type: 'activate_spell_node', nodeId: node.id })) progressed = true;
    }
    if (!progressed) break;
  }
  for (const attunement of SPELL_ATTUNEMENTS) {
    simulation.execute({ type: 'buy_attunement', attunementId: attunement.id });
  }
  while (simulation.execute({ type: 'summon_draw', count: 10 }));

  const owned = Object.keys(simulation.getState().companions.owned);
  for (const definitionId of owned) simulation.execute({ type: 'ascend_companion', definitionId });
  const { party } = simulation.getState().companions;
  for (let slot = 0; slot < 5; slot += 1) {
    if (party[slot]) continue;
    for (const definitionId of owned) {
      if (party.includes(definitionId)) continue;
      if (simulation.execute({ type: 'equip_companion', definitionId, slot })) break;
    }
  }
}

function play(simulation: EvercastSimulation, state: { wantHp: boolean }): void {
  simulation.advance(TICK_SECONDS, { presentationEvents: false });
  spendGold(simulation, state);
  developBuild(simulation);
}

/* -------------------------------------------------------------- metrics --- */

interface StageRecord {
  stage: number;
  elapsed: number;
  /** Knowledge a rebirth would pay here, read from the snapshot. */
  knowledgeIfRebirth: number;
}

function medianMinutesPerStage(records: StageRecord[], low: number, high: number): string {
  const byStage = new Map(records.map((r) => [r.stage, r.elapsed]));
  const deltas: number[] = [];
  for (const { stage, elapsed } of records) {
    if (stage <= low || stage > high) continue;
    const previous = byStage.get(stage - 1);
    if (previous === undefined) continue;
    deltas.push((elapsed - previous) / 60);
  }
  if (deltas.length === 0) return '   -  ';
  deltas.sort((a, b) => a - b);
  return deltas[Math.floor(deltas.length / 2)].toFixed(2).padStart(6);
}

function worstStage(records: StageRecord[]): { minutes: number; stage: number } | null {
  const byStage = new Map(records.map((r) => [r.stage, r.elapsed]));
  let worst: { minutes: number; stage: number } | null = null;
  for (const { stage, elapsed } of records) {
    const previous = byStage.get(stage - 1);
    if (previous === undefined) continue;
    const minutes = (elapsed - previous) / 60;
    if (!worst || minutes > worst.minutes) worst = { minutes, stage };
  }
  return worst;
}

/* ------------------------------------------------------------ scenarios --- */

function runPush(label: string, hours: number): { simulation: EvercastSimulation; records: StageRecord[] } {
  const simulation = new EvercastSimulation();
  const budget = hours * 3600;
  const state = { wantHp: false };
  const records: StageRecord[] = [];
  let lastStage = simulation.getState().run.frontierStage;
  records.push({ stage: lastStage, elapsed: 0, knowledgeIfRebirth: 0 });

  while (simulation.getState().run.elapsedSeconds < budget) {
    play(simulation, state);
    const { run } = simulation.getState();
    if (run.frontierStage === lastStage) continue;
    lastStage = run.frontierStage;
    const snapshot = simulation.getSnapshot();
    records.push({
      stage: lastStage,
      elapsed: run.elapsedSeconds,
      knowledgeIfRebirth: snapshot.canRebirth ? Number(snapshot.rebirthKnowledgeGain.raw) : 0,
    });
  }

  const { run, equipment } = simulation.getState();
  const worst = worstStage(records);
  log(`\n### ${label}`);
  log(`reached stage ${run.frontierStage} in ${(run.elapsedSeconds / 3600).toFixed(1)}h`);
  log(`deaths ${run.stats.deaths}   kills ${run.stats.kills}   boss kills ${run.stats.bossKills}`);
  log(`gear ${GEAR_SLOT_ORDER.map((s) => `${s}=${equipment.pieces[s].level}`).join(' ')}`);
  log(
    `median min/stage   1-25:${medianMinutesPerStage(records, 0, 25)}` +
      `  26-50:${medianMinutesPerStage(records, 25, 50)}` +
      `  51-100:${medianMinutesPerStage(records, 50, 100)}` +
      `  101+:${medianMinutesPerStage(records, 100, Number.MAX_SAFE_INTEGER)}`,
  );
  log(worst ? `worst single stage ${worst.minutes.toFixed(1)} min at stage ${worst.stage}` : 'worst single stage n/a');

  const levelsPerStage = GEAR_SLOT_ORDER.reduce((sum, s) => sum + equipment.pieces[s].level, 0) / 8 / run.frontierStage;
  log(`gear levels gained per stage ~${levelsPerStage.toFixed(2)} (the evolution-milestone assumption)`);

  return { simulation, records };
}

/**
 * Where the rate-optimal cash-out sits. The spec's claim is that `^1.5` puts it
 * well short of the soft stall; this locates it from measured play instead of
 * from the closed form.
 */
function reportKnowledgeRate(records: StageRecord[]): number {
  const viable = records.filter((r) => r.knowledgeIfRebirth > 0 && r.elapsed > 0);
  if (viable.length === 0) {
    log('\nThe run never became rebirth-viable, so there is no Knowledge rate to');
    log('report: prestige is unreachable inside the budget, not merely slow.');
    return 0;
  }
  log('\nKnowledge per hour, if the run cashed out at that stage:');
  log('  stage |  reached at | Knowledge | K/hr');
  let best = viable[0];
  for (const record of viable) {
    const rate = record.knowledgeIfRebirth / (record.elapsed / 3600);
    if (rate > best.knowledgeIfRebirth / (best.elapsed / 3600)) best = record;
    if (record.stage % 25 !== 0 && record !== viable[viable.length - 1]) continue;
    log(
      `  ${String(record.stage).padStart(5)} | ${(record.elapsed / 60).toFixed(0).padStart(8)}m |` +
        ` ${String(record.knowledgeIfRebirth).padStart(9)} | ${rate.toFixed(2).padStart(6)}`,
    );
  }
  const bestRate = best.knowledgeIfRebirth / (best.elapsed / 3600);
  log(`  -> rate-optimal cash-out at stage ${best.stage} (${bestRate.toFixed(2)} K/hr)`);
  return bestRate;
}

/**
 * Rebirth keeps equipment and gold, so a geared player can re-reach the unlock
 * stage in minutes and cash out again. If that pays better per hour than pushing
 * deeper, the prestige loop rewards spamming it — which is worth knowing before
 * any power multiplier is attached to Knowledge.
 */
function reportRebirthSpam(simulation: EvercastSimulation, deepRate: number): void {
  log('\nRebirth-spam check (same save, gear and gold retained):');
  const state = { wantHp: false };

  if (!simulation.getSnapshot().canRebirth) {
    log('  never became rebirth-viable');
    return;
  }
  // Cash the deep run out first. That payout was earned by the push, so counting
  // it here would credit spam with the depth it is avoiding.
  simulation.execute({ type: 'rebirth' });

  const cycles: { seconds: number; knowledge: number }[] = [];
  for (let cycle = 0; cycle < 3; cycle += 1) {
    // Climb back to wherever a rebirth becomes possible again. Building a
    // snapshot is far more expensive than a tick, so poll every few sim seconds
    // rather than every tick; the answer only has to be accurate to that window.
    const POLL_TICKS = 40;
    let guard = 0;
    while (guard < 2_000_000) {
      if (simulation.getSnapshot().canRebirth) break;
      for (let tick = 0; tick < POLL_TICKS; tick += 1) play(simulation, state);
      guard += POLL_TICKS;
    }
    const snapshot = simulation.getSnapshot();
    if (!snapshot.canRebirth) break;

    // `elapsedSeconds` belongs to the run, and a rebirth starts a new one - so
    // the clock now reads the re-climb on its own. Differencing it across the
    // rebirth would subtract the whole previous run and go negative.
    const seconds = simulation.getState().run.elapsedSeconds;
    const knowledge = Number(snapshot.rebirthKnowledgeGain.raw);
    cycles.push({ seconds, knowledge });
    log(
      `  cycle ${cycle + 1}: re-climbed to the unlock stage in ${(seconds / 60).toFixed(1)} min` +
        `, then cashed out ${knowledge} Knowledge`,
    );
    simulation.execute({ type: 'rebirth' });
  }

  if (cycles.length === 0) {
    log('  never became rebirth-viable');
    return;
  }
  const totalSeconds = cycles.reduce((sum, c) => sum + c.seconds, 0);
  const totalKnowledge = cycles.reduce((sum, c) => sum + c.knowledge, 0);
  const spamRate = totalKnowledge / (totalSeconds / 3600);
  log(`  spam rate ${spamRate.toFixed(2)} K/hr vs deep-push rate ${deepRate.toFixed(2)} K/hr`);
  log(
    spamRate > deepRate
      ? `  -> SPAM WINS by ${(spamRate / deepRate).toFixed(1)}x. Knowledge must pay on the margin.`
      : '  -> deep push wins; the prestige loop rewards depth.',
  );
}

/* ----------------------------------------------------------------- run ---- */

describe('balance sweep', () => {
  it('measures the progression curve', () => {
    log('='.repeat(72));
    log(`Evercast balance sweep - ${SIM_HOURS}h simulated per scenario`);
    log('='.repeat(72));

    const { simulation, records } = runPush('current build', SIM_HOURS);

    // Compare spam against the *best* rate a deep push can reach, not the rate it
    // happened to end on - the exploit only matters if it beats the best play.
    const bestDeepRate = reportKnowledgeRate(records);
    if (bestDeepRate > 0) reportRebirthSpam(simulation, bestDeepRate);

    log('');
    flush();
  }, 3_000_000);
});

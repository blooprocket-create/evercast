import { EvercastScene } from '../../src/game/EvercastScene';
import { CombatSystem } from '../../src/engine/combat/CombatSystem';
import { DEFAULT_ENGINE_CONFIG } from '../../src/engine/config';
import { createInitialGameState } from '../../src/engine/state';
import { createDefaultCatalog } from '../../src/content/catalog';
import { buildSimulationSnapshot } from '../../src/engine/snapshot/SimulationSnapshotBuilder';
import { big } from '../../src/engine/numbers';
import type { GameEvent } from '../../src/engine/events/GameEvent';
import type { SpellModifier } from '../../src/engine/spell/types';
import type { VfxQuality } from '../../src/game/vfx/VfxPool';
import { SPELL_TREE_NODES } from '../../src/content/spellTree';

const query = new URLSearchParams(location.search);
const view = new EvercastScene(
  document.querySelector('canvas')!,
  (query.get('quality') ?? 'medium') as VfxQuality,
);
const state = createInitialGameState(DEFAULT_ENGINE_CONFIG),
  catalog = createDefaultCatalog();
const events: GameEvent[] = [];
const combat = new CombatSystem(DEFAULT_ENGINE_CONFIG, (e) => events.push(e));
let nextId = 100,
  auto = false,
  paused = false,
  elapsed = 0,
  previous = performance.now();
const snapshot = () =>
  buildSimulationSnapshot({
    state,
    config: DEFAULT_ENGINE_CONFIG,
    catalog,
    canRebirth: false,
    lastEvent: 'VFX review',
  });
function refill() {
  state.run.phase = 'combat';
  state.run.frontierStage = 26;
  state.run.encounterStage = 26;
  state.run.enemies = Array.from({ length: 6 }, (_, i) => ({
    instanceId: ++nextId,
    definitionId: 'briarling',
    name: `Target ${i + 1}`,
    stage: 26,
    boss: false,
    hp: big('1e12'),
    maxHp: big('1e12'),
    attackDamage: big(0),
    attackInterval: 2,
    attackCooldown: 2,
  }));
  view.sync(snapshot(), 0, []);
}
function configure(mode: string) {
  document.querySelector<HTMLSelectElement>('#mode')!.value = mode;
  const all = mode === 'combined' || mode === 'stress';
  state.spellTree.activatedNodeIds = SPELL_TREE_NODES.filter(
    (n) => n.region === mode || (all && ['fire', 'storm', 'blood', 'frost'].includes(n.region)),
  ).map((n) => n.id);
  const mods: SpellModifier[] = [];
  if (mode === 'pierce' || all)
    mods.push({ id: 'review-pierce', kind: 'combat', action: { kind: 'pierce', count: all ? 1 : 4 } });
  if (mode === 'storm' || all)
    mods.push({
      id: 'review-chain',
      kind: 'combat',
      action: { kind: 'chain', count: 3, damageMultiplier: 0.5 },
    });
  if (mode === 'fire' || all)
    mods.push({
      id: 'review-splash',
      kind: 'combat',
      action: { kind: 'splash', targets: 5, damageMultiplier: 0.3 },
    });
  if (mode === 'frost' || all)
    mods.push({ id: 'review-control', kind: 'combat', action: { kind: 'control', delaySeconds: 0.25 } });
  if (mode === 'blood' || all)
    mods.push({ id: 'review-leech', kind: 'combat', action: { kind: 'leech', fraction: 0.3 } });
  if (mode === 'repeat' || all)
    mods.push({
      id: 'review-repeat',
      kind: 'trigger',
      trigger: 'onCrit',
      action: { kind: 'repeatProjectile', count: 2, damageMultiplier: 0.3 },
    });
  state.run.spell = {
    baseDamage: '5',
    castInterval: mode === 'stress' ? 0.04 : 0.8,
    projectileCount: all ? 5 : 1,
    critChance: mode === 'repeat' || all ? 1 : 0,
    critMultiplier: 2,
    modifiers: mods,
  };
}
function cast(lethal = false) {
  state.run.mage.hp = big(1);
  state.run.mage.maxHp = big(100);
  const oldDamage = state.run.spell.baseDamage;
  if (lethal) state.run.spell.baseDamage = '1e20';
  const result = combat.cast(state.run, state.equipment);
  for (const id of result.killedEnemyIds)
    events.push({
      type: 'enemy_killed',
      time: state.run.elapsedSeconds,
      stage: 26,
      instanceId: id,
      enemyId: 'briarling',
      gold: '0',
    });
  state.run.enemies = state.run.enemies.filter((e) => !result.killedEnemyIds.includes(e.instanceId));
  state.run.spell.baseDamage = oldDamage;
  view.sync(snapshot(), 0, events.splice(0));
}
function step(dt: number) {
  state.run.elapsedSeconds += dt;
  view.sync(snapshot(), dt, []);
}
function stats() {
  return {
    ...view.vfx.stats,
    sceneMeshes: (view as any).scene.meshes.length,
    materials: (view as any).scene.materials.length,
    animationGroups: (view as any).scene.animationGroups.length,
    sceneLights: (view as any).scene.lights.length,
  };
}
const mode = document.querySelector<HTMLSelectElement>('#mode')!;
mode.onchange = () => configure(mode.value);
document.querySelector<HTMLButtonElement>('#cast')!.onclick = () => cast();
document.querySelector<HTMLButtonElement>('#auto')!.onclick = () => {
  auto = !auto;
};
document.querySelector<HTMLButtonElement>('#kill')!.onclick = () => cast(true);
document.querySelector<HTMLButtonElement>('#reset')!.onclick = refill;
refill();
configure(query.get('mode') ?? 'arcane');
mode.value = query.get('mode') ?? 'arcane';
function loop(now: number) {
  const dt = Math.min(0.05, (now - previous) / 1000);
  previous = now;
  if (!paused) {
    elapsed += dt;
    if (auto && elapsed >= state.run.spell.castInterval) {
      elapsed = 0;
      cast();
    }
    step(dt);
  }
  document.querySelector('#stats')!.textContent = JSON.stringify(stats(), null, 2);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
(window as any).__vfxReview = {
  view,
  state,
  cast,
  step,
  stats,
  refill,
  configure,
  async frame(mode: string, time: number, lethal = false) {
    paused = true;
    auto = false;
    for (let i = 0; i < 60; i++) step(0.1);
    refill();
    configure(mode);
    await view.whenReady();
    await new Promise(requestAnimationFrame);
    step(1);
    cast(lethal);
    for (let remaining = time; remaining > 0; remaining -= 0.008) step(Math.min(0.008, remaining));
    return stats();
  },
  pause(value = true) {
    paused = value;
  },
  auto(value = true) {
    auto = value;
  },
  dispose() {
    paused = true;
    auto = false;
    view.dispose();
  },
};

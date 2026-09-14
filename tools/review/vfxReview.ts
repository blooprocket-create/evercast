import { EvercastScene } from '../../src/game/EvercastScene';
import { NO_MASTERY } from '../../src/engine/prestige/Mastery';
import { CombatSystem } from '../../src/engine/combat/CombatSystem';
import {
  clearSpellCombat,
  effectiveCastInterval,
  ensurePositions,
} from '../../src/engine/combat/SpellCombatState';
import { DEFAULT_ENGINE_CONFIG } from '../../src/engine/config';
import { createInitialGameState } from '../../src/engine/state';
import { createDefaultCatalog } from '../../src/content/catalog';
import { buildSimulationSnapshot } from '../../src/engine/snapshot/SimulationSnapshotBuilder';
import { big } from '../../src/engine/numbers';
import type { GameEvent } from '../../src/engine/events/GameEvent';
import type { VfxQuality } from '../../src/game/vfx/VfxPool';
import { SPELL_TREE_NODES, SPELL_TREE_NODE_BY_ID } from '../../src/content/spellTree';
import {
  SPELL_TREE_NODE_COUNT,
  buildSpellFromTree,
  canActivateSpellNode,
} from '../../src/engine/spellTree/SpellTreeSystem';
import { SPELL_ATTUNEMENTS } from '../../src/content/spellTree';

const query = new URLSearchParams(location.search);
const view = new EvercastScene(
  document.querySelector('canvas')!,
  (query.get('quality') ?? 'medium') as VfxQuality,
);
const state = createInitialGameState(DEFAULT_ENGINE_CONFIG),
  catalog = createDefaultCatalog(),
  events: GameEvent[] = [];
const combat = new CombatSystem(DEFAULT_ENGINE_CONFIG, (e) => events.push(e));
let nextId = 100,
  auto = false,
  paused = false,
  previous = performance.now();
const history: GameEvent[] = [];
const snapshot = () =>
  buildSimulationSnapshot({
    state,
    config: DEFAULT_ENGINE_CONFIG,
    catalog,
    canRebirth: false,
    lastSummon: null,
    nextKnowledgeStage: 1,
      rebirthKnowledgeGain: big(0),
    chronicle: [],
  });
const mode = document.querySelector<HTMLSelectElement>('#mode')!;
for (const node of SPELL_TREE_NODES.filter((n) => ['root', 'route', 'mutation', 'fusion', 'apex'].includes(n.kind))) {
  const option = document.createElement('option');
  option.value = node.id;
  option.textContent = `${node.kind} · ${node.name}`;
  mode.append(option);
}
function flush(dt = 0) {
  const batch = events.splice(0);
  history.push(...batch);
  if (history.length > 2000) history.splice(0, history.length - 2000);
  view.sync(snapshot(), dt, batch);
}
function refill() {
  clearSpellCombat(state.run);
  state.run.phase = 'combat';
  state.run.frontierStage = 26;
  state.run.encounterStage = 26;
  state.run.enemies = Array.from({ length: 6 }, (_, i) => ({
    instanceId: ++nextId,
    definitionId: 'briarling',
    name: `Target ${i + 1}`,
    stage: 26,
    boss: false,
    hp: big('1e6'),
    maxHp: big('1e6'),
    attackDamage: big(0),
    attackInterval: 2,
    attackCooldown: 2,
  }));
  ensurePositions(state.run, DEFAULT_ENGINE_CONFIG.enemyAttackRange);
  state.run.castCooldown = 0;
  events.push({
    type: 'encounter_started',
    time: state.run.elapsedSeconds,
    stage: 26,
    totalEnemies: 6,
    boss: false,
  });
  flush();
}
function configure(id: string) {
  const node = SPELL_TREE_NODE_BY_ID.get(id);
  if (!node) throw new Error(`Unknown review node: ${id}`);
  mode.value = id;
  clearSpellCombat(state.run);
  // Review-only: every attunement granted and points to spare, so any authored
  // path can be allocated for inspection. Never touches a saved game.
  state.spellTree = {
    purchasedPoints: SPELL_TREE_NODE_COUNT,
    activatedNodeIds: [],
    attunements: SPELL_ATTUNEMENTS.map((attunement) => attunement.id),
  };
  const activate = (key: string) => {
    if (key === 'evercast_root' || state.spellTree.activatedNodeIds.includes(key)) return;
    SPELL_TREE_NODE_BY_ID.get(key)!.requiresAll.forEach(activate);
    if (!canActivateSpellNode(state.spellTree, key)) throw new Error(`Invalid review path: ${key}`);
    state.spellTree.activatedNodeIds.push(key);
  };
  activate(id);
  state.run.spell = buildSpellFromTree(state.spellTree);
  const m = state.run.spell.mechanics!;
  // Explicit review-only switch: makes rare effects reproducible, without fabricated events.
  if (document.querySelector<HTMLInputElement>('#procs')!.checked) {
    m.meteorChance = 1;
    m.contagionChance = 1;
    m.ruinChance = 1;
  }
  state.run.castCooldown = 0;
  history.length = 0;
  document.querySelector('#build')!.textContent =
    `${node.name} · ${state.spellTree.activatedNodeIds.length} allocated points`;
}
function collectDead(ids: number[]) {
  for (const id of ids)
    events.push({
      type: 'enemy_killed',
      time: state.run.elapsedSeconds,
      stage: 26,
      instanceId: id,
      enemyId: 'briarling',
      gold: '0',
    });
  state.run.enemies = state.run.enemies.filter((e) => !ids.includes(e.instanceId));
}
function cast(lethal = false) {
  const old = state.run.spell.baseDamage;
  if (lethal) state.run.spell.baseDamage = '1e20';
  collectDead(combat.cast(state.run, state.equipment, NO_MASTERY).killedEnemyIds);
  state.run.spell.baseDamage = old;
  state.run.castCooldown = effectiveCastInterval(state.run);
  flush();
}
function step(dt: number) {
  let remaining = dt;
  while (remaining > 1e-9) {
    const delay = Math.min(
      remaining,
      combat.evolving.effects.nextDelay(state.run),
      auto && state.run.enemies.length ? Math.max(0, state.run.castCooldown) : Infinity,
    );
    state.run.elapsedSeconds += delay;
    state.run.castCooldown -= delay;
    remaining -= delay;
    collectDead(combat.evolving.effects.advance(state.run));
    if (auto && state.run.castCooldown <= 1e-9 && state.run.enemies.length) cast();
    flush(delay);
    if (delay === 0 && combat.evolving.effects.nextDelay(state.run) === 0)
      throw new Error('Review clock stalled');
  }
}
function stats() {
  return {
    ...view.vfx.stats,
    route: state.run.spell.mechanics?.route,
    combat: state.run.combatState,
    sceneMeshes: (view as any).scene.meshes.length,
    materials: (view as any).scene.materials.length,
  };
}
mode.onchange = () => configure(mode.value);
document.querySelector<HTMLInputElement>('#procs')!.onchange = () => configure(mode.value);
document.querySelector<HTMLButtonElement>('#cast')!.onclick = () => cast();
document.querySelector<HTMLButtonElement>('#auto')!.onclick = () => {
  auto = !auto;
};
document.querySelector<HTMLButtonElement>('#kill')!.onclick = () => cast(true);
document.querySelector<HTMLButtonElement>('#reset')!.onclick = refill;
document.querySelector<HTMLButtonElement>('#wounded')!.onclick = () => {
  for (const enemy of state.run.enemies) enemy.hp = enemy.maxHp.mul(0.15);
  flush();
};
refill();
configure(query.get('mode') ?? 'evercast_root');
function loop(now: number) {
  const dt = Math.min(0.05, (now - previous) / 1000);
  previous = now;
  if (!paused) step(dt);
  const s = stats();
  document.querySelector('#stats')!.textContent = JSON.stringify(
    {
      route: s.route,
      meshes: s.meshes,
      paths: s.paths,
      jobs: s.jobs,
      momentum: s.combat?.momentum,
      focus: s.combat?.focus,
      supercharge: s.combat?.supercharge,
      meteors: s.combat?.meteors.length,
    },
    null,
    2,
  );
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
  history,
  async frame(id: string, time: number, casts = 1) {
    paused = true;
    auto = false;
    for (let i = 0; i < 10; i++) step(0.1);
    refill();
    configure(id);
    await view.whenReady();
    await new Promise(requestAnimationFrame);
    step(1);
    for (let i = 0; i < casts - 1; i++) {
      cast();
      step(Math.max(1, effectiveCastInterval(state.run)));
    }
    cast();
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

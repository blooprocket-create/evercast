import type { EnemyState, RunState } from '../model';
import type { SpellMechanics } from '../spell/SpellMechanics';
import { compileSpell } from '../spell/SpellCompiler';

export interface CombatPosition {
  x: number;
  z: number;
}
export interface DotState {
  baseDamage: string;
  damage: string;
  nextTickAt: number;
  expiresAt: number;
  castId: number;
  sourceInstanceId: number;
  mechanics: SpellMechanics;
}
export interface EnemyStatuses {
  dot?: DotState;
  weakness?: { stacks: number; strength: number; expiresAt: number };
  ruin?: { amplification: number; expiresAt: number };
}
export interface PendingMeteor {
  id: number;
  dueAt: number;
  position: CombatPosition;
  targetId: number;
  castId: number;
  damage: string;
  mechanics: SpellMechanics;
  infect: boolean;
}
export interface SpellCombatState {
  procSerial: number;
  meteors: PendingMeteor[];
  momentum: number;
  momentumUntil: number;
  overdriveUntil: number;
  focus: number;
  supercharge: number;
  superchargeTargetId: number | null;
  velocityStored: string;
  velocityReady: boolean;
  nextCastHaste: boolean;
}
export function createSpellCombatState(): SpellCombatState {
  return {
    procSerial: 0,
    meteors: [],
    momentum: 0,
    momentumUntil: 0,
    overdriveUntil: 0,
    focus: 0,
    supercharge: 0,
    superchargeTargetId: null,
    velocityStored: '0',
    velocityReady: false,
    nextCastHaste: false,
  };
}
export function combatState(run: RunState): SpellCombatState {
  return (run.combatState ??= createSpellCombatState());
}
export function clearSpellCombat(run: RunState): void {
  run.combatState = createSpellCombatState();
  for (const enemy of run.enemies) enemy.statuses = {};
}
export function formationSlot(index: number): CombatPosition {
  const row = Math.floor(index / 3);
  return { x: 2.4 + (index % 3) * 1.2 + row * 0.48, z: (row - 0.5) * 1.25 };
}
export function ensurePositions(run: RunState): void {
  for (const enemy of run.enemies)
    if (!enemy.position) {
      let i = 0;
      while (run.enemies.some((e) => e.position && distanceSquared(e.position, formationSlot(i)) < 0.001))
        i++;
      enemy.position = formationSlot(i);
    }
}
export function positionOf(enemy: EnemyState): CombatPosition {
  return enemy.position ?? formationSlot(0);
}
export function distanceSquared(a: CombatPosition, b: CombatPosition): number {
  return (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
}
export function nearby(
  run: RunState,
  position: CombatPosition,
  radius: number,
  exclude = new Set<number>(),
): EnemyState[] {
  return run.enemies
    .filter(
      (e) =>
        e.hp.cmp(0) > 0 &&
        !exclude.has(e.instanceId) &&
        distanceSquared(position, positionOf(e)) <= radius ** 2,
    )
    .sort(
      (a, b) =>
        distanceSquared(position, positionOf(a)) - distanceSquared(position, positionOf(b)) ||
        a.instanceId - b.instanceId,
    );
}
export function effectiveCastInterval(run: RunState): number {
  const spell = compileSpell(run.spell),
    m = spell.mechanics,
    s = run.combatState;
  if (!m || !s) return spell.castInterval;
  const speed =
    s.overdriveUntil > run.elapsedSeconds
      ? m.overdriveSpeed
      : 1 + (s.momentumUntil > run.elapsedSeconds ? s.momentum * m.momentumSpeed : 0);
  return Math.max(0.01, (spell.castInterval / speed) * (s.nextCastHaste ? 0.5 : 1));
}

import type { GameEvent } from '../events/GameEvent';
import type { GameState } from '../model';
import { big } from '../numbers';
import { createDefaultSpellBuild } from '../spell/SpellCompiler';
import type { SpellBuild, SpellModifier } from '../spell/types';
import {
  SPELL_POINT_BASE_COST,
  SPELL_POINT_COST_GROWTH,
  SPELL_TREE_NODE_BY_ID,
  SPELL_TREE_NODES,
  SPELL_TREE_ROOT_ID,
  SPELL_TREE_STARTER_POINTS,
  spellPointCost,
} from './SpellTreeCatalog';
import type { SpellTreeState } from './types';
import { SPELL_MECHANIC_DEFAULTS } from '../../content/spellTreeTuning';
import { SPELL_TREE_EXCLUSIVE_GROUPS } from '../../content/spellTree';
import { clearSpellCombat } from '../combat/SpellCombatState';

export const MAX_SPELL_TREE_POINTS = SPELL_TREE_NODES.filter((node) => node.id !== SPELL_TREE_ROOT_ID).length;

export function createInitialSpellTreeState(): SpellTreeState {
  return {
    purchasedPoints: 0,
    activatedNodeIds: [],
  };
}

export function totalSpellPoints(state: SpellTreeState): number {
  return SPELL_TREE_STARTER_POINTS + Math.max(0, Math.floor(state.purchasedPoints));
}

export function spentSpellPoints(state: SpellTreeState): number {
  return state.activatedNodeIds.length;
}

export function unspentSpellPoints(state: SpellTreeState): number {
  return Math.max(0, totalSpellPoints(state) - spentSpellPoints(state));
}

export function isSpellNodeActive(state: SpellTreeState, nodeId: string): boolean {
  return nodeId === SPELL_TREE_ROOT_ID || state.activatedNodeIds.includes(nodeId);
}

export function canActivateSpellNode(state: SpellTreeState, nodeId: string): boolean {
  return spellNodeStatus(state, nodeId) === 'available';
}

export type SpellNodeStatus = 'active' | 'available' | 'exclusive' | 'requirements' | 'points' | 'unknown';
export function spellNodeStatus(state: SpellTreeState, nodeId: string): SpellNodeStatus {
  const node = SPELL_TREE_NODE_BY_ID.get(nodeId);
  if (!node) return 'unknown';
  if (isSpellNodeActive(state, nodeId)) return 'active';
  // A locked ancestor locks its entire route, even if its direct group is still empty.
  const locked = (id: string, visited = new Set<string>()): boolean => {
    if (visited.has(id)) return false;
    visited.add(id);
    const n = SPELL_TREE_NODE_BY_ID.get(id);
    if (!n || isSpellNodeActive(state, id)) return false;
    const group = SPELL_TREE_EXCLUSIVE_GROUPS.find((g) => g.id === n.exclusiveGroup);
    if (
      group &&
      state.activatedNodeIds.filter((a) => SPELL_TREE_NODE_BY_ID.get(a)?.exclusiveGroup === group.id)
        .length >= group.maxSelections
    )
      return true;
    return n.requiresAll.some((parent) => locked(parent, visited));
  };
  if (locked(nodeId)) return 'exclusive';
  if (!node.requiresAll.every((id) => isSpellNodeActive(state, id))) return 'requirements';
  return unspentSpellPoints(state) > 0 ? 'available' : 'points';
}

export function modifiersForSpellTree(state: SpellTreeState): SpellModifier[] {
  const modifiers: SpellModifier[] = [];
  for (const nodeId of state.activatedNodeIds) {
    const node = SPELL_TREE_NODE_BY_ID.get(nodeId);
    if (!node) continue;
    modifiers.push(...node.modifiers);
  }
  return modifiers;
}

export function buildSpellFromTree(state: SpellTreeState): SpellBuild {
  const build = createDefaultSpellBuild();
  build.modifiers = modifiersForSpellTree(state);
  build.mechanics = { ...SPELL_MECHANIC_DEFAULTS };
  for (const id of state.activatedNodeIds)
    for (const effect of SPELL_TREE_NODE_BY_ID.get(id)?.mechanics ?? []) {
      const target = build.mechanics as unknown as Record<string, string | number | boolean>;
      target[effect.key] =
        effect.operation === 'add' ? Number(target[effect.key]) + Number(effect.value) : effect.value;
    }
  return build;
}

export class SpellTreeSystem {
  constructor(private readonly emit: (event: GameEvent) => void) {}

  buyPoint(state: GameState): boolean {
    if (totalSpellPoints(state.spellTree) >= MAX_SPELL_TREE_POINTS) return false;
    const cost = big(spellPointCost(state.spellTree.purchasedPoints));
    if (state.run.essence.cmp(cost) < 0) return false;
    state.run.essence = state.run.essence.sub(cost);
    state.spellTree.purchasedPoints += 1;
    this.emit({
      type: 'spell_point_purchased',
      time: state.run.elapsedSeconds,
      purchasedPoints: state.spellTree.purchasedPoints,
      cost: cost.toString(),
    });
    return true;
  }

  activateNode(state: GameState, nodeId: string): boolean {
    if (!canActivateSpellNode(state.spellTree, nodeId)) return false;
    const node = SPELL_TREE_NODE_BY_ID.get(nodeId);
    if (!node) return false;
    state.spellTree.activatedNodeIds.push(nodeId);
    state.run.spell = buildSpellFromTree(state.spellTree);
    this.emit({
      type: 'spell_node_activated',
      time: state.run.elapsedSeconds,
      nodeId,
      nodeName: node.name,
    });
    return true;
  }

  respec(state: GameState): boolean {
    if (state.spellTree.activatedNodeIds.length === 0) return false;
    const refundedPoints = state.spellTree.activatedNodeIds.length;
    clearSpellCombat(state.run);
    state.spellTree.activatedNodeIds = [];
    state.run.spell = buildSpellFromTree(state.spellTree);
    this.emit({
      type: 'spell_tree_respecced',
      time: state.run.elapsedSeconds,
      refundedPoints,
    });
    return true;
  }

  syncSpell(state: GameState): void {
    state.run.spell = buildSpellFromTree(state.spellTree);
  }
}

export const SPELL_POINT_TUNING = {
  starterPoints: SPELL_TREE_STARTER_POINTS,
  baseCost: SPELL_POINT_BASE_COST,
  growth: SPELL_POINT_COST_GROWTH,
} as const;

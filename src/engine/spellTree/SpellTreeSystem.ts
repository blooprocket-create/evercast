import type { GameEvent } from '../events/GameEvent';
import type { GameState } from '../model';
import { big } from '../numbers';
import { createDefaultSpellBuild } from '../spell/SpellCompiler';
import type { SpellBuild, SpellModifier } from '../spell/types';
import {
  SPELL_POINT_BASE_COST,
  SPELL_POINT_COST_GROWTH,
  SPELL_TREE_NODE_BY_ID,
  SPELL_TREE_ROOT_ID,
  SPELL_TREE_STARTER_POINTS,
  spellPointCost,
} from './SpellTreeCatalog';
import type { SpellTreeState } from './types';

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
  if (nodeId === SPELL_TREE_ROOT_ID || state.activatedNodeIds.includes(nodeId)) return false;
  if (unspentSpellPoints(state) <= 0) return false;
  const node = SPELL_TREE_NODE_BY_ID.get(nodeId);
  if (!node) return false;
  return node.requires.some((requiredId) => isSpellNodeActive(state, requiredId));
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
  return build;
}

export class SpellTreeSystem {
  constructor(private readonly emit: (event: GameEvent) => void) {}

  buyPoint(state: GameState): boolean {
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

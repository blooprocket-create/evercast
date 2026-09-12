import type { GameEvent } from '../events/GameEvent';
import type { GameState } from '../model';
import { big } from '../numbers';
import { createDefaultSpellBuild } from '../spell/SpellCompiler';
import type { SpellBuild, SpellModifier } from '../spell/types';
import type { SpellMechanics } from '../spell/SpellMechanics';
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
import {
  SPELL_ATTUNEMENTS,
  SPELL_ATTUNEMENT_BY_ID,
  spellTreeExclusiveGroups,
} from '../../content/spellTree';
import { clearSpellCombat } from '../combat/SpellCombatState';

/** Every non-root node, which is the most points the graph could ever absorb. */
export const SPELL_TREE_NODE_COUNT = SPELL_TREE_NODES.filter(
  (node) => node.id !== SPELL_TREE_ROOT_ID,
).length;

export function createInitialSpellTreeState(): SpellTreeState {
  return {
    purchasedPoints: 0,
    activatedNodeIds: [],
    attunements: [],
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

export function hasAttunement(state: SpellTreeState, attunementId: string): boolean {
  return state.attunements.includes(attunementId);
}

/**
 * The largest legal build the current unlocks allow, which is the real purchase
 * ceiling. The old one was the raw node count, so the tree sold points that the
 * exclusive groups guaranteed could never be spent.
 *
 * Derived rather than authored: take every node the rules currently allow, in
 * authored order, until nothing more can be taken. Routes and identities hold
 * equal numbers of nodes, so the first legal maximal build is a maximum one;
 * counting subtrees instead would be wrong, because fusions have two parents
 * and the graph is not a tree.
 */
const allocatableCache = new Map<string, number>();
export function maxAllocatableSpellPoints(attunements: readonly string[] = []): number {
  const key = [...attunements].sort().join(',');
  const cached = allocatableCache.get(key);
  if (cached !== undefined) return cached;

  const probe: SpellTreeState = {
    // Enough points that the budget never decides the answer; the rules do.
    purchasedPoints: SPELL_TREE_NODE_COUNT,
    activatedNodeIds: [],
    attunements: [...attunements],
  };
  for (let progressed = true; progressed; ) {
    progressed = false;
    for (const node of SPELL_TREE_NODES) {
      if (node.id === SPELL_TREE_ROOT_ID || probe.activatedNodeIds.includes(node.id)) continue;
      if (spellNodeStatus(probe, node.id) !== 'available') continue;
      probe.activatedNodeIds.push(node.id);
      progressed = true;
    }
  }

  allocatableCache.set(key, probe.activatedNodeIds.length);
  return probe.activatedNodeIds.length;
}

export function canActivateSpellNode(state: SpellTreeState, nodeId: string): boolean {
  return spellNodeStatus(state, nodeId) === 'available';
}

export type SpellNodeStatus = 'active' | 'available' | 'exclusive' | 'requirements' | 'points' | 'unknown';

/**
 * `exclusive` still means what it did: a full group is standing in the way, and
 * a respec can always swap which member of that group you hold. What it cannot
 * do is let you hold *both*, which is what an Attunement buys - see
 * `blockingAttunement`, which the inspector uses to name the unlock.
 */
export function spellNodeStatus(state: SpellTreeState, nodeId: string): SpellNodeStatus {
  const node = SPELL_TREE_NODE_BY_ID.get(nodeId);
  if (!node) return 'unknown';
  if (isSpellNodeActive(state, nodeId)) return 'active';

  const groups = spellTreeExclusiveGroups(state.attunements);
  // A locked ancestor locks its entire route, even if its direct group is still empty.
  const locked = (id: string, visited = new Set<string>()): boolean => {
    if (visited.has(id)) return false;
    visited.add(id);
    const n = SPELL_TREE_NODE_BY_ID.get(id);
    if (!n || isSpellNodeActive(state, id)) return false;
    const group = groups.find((g) => g.id === n.exclusiveGroup);
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

/**
 * The attunement that would let this node be held *alongside* whatever is
 * currently blocking it, rather than instead of it. Null when a respec is the
 * whole answer.
 */
export function blockingAttunement(state: SpellTreeState, nodeId: string): string | null {
  if (spellNodeStatus(state, nodeId) !== 'exclusive') return null;
  for (const attunement of SPELL_ATTUNEMENTS) {
    if (hasAttunement(state, attunement.id)) continue;
    const widened: SpellTreeState = {
      ...state,
      attunements: [...state.attunements, ...attunement.requires, attunement.id],
    };
    if (spellNodeStatus(widened, nodeId) !== 'exclusive') return attunement.id;
  }
  return null;
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
  build.mechanics.route = dominantRoute(build.mechanics);
  return build;
}

/**
 * One name for a build that may hold several routes. Combat reads the flags;
 * this is for descriptions and VFX, which need something to call it. Heaviest
 * shape wins, so a blend is announced by the part that changes the cast most.
 */
export function dominantRoute(mechanics: SpellMechanics): SpellMechanics['route'] {
  if (mechanics.chargedCast) return 'charged';
  if (mechanics.piercingCast) return 'piercing';
  if (mechanics.twinCast) return 'twin';
  return 'base';
}

export class SpellTreeSystem {
  constructor(private readonly emit: (event: GameEvent) => void) {}

  buyPoint(state: GameState): boolean {
    if (totalSpellPoints(state.spellTree) >= maxAllocatableSpellPoints(state.spellTree.attunements))
      return false;
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

  /**
   * Knowledge's first sink. Attunements are not allocations: respec never
   * refunds them, and they survive Rebirth with the rest of the tree state.
   */
  buyAttunement(state: GameState, attunementId: string): boolean {
    const attunement = SPELL_ATTUNEMENT_BY_ID.get(attunementId);
    if (!attunement) return false;
    if (hasAttunement(state.spellTree, attunementId)) return false;
    if (!attunement.requires.every((id) => hasAttunement(state.spellTree, id))) return false;
    const cost = big(attunement.cost);
    if (state.meta.knowledge.cmp(cost) < 0) return false;
    state.meta.knowledge = state.meta.knowledge.sub(cost);
    state.spellTree.attunements.push(attunementId);
    this.emit({
      type: 'attunement_purchased',
      time: state.run.elapsedSeconds,
      attunementId,
      attunementName: attunement.name,
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

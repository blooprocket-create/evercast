import { SPELL_TREE_EXCLUSIVE_GROUPS, SPELL_TREE_NODES, SPELL_TREE_ROOT_ID } from '../../content/spellTree';
import type { SpellTreeNodeDefinition } from '../../engine/spellTree/types';
import { type SpellNodeStatus, unspentSpellPoints } from '../../engine/spellTree/SpellTreeSystem';
import type { SpellTreeState } from '../../engine/spellTree/types';

/**
 * The engine's `spellNodeStatus` answers one node at a time and walks its
 * ancestors to do it, which the old view paid for ~226 times per render. Since
 * lockout propagates strictly downward, one pass in prerequisite order answers
 * every node at once.
 *
 * `spellNodeStatus` stays authoritative — it gates the real command. This is a
 * read model, and `spellNodeStatuses.test.ts` asserts the two agree on every
 * node in every state it can reach.
 */

const NODE_BY_ID = new Map(SPELL_TREE_NODES.map((node) => [node.id, node]));

/** Prerequisites before dependents, computed once. */
const TOPOLOGICAL: readonly SpellTreeNodeDefinition[] = (() => {
  const remaining = new Map(SPELL_TREE_NODES.map((node) => [node.id, node.requiresAll.length]));
  const dependents = new Map<string, string[]>();
  for (const node of SPELL_TREE_NODES) {
    for (const parent of node.requiresAll) {
      const list = dependents.get(parent);
      if (list) list.push(node.id);
      else dependents.set(parent, [node.id]);
    }
  }

  const order: SpellTreeNodeDefinition[] = [];
  const queue = SPELL_TREE_NODES.filter((node) => node.requiresAll.length === 0).map((n) => n.id);
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const node = NODE_BY_ID.get(queue[cursor]);
    if (node) order.push(node);
    for (const child of dependents.get(queue[cursor]) ?? []) {
      const left = (remaining.get(child) ?? 0) - 1;
      remaining.set(child, left);
      if (left === 0) queue.push(child);
    }
  }

  if (order.length !== SPELL_TREE_NODES.length) {
    throw new Error('Spell tree has a prerequisite cycle.');
  }
  return order;
})();

const GROUP_BY_ID = new Map(SPELL_TREE_EXCLUSIVE_GROUPS.map((group) => [group.id, group]));

export function spellNodeStatuses(state: SpellTreeState): ReadonlyMap<string, SpellNodeStatus> {
  const activated = new Set(state.activatedNodeIds);
  const isActive = (id: string) => id === SPELL_TREE_ROOT_ID || activated.has(id);

  const groupUsage = new Map<string, number>();
  for (const id of state.activatedNodeIds) {
    const group = NODE_BY_ID.get(id)?.exclusiveGroup;
    if (group) groupUsage.set(group, (groupUsage.get(group) ?? 0) + 1);
  }
  const groupIsFull = (node: SpellTreeNodeDefinition): boolean => {
    if (!node.exclusiveGroup) return false;
    const group = GROUP_BY_ID.get(node.exclusiveGroup);
    return group !== undefined && (groupUsage.get(group.id) ?? 0) >= group.maxSelections;
  };

  const unspent = unspentSpellPoints(state);
  const locked = new Map<string, boolean>();
  const statuses = new Map<string, SpellNodeStatus>();

  for (const node of TOPOLOGICAL) {
    const active = isActive(node.id);
    // A locked ancestor locks the whole route, even where the group below is empty.
    const isLocked =
      !active && (groupIsFull(node) || node.requiresAll.some((id) => locked.get(id) === true));
    locked.set(node.id, isLocked);

    statuses.set(
      node.id,
      active
        ? 'active'
        : isLocked
          ? 'exclusive'
          : !node.requiresAll.every(isActive)
            ? 'requirements'
            : unspent > 0
              ? 'available'
              : 'points',
    );
  }

  return statuses;
}

/**
 * Value-stable key for memoizing the map above. `activeSpellNodeIds` is a fresh
 * array on every snapshot build, so keying on it by identity never hits — which
 * is the exact failure this rewrite exists to remove.
 */
export function spellTreeStateKey(state: SpellTreeState): string {
  return `${state.purchasedPoints}:${state.activatedNodeIds.join(',')}`;
}

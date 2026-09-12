import type { SpellModifier } from '../spell/types';
import type { MechanicUpgrade } from '../spell/SpellMechanics';

export type SpellTreeRegion = 'core' | 'twin' | 'piercing' | 'charged';

export type SpellTreeNodeKind =
  | 'root'
  | 'route'
  | 'identity'
  | 'minor'
  | 'mutation'
  | 'fusion'
  | 'apex';

export interface SpellTreeNodeDefinition {
  id: string;
  name: string;
  description: string;
  region: SpellTreeRegion;
  kind: SpellTreeNodeKind;
  requiresAll: string[];
  exclusiveGroup?: string;
  mechanics?: MechanicUpgrade[];
  modifiers: SpellModifier[];
}

export interface SpellTreeState {
  purchasedPoints: number;
  activatedNodeIds: string[];
  /**
   * Permanent rule unlocks bought with Knowledge. They live here rather than in
   * `MetaState` because every reader of the tree's rules already takes a
   * `SpellTreeState` and nothing else, and because `SaveCodec` has to know them
   * before it can validate allocations. Like the rest of this state they sit
   * outside `RunState`, so they survive Rebirth for free.
   */
  attunements: string[];
}

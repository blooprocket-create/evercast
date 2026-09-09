import type { SpellModifier } from '../spell/types';
import type { MechanicUpgrade } from '../spell/SpellMechanics';

export type SpellTreeRegion = 'core' | 'twin' | 'piercing' | 'charged';

export type SpellTreeNodeKind = 'root' | 'route' | 'identity' | 'minor' | 'mutation' | 'fusion';

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
}

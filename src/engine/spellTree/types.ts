import type { SpellModifier } from '../spell/types';

export type SpellTreeRegion =
  | 'core'
  | 'power'
  | 'speed'
  | 'projectile'
  | 'crit'
  | 'arcane'
  | 'fire'
  | 'frost'
  | 'storm'
  | 'blood';

export type SpellTreeNodeKind = 'root' | 'minor' | 'notable' | 'mutation';

export interface SpellTreeNodeDefinition {
  id: string;
  name: string;
  description: string;
  region: SpellTreeRegion;
  kind: SpellTreeNodeKind;
  x: number;
  y: number;
  requires: string[];
  modifiers: SpellModifier[];
}

export interface SpellTreeState {
  purchasedPoints: number;
  activatedNodeIds: string[];
}

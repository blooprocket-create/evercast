import Decimal from 'break_eternity.js';

export type GearSlot =
  | 'helm'
  | 'staff'
  | 'spellbook'
  | 'robe'
  | 'boots'
  | 'necklace'
  | 'ringLeft'
  | 'ringRight';

export interface GearPieceState {
  slot: GearSlot;
  level: number;
  treeNodes: string[];
}

export interface EquipmentState {
  gold: Decimal;
  pieces: Record<GearSlot, GearPieceState>;
}

export type GearPrimaryStat = 'baseDamage' | 'maxHp';

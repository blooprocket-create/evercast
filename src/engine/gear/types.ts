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

export interface GearDefinition {
  slot: GearSlot;
  /**
   * What the slot is called, as opposed to what is currently in it. The
   * interface needs this to tell two identically named pieces apart - both
   * rings reach "Evercast Signet" - and the event log needs it so a level-up
   * does not report the field name, "ringLeft".
   */
  slotLabel: string;
  baseName: string;
  description: string;
  primaryStat: GearPrimaryStat;
  primaryStatLabel: string;
  statPerLevel: number;
  baseLevelCost: number;
  costGrowth: number;
  evolutionNames: readonly [string, string, string, string, string, string];
}

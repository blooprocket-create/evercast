/** Compiled behavior, independent of authored node IDs and UI layout. */
export interface SpellMechanics {
  /**
   * The dominant shape, derived from the flags below. Presentation and
   * descriptions read it; combat never does, because a blended build has more
   * than one shape and a single string cannot say so.
   */
  route: 'base' | 'twin' | 'piercing' | 'charged';
  /**
   * The three routes, held independently. They compose because they act on
   * different axes: Twin is how many projectiles, Piercing is how many targets
   * each one reaches, Charged is how hard and how slow. The Schism attunement
   * is what lets more than one be true at once.
   */
  twinCast: boolean;
  piercingCast: boolean;
  chargedCast: boolean;
  /** Base damage multiplier per route held *beyond the first*. 1 disables it. */
  routeBlendScale: number;
  explosive: boolean;
  meteor: boolean;
  dot: boolean;
  contagion: boolean;
  weakness: boolean;
  ruin: boolean;
  chain: boolean;
  driving: boolean;
  kinetic: boolean;
  momentum: boolean;
  overdrive: boolean;
  perfect: boolean;
  supercharge: boolean;
  execution: boolean;
  finalBlow: boolean;
  plaguefall: boolean;
  doomfall: boolean;
  blight: boolean;
  terminalVoltage: boolean;
  stormdrive: boolean;
  terminalVelocity: boolean;
  criticalOverload: boolean;
  deathSentence: boolean;
  obliteration: boolean;
  /** Apex capstones. Each needs all three fusions of its route. */
  pandemic: boolean;
  singularity: boolean;
  ascendance: boolean;
  blastRadius: number;
  explosionDamage: number;
  meteorChance: number;
  meteorDelay: number;
  meteorDamage: number;
  dotDamage: number;
  dotDuration: number;
  dotInterval: number;
  contagionChance: number;
  contagionRadius: number;
  weaknessStrength: number;
  weaknessDuration: number;
  weaknessCap: number;
  ruinChance: number;
  ruinDuration: number;
  ruinAmplification: number;
  penetrations: number;
  lineTolerance: number;
  chainRadius: number;
  piercedDamage: number;
  forceGain: number;
  forceCap: number;
  momentumCap: number;
  momentumSpeed: number;
  momentumDuration: number;
  overdriveSpeed: number;
  overdriveDuration: number;
  chargedDamage: number;
  chargedInterval: number;
  focusMax: number;
  superchargeCap: number;
  superchargeGain: number;
  executeThreshold: number;
  executeDamage: number;
  finalBlowPower: number;
  finalBlowExponent: number;
  finalBlowLowBonus: number;
  doomfallMultiplier: number;
  blightStrength: number;
  overloadCritGain: number;
  woundedThreshold: number;
  criticalThreshold: number;
  /** How many uninfected neighbours one Contagion tick can take under Pandemic. */
  pandemicTargets: number;
  singularityRadius: number;
  singularityDamage: number;
  /** Critical multiplier added per point of held Focus under Ascendance. */
  ascendanceCritGain: number;
}
export type MechanicUpgrade = {
  [K in keyof SpellMechanics]: { key: K; value: SpellMechanics[K]; operation?: 'add' | 'set' };
}[keyof SpellMechanics];

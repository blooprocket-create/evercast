import type { SpellTreeNodeDefinition, SpellTreeRegion } from '../engine/spellTree/types';
import type { MechanicUpgrade, SpellMechanics } from '../engine/spell/SpellMechanics';
import { SPELL_SIDE_TUNING as S } from './spellTreeTuning';

export const SPELL_TREE_ROOT_ID = 'evercast_root';
export const SPELL_TREE_STARTER_POINTS = 1;
export const SPELL_POINT_BASE_COST = 8;
export const SPELL_POINT_COST_GROWTH = 1.27;
/** Ranks per optional side path. Each rank repeats its `SPELL_SIDE_TUNING` bonus. */
export const SPELL_SIDE_RANKS = 3;
const RANK_NUMERALS = ['I', 'II', 'III'] as const;
export function spellPointCost(purchasedPoints: number): number {
  return Math.max(
    1,
    Math.floor(
      SPELL_POINT_BASE_COST * Math.pow(SPELL_POINT_COST_GROWTH, Math.max(0, Math.floor(purchasedPoints))),
    ),
  );
}
/**
 * Permanent rule unlocks bought with Knowledge. They do not add nodes; they
 * raise the `maxSelections` of the groups below, which is what actually decides
 * how much of the authored graph a single build can reach. Costs are playtest
 * figures, sized against `RebirthSystem.previewKnowledgeGain`.
 */
export interface SpellAttunementDefinition {
  id: string;
  name: string;
  description: string;
  /** Knowledge. */
  cost: number;
  requires: readonly string[];
}

export const SPELL_ATTUNEMENTS: readonly SpellAttunementDefinition[] = [
  {
    id: 'third_identity',
    name: 'Broadened Study',
    description:
      'Take all three identities of a route instead of two. Opens the third subtree and the two fusions that needed it.',
    cost: 1,
    requires: [],
  },
  {
    id: 'second_route',
    name: 'Schism',
    description:
      'The Evercast holds a second shape. Awaken two routes at once; their projectile count, penetration and charge compound.',
    cost: 6,
    requires: [],
  },
  {
    id: 'third_route',
    name: 'Confluence',
    description: 'Hold all three shapes of the Evercast at once.',
    cost: 25,
    requires: ['second_route'],
  },
];

export const SPELL_ATTUNEMENT_BY_ID = new Map(SPELL_ATTUNEMENTS.map((a) => [a.id, a]));

export interface SpellTreeExclusiveGroup {
  id: string;
  maxSelections: number;
  name: string;
}

/**
 * The route fork and the identity forks, widened by whatever the player has
 * attuned. This is a function rather than a constant because the unlocks move
 * `maxSelections` — the whole point of the expansion is that exclusivity is
 * progression, not a fixed rule.
 */
export function spellTreeExclusiveGroups(
  attunements: readonly string[] = [],
): SpellTreeExclusiveGroup[] {
  const has = (id: string) => attunements.includes(id);
  const routes = has('third_route') ? 3 : has('second_route') ? 2 : 1;
  const identities = has('third_identity') ? 3 : 2;
  return [
    { id: 'root_route', maxSelections: routes, name: 'Evercast route' },
    ...(['twin', 'piercing', 'charged'] as const).flatMap((route) => [
      {
        id: `${route}_identity`,
        maxSelections: identities,
        name: `${route} identities`,
      },
      // No attunement widens this one. A route ends in one capstone or the
      // other, so the spell keeps an identity even with everything unlocked.
      { id: `${route}_apex`, maxSelections: 1, name: `${route} apex` },
    ]),
  ];
}
const set = <K extends keyof SpellMechanics>(key: K, value: SpellMechanics[K]) =>
  ({ key, value, operation: 'set' }) as MechanicUpgrade;
type BooleanKey = {
  [K in keyof SpellMechanics]: SpellMechanics[K] extends boolean ? K : never;
}[keyof SpellMechanics];
const enable = (key: BooleanKey) => set(key, true);
const nodes: SpellTreeNodeDefinition[] = [];
function node(
  id: string,
  name: string,
  region: SpellTreeRegion,
  kind: SpellTreeNodeDefinition['kind'],
  requiresAll: string[],
  description: string,
  mechanics: MechanicUpgrade[] = [],
  group?: string,
) {
  nodes.push({
    id,
    name,
    region,
    kind,
    requiresAll,
    description,
    mechanics,
    modifiers: [],
    exclusiveGroup: group,
  });
}
node(
  SPELL_TREE_ROOT_ID,
  'Evercast',
  'core',
  'root',
  [],
  'One spell. One magical projectile. Every path evolves it.',
);
node(
  'twin_cast',
  'Twin Cast',
  'twin',
  'route',
  [SPELL_TREE_ROOT_ID],
  'Two independent projectiles. They target different enemies when possible, or both strike one enemy.',
  [enable('twinCast')],
  'root_route',
);
node(
  'piercing_cast',
  'Piercing Cast',
  'piercing',
  'route',
  [SPELL_TREE_ROOT_ID],
  'One projectile penetrates an enemy directly behind its victim. With no continuation, the next cast interval is halved.',
  [enable('piercingCast')],
  'root_route',
);
node(
  'charged_cast',
  'Charged Cast',
  'charged',
  'route',
  [SPELL_TREE_ROOT_ID],
  'One slower, much heavier projectile. Playtest: ×3 damage, ×1.7 cast interval.',
  [enable('chargedCast')],
  'root_route',
);
type Side = { id: string; name: string; key: Exclude<keyof typeof S, 'criticalMassChance'> };
function identity(
  route: Exclude<SpellTreeRegion, 'core'>,
  id: string,
  name: string,
  description: string,
  effects: MechanicUpgrade[],
  sides: Side[],
  mutation: string,
  mutationName: string,
  mutationDescription: string,
  flag: BooleanKey,
) {
  node(id, name, route, 'identity', [`${route}_cast`], description, effects, `${route}_identity`);
  sidePaths(route, id, sides);
  node(mutation, mutationName, route, 'mutation', [id], mutationDescription, [enable(flag)]);
}

/** The optional rank ladder hanging off an identity or an apex. */
function sidePaths(route: Exclude<SpellTreeRegion, 'core'>, parent: string, sides: Side[]) {
  for (const side of sides)
    for (let rank = 1; rank <= SPELL_SIDE_RANKS; rank++) {
      const upgradeId = `${side.id}_${rank}`;
      node(
        upgradeId,
        `${side.name} ${RANK_NUMERALS[rank - 1]}`,
        route,
        'minor',
        [rank === 1 ? parent : `${side.id}_${rank - 1}`],
        `Optional investment: ${side.name}. Playtest bonus ${S[side.key]}.`,
      );
      if (side.key === 'critChance' || side.key === 'critMultiplier')
        nodes.at(-1)!.modifiers = [
          { id: upgradeId, kind: 'stat', stat: side.key, operation: 'add', value: S[side.key] },
        ];
      else
        nodes.at(-1)!.mechanics = [
          { key: side.key, value: S[side.key], operation: 'add' } as MechanicUpgrade,
        ];
    }
}
identity(
  'twin',
  'explosive',
  'Explosive',
  'Every projectile retains its direct hit and independently creates a separate area-damage proc.',
  [enable('explosive')],
  [
    { id: 'blast_radius', name: 'Blast Radius', key: 'blastRadius' },
    { id: 'explosion_damage', name: 'Explosion Damage', key: 'explosionDamage' },
  ],
  'meteor_shower',
  'Meteor Shower',
  'Each projectile hit independently has a 15% chance to call a delayed AoE meteor. Multiple meteors can be pending.',
  'meteor',
);
identity(
  'twin',
  'damage_over_time',
  'DoT',
  'Projectile hits apply a refreshing damage-over-time infection.',
  [enable('dot')],
  [
    { id: 'dot_damage', name: 'DoT Damage', key: 'dotDamage' },
    { id: 'dot_duration', name: 'DoT Duration', key: 'dotDuration' },
  ],
  'contagion',
  'Contagion',
  'Each DoT tick has a 15% chance to spread to a nearby enemy. Spread infections can spread again.',
  'contagion',
);
identity(
  'twin',
  'debuff',
  'Debuff',
  'Hits apply Weakness, reducing outgoing enemy damage. Maximum two stacks; both Twin hits can apply a stack.',
  [enable('weakness')],
  [
    { id: 'weakness_strength', name: 'Weakness Strength', key: 'weaknessStrength' },
    { id: 'weakness_duration', name: 'Weakness Duration', key: 'weaknessDuration' },
  ],
  'ruin',
  'Ruin',
  'Each projectile hit has a 15% chance to temporarily amplify incoming damage while retaining Weakness.',
  'ruin',
);
identity(
  'piercing',
  'deep_pierce',
  'Deep Pierce',
  'Penetrate an additional enemy, still requiring a straight line behind the target.',
  [{ key: 'penetrations', value: 1, operation: 'add' }],
  [
    { id: 'penetration', name: 'Penetration', key: 'penetrations' },
    { id: 'pierced_damage', name: 'Pierced Damage', key: 'piercedDamage' },
  ],
  'chain_lightning',
  'Chain Lightning',
  'Mutates penetration into nearby sequential chain hops. Replaces strict line piercing instead of adding a separate proc.',
  'chain',
);
identity(
  'piercing',
  'driving_force',
  'Driving Force',
  'Each successful penetration increases damage to the next target, up to a tunable limit.',
  [enable('driving')],
  [
    { id: 'force_gain', name: 'Force Gain', key: 'forceGain' },
    { id: 'impact_scaling', name: 'Impact Scaling', key: 'forceCap' },
  ],
  'kinetic_collapse',
  'Kinetic Collapse',
  'Intermediate penetrations stay near normal; accumulated force is delivered to the final target.',
  'kinetic',
);
identity(
  'piercing',
  'momentum',
  'Momentum',
  'Successful line penetrations build up to five temporary cast-speed stacks.',
  [enable('momentum')],
  [
    { id: 'momentum_gain', name: 'Momentum Gain', key: 'momentumSpeed' },
    { id: 'momentum_duration', name: 'Momentum Duration', key: 'momentumDuration' },
  ],
  'overdrive',
  'Overdrive',
  'At five Momentum stacks, enter a short burst of much faster casting. Momentum resets when it ends.',
  'overdrive',
);
identity(
  'charged',
  'critical_mass',
  'Critical Mass',
  'Increase the chance of heavy critical hits.',
  [],
  [
    { id: 'crit_chance', name: 'Crit Chance', key: 'critChance' },
    { id: 'crit_damage', name: 'Crit Damage', key: 'critMultiplier' },
  ],
  'perfect_strike',
  'Perfect Strike',
  'Non-critical casts build Focus. At maximum Focus, the next cast is guaranteed critical and consumes Focus.',
  'perfect',
);
nodes.find((n) => n.id === 'critical_mass')!.modifiers = [
  {
    id: 'critical_mass_chance',
    kind: 'stat',
    stat: 'critChance',
    operation: 'add',
    value: S.criticalMassChance,
  },
];
identity(
  'charged',
  'overcharge',
  'Overcharge',
  'Increase heavy-cast damage. Optional upgrades further improve charge damage and speed.',
  [{ key: 'chargedDamage', value: S.chargedDamage, operation: 'add' }],
  [
    { id: 'charge_damage', name: 'Charge Damage', key: 'chargedDamage' },
    { id: 'charge_speed', name: 'Charge Speed', key: 'chargedInterval' },
  ],
  'supercharge',
  'Supercharge',
  'Casts at the same target build stacks that enlarge and strengthen the next projectile. Switching targets resets stacks.',
  'supercharge',
);
identity(
  'charged',
  'execution',
  'Execution',
  'Deal increased damage to weakened targets.',
  [enable('execution')],
  [
    { id: 'execute_damage', name: 'Execute Damage', key: 'executeDamage' },
    { id: 'execute_threshold', name: 'Execute Threshold', key: 'executeThreshold' },
  ],
  'final_blow',
  'Final Blow',
  'Damage rises along a missing-health curve, ramping further at very low HP. Never an instant kill.',
  'finalBlow',
);
const fusions: [string, string, SpellTreeRegion, string, string, string, BooleanKey][] = [
  [
    'plaguefall',
    'Plaguefall',
    'twin',
    'meteor_shower',
    'contagion',
    'Contagion calls a meteor onto its newly infected target. That meteor applies DoT to surviving victims.',
    'plaguefall',
  ],
  [
    'doomfall',
    'Doomfall',
    'twin',
    'meteor_shower',
    'ruin',
    'A meteor hitting Ruin consumes it, greatly empowers the explosion, and applies Weakness to its victims.',
    'doomfall',
  ],
  [
    'blight',
    'Blight',
    'twin',
    'contagion',
    'ruin',
    'Contagion spreads Weakness too. Spreading from a Ruined source applies stronger Weakness.',
    'blight',
  ],
  [
    'terminal_voltage',
    'Terminal Voltage',
    'piercing',
    'chain_lightning',
    'kinetic_collapse',
    'Store force across the entire chain and release it into the final target.',
    'terminalVoltage',
  ],
  [
    'stormdrive',
    'Stormdrive',
    'piercing',
    'chain_lightning',
    'overdrive',
    'Every successful chain hop now builds Momentum and can trigger Overdrive.',
    'stormdrive',
  ],
  [
    'terminal_velocity',
    'Terminal Velocity',
    'piercing',
    'kinetic_collapse',
    'overdrive',
    'Casts during Overdrive store force. After Overdrive ends, the next cast releases it into its final target.',
    'terminalVelocity',
  ],
  [
    'critical_overload',
    'Critical Overload',
    'charged',
    'perfect_strike',
    'supercharge',
    'Supercharge also amplifies critical damage. A Perfect Strike consumes all stored Supercharge in one critical hit.',
    'criticalOverload',
  ],
  [
    'death_sentence',
    'Death Sentence',
    'charged',
    'perfect_strike',
    'final_blow',
    'Focus builds faster as the target loses health.',
    'deathSentence',
  ],
  [
    'obliteration',
    'Obliteration',
    'charged',
    'supercharge',
    'final_blow',
    'Supercharge builds more quickly as the same target loses health.',
    'obliteration',
  ],
];
for (const [id, name, route, a, b, description, flag] of fusions)
  node(id, name, route, 'fusion', [a, b], description, [enable(flag)]);

/**
 * One capstone per route, each requiring all three of that route's fusions -
 * so an apex is only reachable once Broadened Study has opened the third
 * identity. They reuse the existing infection, explosion and resource systems
 * rather than introducing new timed work.
 */
const apexes: [
  string,
  string,
  Exclude<SpellTreeRegion, 'core'>,
  [string, string, string],
  string,
  BooleanKey,
  Side[],
][] = [
  [
    'pandemic',
    'Pandemic',
    'twin',
    ['plaguefall', 'doomfall', 'blight'],
    'Contagion stops choosing. Every tick that spreads takes several uninfected neighbours at once, each carrying whatever the infection already carries.',
    'pandemic',
    [
      { id: 'pandemic_reach', name: 'Pandemic Reach', key: 'pandemicTargets' },
      { id: 'contagion_radius', name: 'Contagion Radius', key: 'contagionRadius' },
    ],
  ],
  [
    'singularity',
    'Singularity',
    'piercing',
    ['terminal_voltage', 'stormdrive', 'terminal_velocity'],
    'All that gathered force has to go somewhere. The terminal hit collapses into an explosion scaled by the force it just delivered.',
    'singularity',
    [
      { id: 'singularity_radius', name: 'Collapse Radius', key: 'singularityRadius' },
      { id: 'singularity_damage', name: 'Collapse Damage', key: 'singularityDamage' },
    ],
  ],
  [
    'ascendance',
    'Ascendance',
    'charged',
    ['critical_overload', 'death_sentence', 'obliteration'],
    'The charge never lapses: Supercharge survives a change of target, and held Focus sharpens every critical hit.',
    'ascendance',
    [
      { id: 'ascendance_gain', name: 'Ascendant Focus', key: 'ascendanceCritGain' },
      { id: 'supercharge_cap', name: 'Charge Capacity', key: 'superchargeCap' },
    ],
  ],
  // The second capstone on each route answers a death rather than a hit. One
  // apex per route: these are the alternative to the three above, not an
  // addition to them.
  [
    'necrosis',
    'Necrosis',
    'twin',
    ['plaguefall', 'doomfall', 'blight'],
    'An infected enemy that dies bursts. The remaining infection detonates around the body and takes hold in whatever it catches.',
    'necrosis',
    [
      { id: 'necrosis_radius', name: 'Burst Radius', key: 'necrosisRadius' },
      { id: 'necrosis_damage', name: 'Burst Damage', key: 'necrosisDamage' },
    ],
  ],
  [
    'cascade',
    'Cascade',
    'piercing',
    ['terminal_voltage', 'stormdrive', 'terminal_velocity'],
    'Every kill is a breakthrough. A death builds Momentum and can trigger Overdrive, whatever struck the final blow.',
    'cascade',
    [
      { id: 'cascade_surge', name: 'Breakthrough', key: 'cascadeStacks' },
      { id: 'cascade_hold', name: 'Momentum Ceiling', key: 'momentumCap' },
    ],
  ],
  [
    'reclamation',
    'Reclamation',
    'charged',
    ['critical_overload', 'death_sentence', 'obliteration'],
    'The charge is not spent on a corpse. A kill returns Focus and Supercharge so they carry to the next target.',
    'reclamation',
    [
      { id: 'reclaim_focus', name: 'Reclaimed Focus', key: 'reclaimFocus' },
      { id: 'reclaim_charge', name: 'Reclaimed Charge', key: 'reclaimCharge' },
    ],
  ],
];
for (const [id, name, route, requires, description, flag, sides] of apexes) {
  node(id, name, route, 'apex', [...requires], description, [enable(flag)], `${route}_apex`);
  sidePaths(route, id, sides);
}

export const SPELL_TREE_NODES: readonly SpellTreeNodeDefinition[] = nodes;
export const SPELL_TREE_NODE_BY_ID = new Map(nodes.map((n) => [n.id, n]));
export function adjacentNodeIds(id: string): string[] {
  return [
    ...(SPELL_TREE_NODE_BY_ID.get(id)?.requiresAll ?? []),
    ...nodes.filter((n) => n.requiresAll.includes(id)).map((n) => n.id),
  ];
}

# Progression Curve v1: the linear/exponential divergence

Every enemy stat in Evercast compounds with the stage. Every source of player
power adds a constant. Those two statements are the whole bug, and no amount of
tuning inside the current shapes can reconcile them — an additive sequence loses
to a geometric one eventually, and "eventually" currently lands around stage 40.

This document is a design proposal. It changes no behaviour on its own. It sets
out what is broken, what the target curves should be, which constants to move,
and what the save migration has to do before any of it can ship.

## What is actually broken

`EncounterSystem.spawnEnemy` builds an enemy out of three compounding terms:

```ts
const maxHp = big(definition.baseHealth)
  .mul(big(definition.healthGrowth).pow(stageExponent))   // 1.16^stage
  .mul(worldTierMultiplier)                               // 1.75^worldTier
  .mul(bossHealthMultiplier);                             // 4.5 on a boss
```

`CombatSystem` line 35 builds the player's out of one additive term:

```ts
const baseDamage = big(spell.damage).add(gear.baseDamageBonus);
```

and `compileGearStats` makes that bonus a straight product:

```ts
const contribution = big(definition.statPerLevel).mul(paidLevels);
```

Max HP is the same shape — `baseMageHealth` plus a linear gear sum. So the
player's two defining stats are both first-degree polynomials in gear level,
facing three stacked exponentials.

| | Scales as | Kind |
| --- | --- | --- |
| Enemy HP | `base × 1.16^stage × 1.75^worldTier × 4.5^boss` | exponential ×3 |
| Enemy attack | `base × 1.085^stage × 1.35^worldTier × 1.8^boss` | exponential ×3 |
| Player damage | `2 + Σ(statPerLevel × level)` | **linear** |
| Player max HP | `25 + Σ(statPerLevel × level)` | **linear** |
| Gear cost | `baseLevelCost + level^1.35 × costGrowth` | polynomial |
| Gold income | `stage × 1` per kill | **linear** |
| Starlight income | flat `1` per kill | **constant** |
| Essence (first clear) | `2 × 1.08^stage` | exponential, *slower* than enemy HP |
| Spell point cost | `8 × 1.27^point` | exponential, *faster* than essence income |
| Knowledge per rebirth | `floor((stage / 50)^1.5)` | `= 1` at stage 56 |

Three details make this worse than the table alone suggests.

**Nothing multiplies the player's damage anywhere.** `compileSpell` has full
support for `{ kind: 'stat', stat: 'damage', operation: 'mul' }`. No content
emits it. The only `stat` modifiers in the whole authored tree are `critChance`
and `critMultiplier`, and both are `operation: 'add'`. The tree's real
contribution is mechanics — twin cast, explosions, DoT, meteors, contagion —
which raise *effective* throughput by a large but **one-time, stage-independent**
factor. They move the curve up once. They do not change its slope.

**The same is true of every other multiplier in the game.** `RARITY_POWER` caps
at 4.3, `STAR_POWER` at 2.9. Companion stats are expressed as shares of the
mage's own numbers — a good design, and one that means companions inherit the
mage's linear ceiling exactly rather than escaping it. The product of every
multiplier a player can ever assemble is a constant. The enemy's grows without
bound.

**`worldTier` is a cliff, not a curve.** `resolveZone` gives
`worldTier = floor(zeroBasedZoneNumber / catalog.zones.length)`. With four zones
at `zoneLength: 25`, it steps at stage 101, 201, 301 — so a single stage boundary
multiplies enemy HP by 1.75 and attack by 1.35 on top of everything else.

## Evidence

The model above was checked against a real stage-56 save rather than derived on
paper. It reproduces that save exactly:

| Quantity | Predicted | In save |
| --- | --- | --- |
| Crypt Hound max HP | 26,673 | 26,673 |
| Hollow Crow max HP | 13,334 | 13,334 |
| Ash Beetle max HP | 24,563 | 24,563 |
| Crypt Hound attack | 183.1 | 183.1 |
| Player hit damage | 389.5 (`2 + 387.5` gear) | 389.5 |
| Player max HP | 775 (`25 + 750` gear) | 775 |

That save is 3.1 hours in, at stage 56, with 8 gear pieces between level 151 and
201, 18 spell nodes, 30 companions, one rebirth — and **239 deaths**.

A greedy bot driving the real engine headlessly (buying the best stat-per-gold
gear every tick, activating every spell node it can afford, summoning and
fielding companions) reaches **stage 40 in 8 simulated hours with 929 deaths**.

The measured per-stage times are not a smooth ramp. They are a sawtooth:

```
stage  20 ->  21    13.7 min      stage 10, 20, 30, 40 are boss stages
stage  30 ->  31    14.8 min      (bossCadence: 10)
stage  40 ->  41   473.1 min  <-- 7.9 hours on one stage
stage  41 ->  46     0.1 min each
```

Nine stages fall in under a minute, then one stage takes eight hours. The player
over-levels against the wall, coasts through the next nine stages, and hits the
next wall harder. There is no stretch of the game where progress feels steady.

## Why upgrades stop mattering

At stage 56, with 389.5 damage:

- One stage of enemy HP growth needs **+62.3 damage** to hold time-to-kill flat.
- The most gold-efficient source is staff levels at ~6,200 gold each →
  **394,678 gold** for those 63 levels.
- A stage-56 wave of six pays **336 gold**.
- That is **~1,175 wave clears to advance one stage** — and stage 57 asks 16%
  more again.

Meanwhile the survival side has already lost. The party in that save holds 5,693
effective HP against 557 incoming DPS — **a wipe in about ten seconds**, against
a wave that needs well over a minute to clear. The 239 deaths are the curve, not
the player.

## The shape of the fix

**Player power must compound in the same variable the enemy compounds in.** Every
change below serves that one sentence; everything else is polish.

### 1. Gear power becomes geometric (`compileGearStats`)

```ts
// GEAR_POWER_GROWTH = 1.07
const contribution = big(definition.statPerLevel)
  .mul(big(GEAR_POWER_GROWTH).pow(paidLevels).sub(1))
  .div(GEAR_POWER_GROWTH - 1);
```

This is the geometric sum, chosen so level 1 contributes 0 and level 2
contributes exactly `statPerLevel` — the early game keeps the numbers it has
today and the curve only diverges upward later.

### 2. Gear cost becomes geometric (`gearLevelCost`)

```ts
// GEAR_COST_GROWTH = 1.075
return big(definition.baseLevelCost)
  .mul(definition.costGrowth)
  .mul(big(GEAR_COST_GROWTH).pow(currentLevel - 1))
  .floor();
```

Cost must compound slightly *faster* than power (1.075 vs 1.07), or the player
outruns the enemy curve and the game trivialises instead of stalling. The small
gap is deliberate: it makes damage-per-gold decay very slowly, which produces a
soft stall rather than a wall — and a soft stall is exactly what should be
triggering a rebirth.

### 3. Gold income couples to enemy HP (`goldRewardForKill`)

```ts
export function goldRewardForKill(stage: number, boss: boolean, maxHp: Decimal) {
  return maxHp.mul(GOLD_HP_FRACTION).mul(boss ? 3 : 1).floor().max(1);  // 0.06
}
```

`ProgressionSystem.handleEnemyKilled` already holds the `enemy`, so this is a
one-argument change at the only call site. Coupling income to the thing that
defines difficulty means income inherits `worldTier` and boss multipliers for
free, and any future enemy retune carries its own economy with it instead of
silently desyncing.

This one is worth stressing because it is **not sufficient on its own**. Applied
alone it made things *worse* in measurement (stage 40 → 40, deaths 929 → 1,564):
a small fraction of early enemy HP pays less than flat `stage` gold did. It only
works alongside the power curve.

### 4. Soften the two spikes (`EncounterSystem`)

`bossHealthMultiplier` 4.5 → **3.0**, and `worldTier` HP 1.75 → **1.30** with
attack 1.35 → **1.15**. These are polish, not the fix — measurement shows them
worth roughly 8% of the improvement — but they are what turns the remaining
sawtooth into a ripple.

## Measured results

Each row is the same greedy bot on the same engine, 8 simulated hours, buying on
marginal value per gold. "med min/stage" is the median wall-clock minutes spent
per stage within the band.

| Configuration | Stage in 8h | Deaths | 1–25 | 26–50 | 51–100 | 101+ | Worst stage |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Shipping constants** | **40** | **929** | 0.19 | 0.69 | – | – | 26m |
| power 1.06 / cost 1.065 / gold 4% / boss 3.0 / tier 1.30 | 201 | 246 | 0.24 | 1.41 | 0.47 | 1.61 | 27m |
| **power 1.07 / cost 1.075 / gold 6% / boss 3.0 / tier 1.30** | **262** | **174** | 0.22 | 1.04 | 0.46 | 1.25 | 30m |
| power 1.08 / cost 1.085 / gold 6% / boss 3.0 / tier 1.30 | 280 | 174 | 0.22 | 0.79 | 0.44 | 1.14 | 31m |

An earlier sweep isolated the contributions: the power/cost curve alone carries
roughly 90% of the gain, boss and `worldTier` softening the remaining 10%, and
the gold coupling is a prerequisite for the power curve rather than an
improvement by itself.

### Recommendation

**power 1.07 / cost 1.075 / gold 6% / boss 3.0 / tier 1.30.**

1.08 reaches further but flattens the mid-game to 0.79 min/stage, which is
closer to a cutscene than a climb. 1.07 holds roughly one to one-and-a-quarter
minutes per stage across every band — steady pacing, 174 deaths instead of 929,
and a worst single stage of 30 minutes instead of eight hours.

### Proposed constants

All five belong in `src/content/`, next to the tuning they resemble, not inside
engine system files — the same rule `spellTreeTuning.ts` and `companionTuning.ts`
already follow.

| Constant | Home | Value |
| --- | --- | --- |
| `GEAR_POWER_GROWTH` | `src/content/gear.ts` | `1.07` |
| `GEAR_COST_GROWTH` | `src/content/gear.ts` | `1.075` |
| `GOLD_HP_FRACTION` | `src/content/gear.ts` | `0.06` |
| `BOSS_HEALTH_MULTIPLIER` | `src/content/zones.ts` | `3.0` (from 4.5) |
| `WORLD_TIER_HEALTH` / `WORLD_TIER_ATTACK` | `src/content/zones.ts` | `1.30` / `1.15` (from 1.75 / 1.35) |

## The save migration is mandatory

This is the part that must not be skipped. Existing gear levels were bought under
a cheap polynomial cost curve. Re-reading those same levels through a geometric
power curve does not rebalance them — it detonates them:

| Slot | Level | Power today | Same level, new formula |
| --- | --- | --- | --- |
| staff | 201 | 200 | **10,756,152** (53,781×) |
| helm | 201 | 200 | **10,756,152** (53,781×) |
| spellbook | 151 | 75 | **182,567** (2,434×) |

The migration therefore has to convert level to **equivalent power**, not carry
the level across. Inverting the geometric sum:

```
newLevel = log(oldPower × (G - 1) / statPerLevel + 1) / log(G) + 1
```

Applied to the reference save, every piece lands between level 37 and 41 with its
damage and HP contribution unchanged to the decimal:

| Slot | Old level | Power | New level | Power |
| --- | --- | --- | --- | --- |
| helm | 201 | 200.0 | 41.0 | 200.0 |
| staff | 201 | 200.0 | 41.0 | 200.0 |
| robe | 201 | 400.0 | 41.0 | 400.0 |
| spellbook | 151 | 75.0 | 37.1 | 75.0 |
| boots | 151 | 150.0 | 37.1 | 150.0 |
| necklace / rings | 151 | 37.5 | 37.1 | 37.5 |

Players keep exactly the power they had and see much smaller level numbers. That
needs saying in the patch notes, because a level dropping from 201 to 41 reads as
a loss until you check the damage figure beside it. `SaveCodec` goes to
**version 9**; levels should round to the nearest integer with power recomputed
from the rounded level, so the same save always migrates to the same state.

Gold, essence, starlight, spell tree, companions and stage are all untouched by
this migration.

## What this does not fix

Worth naming so the next pass has somewhere to start.

**The first boss becomes the sharpest wall.** In every fixed configuration the
worst single stage moves to stage 11 — clearing the stage-10 boss — at 27–31
minutes, because gear has not compounded meaningfully by level ~15. Either the
first boss wants a lower multiplier than later ones, or `bossCadence` wants to
skip the first interval.

**The sawtooth is reduced, not removed.** Median stage time still alternates
between bands (1.04 min at 26–50, 0.46 at 51–100, 1.25 at 101+). Pacing is a
separate problem from scaling, and the boss cadence is the driver.

**Rebirth still grants no power.** `RebirthSystem.perform` pays knowledge and
nothing else, so a prestige is a pure reset with a currency attached. The
standard contract — prestige currency also being a global multiplier, so each
re-climb is faster than the last — is absent. With the curves above the soft
stall becomes the natural rebirth trigger, which makes this the most valuable
follow-up.

**Knowledge income is too thin for its sink.** The sink is well-designed:
Broadened Study (1), Schism (6), Confluence (25) widen the exclusive groups and
genuinely reshape a build. But `floor((highestStageThisRun / 50)^1.5)` pays
exactly **1** at stage 56, so Schism costs six full run-wipes and Confluence
twenty-five. With the curves above a run reaches stage 262, which pays
`floor((262/50)^1.5)` = 11 — better, and probably still short. Worth revisiting
once the main curve lands, since the exponent only matters relative to how deep a
run now goes.

**`piece.treeNodes` is a dead field.** Declared in `types.ts`, initialised in
`createInitialEquipmentState`, persisted through `SaveCodec`, and surfaced by
`gearDisplayData` as `unlockedTreeTier` — and no system anywhere writes to it.
`compileGearStats` reads only `piece.level`. The gear tree the UI advertises does
not exist. It is the natural home for a second multiplicative layer if one is
wanted later, and `GEAR_EVOLUTION_MILESTONES` / `evolutionTierForLevel` are
already computed and already mechanically inert, so the hook is sitting there.

## How these numbers were produced

The baseline model was derived from `EncounterSystem`, `GearSystem`,
`ProgressionSystem` and `SpellCompiler`, then validated against a real stage-56
save — it reproduces every enemy stat and both player stats exactly, so the
arithmetic in this document describes the shipping game rather than an
approximation of it.

The measured rows come from a throwaway harness driving `EvercastSimulation`
headlessly, with the candidate curves injected behind environment variables so a
sweep could run several configurations in one process. It is not included in this
branch — the proposal is documentation only. It is worth rebuilding as a proper
`tools/balance/` harness when the change is implemented, both to re-derive these
tables and to keep them honest afterwards; `src/engine` is already constrained to
run headlessly in Node, which is what makes that cheap.

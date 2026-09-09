# Real Spell Tree v1

Evercast remains one spell. Its 67-node graph has a free root, three mutually exclusive routes, nine identities, 36 optional side upgrades, nine mutations, and nine pairwise fusions. A normal complete build can allocate 14 points: one route, two identities, their eight side upgrades and two mutations, and one fusion.

## Rules and ownership

`src/content/spellTree.ts` owns the graph and exclusive groups. `maxSelections` implements both the hard root fork (one of three) and each route's identity fork (two of three). `requiresAll` implements every prerequisite, including both fusion parents. Descendants of an excluded identity remain visibly locked. Side paths are independent and mutations require their identity, not its optional upgrades.

`SpellTreeSystem` compiles allocations into `SpellBuild.mechanics`. Combat consumes these named behaviors and tuning values, never node IDs or UI coordinates. `SpellTreeLayout` owns the three route columns and places fusions between their parents. Available, active, missing-prerequisite, insufficient-point and exclusive states have distinct labels; excluded branches use dashed borders. Route navigation keeps all three choices accessible on narrower screens.

Future fusion identities can be normal children requiring the fusion, with a new exclusive group whose `maxSelections` is 1. There are no invented future effects or spendable placeholder nodes.

## Authoritative combat

`EvolvingCombat` resolves direct projectiles, penetration/chain order, criticals, Focus, Supercharge and stored force. `TimedSpellEffects` resolves DoT ticks, spread, delayed meteors, status expiration and Overdrive expiration. `EvercastSimulation` includes these deadlines alongside spawn/cast/attack deadlines. Timed player effects and casts resolve before enemy attacks at the same timestamp. Weakness and Ruin expire before damage at their exact deadline; a DoT may tick at its expiration timestamp.

Enemies receive stable engine-owned formation positions when spawned. Straight-line penetration means increasing X within `lineTolerance` of the preceding victim's Z lane. It does not select arbitrary nearby enemies. Chain Lightning replaces that selection with nearest living, unvisited targets within its radius, preserving A → B → C event provenance. Actors use the same positions and do not reshuffle when a neighbor dies.

Important playtest conventions:

- A blocked Piercing Cast halves the *next* cast interval. This interpretation of “50% faster” is explicit in the node description. Chain mutation applies the fallback if it has no continuation.
- Each Twin projectile is an independent valid hit. Each explosion is a separate damage event. Meteors capture an impact location and can coexist without a gameplay/VFX quota.
- DoT applications refresh duration, retain the current tick phase and keep the stronger existing tick damage. They do not stack separate tick streams. Contagion prefers a nearby uninfected enemy, then refreshes the nearest infected one. A spread infection can spread again on its own ticks.
- Weakness adds one stack per hit, caps at two, and refreshes duration. Ruin retains Weakness while adding incoming amplification. Doomfall consumes Ruin on affected victims once and multiplies the entire meteor once, regardless of how many ruined victims are present.
- Driving Force adds capped force per penetration. Kinetic Collapse moves that force into the final hit. Terminal Voltage enables accumulation across the mutated chain; chain hops do not otherwise generate straight-line Kinetic force or Momentum. Stormdrive enables Momentum from every chain hop.
- During Terminal Velocity's Overdrive, each cast stores its capped force rather than paying it out. A cast with no continuation still stores one force step. After Overdrive expires, the next cast adds the stored amount to its final victim, then clears it. Overdrive resets Momentum at its end.
- Non-crits build Focus. Natural crits retain existing Focus; only the guaranteed Perfect Strike consumes it. Supercharge is earned for the *next* projectile and resets on target switch. Critical Overload consumes all stacks on Perfect Strike.
- Death Sentence and Obliteration add one extra resource stack at or below 50% HP and another at or below 20%. Final Blow multiplies actual damage; it never directly sets HP to zero.
- Temporary resources, statuses and queued meteors clear on encounter completion, defeat/retry, respec and rebirth. They persist through saves within an encounter. An old meteor cannot strike the next wave.

## Central playtest tuning

All figures below are provisional, in `src/content/spellTreeTuning.ts`. Point price remains `floor(8 × 1.27^purchasedPoints)`; Gold, gear, Essence rewards, waves and Rebirth progression are unchanged. The purchase ceiling still follows the authored non-root node count; migration preserves already purchased points.

| Mechanic | Default |
| --- | --- |
| Charged Cast | ×3 base-plus-gear damage; ×1.7 cast interval |
| Explosion | 1.65-unit radius; 35% base damage |
| Meteor | 15% per hit; 0.55s delay; 125% base damage |
| DoT | 18% base damage each second for 4s |
| Contagion | 15% per tick; 2.5-unit spread radius |
| Weakness | 12% outgoing reduction per stack, max 2; 4s |
| Ruin | 15% per hit; +30% incoming damage for 3s |
| Piercing / Deep Pierce | 1 continuation; identity adds 1; line tolerance 0.18 |
| Chain | 3.2-unit radius; uses the penetration count |
| Driving / Kinetic force | +30% base damage per step; capped at +200% |
| Momentum | +6% cast speed per stack, max 5; 3s refresh |
| Overdrive | ×1.8 cast speed for 2.5s |
| Critical Mass / Focus | +10 percentage points crit chance; 3 non-crits to guarantee next |
| Supercharge | +18% damage per stack, max 5 |
| Execution | +30% damage at or below 35% HP |
| Final Blow | `1 + 1.5 × missingHP²`, plus 0.5 at or below 20% HP |
| Doomfall / Blight | ×3 meteor damage / ×1.5 Weakness strength |
| Critical Overload | +20% critical multiplier factor per Supercharge stack |

Side upgrades add the same bonus at ranks I and II: radius +0.35, explosion damage +15 percentage points, DoT damage +8 points, DoT/Weakness duration +1.5s, Weakness strength +4 points, penetrations +1, pierced damage +15 points, force gain +15 points, force cap +100 points, Momentum speed +2 points/stack, Momentum duration +1s, crit chance +5 points, crit multiplier +0.3, charged damage multiplier +0.4, charged interval multiplier −0.15, execute damage +20 points, execute threshold +5 points. Overcharge itself adds +0.4 charged damage multiplier.

## Saves

Save version 6 keeps the existing `evercast.save.v1` storage key. Version 5 allocations are removed and become unspent points: purchased count is preserved exactly, no Essence is refunded or duplicated, and Gold, gear, frontier/meta and unrelated progression are preserved. Temporary old spell state is cleared and the base Evercast build is compiled immediately. Re-saving and loading cannot refund a second time.

Versions 1–4 retain the established first-clear Essence reconciliation policy. Version 4 also drops the obsolete allocations. New version 6 allocations are validated against every dependency, exclusive group and the saved point budget; malformed allocations cannot mint purchased points. Position, status deadlines, proc serial, queued meteors and temporary cast resources serialize with the run. Encoded snapshots own their mutable data rather than changing as the live game advances.

## VFX and review

The existing Blender kit supplies geometry. Twin hits retain separate flights, chain arcs follow emitted sources, terminal hits receive a larger impact, and Charged/Supercharge scale the moving projectile. Meteors fall toward their captured ground position; Plaguefall uses green infection accents and spread paths. Weakness and Ruin use separate temporary glyphs. Snapshot reconciliation clears consumed or expired statuses and restores visuals after loading. Shared actor materials stay matte and unchanged.

`ProcVfxPresenter` adds one shared plague material and uses the existing pool ceilings. Presentation may coalesce/drop saturated effects; authoritative pending damage is never limited by those ceilings. Explosion visuals follow the corresponding projectile arrival. Damage labels consume real damage events.

Run `npm run dev`, then open `/tools/review/vfx.html`. Choose any root, mutation or fusion. The fixture allocates a legal tree, runs real combat/timed effects and never touches a saved game. “100% proc preview” is an explicitly labeled review-only override for reproducible rare effects. Unchecked uses the authored 15% tuning. “Targets to 15% HP” exposes execution behavior. Production builds contain the game, not this development review page.

Validation includes all route locks and identity pairs, both-parent gates for every fusion, all mutations and nine focused fusion regressions, deterministic per-hit/tick RNG, delayed work, migration and all-nine-fusion chunked/offline/save parity. VFX stress tests also verify that pending gameplay meteors can exceed the visual mesh budget without state mutation or leaked resources.

Browser verification exercised purchasing, respec, the third-identity lock and both-parent fusion gates on all three routes. The live review exercised all 22 root/mutation/fusion presets with real events, including Plaguefall spread meteors, Doomfall empowerment, Terminal Velocity storage, Stormdrive Overdrive and Perfect Strike consumption. Screenshots in `docs/media/spell-tree` show the new tree and representative runtime effects. Exact damage/expiry behavior is covered by engine tests, rather than inferred from screenshots.

Final verification: 118 tests across 24 files passed, TypeScript checks passed, and the production build passed. A version 5 fixture loaded in the production browser became version 6 with 12 purchased / 13 unspent points, 4,321 Essence, staff level 20 and highest stage 42 retained. No browser errors were reported. The existing Vite large-chunk warning remains.

# Spell Tree v2: attunements, blended routes, apexes

Evercast v1 authored 67 nodes and let a build hold 14 of them. The exclusive
groups were the ceiling: one route of three closed two thirds of the graph, two
identities of three closed another third. v2 keeps that fork sharp and makes it
temporary. Attunements widen the groups, the three routes compose instead of
excluding, and each route ends in a capstone.

## What was actually broken

`MAX_SPELL_TREE_POINTS` was the raw non-root node count, so `buyPoint` sold 66
points against a graph that could absorb 14. Arcane Essence is finite and
first-clear only, and the tree is its only sink, so a finished build turned every
further frontier clear into a reward with no use. Knowledge, meanwhile, had been
paid out by `RebirthSystem` since it shipped and subtracted by nothing: rebirthing
cost a frontier and bought a number that did nothing.

The ceiling is now derived. `maxAllocatableSpellPoints` takes every node the
current rules allow, in authored order, until nothing more can be taken, and that
count gates purchases. Routes and identities hold equal numbers of nodes, so the
first legal maximal build is a maximum one. Counting subtrees would be wrong:
fusions have two parents and the graph is not a tree.

## Attunements

Permanent unlocks bought with Knowledge. They add no nodes. They raise
`maxSelections` on the groups in `spellTreeExclusiveGroups`, which is the thing
that decides how much of the graph one build can hold.

| Attunement | Knowledge | Effect |
| --- | --- | --- |
| Broadened Study | 1 | Every identity group 2 → 3 |
| Schism | 6 | The route group 1 → 2 |
| Confluence | 25 (needs Schism) | The route group 2 → 3 |

`previewKnowledgeGain` is `floor((highestStageThisRun / 50)^1.5)`, so the first
rebirth at stage 50 yields exactly 1 and buys Broadened Study outright. That is
deliberate: it turns the first prestige from a strict downgrade into the moment
the tree opens.

They live on `SpellTreeState`, not `MetaState`. Every reader of the tree's rules
already takes a `SpellTreeState` and nothing else, so no call signature changed;
`SaveCodec` needs them before it can validate allocations; and that state already
sits outside `RunState`, so it survives Rebirth without being asked to.

A node blocked by a full group still reports `exclusive`, because a respec can
always swap which member of that group you hold. What it cannot do is let you
hold both — `blockingAttunement` names the unlock that would, and the inspector
says so rather than telling the player to respec in vain. Once every attunement
is owned, each group's cap equals the number of choices in it, so nothing is
exclusive and the whole graph is reachable in one build.

## Blended routes

`route` was a single string and `buildSpellFromTree` applies `set` last-wins, so
two route nodes silently overwrote each other: Schism could be bought and could
not mean anything. The three routes were never really alternatives — they answer
different questions.

- **Twin** — how many projectiles leave the staff.
- **Piercing** — how many targets each one reaches.
- **Charged** — how hard, and how slow.

So they are three independent flags, and `cast` resolves a chain per projectile
rather than one flat target list. Twin and Piercing together is two bolts that
each penetrate; with Charged, two heavy ones. `route` survives as a derived name
for the heaviest shape held, because descriptions and VFX need something to call
it, but combat never reads it.

Two rules carry the weight:

- **The per-hit index is one counter across the whole cast.** The proc RNG is a
  pure hash of its arguments, so two projectiles presenting the same index to the
  same channel would correlate perfectly. For a single-route build the counter
  produces exactly the sequence the old loop variable did, which is why every
  v1 combat and fusion-parity test passes untouched.
- **Execution and Final Blow read the health of the enemy being hit**, not the
  primary's. With one target those are the same number; with two they were not.

`routeBlendScale` (0.75) multiplies base damage once per route held beyond the
first, so a blend is a sideways move rather than a strictly larger one on a curve
where each point already costs 27% more than the last. Setting it to 1 removes
the penalty. Terminal force and the halved interval on a blocked pierce are
per-chain: the interval halves only when *no* projectile found a continuation.

## Apexes

One capstone per route, each requiring all three of that route's fusions — which
needs three mutations, which needs three identities, so an apex only exists for a
build that took Broadened Study and then finished what it opened. This is the
extension shape `SPELL_TREE_V1.md` reserved: normal children of a fusion, with no
invented effects and no spendable placeholder nodes.

| Apex | Route | Requires | Effect |
| --- | --- | --- | --- |
| Pandemic | Twin | Plaguefall + Doomfall + Blight | A spreading tick takes several uninfected neighbours at once |
| Singularity | Piercing | Terminal Voltage + Stormdrive + Terminal Velocity | The terminal hit collapses into an explosion scaled by the force delivered |
| Ascendance | Charged | Critical Overload + Death Sentence + Obliteration | Supercharge survives a target change; held Focus sharpens every critical |

All three reuse the existing infection, explosion and resource systems, so none
adds a deadline to `nextDelay` or a proc channel. Pandemic still falls back to
refreshing the nearest infected enemy when there is nothing new to infect;
Singularity does nothing when the chain found no continuation, because there is
no force to collapse.

Each carries the same three-rank side ladder as an identity — `sidePaths` is now
one helper rather than a loop buried inside `identity()`.

## Provisional tuning

In `src/content/spellTreeTuning.ts` with the rest. Side ranks add the same bonus
at I, II and III; rank III is new in v2 and gives a finished v1 build somewhere
to put its stranded point without waiting on a rebirth.

| Value | Default |
| --- | --- |
| `routeBlendScale` | 0.75 per route beyond the first |
| Pandemic targets | 2, +1 per rank |
| Contagion radius rank | +0.5 |
| Singularity radius / damage | 2.2 units, 60% of delivered force; +0.4 / +0.25 per rank |
| Ascendance crit gain | +0.25 multiplier per point of Focus; +0.15 per rank |
| Supercharge capacity rank | +1 |

Two rank-III values want a playtest look in particular: `charge_speed_3` drives
`chargedInterval` to 1.25, and `penetration_3` adds a fourth pierce.

## Shape of the graph

106 nodes: root, 3 routes, 9 identities, 54 side ranks, 9 mutations, 9 fusions,
3 apexes and their 18 side ranks. Layout is still derived entirely from
`requiresAll`, `region` and `kind`; `apex` needed a size and a label and nothing
else.

| Unlocks | Legal build | Essence reaches it near stage |
| --- | --- | --- |
| v1, for comparison | 14 | 41 |
| v2 base rules | 18 | 52 |
| Broadened Study | 35 | 106 |
| Schism | 36 | 110 |
| Both | 70 | 214 |
| Confluence | 105 (every node) | 322 |

Stage figures fall out of the two existing curves — points at
`floor(8 × 1.27^purchased)`, first-clear Essence at
`floor(2 × 1.08^(stage-1))` with a ×4 boss cadence — and are why no cost tuning
was changed.

## Saves

`CURRENT_SAVE_VERSION` is 8; `MINIMUM_SAVE_VERSION` stays 5. v8 adds
`attunements` to the serialized spell tree. v5–v7 load on the original rules
rather than losing anything.

Attunements are read before allocations, because they decide the group caps those
allocations are checked against. One whose own prerequisite is missing is
dropped, so a hand-edited save cannot widen the tree by naming Confluence alone.
The existing fixed-point rebuild then drops any allocation the remaining unlocks
make illegal — a two-route build saved without Schism loads as its first route —
and `purchasedPoints` is still copied verbatim, so a malformed blob truncates a
tree rather than minting points.

## Validation

533 tests across 53 files, plus the production TypeScript/Vite build. The three
auto-iterating suites cover new nodes for free: authored-content integrity, route
and identity locks, and chunked/offline/save-resumed parity — the last now runs
over all nine fusions, all three apexes and a blended two-route build. Hand-written
coverage adds the derived ceiling against a real allocation, attunement purchase
and prerequisite rules, rank III chaining, the blend structure and damage, per-hit
proc independence across projectiles, and each apex's behaviour and its null case.

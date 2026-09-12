# Evercast Architecture

Evercast is a deterministic incremental simulation with a 3D presentation layer.

## Non-negotiable boundary

`src/engine/**` must never import React, Babylon.js, browser storage, DOM APIs, or presentation assets.

The authoritative game can therefore run:

- in the browser with Babylon + React,
- headlessly in Node for balance testing,
- during offline/background catch-up,
- in automated tests,
- and later on a trusted server if validation is ever needed.

## Runtime dependency graph

```text
content/ authored game data
   ↓
engine/ authoritative deterministic rules
   ↓ snapshots + serializable GameEvents
┌───────────────┬──────────────────┐
↓               ↓                  ↓
app/           game/               ui/
persistence    Babylon             React
boot/offline    renderer            menus/tree
```

Presentation never reports collision, damage, kills, progression, or rewards back into the engine.

## Ownership rules

### `src/content`

Owns authored game data: enemies, zones, gear definitions/tuning, and the authored spell-tree graph. Content may use engine schema types, but authored names, descriptions, balance values, and graph definitions do not belong inside engine system files.

### `src/engine`

Owns deterministic rules, mutable authoritative state, economy/combat calculations, save migrations, commands, snapshots, and serializable events. It does not own React/Babylon behavior or UI layout coordinates.

### `src/ui`

Owns React presentation and presentation-only layout data. Spell-tree x/y coordinates live here rather than in the gameplay node definitions.

### `src/game`

Owns Babylon models, animation, camera, environment rendering, particles, VFX, and other visual reactions to snapshots/events.

### `src/app`

Owns browser lifecycle, save loading, autosave, visibility/background handling, and bootstrapping.

## State boundaries

`GameState` currently has five domains:

- `RunState`: frontier, current encounter, push/farm mode, Arcane Essence, spell build, combat timers, the live party and run stats.
- `MetaState`: Rebirth count, Knowledge, lifetime/highest-stage records, permanent unlock/story flags.
- `EquipmentState`: Gold and the eight persistent gear pieces.
- `SpellTreeState`: purchased Spell Points and activated spell-tree nodes.
- `CompanionsState`: Starlight, the owned roster, the party, and the draw/pity counters.

The current placeholder Rebirth replaces `RunState` while equipment and spell-tree state survive. That is intentionally provisional until prestige is designed; it must not become canon by accident.

## Numbers

Authoritative economy/combat magnitudes use `break_eternity.js` `Decimal` values. Serialization uses strings. UI receives `QuantitySnapshot` values (`raw` + `display`) rather than owning Decimal objects.

## Time and offline progress

The simulation is event-driven rather than frame-driven. `advance(seconds)` consumes time until the next spawn, cast, enemy attack, timed spell effect/status expiration, or encounter transition. The same method powers live play and offline/background catch-up, so renderer FPS and browser throttling cannot change authoritative outcomes.

The browser layer detects tab visibility. Hidden time is applied through `OfflineProgressor` when the tab becomes visible again, with presentation events suppressed and the normal offline cap applied.

Away time is owed rather than spent up front. `OfflineProgressor.begin` returns an `OfflineCatchUp` the caller advances in slices, and `GameLoop` works it down inside a share of each frame; boot-time and hidden-time debt go through the same path. A day of catch-up from a played save is several hundred thousand world events, so applying it in one pass before the first render presents as a game that will not start - and it is what the loop's step budget exists to survive rather than trip over. Because `step` never consumes past an event, slicing cannot change what happened: state agrees with a single pass exactly, other than float accumulation in elapsed time and in-flight positions.

`src/app/runtime.ts` is imported on the way to the first render, which makes anything that throws there a blank page on every reload rather than a handled error. It resumes a save defensively and reports a failure instead of taking the app down.

## Encounter system

Each stage is a finite timed-spawn encounter. Multiple authoritative enemies can coexist.

An encounter owns:

- total enemy budget,
- spawned count,
- spawn cadence,
- maximum simultaneous living enemies,
- boss-stage identity.

The stage clears only after the full enemy budget has spawned and no living enemies remain. Spawn timing is independent of whether earlier enemies have died, subject to the `maxAlive` safety cap.

## Combat and presentation events

`CombatSystem` resolves casts, deterministic critical hits, direct hits, pierce, chain, splash, repeats, enemy attacks, control, leech and triggered effects. Player casts win exact timer ties.

The engine event stream is the presentation contract. `projectile_hit` includes effect provenance (`direct`, `pierce`, `chain`, `splash`, or `repeat`), source target when relevant, and sequence information. Babylon should animate those facts rather than infer combat from build stats.

## Progression economies

Gold and Arcane Essence intentionally serve different loops:

- **Gold** is repeatable. Every kill grants Gold and farming/AFK time can accumulate it. Gold levels gear.
- **Arcane Essence** is finite frontier progression. It is granted only on a stage's first-ever frontier clear and purchases Spell Points. Farming/replaying already-cleared stages grants no Essence.
- **Starlight** is repeatable and buys summons. It is deliberately a third wallet rather than a second use for one of the others: draws out of Gold would cannibalise gear, and draws out of Essence would break the rule above. It grows far more slowly than Gold per kill, with a boss multiplier and a first-clear bonus.

Boss first-clears currently award more Essence. Exact curves remain prototype tuning.

## Spell tree

The authored v1 tree has three exclusive routes, choose-two identity groups, optional side upgrades, mutations and pairwise fusions requiring both parents. Allocations compile into SpellBuild.mechanics. EvolvingCombat and TimedSpellEffects own cast/timed behavior; stable enemy positions and temporary spell resources remain authoritative engine state. UI geometry stays separate.

See [Real Spell Tree v1](SPELL_TREE_V1.md) for the graph rules, provisional tuning, event timing and version 6 migration. Future fusion identity splits are supported through the same exclusive-group schema, without invented nodes.

## Companions

Up to five companions fight alongside the mage as real combatants with their own
health. They swing on their own cooldowns, take the blow that would have hit the
mage, and can be knocked out; a knockout costs the rest of the encounter, never
the run. `ProgressionSystem.resetAfterEncounter` restores the party where it
already restores the mage.

Ownership is persistent and stored **once per companion**, never once per copy:
a duplicate draw banks shards, and shards buy star levels. Companion power is a
*share* of the mage's own numbers — health off her maximum, damage off her
per-hit — so a companion is worth what it says at every magnitude and needs no
second scaling economy.

Four rules carry the weight:

- **Beats are events.** `nextCompanionBeat` joins the same `min(...)` the spawn,
  cast and enemy beats already feed, and companion cooldowns tick only while
  something is in reach — the mirror of `tickEnemyCooldowns`. Passive abilities
  are never scheduled: a cooldown of zero would put a due action at t=0 on every
  pass and `advance` would spin until the safety limit.
- **Reaches are gates.** `soonestRangeChange` takes a list of thresholds so each
  companion's reach is a moment the loop can stop on, not a condition that can
  flip mid-step.
- **Targeting is pure.** `combat/Threat.ts` sorts by threat with no randomness,
  so a chunked run, a single pass and a resumed save agree on who took the hit.
  Enemies tagged `flying` or `ambush` invert the sort and dive the softest
  target, which is what keeps a wall of vanguards from making the back row free.
- **The standoff is stored.** A wave that spawns against a standing frontline
  keeps its distance for life, captured once at spawn. `contactPoint` is derived
  twice per step, so a stop that moved when a tank fell would put a chunked run
  and a single pass on different coordinates. It also reads correctly: the wave
  that arrives after the line breaks presses in.

Draws are a pure hash of a stored serial, so a reload continues on the roll the
session would have made next. Pity follows the Genshin/HSR shape — the published
rate is not the experienced one, and almost every high-rarity pull comes out of
the ramp.

Companions occupy their own rail group rather than sitting under Power, because
the three jobs are distinct: **Companions** manages the roster (stats, ability,
ascension), **Party** deploys it (pick a slot, then pick who fills it), and
**Summon** draws. The group set in `ui/nav/destinations.ts` is asserted closed by
`ui/architecture.test.ts`, so a fifth is again a deliberate decision.

Formation slots are gameplay geometry and live in the engine: they decide reach
and who is reached first. They separate mostly along x for the reason
`Contact.ts` gives about the enemy slots — z is nearly the depth axis at this
camera angle. Companion art is procedural placeholder built from primitives in
`src/game/actors/CompanionModels.ts`; `modelKey` is the seam an authored Blender
pack would replace without touching combat.

## Gear

The eight persistent gear slots are Helm, Staff, Spellbook, Robe, Boots, Necklace, Ring I and Ring II. Gold levels each piece independently with additive stat growth. Automatic evolution milestones are currently 1/50/100/200/500/1000 and remain tunable.

Authored gear names, descriptions and tuning live in `src/content`; engine gear modules own state/evolution mechanics.

## Environment assets

`world/EnvironmentAssets` owns the scene-local GLB template cache and creates instances
with shared geometry and materials. `EnvironmentPropCatalog` controls weighted biome
selection and scale. `WorldGenerator` owns scrolling chunk roots, roadside placement,
arrival landmarks, and cathedral assemblies. Disposing a chunk removes its instances;
disposing the world releases the templates and any late downloads. Asset loading never
changes deterministic combat or progression. The authored pack lives in
`public/models/environment`, with editable Blender source in `art/environment`.

## Snapshots and coordinator size

`EvercastSimulation` is the orchestration boundary, not a dumping ground for every derived read model. Snapshot construction lives in `src/engine/snapshot/SimulationSnapshotBuilder.ts`, and event-to-text formatting lives in `src/engine/events/describeGameEvent.ts`.

As new systems arrive, prefer extracting cohesive builders/services rather than allowing `EvercastSimulation` to absorb unrelated presentation/read-model logic.

## Save / migration

`SaveCodec` owns versioned schema conversion. Version 7 adds the companions domain; every earlier save loads with the feature simply not started rather than losing anything it had. Browser `localStorage` remains in `src/app`. Existing saves migrate forward rather than silently resetting progression.

The current solver is exact event-driven catch-up, metered across frames rather than run in one pass. Endgame event frequency makes a long catch-up expensive in total work, not just per pass, so `OfflineProgressor` remains the seam for an analytical/bulk strategy without changing combat or save formats.

## Testing gates

`npm run validate` runs unit/integration tests and a production TypeScript/Vite build. GitHub Actions runs the same validation on PRs and `main`.

Coverage includes deterministic advancement, multi-enemy overlap, push/farm behavior, content references, spell compilation, gear, Spell Point economy/pathing, first-clear Essence, save migrations, offline catch-up (including a full day away from a played save, and sliced catch-up agreeing with a single pass), the advance loop's runaway guard, prestige reset boundaries, and architecture guards preventing presentation dependencies from entering `src/engine`.

## Still intentionally deferred

- final spell-tree balance and future fusion identities,
- bounded/diminishing control rules,
- final prestige behavior,
- gear-tree point sources and authored gear trees,
- final enemy/zone tuning,
- story content,
- further batching and platform tuning of endgame VFX,
- analytical endgame offline simulation,
- analytics/cloud saves/accounts.

The architecture exposes seams for all of them without pretending their designs are already settled.

## Art and animation presentation

`ActorAssets` caches Blender GLB templates. Each combatant has independent transform
targets and animation groups while repeated parts share geometry and materials.
`ActorVisual` advances named idle, walk, attack, hit, and death clips on a presentation
clock, restoring the rest pose between states. Spell casts originate at the staff
socket. Cast animation duration adapts to the spell interval without delaying damage.
Enemy deaths briefly retain their visual, then release its animation groups and meshes.
The mage recovers from the defeat pose while the simulation resumes its existing flow.

Snapshots expose the content catalog's enemy `modelKey`; no renderer imports enter the
engine. Gear slots expose five cumulative modeled upgrades for the six existing tiers.
Changing equipment never scales anatomy or mutates shared material state.

`WorldTerrain` generates matching world-space chunk edges and a level combat lane.
`WorldBackdrop` owns the sky and distant hills independently of chunk lifetime.
`WorldGenerator` composes groves, verge vegetation, arrival landmarks, shadows, wind,
and two bounded local lights. Idle animation does not advance journey distance.
Environment templates are matte, except for restrained metal and emissive accents.
All GLB requests respect the Vite base path and handle late completion during teardown.

## Combat VFX

`CombatVfxPlan` reads authoritative hit provenance; `SpellVfxPresenter` schedules
short cosmetic flights and links, while `CombatFxPresenter` owns hit/death feedback.
`VfxPool` shares the Blender kit and bounds reusable meshes, path buffers, and jobs
through three quality presets. Presentation-only `healing` and `controlDelaySeconds`
metadata report actual applied results; no combat calculations moved into Babylon.
See [Combat VFX](COMBAT_VFX.md) for timing, resource ownership, caps, test coverage,
the development review fixture, captures, and measured performance limitations.

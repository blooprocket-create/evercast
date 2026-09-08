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

`GameState` currently has four domains:

- `RunState`: frontier, current encounter, push/farm mode, Arcane Essence, spell build, combat timers and run stats.
- `MetaState`: Rebirth count, Knowledge, lifetime/highest-stage records, permanent unlock/story flags.
- `EquipmentState`: Gold and the eight persistent gear pieces.
- `SpellTreeState`: purchased Spell Points and activated spell-tree nodes.

The current placeholder Rebirth replaces `RunState` while equipment and spell-tree state survive. That is intentionally provisional until prestige is designed; it must not become canon by accident.

## Numbers

Authoritative economy/combat magnitudes use `break_eternity.js` `Decimal` values. Serialization uses strings. UI receives `QuantitySnapshot` values (`raw` + `display`) rather than owning Decimal objects.

## Time and offline progress

The simulation is event-driven rather than frame-driven. `advance(seconds)` consumes time until the next spawn, cast, enemy attack, or encounter transition. The same method powers live play and offline/background catch-up, so renderer FPS and browser throttling cannot change authoritative outcomes.

The browser layer detects tab visibility. Hidden time is applied through `OfflineProgressor` when the tab becomes visible again, with presentation events suppressed and the normal offline cap applied.

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

Boss first-clears currently award more Essence. Exact curves remain prototype tuning.

## Spell tree

The current playtest tree is authored content with a centered Evercast root, connected pathing, minor/notable/mutation nodes, and Power/Speed/Projectile/Crit plus Arcane/Fire/Frost/Storm/Blood regions.

The engine stores only purchased points and activated node IDs, then compiles those nodes into the one true `SpellBuild`. UI layout geometry is separate from the node gameplay definitions.

Current elemental mechanics are prototype balance, not canon. In particular, control effects such as Frost still need systemic balance work.

## Gear

The eight persistent gear slots are Helm, Staff, Spellbook, Robe, Boots, Necklace, Ring I and Ring II. Gold levels each piece independently with additive stat growth. Automatic evolution milestones are currently 1/50/100/200/500/1000 and remain tunable.

Authored gear names, descriptions and tuning live in `src/content`; engine gear modules own state/evolution mechanics.

## Snapshots and coordinator size

`EvercastSimulation` is the orchestration boundary, not a dumping ground for every derived read model. Snapshot construction lives in `src/engine/snapshot/SimulationSnapshotBuilder.ts`, and event-to-text formatting lives in `src/engine/events/describeGameEvent.ts`.

As new systems arrive, prefer extracting cohesive builders/services rather than allowing `EvercastSimulation` to absorb unrelated presentation/read-model logic.

## Save / migration

`SaveCodec` owns versioned schema conversion. Browser `localStorage` remains in `src/app`. Existing saves migrate forward rather than silently resetting progression.

The current solver is exact event-driven catch-up. If endgame event frequency eventually makes long catch-up too expensive, `OfflineProgressor` is the seam for an analytical/bulk strategy without changing combat or save formats.

## Testing gates

`npm run validate` runs unit/integration tests and a production TypeScript/Vite build. GitHub Actions runs the same validation on PRs and `main`.

Coverage includes deterministic advancement, multi-enemy overlap, push/farm behavior, content references, spell compilation, gear, Spell Point economy/pathing, first-clear Essence, save migrations, offline catch-up, prestige reset boundaries, and architecture guards preventing presentation dependencies from entering `src/engine`.

## Still intentionally deferred

- final spell-tree balance/topology,
- bounded/diminishing control rules,
- final prestige behavior,
- gear-tree point sources and authored gear trees,
- final enemy/zone tuning,
- story content,
- production animation/VFX architecture and pooling,
- analytical endgame offline simulation,
- analytics/cloud saves/accounts.

# Evercast Architecture

Evercast is a deterministic incremental simulation with a 3D presentation layer.

## Non-negotiable boundary

`src/engine/**` must never import React, Babylon.js, browser storage, DOM APIs, or presentation assets.

The authoritative game can therefore run:

- in the browser with Babylon + React,
- headlessly in Node for balance testing,
- during offline catch-up,
- in automated tests,
- and later on a trusted server if validation is ever needed.

## Runtime dependency graph

```text
content/ (data)
   ↓
engine/ (authoritative deterministic game)
   ↓ snapshots + serializable GameEvents
┌───────────────┬──────────────────┐
↓               ↓                  ↓
app/           game/               ui/
persistence    Babylon             React
boot/offline    renderer            HUD/tree
```

No arrow is allowed to point back into `engine/` from React or Babylon.

## Engine modules

### State

`GameState` is split into two reset boundaries:

- `RunState`: frontier, current encounter, mode, Essence, spell build, combat timers, run stats.
- `MetaState`: Rebirth count, Knowledge, lifetime/highest-stage records, permanent unlock/story flags.

Rebirth replaces `RunState`; `MetaState` survives.

### Numbers

All authoritative economy/combat magnitudes use `break_eternity.js` `Decimal` values immediately. Serialization uses strings. UI receives `QuantitySnapshot` values (`raw` + `display`) instead of owning Decimal objects.

### Time

The simulation is event-driven rather than frame-driven. `advance(seconds)` consumes time until the next cast, enemy attack, or encounter transition. The same method powers live play and offline catch-up, so renderer FPS cannot change outcomes.

### Encounter system

Zones and enemies are data definitions. `EncounterSystem` uses the run seed + stage + run state to choose deterministic encounters. Boss cadence and zone length are configuration, not hard-coded renderer logic.

### Combat

`CombatSystem` resolves casts, deterministic critical hits, enemy attacks and triggered spell effects. Player casts win exact timer ties to keep ordering stable and player-friendly.

### Spell/effect foundation

The tree itself is intentionally not authored yet. The engine already accepts a data-driven `SpellBuild` containing:

- stat modifiers,
- trigger modifiers (`onHit`, `onCrit`, `onKill`),
- bonus damage,
- repeat projectiles,
- resource multipliers.

This is the foundation the future tree will compile into. The tree UI will not contain combat logic.

### Push / farm loop

A failed frontier fight switches the run into farm mode at the safest previously cleared non-boss stage. Farm kills continue generating Essence. After a configurable number of farm kills, the simulation automatically retries the frontier. UI can also issue a manual retry command.

### Events

The engine emits serializable `GameEvent` records. The Babylon layer reacts to visual events (cast, kill, death) but never reports collision/damage back to the engine. EventBus has ordering and runaway-event safety tests.

### Save / offline

`SaveCodec` is pure engine code and owns schema/version conversion. Browser `localStorage` lives in `src/app`. Offline progress advances the exact same deterministic simulation with presentation events disabled and a configurable catch-up cap.

The current solver is exact event-driven catch-up. If endgame cast frequencies eventually make very long catch-up too expensive, `OfflineProgressor` is the seam where we can add a bulk/analytical strategy without changing combat or save formats.

## Content layer

`src/content/**` owns authored definitions and cross-reference validation. Core systems consume a `ContentCatalog`, so tests or future modes can inject alternate catalogs.

## Presentation

### Babylon (`src/game`)

Responsible for models, animation, camera, lighting, particles, VFX and environment rendering. It consumes snapshots/events only.

### React (`src/ui`)

Responsible for HUD, future spell tree, prestige, lore and settings. It issues engine commands but does not mutate state directly.

### App (`src/app`)

Owns browser-only bootstrapping: save loading, offline catch-up, autosave and browser lifecycle hooks.

## Testing gates

`npm run validate` runs unit/integration tests then a production TypeScript/Vite build.

The test suite covers:

- renderer-independent advancement,
- deterministic same-seed outcomes,
- stronger builds outperforming weaker builds,
- push → defeat → farm behavior,
- nested event ordering,
- content-reference validation,
- spell modifier compilation,
- save round trips,
- offline catch-up and cap behavior,
- rebirth reset boundaries,
- an architecture guard preventing React/Babylon imports in `src/engine`.

GitHub Actions runs the same validation on PRs and `main`.

## Still intentionally deferred

These are content/design systems, not foundation blockers:

- the actual skill tree graph and economy,
- final prestige names/formulas/cadence,
- final enemy/zone tuning,
- story content,
- production GLB assets and animations,
- pooled endgame VFX implementation,
- analytics/cloud saves/accounts.

The architecture exposes seams for all of them without pretending their designs are already settled.

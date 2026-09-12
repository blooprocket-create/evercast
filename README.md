# Evercast

A 2.5D incremental fantasy game about one endlessly evolving spell.

## Stack

- Vite + TypeScript
- React for HUD, menus and the spell tree
- Babylon.js for the 3D side-scrolling diorama
- Headless deterministic simulation engine
- `break_eternity.js` for incremental-scale numbers

## Run locally

```bash
npm install
npm run dev
```

## Validate

```bash
npm run validate
```

Validation runs the full Vitest suite and a production Vite/TypeScript build.

## Architecture rules

- `src/content` owns authored enemies, zones, gear data and spell-tree definitions.
- `src/engine` owns deterministic state/rules and may not import React, Babylon.js or browser APIs.
- `src/ui` owns React presentation and presentation-only layout such as spell-tree geometry.
- `src/game` owns Babylon rendering, animation and VFX and reacts to snapshots/events rather than deciding combat outcomes.
- `src/app` owns browser lifecycle, persistence and background/offline catch-up.

See `docs/ARCHITECTURE.md`.

## Environment art

The Blender-authored environment library contains 39 props for Greenfields,
Whispering Woods, and Gravehollow. Editable source and preview sheets are in
`art/environment`; individual GLBs and their manifest are in
`public/models/environment`. See [the asset guide](art/environment/README.md)
for inventory, scale conventions, rebuild instructions, and integration notes.

The articulated cast includes the mage, all eight enemy types, and eight standalone
equipment files. Five animation clips drive travel, casting, attacks, hit reactions,
and defeat; equipment gains modeled details across all six evolution tiers.
Editable Blender source, a cast sheet, and rebuild instructions are in
[the character guide](art/characters/README.md).

The renderer adds matte materials, uneven terrain around a clear combat lane,
soft shadows, layered distant hills, wind, and lit biome landmarks. In development,
**N** previews the next biome and **Shift N** its transition; these shortcuts do not
change simulation progress or appear in production.

## Companions

Up to five companions fight alongside the mage, drawn from a 30-strong roster
across five rarities and six classes. They are real combatants: they swing on
their own timers, soak the blows aimed at the mage, and can be knocked out for
the rest of an encounter. Duplicates bank shards, and shards buy star levels.

Companions get their own section of the rail: a roster screen, a Party screen for
deploying them, and the Summon banner. Summons cost Starlight, a third wallet
earned from kills so the collection loop feeds off the combat loop without
competing with gear or Arcane Essence. The
reveal is animated, with a skip toggle in Settings and a Skip button on the
overlay itself.

Companion models are procedural placeholder art built from primitives at
runtime, not authored GLBs — `modelKey` is the seam a Blender pack would drop
into later. See the Companions section of [the architecture guide](docs/ARCHITECTURE.md).

## Spell tree

One spell, 127 nodes: three routes, nine identities with three-rank side paths,
nine mutations, nine pairwise fusions and two capstones per route - one that
answers a hit, one that answers a death.

The fork is sharp but not permanent. Attunements, bought with the Knowledge that
Rebirth pays out, widen the exclusive groups: take all three identities of a
route, then hold two routes at once, then all three. The routes compose rather
than exclude - Twin is how many projectiles, Piercing how many targets each one
reaches, Charged how hard and how slow - so a blended build is two heavy bolts
that each penetrate. A legal build grows from 18 points to 105 - everything but
the capstone you did not take, which stays a choice however much you unlock.

See [the v2 guide](docs/SPELL_TREE_V2.md) for the rules, tuning, blended-route
conventions and save migration, and [v1](docs/SPELL_TREE_V1.md) for the original
graph and its combat conventions.

# Evercast

A 2.5D incremental fantasy game about one endlessly evolving spell.

## Stack

- Vite + TypeScript
- React for HUD and future spell-tree UI
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

## Architecture rule

Nothing in `src/engine` may import React, Babylon.js or browser APIs. Combat, progression, saves and offline catch-up must remain deterministic and render-independent.

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

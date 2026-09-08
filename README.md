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

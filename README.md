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

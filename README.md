# Evercast

A 2.5D incremental fantasy game about one endlessly evolving spell.

## Stack

- Vite + TypeScript
- React for HUD and future spell-tree UI
- Babylon.js for the 3D side-scrolling diorama
- Headless custom simulation engine
- break_eternity.js reserved for incremental-scale numbers

## Run locally

```bash
npm install
npm run dev
```

## Validate

```bash
npm test
npm run build
```

## Architecture rule

Nothing in `src/engine` may import React or Babylon.js. The simulation must remain deterministic and render-independent.

See `docs/ARCHITECTURE.md`.

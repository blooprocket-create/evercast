# Evercast Architecture

Evercast is a deterministic incremental simulation with a 3D presentation layer.

## Non-negotiable boundary

`src/engine/**` must never import React or Babylon.js.

This lets the simulation run headlessly for balance tests, offline progress, automated build comparisons, and future server-side validation.

## Layers

1. **Engine** — combat, encounters, spell/effect graph, progression, prestige, offline math, saves.
2. **Content** — enemies, zones, bosses, skill nodes, story events; data rather than engine code.
3. **Game** — Babylon.js renderer, camera, models, animation, lighting, particles, VFX.
4. **UI** — React HUD, spell tree, stats, prestige, lore, settings.

## Current vertical slice

The scaffold deliberately implements only the core loop:

`travel → encounter → auto-cast → kill → reward → travel`

Boss placeholder: every 10th stage.
Zone placeholder: every 25 stages.

The skill tree is intentionally not implemented until the loop and pacing are agreed upon.

## Next technical milestones

- Replace primitive mage/enemy meshes with GLB assets.
- Add asset manifest + GLB loader pipeline.
- Add pooled projectile/VFX systems.
- Promote all economy values to `break_eternity.js` Decimal.
- Add seeded encounter generation.
- Add save schema/version migrations.
- Add offline progress solver.
- Build headless balance simulator CLI.
- Define effect event bus and spell graph only after the loop is locked.

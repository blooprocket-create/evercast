# Evercast environment props

39 original, static props made in Blender for Evercast's three requested biomes. Angular organic silhouettes, flat-shaded foliage, modeled decorative details, and matte PBR materials; no voxel geometry or external texture dependencies.

## Files

- `evercast_environment.blend`: editable mesh library with one named object per asset, grouped into three biome collections. Greenfields is visible initially; enable the other collections in the Outliner to inspect them. Objects are spaced on a library grid at their actual scale.
- `*_preview.png`: orthographic studio sheets. Props are individually scaled to fit each cell; these sheets do not show relative world scale.
- `../../public/models/environment/<biome>/*.glb`: individual, grounded game exports.
- `../../public/models/environment/manifest.json`: stable asset IDs, URLs, triangle counts, and source dimensions in meters (X width, Y depth, Z height).
- `validation.json`: Blender GLB round-trip verification results.

## Inventory

| Biome | Assets |
| --- | --- |
| Greenfields (13) | Grass clump A/B, flower patch A/B, rock A/B/C, healthy tree A/B/C, fallen log, small ruin stone, meadow waystone |
| Whispering Woods (11) | Dark tree A/B/C, root cluster, mushroom patch, bush clump, mossy rock A/B, forest shrine arch, forest fern, ancient fir |
| Gravehollow (15) | Dead tree A/B/C, gravestone A/B/C, broken fence segment, ruined arch, mausoleum, graveyard gate, cathedral tower/nave/buttress modules, bone pile with rubble, vigil lantern |

The tree variants have different heights, lean directions, branching arrangements, and crown proportions. Cathedral parts are separate static silhouette modules, with no interior. The gate is an open stone gateway. The shrine combines an arch, altar, jade relic, and climbing ivy.

## Game use

GLB exports use glTF's Y-up convention; Blender source uses Z-up. One unit is one meter. The export origin is at ground level and centered around the construction origin. Mesh transforms are applied, and materials are embedded. There are no cameras or lights in the individual exports.

Files are served directly by Vite, for example `/models/environment/greenfields/healthy_tree_a.glb`. `src/game/world/EnvironmentAssets.ts` registers Babylon's GLB 2.0 loader, loads each requested model once per scene, and instances it with shared geometry and materials. `EnvironmentPropCatalog.ts` controls weighted biome selection and scale; `WorldGenerator.ts` places the props, arrival landmarks, and cathedral assemblies into scrolling chunks.

Tall scenery stays behind the combat lane. Ground cover can appear on either verge. The existing staggered biome transitions still control selection, lighting, fog, and ground colors; imported props retain their authored materials. The placement wrapper rotates the imported model by 180 degrees so the Blender front faces the game's camera. It preserves the loader's coordinate conversion root.

Chunk cleanup disposes placements without destroying their shared templates. World cleanup releases the cache, including late downloads. Failed loads retain simple fallback scenery and are not repeatedly requested. Asset URLs respect Vite's configured base path.

These are static meshes without collision hulls, animation, or authored LODs. Foliage uses double-sided materials. Materials use solid colors and require no UV textures. For distant repeated trees, add LODs or reduce density after measuring the scene budget. Source mesh components can be separated in Blender by loose parts for further editing.

`npm run validate` checks the game, imports all 39 GLBs through Babylon, and covers matte materials, terrain winding and seams, cache sharing, chunk eviction during loading, world disposal, failed downloads, and placement coverage. In development, **N** previews the next biome and **Shift N** previews the transition without changing simulation progress.

Natural materials use roughness 1 and zero specular reflection in both Blender and Babylon. Actual iron and bronze retain muted highlights; jade and candles emit light. The exports include `KHR_materials_specular`. Scenery uses continuous ground heights, contact and directional shadows, wind, distant landscape layers, and at most two local landmark lights.

## Rebuild and verify

From the repository root, run with Blender 5.2:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' --background --factory-startup --python tools/blender/build_environment.py
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' --background --factory-startup --python tools/blender/validate_environment.py
```

Generation uses stable per-asset seeds. Rebuilding replaces the generated library, GLBs, manifest, and preview sheets. Preserve hand edits separately before rebuilding.

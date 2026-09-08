# Evercast cast and equipment

Original Blender models in the same matte, faceted fantasy style as the environment.
The pack has 17 GLBs: one mage, eight enemies, and eight standalone gear attachments.
No purchased assets, texture downloads, or voxel geometry are used.

## Inventory

- Mage: bent travelling hat, sculpted face and silver beard, tailored robe with pleats,
  shoulder mantle, belt, articulated sleeves and boots, ash staff with an amethyst focus,
  bound spellbook, pendant, and two rings.
- Moss Slime, Briarling, Road Imp, Ash Beetle, Hollow Crow, Road Warden, Crypt Hound,
  and Ember Wisp match every `modelKey` in the enemy content catalog.
- Equipment files: `gear_helm`, `gear_staff`, `gear_spellbook`, `gear_robe`, `gear_boots`,
  `gear_necklace`, `gear_ringLeft`, and `gear_ringRight`.

## Source and animation

`evercast_characters.blend` contains the editable production models arranged on a grid.
The mage retains its full attached equipment hierarchy. `cast_preview.png` is a studio
sheet with all equipment enhancements visible; the game enables them by evolution tier.
`../../public/models/characters/manifest.json` records URLs, triangle counts, and clips.

Each character uses an articulated transform hierarchy, not a deforming skinned rig.
Rigid joints retain crisp facets and support independent limb motion. Named Blender
NLA tracks export as `idle`, `walk`, `attack`, `hit`, and `death`, authored at 24 fps.
Crow wings flap, slime bodies squash and stretch, and other characters move their
limbs and bodies. Death is a one-shot pose followed by visual cleanup.

Blender uses Z-up with front -Y; GLBs are Y-up. Runtime placement preserves the glTF
conversion root and rotates the mage and enemies toward one another. The ground origin
is at the feet; hovering creatures include their intended altitude inside the model.
Standalone equipment uses the corresponding attachment's local coordinate space.

Every slot has `upgrade_<slot>_1` through `upgrade_<slot>_5` nodes. These add cumulative
filigree, prongs, runes, or jewelled settings at levels 50, 100, 200, 500, and 1000.
The staff's `socket_spell` node is the projectile origin. Gear stays attached during
movement and casting. Natural surfaces have zero specular reflection; only bronze
retains muted highlights. Magic accents use restrained emission.

## Rebuild and verification

From the repository root with Blender 5.2:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' --background --factory-startup --python tools/blender/build_characters.py
npm run validate
```

Generation replaces the GLBs, manifest, Blender library, and preview. Preserve hand
edits separately before rebuilding. Tests import all 17 GLBs through Babylon and check
catalog coverage, animation clips, independent instances, pose recovery, all gear tiers,
staff socket motion, late downloads, and fallbacks. These are alpha assets: deforming
skin, authored LODs, and additional attack variations can be added without changing
combat logic.

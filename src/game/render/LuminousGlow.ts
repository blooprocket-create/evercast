import {
  Color3,
  GlowLayer,
  MultiMaterial,
  PBRMaterial,
  Scene,
  StandardMaterial,
} from '@babylonjs/core';
import type { AbstractMesh, Material } from '@babylonjs/core';

/**
 * The glow pass, over the things that actually glow.
 *
 * `GlowLayer` renders the scene a second time into its own target and then
 * blurs and adds the result. Left to itself it renders *everything*: the
 * terrain, the road, every blade of grass and every tree in frame, each of them
 * resolved through a custom selector that answers "black" for all but a handful.
 * Measured on the road at 1280x720, that was around four hundred and eighty
 * draw calls a frame spent proving that grass does not shine.
 *
 * `hasMesh` is the supported way to say otherwise - `EffectLayer` calls it to
 * decide what belongs in the pass at all - and the answer is already written on
 * every material the game ships, in the names the models were authored with.
 * The same regex drives both, so a mesh can no longer be in the pass without
 * being able to contribute to it.
 */

/**
 * What is lit from inside: the spell effects, the arcane parts of the gear the
 * mage is wearing, the candle in a wayside lantern, the inlay on a shrine.
 */
export const LUMINOUS = /VFX \/|Arcane \/|Lantern \/ candle|Shrine \/ jade inlay/;

export function isLuminousMaterial(name: string | undefined | null): boolean {
  return name !== undefined && name !== null && LUMINOUS.test(name);
}

/**
 * Whether a mesh's material - or, if it carries several, any one of them - can
 * contribute to the pass.
 *
 * The sub-material branch is belt and braces rather than a fix for anything
 * shipped: Babylon's glTF loader splits a multi-primitive mesh into one mesh
 * per primitive, each with a single material, so the lantern's candle and the
 * shrine's inlay arrive as meshes of their own and match by name. A
 * `MultiMaterial` would not, and the failure would be silent and asset-shaped -
 * a prop that simply stopped glowing - so the three lines are worth having.
 */
export function isLuminousSurface(material: Material | null): boolean {
  if (!material) return false;
  if (isLuminousMaterial(material.name)) return true;
  return (
    material instanceof MultiMaterial &&
    material.subMaterials.some((sub) => isLuminousMaterial(sub?.name))
  );
}

export class LuminousGlow extends GlowLayer {
  constructor(scene: Scene, blurKernelSize: number, intensity: number) {
    super('glow', scene, { blurKernelSize });
    this.intensity = intensity;
    this.customEmissiveColorSelector = (_mesh, _subMesh, material, result) => {
      const color =
        isLuminousMaterial(material?.name) &&
        (material instanceof PBRMaterial || material instanceof StandardMaterial)
          ? material.emissiveColor
          : Color3.Black();
      result.set(color.r, color.g, color.b, 1);
    };
  }

  /**
   * Called per mesh, per frame, by the layer itself.
   *
   * A mesh whose material cannot answer the selector with anything but black
   * has nothing to add, so it is not drawn. `super.hasMesh` still has the last
   * word, which is what keeps the layer's own include/exclude lists working.
   */
  override hasMesh(mesh: AbstractMesh): boolean {
    return isLuminousSurface(mesh.material) && super.hasMesh(mesh);
  }
}

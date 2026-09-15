import { Color3, PBRMaterial } from '@babylonjs/core';
import { type AtmosphereResponse, type AtmosphereState, breatheOn } from '../render/Atmosphere';

/**
 * Which props bend, and how far.
 *
 * Amplitude is world units of sway per unit of height above the prop's own
 * base, so one number covers a blade of grass and a four-metre tree: the tree
 * moves further because it is taller, not because it is authored to. The
 * values are the ones the CPU wind used, converted from the radians it rotated
 * a whole prop by - a tree swung 0.004 radians about its root, which at the top
 * of a four-metre trunk was about sixteen millimetres.
 */
const WIND = [
  { match: /grass_clump|flower_patch|forest_fern|mushroom_patch/, amplitude: 0.055 },
  { match: /bush_clump|root_cluster/, amplitude: 0.03 },
  { match: /tree|fir/, amplitude: 0.012 },
] as const;

/** Only the parts thin enough for a low sun to come through. */
const FOLIAGE = /^(Leaf|Moss|Flower|Petal|Frond) \//;

/**
 * What the air and the light do to one environment surface.
 *
 * Keyed off the material name and the asset it arrived in, both of which the
 * models already carry - the same reasoning as `StylizedMaterials`, which reads
 * `Iron /` and `Arcane /` rather than inventing a parallel classification.
 */
export function environmentResponse(materialName: string, assetId: string): AtmosphereResponse {
  if (!FOLIAGE.test(materialName)) return {};
  const wind = WIND.find((rule) => rule.match.test(assetId))?.amplitude ?? 0;
  // A flower petal is thinner than a leaf and reads brighter against the sun.
  const translucency = materialName.startsWith('Flower /') ? 0.5 : 0.34;
  return { wind, translucency };
}

/** The environment is painted and matte; only actual iron/bronze retains a muted highlight. */
export function finishEnvironmentMaterial(
  material: PBRMaterial,
  assetId = '',
  atmosphere?: AtmosphereState,
): void {
  const metal = /Iron \/|tarnished bronze/.test(material.name);
  material.roughness = metal ? 0.78 : 1;
  material.metallic = metal ? 0.35 : 0;
  material.specularIntensity = metal ? 0.28 : 0;
  material.metallicF0Factor = metal ? 0.45 : 0;
  material.environmentIntensity = metal ? 0.25 : 0;
  material.clearCoat.isEnabled = false;
  material.sheen.isEnabled = false;
  material.useSpecularOverAlpha = false;
  material.useRadianceOverAlpha = false;
  // Reduce the palette's face-to-face contrast so leaves read as foliage, not cut gems.
  const foliage: Record<string, string> = {
    'Leaf / fern': '#708B56', 'Leaf / sunlit': '#87A366', 'Leaf / sage': '#79965B',
    'Leaf / deep jade': '#376B59', 'Leaf / blue spruce': '#467C65', 'Leaf / moss edge': '#548D68',
    'Moss / chartreuse': '#617847',
  };
  const hex = foliage[material.name];
  if (hex) material.albedoColor = Color3.FromHexString(hex).toLinearSpace();
  if (material.name === 'Shrine / jade inlay') {
    material.emissiveColor = new Color3(0.055, 0.18, 0.12);
  }
  if (material.name === 'Lantern / candle') material.emissiveColor = new Color3(0.85, 0.24, 0.035);
  // After the albedo: the translucent colour is mixed from it, so a leaf tinted
  // above would otherwise glow in the palette colour it no longer wears.
  if (atmosphere) breatheOn(material, atmosphere, environmentResponse(material.name, assetId));
}

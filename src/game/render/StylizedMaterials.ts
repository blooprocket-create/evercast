import { Color3, PBRMaterial } from '@babylonjs/core';

/**
 * How the actors are shaded.
 *
 * The models arrive with one flat base colour per material and no texture of
 * any kind, and their UVs are palette-style - every vertex of a face shares one
 * texel - so a tiled detail or normal map would render as a flat colour, not as
 * detail. Surface interest therefore has to come from how each material
 * *responds* to light rather than from anything painted on it: roughness, a
 * cloth sheen that catches the rim light, a metal that actually has a
 * highlight, and arcane parts that read as lit from inside.
 *
 * The material names carry the intent already - `Iron /`, `Arcane /`, `Cast /` -
 * so this reads them rather than inventing a parallel classification.
 */

type Family = 'metal' | 'arcane' | 'cloth' | 'leather' | 'skin' | 'matte';

/** Ordered: the first hit wins, so the specific names come before the general. */
const CLOTH = /fold|lining|plumage|feather|robe|ink|midnight plum/i;
const LEATHER = /leather|oxblood|slate|blue slate/i;
const SKIN = /skin|beard|ivory/i;

export function familyOf(name: string): Family {
  if (name.startsWith('Iron /')) return 'metal';
  if (name.startsWith('Arcane /')) return 'arcane';
  if (CLOTH.test(name)) return 'cloth';
  if (LEATHER.test(name)) return 'leather';
  if (SKIN.test(name)) return 'skin';
  return 'matte';
}

/**
 * Applied to every actor material on load. Previously this set roughness to 1
 * and specular to 0 on everything, which flattened the arcane materials'
 * authored emissive along with the rest and left the rim light nothing to catch.
 */
export function stylizeActorMaterial(material: PBRMaterial): void {
  const family = familyOf(material.name);
  // No environment texture is loaded, so image-based lighting would only wash
  // the palette out. All of the shaping below comes from the three real lights.
  material.environmentIntensity = 0;

  switch (family) {
    case 'metal':
      material.metallic = 0.55;
      material.roughness = 0.42;
      material.specularIntensity = 0.6;
      material.metallicF0Factor = 0.55;
      break;

    case 'arcane':
      // Lit from inside: the authored emissiveFactor is kept and lifted, and
      // the glow layer picks these up by name.
      material.metallic = 0;
      material.roughness = 0.25;
      material.specularIntensity = 0.8;
      material.emissiveColor = material.emissiveColor.scale(1.6);
      material.emissiveIntensity = 1.35;
      break;

    case 'cloth':
      material.metallic = 0;
      material.roughness = 0.92;
      material.specularIntensity = 0.08;
      // Sheen is what makes cloth read as cloth under a backlight: a soft,
      // wide, off-angle highlight along the silhouette rather than a hotspot.
      material.sheen.isEnabled = true;
      material.sheen.intensity = 0.42;
      material.sheen.roughness = 0.45;
      material.sheen.color = Color3.Lerp(material.albedoColor, Color3.White(), 0.55);
      material.sheen.albedoScaling = true;
      break;

    case 'leather':
      material.metallic = 0;
      material.roughness = 0.6;
      material.specularIntensity = 0.3;
      break;

    case 'skin':
      material.metallic = 0;
      material.roughness = 0.75;
      material.specularIntensity = 0.22;
      break;

    case 'matte':
      material.metallic = 0;
      material.roughness = 0.95;
      material.specularIntensity = 0.14;
      break;
  }
}

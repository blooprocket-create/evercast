import { Color3, PBRMaterial } from '@babylonjs/core';

/** The environment is painted and matte; only actual iron/bronze retains a muted highlight. */
export function finishEnvironmentMaterial(material: PBRMaterial): void {
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
}

import { Color3, Mesh, MeshBuilder, PBRMaterial, Scene, TransformNode, Vector3 } from '@babylonjs/core';
import type { CompanionClass, CompanionModelKey, CompanionRarity } from '../../engine/companions/types';
import { stylizeActorMaterial } from '../render/StylizedMaterials';

/**
 * Placeholder programmer art, built from primitives at runtime.
 *
 * The authored cast is Blender-sourced GLB (see art/characters/README.md), and
 * companions will join it the same way - `modelKey` is already the seam. Until
 * then these are composed here rather than shipped as thirty more binaries,
 * and they are shaped for one job: reading as what they are at the pinned
 * 17.5-unit camera distance, through depth of field, at a silhouette's worth
 * of pixels. Hence blunt, separated masses and no detail below ~8cm.
 */

/** Class tint, kept away from the rarity accents so the two never fight. */
const CLASS_TINT: Readonly<Record<CompanionClass, [number, number, number]>> = {
  vanguard: [0.19, 0.22, 0.28],
  bruiser: [0.3, 0.19, 0.14],
  trickster: [0.15, 0.18, 0.23],
  ranger: [0.18, 0.26, 0.19],
  arcanist: [0.2, 0.17, 0.3],
  support: [0.3, 0.27, 0.21],
};

/** Rarity accent, matching the interface's ramp: grey, green, purple, gold, hot. */
const RARITY_ACCENT: Readonly<Record<CompanionRarity, [number, number, number]>> = {
  common: [0.36, 0.4, 0.34],
  rare: [0.26, 0.52, 0.4],
  epic: [0.42, 0.32, 0.72],
  legendary: [0.66, 0.48, 0.16],
  mythical: [0.78, 0.34, 0.14],
};

export interface CompanionBuild {
  root: TransformNode;
  meshes: Mesh[];
  materials: PBRMaterial[];
  /** Parts the idle animation sways, and the attack swings. */
  limbs: TransformNode[];
  /** Hovering models bob instead of stepping, and never plant a foot. */
  hovers: boolean;
  /** Where a projectile or effect should originate. */
  muzzle: Vector3;
}

interface BuildContext {
  scene: Scene;
  name: string;
  body: PBRMaterial;
  accent: PBRMaterial;
  meshes: Mesh[];
  limbs: TransformNode[];
}

/**
 * `glow` is a hint, not a light source.
 *
 * At 0.55 of albedo the accents cleared the pipeline's 0.7 bloom threshold and
 * came back white, so a legendary's gold and a mythical's ember were the same
 * blown-out slab on screen - which is exactly backwards for the one cue that
 * has to read at a glance. The environment art guide says the same thing about
 * its own emissives: restrained.
 */
function matte(scene: Scene, name: string, rgb: readonly [number, number, number], glow = 0): PBRMaterial {
  const material = new PBRMaterial(name, scene);
  material.albedoColor = new Color3(rgb[0], rgb[1], rgb[2]);
  material.metallic = 0;
  material.roughness = 1;
  material.specularIntensity = 0;
  if (glow > 0) material.emissiveColor = new Color3(rgb[0] * glow, rgb[1] * glow, rgb[2] * glow);
  stylizeActorMaterial(material);
  return material;
}

/** Only the top two tiers carry any light of their own. */
const RARITY_GLOW: Readonly<Record<CompanionRarity, number>> = {
  common: 0,
  rare: 0,
  epic: 0,
  legendary: 0.14,
  mythical: 0.2,
};

function box(
  context: BuildContext,
  part: string,
  size: { width: number; height: number; depth: number },
  position: Vector3,
  material = context.body,
): Mesh {
  const mesh = MeshBuilder.CreateBox(`${context.name}-${part}`, size, context.scene);
  mesh.position.copyFrom(position);
  mesh.material = material;
  mesh.isPickable = false;
  context.meshes.push(mesh);
  return mesh;
}

function ball(
  context: BuildContext,
  part: string,
  diameter: number,
  position: Vector3,
  material = context.body,
): Mesh {
  const mesh = MeshBuilder.CreateSphere(
    `${context.name}-${part}`,
    { diameter, segments: 6 },
    context.scene,
  );
  mesh.position.copyFrom(position);
  mesh.material = material;
  mesh.isPickable = false;
  context.meshes.push(mesh);
  return mesh;
}

function post(
  context: BuildContext,
  part: string,
  options: { height: number; diameterTop?: number; diameterBottom?: number },
  position: Vector3,
  material = context.body,
): Mesh {
  const mesh = MeshBuilder.CreateCylinder(
    `${context.name}-${part}`,
    {
      height: options.height,
      diameterTop: options.diameterTop ?? 0.16,
      diameterBottom: options.diameterBottom ?? 0.16,
      tessellation: 7,
    },
    context.scene,
  );
  mesh.position.copyFrom(position);
  mesh.material = material;
  mesh.isPickable = false;
  context.meshes.push(mesh);
  return mesh;
}

/** Two legs, shared by every upright build. */
function legs(context: BuildContext, height: number): void {
  for (const side of [-1, 1]) {
    post(context, `leg${side}`, { height, diameterTop: 0.17, diameterBottom: 0.14 },
      new Vector3(0, height / 2, side * 0.13));
  }
}

const BUILDERS: Record<CompanionModelKey, (context: BuildContext) => Omit<CompanionBuild, 'root' | 'meshes' | 'materials'>> = {
  /* A slab of a shield and a blunt helm: the thing standing in front. */
  humanoid_heavy: (context) => {
    legs(context, 0.42);
    box(context, 'torso', { width: 0.44, height: 0.5, depth: 0.6 }, new Vector3(0, 0.69, 0));
    box(context, 'pauldron', { width: 0.5, height: 0.14, depth: 0.78 }, new Vector3(0, 0.95, 0));
    box(context, 'helm', { width: 0.3, height: 0.26, depth: 0.34 }, new Vector3(0.02, 1.12, 0));
    const shield = box(context, 'shield', { width: 0.1, height: 0.62, depth: 0.5 },
      new Vector3(0.3, 0.72, -0.36), context.accent);
    const arm = post(context, 'arm', { height: 0.42 }, new Vector3(0.06, 0.72, 0.34));
    context.limbs.push(shield, arm);
    return { limbs: context.limbs, hovers: false, muzzle: new Vector3(0.34, 0.8, 0.3) };
  },

  /* Narrow, hooded, and carrying something short. */
  humanoid_light: (context) => {
    legs(context, 0.46);
    box(context, 'torso', { width: 0.3, height: 0.46, depth: 0.4 }, new Vector3(0, 0.69, 0));
    const hood = MeshBuilder.CreateCylinder(`${context.name}-hood`,
      { height: 0.3, diameterTop: 0.04, diameterBottom: 0.32, tessellation: 7 }, context.scene);
    hood.position.set(0, 1.05, 0);
    hood.material = context.accent;
    hood.isPickable = false;
    context.meshes.push(hood);
    box(context, 'cloak', { width: 0.1, height: 0.62, depth: 0.42 }, new Vector3(-0.17, 0.68, 0), context.accent);
    const blade = box(context, 'blade', { width: 0.07, height: 0.46, depth: 0.07 }, new Vector3(0.18, 0.74, 0.28));
    context.limbs.push(blade);
    return { limbs: context.limbs, hovers: false, muzzle: new Vector3(0.24, 0.9, 0.26) };
  },

  /* A cone of robe, a staff, and a light at the top of it. */
  humanoid_robed: (context) => {
    const robe = MeshBuilder.CreateCylinder(`${context.name}-robe`,
      { height: 0.86, diameterTop: 0.34, diameterBottom: 0.66, tessellation: 8 }, context.scene);
    robe.position.set(0, 0.43, 0);
    robe.material = context.body;
    robe.isPickable = false;
    context.meshes.push(robe);
    box(context, 'shoulders', { width: 0.34, height: 0.12, depth: 0.46 }, new Vector3(0, 0.92, 0));
    ball(context, 'head', 0.28, new Vector3(0.02, 1.1, 0));
    const staff = post(context, 'staff', { height: 1.12, diameterTop: 0.06, diameterBottom: 0.06 },
      new Vector3(0.22, 0.62, 0.26));
    const focus = ball(context, 'focus', 0.19, new Vector3(0.22, 1.2, 0.26), context.accent);
    context.limbs.push(staff, focus);
    return { limbs: context.limbs, hovers: false, muzzle: new Vector3(0.22, 1.2, 0.26) };
  },

  /* Low, long, four-legged. */
  beast_quadruped: (context) => {
    for (const side of [-1, 1]) {
      for (const front of [-1, 1]) {
        post(context, `leg${side}${front}`, { height: 0.34, diameterTop: 0.13, diameterBottom: 0.11 },
          new Vector3(front * 0.24, 0.17, side * 0.17));
      }
    }
    box(context, 'body', { width: 0.72, height: 0.34, depth: 0.42 }, new Vector3(0, 0.5, 0));
    const head = box(context, 'head', { width: 0.32, height: 0.26, depth: 0.3 }, new Vector3(0.44, 0.58, 0));
    box(context, 'crest', { width: 0.22, height: 0.16, depth: 0.1 }, new Vector3(0.36, 0.76, 0), context.accent);
    const tail = post(context, 'tail', { height: 0.36, diameterTop: 0.05, diameterBottom: 0.12 },
      new Vector3(-0.42, 0.56, 0), context.accent);
    context.limbs.push(head, tail);
    return { limbs: context.limbs, hovers: false, muzzle: new Vector3(0.58, 0.6, 0) };
  },

  /* A core that never touches the ground, with shards around it. */
  floating_orb: (context) => {
    const core = ball(context, 'core', 0.46, new Vector3(0, 0.92, 0), context.accent);
    for (let index = 0; index < 3; index += 1) {
      const angle = (index / 3) * Math.PI * 2;
      const shard = box(context, `shard${index}`, { width: 0.11, height: 0.26, depth: 0.11 },
        new Vector3(Math.cos(angle) * 0.36, 0.92 + Math.sin(angle) * 0.12, Math.sin(angle) * 0.36));
      shard.rotation.z = angle;
      context.limbs.push(shard);
    }
    ball(context, 'halo', 0.2, new Vector3(0, 1.26, 0));
    context.limbs.push(core);
    return { limbs: context.limbs, hovers: true, muzzle: new Vector3(0, 0.92, 0) };
  },

  /* A body between two plates that beat. */
  winged_creature: (context) => {
    post(context, 'body', { height: 0.5, diameterTop: 0.2, diameterBottom: 0.3 }, new Vector3(0, 0.62, 0));
    const neck = post(context, 'neck', { height: 0.32, diameterTop: 0.1, diameterBottom: 0.16 },
      new Vector3(0.18, 0.94, 0));
    neck.rotation.z = -0.5;
    box(context, 'head', { width: 0.26, height: 0.16, depth: 0.16 }, new Vector3(0.34, 1.06, 0));
    for (const side of [-1, 1]) {
      const wing = box(context, `wing${side}`, { width: 0.5, height: 0.06, depth: 0.44 },
        new Vector3(-0.04, 0.82, side * 0.34), context.accent);
      wing.rotation.x = side * 0.3;
      context.limbs.push(wing);
    }
    post(context, 'legs', { height: 0.34, diameterTop: 0.1, diameterBottom: 0.08 }, new Vector3(0, 0.2, 0));
    context.limbs.push(neck);
    return { limbs: context.limbs, hovers: false, muzzle: new Vector3(0.42, 1.06, 0) };
  },
};

/** Builds one companion under a fresh root, ready to be positioned. */
export function buildCompanion(
  scene: Scene,
  name: string,
  modelKey: CompanionModelKey,
  companionClass: CompanionClass,
  rarity: CompanionRarity,
  stars: number,
): CompanionBuild {
  const root = new TransformNode(name, scene);
  const body = matte(scene, `${name}-body`, CLASS_TINT[companionClass]);
  const accent = matte(scene, `${name}-accent`, RARITY_ACCENT[rarity], RARITY_GLOW[rarity]);
  const context: BuildContext = { scene, name, body, accent, meshes: [], limbs: [] };

  const built = BUILDERS[modelKey](context);
  for (const mesh of context.meshes) mesh.parent = root;

  // Star pips float above the head: ascension has to be visible on the field,
  // not only in the roster.
  const pips: Mesh[] = [];
  for (let index = 0; index < stars; index += 1) {
    const pip = MeshBuilder.CreateBox(`${name}-pip${index}`, { size: 0.075 }, scene);
    pip.position.set(0, 1.46, (index - (stars - 1) / 2) * 0.13);
    pip.rotation.y = Math.PI / 4;
    pip.material = accent;
    pip.parent = root;
    pip.isPickable = false;
    pips.push(pip);
  }

  return {
    root,
    meshes: [...context.meshes, ...pips],
    materials: [body, accent],
    limbs: built.limbs,
    hovers: built.hovers,
    muzzle: built.muzzle,
  };
}

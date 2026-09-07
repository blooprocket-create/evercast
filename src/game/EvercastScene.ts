import {
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  GlowLayer,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  ParticleSystem,
  Scene,
  StandardMaterial,
  Vector3,
} from '@babylonjs/core';
import type { GameEvent } from '../engine/events/GameEvent';
import type { GearSlot } from '../engine/gear/types';
import type { SimulationSnapshot } from '../engine/types';
import {
  earnedJourneyStages,
  initialJourneyTravelSeconds,
  WORLD_TRAVEL_SECONDS_PER_STAGE,
} from './world/JourneyProgress';
import { WorldGenerator } from './world/WorldGenerator';

export class EvercastScene {
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly mage: Mesh;
  private readonly enemy: Mesh;
  private readonly world: WorldGenerator;
  private readonly gearMeshes = new Map<GearSlot, Mesh>();
  private readonly gearTiers = new Map<GearSlot, number>();
  private travelPhase = 0;
  private journeyInitialized = false;
  private visualFrontierStage = 1;
  private pendingWorldTravelSeconds = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true });
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.025, 0.035, 0.06, 1);

    const camera = new ArcRotateCamera('camera', -Math.PI / 2, Math.PI / 2.35, 15, new Vector3(1.4, 1.25, 0), this.scene);
    camera.lowerRadiusLimit = 15;
    camera.upperRadiusLimit = 15;
    camera.inputs.clear();

    const skyLight = new HemisphericLight('sky', new Vector3(0, 1, 0), this.scene);
    skyLight.intensity = 0.65;
    const sun = new DirectionalLight('sun', new Vector3(-0.7, -1, -0.4), this.scene);
    sun.position = new Vector3(8, 12, -4);
    sun.intensity = 2.2;

    new GlowLayer('glow', this.scene, { blurKernelSize: 32 }).intensity = 0.7;

    this.world = new WorldGenerator(this.scene, skyLight, sun);
    this.mage = this.createMage();
    this.enemy = this.createEnemy();

    this.engine.runRenderLoop(() => this.scene.render());
    window.addEventListener('resize', this.resize);
    window.addEventListener('keydown', this.keydown);
  }

  sync(snapshot: SimulationSnapshot, deltaSeconds: number, events: readonly GameEvent[]): void {
    this.travelPhase += deltaSeconds;
    const walking = snapshot.phase === 'travel';
    this.syncJourney(snapshot, deltaSeconds, walking);
    this.syncGearVisuals(snapshot);

    this.mage.position.y = 0.65 + (walking ? Math.sin(this.travelPhase * 8) * 0.035 : 0);
    this.mage.rotation.z = walking ? Math.sin(this.travelPhase * 8) * 0.01 : 0;
    this.enemy.setEnabled(!walking);
    this.enemy.scaling.setAll(snapshot.boss ? 1.5 : 1);

    for (const event of events) {
      if (event.type === 'spell_cast') this.spawnArcaneBolt();
      if (event.type === 'enemy_killed') this.spawnBurst(this.enemy.position.clone());
      if (event.type === 'mage_defeated' || event.type === 'gear_evolved') this.spawnBurst(this.mage.position.clone());
    }
  }

  dispose(): void {
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('keydown', this.keydown);
    this.world.dispose();
    this.scene.dispose();
    this.engine.dispose();
  }

  private readonly resize = (): void => this.engine.resize();

  private readonly keydown = (event: KeyboardEvent): void => {
    if (event.key.toLowerCase() === 'n') this.world.jumpToNextBiome();
  };

  private syncJourney(snapshot: SimulationSnapshot, deltaSeconds: number, walking: boolean): void {
    if (!this.journeyInitialized) {
      this.visualFrontierStage = Math.max(1, snapshot.stage);
      const initialTravel = initialJourneyTravelSeconds(this.visualFrontierStage);
      if (initialTravel > 0) this.world.update(initialTravel, true);
      this.journeyInitialized = true;
    }

    const newlyEarnedStages = earnedJourneyStages({
      mode: snapshot.mode,
      frontierStage: snapshot.stage,
      visualFrontierStage: this.visualFrontierStage,
    });

    if (newlyEarnedStages > 0) {
      this.pendingWorldTravelSeconds += newlyEarnedStages * WORLD_TRAVEL_SECONDS_PER_STAGE;
      this.visualFrontierStage = snapshot.stage;
    }

    // World position is earned by clearing frontier stages. Farming and same-stage retries
    // deliberately contribute no distance, so a boss wall cannot drift into a new biome.
    if (snapshot.mode === 'push' && walking && this.pendingWorldTravelSeconds > 0) {
      const travelStep = Math.min(deltaSeconds, this.pendingWorldTravelSeconds);
      this.world.update(travelStep, true);
      this.pendingWorldTravelSeconds -= travelStep;
      return;
    }

    // Keep the journey anchored while stuck. The renderer still renders combat/VFX; this call
    // avoids the WorldGenerator's old time-based background creep from advancing the biome.
    this.world.update(0, false);
  }

  private createMage(): Mesh {
    const body = MeshBuilder.CreateCylinder('mage', { height: 1.25, diameterTop: 0.42, diameterBottom: 0.9, tessellation: 10 }, this.scene);
    body.position = new Vector3(-3.2, 0.65, 0);
    const robeMat = this.gearMaterial('robeMat', new Color3(0.16, 0.13, 0.34));
    body.material = robeMat;
    this.gearMeshes.set('robe', body);

    const head = MeshBuilder.CreateSphere('mageHead', { diameter: 0.48, segments: 12 }, this.scene);
    head.parent = body;
    head.position.y = 0.78;
    const headMat = new PBRMaterial('headMat', this.scene);
    headMat.albedoColor = new Color3(0.72, 0.57, 0.44);
    headMat.roughness = 0.8;
    head.material = headMat;

    const hat = MeshBuilder.CreateCylinder('hat', { height: 0.85, diameterTop: 0, diameterBottom: 0.9, tessellation: 12 }, this.scene);
    hat.parent = body;
    hat.position.y = 1.25;
    hat.rotation.z = -0.15;
    hat.material = this.gearMaterial('helmMat', new Color3(0.13, 0.11, 0.28));
    this.gearMeshes.set('helm', hat);

    const staff = MeshBuilder.CreateCylinder('staff', { height: 1.8, diameter: 0.075, tessellation: 8 }, this.scene);
    staff.parent = body;
    staff.position = new Vector3(0.62, 0.12, -0.05);
    staff.rotation.z = -0.18;
    staff.material = this.gearMaterial('staffMat', new Color3(0.28, 0.18, 0.09));
    const staffGem = MeshBuilder.CreatePolyhedron('staffGem', { type: 2, size: 0.16 }, this.scene);
    staffGem.parent = staff;
    staffGem.position.y = 1.02;
    staffGem.material = this.gearMaterial('staffGemMat', new Color3(0.25, 0.2, 0.55));
    this.gearMeshes.set('staff', staff);

    const book = MeshBuilder.CreateBox('spellbook', { width: 0.42, height: 0.52, depth: 0.12 }, this.scene);
    book.parent = body;
    book.position = new Vector3(-0.48, 0.25, -0.22);
    book.rotation.z = 0.12;
    book.material = this.gearMaterial('spellbookMat', new Color3(0.25, 0.08, 0.12));
    this.gearMeshes.set('spellbook', book);

    const boots = MeshBuilder.CreateBox('boots', { width: 0.56, height: 0.18, depth: 0.46 }, this.scene);
    boots.parent = body;
    boots.position = new Vector3(0, -0.69, 0.02);
    boots.material = this.gearMaterial('bootsMat', new Color3(0.14, 0.08, 0.05));
    this.gearMeshes.set('boots', boots);

    const necklace = MeshBuilder.CreateTorus('necklace', { diameter: 0.28, thickness: 0.035, tessellation: 12 }, this.scene);
    necklace.parent = body;
    necklace.position = new Vector3(0, 0.55, -0.24);
    necklace.rotation.x = Math.PI / 2;
    necklace.material = this.gearMaterial('necklaceMat', new Color3(0.42, 0.34, 0.12));
    this.gearMeshes.set('necklace', necklace);

    const ringLeft = MeshBuilder.CreateSphere('ringLeft', { diameter: 0.09, segments: 6 }, this.scene);
    ringLeft.parent = body;
    ringLeft.position = new Vector3(-0.53, 0.08, -0.15);
    ringLeft.material = this.gearMaterial('ringLeftMat', new Color3(0.34, 0.31, 0.18));
    this.gearMeshes.set('ringLeft', ringLeft);

    const ringRight = MeshBuilder.CreateSphere('ringRight', { diameter: 0.09, segments: 6 }, this.scene);
    ringRight.parent = body;
    ringRight.position = new Vector3(0.49, 0.08, -0.16);
    ringRight.material = this.gearMaterial('ringRightMat', new Color3(0.34, 0.31, 0.18));
    this.gearMeshes.set('ringRight', ringRight);

    return body;
  }

  private gearMaterial(name: string, color: Color3): PBRMaterial {
    const material = new PBRMaterial(name, this.scene);
    material.albedoColor = color;
    material.metallic = 0.05;
    material.roughness = 0.72;
    return material;
  }

  private syncGearVisuals(snapshot: SimulationSnapshot): void {
    for (const piece of snapshot.gear) {
      if (this.gearTiers.get(piece.slot) === piece.evolutionTier) continue;
      this.gearTiers.set(piece.slot, piece.evolutionTier);
      const mesh = this.gearMeshes.get(piece.slot);
      if (!mesh) continue;
      const material = mesh.material;
      if (material instanceof PBRMaterial) {
        const tier = piece.evolutionTier;
        material.metallic = Math.min(0.65, 0.05 + tier * 0.11);
        material.roughness = Math.max(0.28, 0.72 - tier * 0.07);
        material.emissiveColor = new Color3(0.06 * tier, 0.045 * tier, 0.1 * tier);
      }
      if (piece.slot !== 'robe') {
        const scale = 1 + piece.evolutionTier * 0.08;
        mesh.scaling.setAll(scale);
      }
    }
  }

  private createEnemy(): Mesh {
    const enemy = MeshBuilder.CreatePolyhedron('enemy', { type: 2, size: 0.75 }, this.scene);
    enemy.position = new Vector3(4, 0.68, 0);
    const material = new PBRMaterial('enemyMat', this.scene);
    material.albedoColor = new Color3(0.2, 0.48, 0.2);
    material.roughness = 0.75;
    enemy.material = material;
    enemy.setEnabled(false);
    return enemy;
  }

  private spawnArcaneBolt(): void {
    if (!this.enemy.isEnabled()) return;
    const bolt = MeshBuilder.CreateSphere(`bolt-${performance.now()}`, { diameter: 0.22, segments: 8 }, this.scene);
    bolt.position = this.mage.position.add(new Vector3(0.55, 0.35, 0));
    const material = new StandardMaterial(`boltMat-${performance.now()}`, this.scene);
    material.emissiveColor = new Color3(0.45, 0.4, 1);
    material.disableLighting = true;
    bolt.material = material;

    const start = bolt.position.clone();
    const end = this.enemy.position.clone();
    const duration = 220;
    const started = performance.now();

    const observer = this.scene.onBeforeRenderObservable.add(() => {
      const t = Math.min((performance.now() - started) / duration, 1);
      bolt.position = Vector3.Lerp(start, end, t);
      if (t >= 1) {
        this.scene.onBeforeRenderObservable.remove(observer);
        bolt.dispose(false, true);
      }
    });
  }

  private spawnBurst(position: Vector3): void {
    const emitter = MeshBuilder.CreateSphere(`burst-${performance.now()}`, { diameter: 0.05 }, this.scene);
    emitter.isVisible = false;
    emitter.position = position;
    const particles = new ParticleSystem(`particles-${performance.now()}`, 60, this.scene);
    particles.particleTexture = null;
    particles.emitter = emitter;
    particles.minEmitBox = new Vector3(-0.1, -0.1, -0.1);
    particles.maxEmitBox = new Vector3(0.1, 0.1, 0.1);
    particles.color1 = new Color4(0.55, 0.45, 1, 1);
    particles.color2 = new Color4(0.25, 0.7, 1, 1);
    particles.minLifeTime = 0.15;
    particles.maxLifeTime = 0.45;
    particles.minSize = 0.04;
    particles.maxSize = 0.16;
    particles.emitRate = 500;
    particles.direction1 = new Vector3(-2, 1, -2);
    particles.direction2 = new Vector3(2, 4, 2);
    particles.gravity = new Vector3(0, -6, 0);
    particles.start();
    window.setTimeout(() => particles.stop(), 90);
    window.setTimeout(() => {
      particles.dispose();
      emitter.dispose();
    }, 800);
  }
}

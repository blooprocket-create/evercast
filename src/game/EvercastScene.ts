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
import type { SimulationSnapshot } from '../engine/types';

export class EvercastScene {
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly mage: Mesh;
  private readonly enemy: Mesh;
  private travelPhase = 0;

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
    sun.position = new Vector3(8, 12, 6);
    sun.intensity = 2.2;

    new GlowLayer('glow', this.scene, { blurKernelSize: 32 }).intensity = 0.65;

    this.createWorld();
    this.mage = this.createMage();
    this.enemy = this.createEnemy();

    this.engine.runRenderLoop(() => this.scene.render());
    window.addEventListener('resize', this.resize);
  }

  sync(snapshot: SimulationSnapshot, deltaSeconds: number, events: readonly GameEvent[]): void {
    this.travelPhase += deltaSeconds;
    const walking = snapshot.phase === 'travel';
    this.mage.position.y = 0.65 + (walking ? Math.sin(this.travelPhase * 8) * 0.035 : 0);
    this.enemy.setEnabled(!walking);
    this.enemy.scaling.setAll(snapshot.boss ? 1.5 : 1);

    for (const event of events) {
      if (event.type === 'spell_cast') this.spawnArcaneBolt();
      if (event.type === 'enemy_killed') this.spawnBurst(this.enemy.position.clone());
      if (event.type === 'mage_defeated') this.spawnBurst(this.mage.position.clone());
    }
  }

  dispose(): void {
    window.removeEventListener('resize', this.resize);
    this.scene.dispose();
    this.engine.dispose();
  }

  private readonly resize = (): void => this.engine.resize();

  private createWorld(): void {
    const ground = MeshBuilder.CreateGround('ground', { width: 30, height: 7 }, this.scene);
    const groundMat = new PBRMaterial('groundMat', this.scene);
    groundMat.albedoColor = new Color3(0.055, 0.11, 0.085);
    groundMat.roughness = 0.96;
    ground.material = groundMat;

    for (let i = 0; i < 18; i += 1) {
      const rock = MeshBuilder.CreatePolyhedron(`rock-${i}`, { type: 1, size: 0.35 + (i % 4) * 0.08 }, this.scene);
      rock.position = new Vector3(-12 + i * 1.5, 0.25, i % 2 === 0 ? 2.2 : -2.1);
      rock.scaling = new Vector3(1, 0.7, 1.4);
      const mat = new PBRMaterial(`rockMat-${i}`, this.scene);
      mat.albedoColor = new Color3(0.15, 0.19, 0.18);
      mat.roughness = 0.9;
      rock.material = mat;
    }

    for (let i = 0; i < 7; i += 1) {
      const trunk = MeshBuilder.CreateCylinder(`trunk-${i}`, { height: 2.8, diameterTop: 0.25, diameterBottom: 0.42, tessellation: 7 }, this.scene);
      trunk.position = new Vector3(-9 + i * 3.2, 1.4, 2.8);
      const crown = MeshBuilder.CreatePolyhedron(`crown-${i}`, { type: 2, size: 1.2 }, this.scene);
      crown.position = trunk.position.add(new Vector3(0, 1.7, 0));
      const trunkMat = new StandardMaterial(`trunkMat-${i}`, this.scene);
      trunkMat.diffuseColor = new Color3(0.15, 0.09, 0.055);
      const crownMat = new StandardMaterial(`crownMat-${i}`, this.scene);
      crownMat.diffuseColor = new Color3(0.09, 0.23, 0.15);
      trunk.material = trunkMat;
      crown.material = crownMat;
    }
  }

  private createMage(): Mesh {
    const body = MeshBuilder.CreateCylinder('mage', { height: 1.25, diameterTop: 0.42, diameterBottom: 0.9, tessellation: 10 }, this.scene);
    body.position = new Vector3(-3.2, 0.65, 0);
    const mat = new PBRMaterial('mageMat', this.scene);
    mat.albedoColor = new Color3(0.16, 0.13, 0.34);
    mat.metallic = 0.05;
    mat.roughness = 0.72;
    body.material = mat;

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
    hat.material = mat;

    return body;
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

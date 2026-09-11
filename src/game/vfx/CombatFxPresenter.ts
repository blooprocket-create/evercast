import { Color3, PointLight, Scene, Vector3 } from '@babylonjs/core';
import type { ActorVisual } from '../actors/ActorAssets';
import type { Hit } from './CombatVfxPlan';
import { VfxPool, type School } from './VfxPool';
import { DamageNumbers } from './DamageNumbers';
import type { GameEvent } from '../../engine/events/GameEvent';

/** Local transient feedback: never touches shared actor materials or authoritative state. */
export class CombatFxPresenter {
  private chill = new Map<number, { left: number; strength: number; position: Vector3; tick: number }>();
  private light?: PointLight;
  private lightTime = 0;
  /** Shared: the companion presenter writes its own labels into this pool, so
   * the damage-numbers setting covers the whole field rather than half of it. */
  readonly numbers: DamageNumbers;
  private burstCooldowns = new Map<string, number>();
  constructor(
    private pool: VfxPool,
    scene: Scene,
  ) {
    this.numbers = new DamageNumbers(scene);
    if (pool.budget.lights) {
      this.light = new PointLight('VFX / impact light', Vector3.Zero(), scene);
      this.light.intensity = 0;
      this.light.range = 2.5;
      // Only the hit actor receives this light; the environment keeps its light budget.
      this.light.renderPriority = 1;
    }
  }

  setDamageNumbersVisible(visible: boolean): void {
    this.numbers.setVisible(visible);
  }

  hit(hit: Hit, position: Vector3, actor?: ActorVisual): void {
    actor?.play('hit');
    actor?.flash(hit.critical);
    this.numbers.show(hit, position);
    const school = hit.source === 'chain' ? 'storm' : hit.source === 'splash' ? 'fire' : 'arcane';
    this.burst(position, school, hit.critical ? 1.45 : 0.7, hit.critical);
    if (hit.critical) this.impactFrame(position, 1);
    if ((hit.controlDelaySeconds ?? 0) > 0) {
      const previous = this.chill.get(hit.instanceId);
      this.chill.set(hit.instanceId, {
        left: Math.min(2.5, (previous?.left ?? 0) + hit.controlDelaySeconds!),
        strength: Math.min(3, (previous?.strength ?? 0) + 1),
        position: position.clone(),
        tick: 0,
      });
      this.burst(position, 'frost', 0.65);
    }
    if (this.light && actor) {
      this.light.includedOnlyMeshes = actor.root.getChildMeshes();
      this.light.position.copyFrom(position);
      this.light.diffuse = Color3.FromHexString(hit.critical ? '#c6a5ff' : '#777fff');
      this.lightTime = 0.09;
    }
  }

  effect(event: Extract<GameEvent, { type: 'effect_hit' }>, position: Vector3, actor?: ActorVisual): void {
    this.numbers.show({ ...event, critical: !!event.empowered }, position);
    actor?.flash(!!event.empowered);
    if (event.effect === 'dot') this.burst(position, 'plague', 0.35);
    else {
      actor?.play('hit');
      this.impactFrame(position, event.effect === 'meteor' ? 1.6 : 1.1);
    }
  }

  /**
   * The anime impact frame: a white-hot core that appears and is gone inside a
   * tenth of a second, under a shockwave ring that outruns it. The two together
   * are what make a hit land - the burst says what school the damage was, this
   * says how hard it hit.
   */
  impactFrame(position: Vector3, size = 1): void {
    const key = `impact:${position.x.toFixed(1)}:${position.z.toFixed(1)}`;
    if (this.burstCooldowns.has(key)) return;
    this.burstCooldowns.set(key, 0.09);
    // arcane_core_b is the one template the pool gives the white heart material.
    this.pool.emit(
      'arcane_core_b',
      'arcane',
      0.11,
      (t, m) => {
        m.position.copyFrom(position);
        m.scaling.setAll(size * (0.2 + t * 1.05));
        m.visibility = 1 - t * t;
      },
      true,
      key,
    );
    this.pool.emit('arcane_ring_b', 'arcane', 0.26, (t, m) => {
      m.position.copyFrom(position);
      m.rotation.x = Math.PI / 2;
      m.scaling.setAll(size * (0.3 + t * 3));
      // Thins as it widens, so the ring reads as a wave rather than a disc.
      m.visibility = (1 - t) * (1 - t) * 0.9;
    });
  }

  burst(position: Vector3, school: School, size = 1, critical = false): void {
    const key = `burst:${school}:${position.x.toFixed(1)}:${position.z.toFixed(1)}:${critical}:${size > 1 ? 'area' : 'hit'}`;
    if (this.burstCooldowns.has(key)) return;
    this.burstCooldowns.set(key, 0.07);
    const ring =
      school === 'plague'
        ? 'blood_ring'
        : school === 'arcane'
          ? critical
            ? 'arcane_glyph_b'
            : 'arcane_ring_a'
          : `${school}_ring`;
    this.pool.emit(
      ring,
      school,
      0.23,
      (t, m) => {
        m.position.copyFrom(position);
        m.rotation.x = Math.PI / 2;
        m.rotation.y = t * 0.4;
        m.scaling.setAll(size * (0.15 + t * 1.5));
        m.visibility = (1 - t) * 0.85;
      },
      true,
      key,
    );
    const shard = {
      plague: 'blood_droplet',
      arcane: 'arcane_shard_a',
      fire: 'fire_flame_a',
      frost: 'frost_shard_b',
      storm: 'storm_shard',
      blood: 'blood_droplet',
    }[school];
    for (let i = 0; i < this.pool.budget.shards + (critical ? 2 : 0); i++) {
      const angle = i * 2.399;
      this.pool.emit(shard, school, 0.18 + (i % 3) * 0.04, (t, m) => {
        m.position.set(
          position.x + Math.cos(angle) * t * size,
          position.y + Math.sin(angle) * t * size * 0.75,
          position.z - 0.1 + (i % 2) * 0.16,
        );
        m.scaling.setAll((1 - t) * 0.24 * size);
        m.rotation.z = -angle;
        m.visibility = 1 - t;
      });
    }
  }

  death(id: number, position: Vector3, actor?: ActorVisual): void {
    this.chill.delete(id);
    actor?.play('death');
    this.burst(position, 'arcane', 1.05);
    this.pool.emit('arcane_glyph_a', 'arcane', 0.5, (t, m) => {
      m.position.set(position.x, 0.07, position.z);
      m.scaling.setAll(0.5 + t);
      m.visibility = (1 - t) * 0.5;
    });
  }

  update(dt: number, anchor: (id: number) => Vector3 | undefined): void {
    for (const [key, left] of this.burstCooldowns) {
      if (left <= dt) this.burstCooldowns.delete(key);
      else this.burstCooldowns.set(key, left - dt);
    }
    this.numbers.update(dt);
    for (const [id, c] of this.chill) {
      c.left -= dt;
      c.tick -= dt;
      const current = anchor(id);
      if (c.left <= 0 || !current) {
        this.chill.delete(id);
        continue;
      }
      c.position.copyFrom(current);
      if (c.tick <= 0) {
        c.tick = 0.18;
        const p = c.position.clone(),
          strength = c.strength;
        this.pool.emit('frost_cluster', 'frost', 0.25, (t, m) => {
          m.position.set(p.x + Math.sin(t * 3) * 0.25, p.y - 0.3, p.z - 0.2);
          m.scaling.setAll(0.15 + strength * 0.045);
          m.visibility = (1 - t) * 0.5;
        });
      }
    }
    this.lightTime = Math.max(0, this.lightTime - dt);
    if (this.light) this.light.intensity = this.lightTime * 5;
  }
  get stats() {
    return { chilled: this.chill.size, lights: this.light ? 1 : 0 };
  }
  dispose(): void {
    this.chill.clear();
    this.burstCooldowns.clear();
    this.light?.dispose();
    this.numbers.dispose();
  }
}

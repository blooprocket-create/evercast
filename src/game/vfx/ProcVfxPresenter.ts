import { Vector3 } from '@babylonjs/core';
import type { GameEvent } from '../../engine/events/GameEvent';
import type { EnemySnapshot } from '../../engine/types';
import type { VfxAnchors } from './SpellVfxPresenter';
import type { CombatFxPresenter } from './CombatFxPresenter';
import { VfxPool, type School } from './VfxPool';

/** Cosmetic state is bounded. These effects never select targets or apply damage. */
export class ProcVfxPresenter {
  private statuses = new Map<
    string,
    { id: number; status: 'dot' | 'weakness' | 'ruin'; left: number; tick: number; stacks: number }
  >();
  constructor(
    private pool: VfxPool,
    private combat: CombatFxPresenter,
    private anchors: VfxAnchors,
  ) {}
  syncStatuses(enemies: readonly EnemySnapshot[], time: number): void {
    const active = new Set<string>();
    for (const enemy of enemies)
      for (const status of ['dot', 'weakness', 'ruin'] as const) {
        const effect = enemy.statuses?.[status];
        if (!effect || effect.expiresAt <= time) continue;
        const key = `${enemy.instanceId}:${status}`;
        active.add(key);
        const previous = this.statuses.get(key);
        this.statuses.set(key, {
          id: enemy.instanceId,
          status,
          left: effect.expiresAt - time,
          tick: previous?.tick ?? 0,
          stacks: 'stacks' in effect ? effect.stacks : 1,
        });
      }
    for (const key of this.statuses.keys()) if (!active.has(key)) this.statuses.delete(key);
  }
  ingest(events: readonly GameEvent[]): void {
    const bursts = new Set<number>();
    for (const event of events) {
      if (
        event.type === 'encounter_started' ||
        event.type === 'spell_tree_respecced' ||
        event.type === 'mage_defeated'
      )
        this.statuses.clear();
      if (event.type === 'enemy_killed')
        for (const [key, s] of this.statuses) if (s.id === event.instanceId) this.statuses.delete(key);
      if (event.type === 'meteor_queued') {
        const end = new Vector3(event.position.x, 0.3, event.position.z),
          start = end.add(new Vector3(-0.8, 4, 0));
        const school: School = event.infect ? 'plague' : 'fire';
        const duration = Math.max(0.05, event.dueAt - event.time);
        this.pool.emit(
          'arcane_core_a',
          school,
          duration,
          (t, mesh) => {
            Vector3.LerpToRef(start, end, t * t, mesh.position);
            mesh.rotation.z = t * 4;
            mesh.scaling.set(1.1 + t * 0.5, 0.6 + t * 0.2, 1.1 + t * 0.5);
            mesh.visibility = 0.8;
          },
          true,
          `meteor:${event.effectId}`,
        );
        this.pool.emit(
          'fire_flame_a',
          school,
          duration,
          (t, mesh) => {
            Vector3.LerpToRef(start, end, t * t, mesh.position);
            mesh.position.y += 0.3;
            mesh.scaling.set(0.8, 1.3, 0.8);
            mesh.visibility = 0.65;
          },
          false,
          `meteor-tail:${event.effectId}`,
        );
        this.pool.emit(
          'fire_ring',
          school,
          duration,
          (t, mesh) => {
            mesh.position.set(end.x, 0.06, end.z);
            mesh.scaling.setAll(0.7 + t * 0.4);
            mesh.visibility = 0.3 + t * 0.3;
          },
          true,
          `meteor-mark:${event.effectId}`,
        );
      }
      if (event.type === 'effect_hit') {
        const position =
          this.anchors.target(event.instanceId)?.clone() ??
          new Vector3(event.position.x, 0.65, event.position.z);
        this.combat.effect(event, position, this.anchors.actor(event.instanceId));
        if (!bursts.has(event.effectId) && event.effect !== 'dot') {
          bursts.add(event.effectId);
          this.combat.burst(
            new Vector3(event.position.x, 0.3, event.position.z),
            // A body coming apart is the infection going off, not a detonation.
            event.effect === 'necrosis' ? 'plague' : 'fire',
            event.empowered ? 2.2 : 1.2,
            event.empowered,
          );
        }
      }
      if (event.type === 'status_applied') {
        if (this.statuses.size >= 96) this.statuses.delete(this.statuses.keys().next().value!);
        this.statuses.set(`${event.instanceId}:${event.status}`, {
          id: event.instanceId,
          status: event.status,
          left: event.expiresAt - event.time,
          tick: 0,
          stacks: event.stacks,
        });
        if (event.spread) {
          const from = this.anchors.target(event.sourceInstanceId),
            to = this.anchors.target(event.instanceId);
          if (from && to)
            this.pool.path(
              'plague',
              0.22,
              from.clone(),
              to.clone(),
              false,
              0.35,
              `spread:${event.sourceInstanceId}:${event.instanceId}`,
            );
        }
      }
      if (event.type === 'spell_cast' && (event.perfect || event.overdrive))
        this.combat.burst(
          this.anchors.staff(),
          event.overdrive ? 'storm' : 'arcane',
          event.perfect ? 1.3 : 0.8,
          event.perfect,
        );
      if (event.type === 'combat_state' && event.state === 'overdrive' && event.stacks > 0)
        this.combat.burst(this.anchors.mage(), 'storm', 1.3, true);
    }
  }
  update(dt: number): void {
    for (const [key, s] of this.statuses) {
      s.left -= dt;
      s.tick -= dt;
      const p = this.anchors.target(s.id)?.clone();
      if (s.left <= 0 || !p) {
        this.statuses.delete(key);
        continue;
      }
      if (s.tick > 0) continue;
      s.tick = 0.24;
      const school: School = s.status === 'dot' ? 'plague' : s.status === 'ruin' ? 'blood' : 'frost';
      this.pool.emit(
        s.status === 'dot' ? 'blood_droplet' : s.status === 'ruin' ? 'blood_glyph' : 'frost_glyph',
        school,
        0.3,
        (t, mesh) => {
          mesh.position.set(p.x, 0.1 + (s.status === 'dot' ? t * 0.65 : 0), p.z);
          mesh.rotation.y = t * 0.5;
          mesh.scaling.setAll(s.status === 'dot' ? 0.25 : 0.45 + s.stacks * 0.1);
          mesh.visibility = (1 - t) * 0.55;
        },
        false,
        `status:${key}`,
      );
    }
  }
  dispose(): void {
    this.statuses.clear();
  }
}

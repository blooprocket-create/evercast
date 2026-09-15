import { Vector3 } from '@babylonjs/core';
import { ProcVfxPresenter } from './ProcVfxPresenter';
import type { GameEvent } from '../../engine/events/GameEvent';
import type { SimulationSnapshot } from '../../engine/types';
import type { ActorVisual } from '../actors/ActorAssets';
import { castDuration, planCast, type Hit } from './CombatVfxPlan';
import { CombatFxPresenter } from './CombatFxPresenter';
import { VfxPool } from './VfxPool';

type Job = { at: number; key: string; run: () => void };
export interface VfxAnchors {
  staff(): Vector3;
  mage(): Vector3;
  target(id: number): Vector3 | undefined;
  actor(id: number): ActorVisual | undefined;
  /** A boss barely rocks when it is hit; everything else takes the blow. */
  boss(id: number): boolean;
}

/** Short cosmetic timeline. Simulation has already resolved every event before ingestion. */
export class SpellVfxPresenter {
  private clock = 0;
  private jobs: Job[] = [];
  private disposed = false;
  private procs: ProcVfxPresenter;
  constructor(
    readonly pool: VfxPool,
    readonly combat: CombatFxPresenter,
    private anchors: VfxAnchors,
  ) {
    this.procs = new ProcVfxPresenter(pool, combat, anchors);
  }

  ingest(
    snapshot: Pick<SimulationSnapshot, 'castInterval' | 'activeSpellNodeIds' | 'spellMechanics'> &
      Partial<Pick<SimulationSnapshot, 'enemies' | 'elapsedSeconds'>>,
    events: readonly GameEvent[],
  ): void {
    if (this.disposed) return;
    const explosions = events.filter((e) => e.type === 'effect_hit' && e.effect === 'explosion');
    this.procs.ingest(events.filter((e) => e.type !== 'effect_hit' || e.effect !== 'explosion'));
    if (explosions.length)
      this.schedule(castDuration(snapshot.castInterval) * 0.5 + 0.14, 'explosions', () =>
        this.procs.ingest(explosions),
      );
    if (snapshot.enemies && snapshot.elapsedSeconds !== undefined)
      this.procs.syncStatuses(snapshot.enemies, snapshot.elapsedSeconds);
    const mechanics = snapshot.spellMechanics;
    const batches = new Map<number, Hit[]>();
    for (const event of events)
      if (event.type === 'projectile_hit') {
        const hits = batches.get(event.castId) ?? [];
        hits.push(event);
        batches.set(event.castId, hits);
      }
    const deathTimes = new Map<number, number>();
    for (const hits of batches.values()) {
      const plan = planCast(hits, snapshot.castInterval);
      const positions = new Map<number, Vector3>();
      for (const hit of hits)
        for (const id of [hit.instanceId, hit.sourceInstanceId]) {
          if (id !== undefined) {
            const p = this.anchors.target(id);
            if (p) positions.set(id, p.clone());
          }
        }
      this.charge(castDuration(snapshot.castInterval) * 0.5);
      for (const flight of plan.flights) {
        const ends = flight.hits.map((h) => positions.get(h.hit.instanceId));
        if (ends.some((p) => !p)) continue; // Missing actors never redirect a spell to another enemy.
        this.schedule(
          flight.release,
          `flight:${flight.fromId}:${flight.hits.map((h) => h.hit.instanceId)}:${flight.lane % 8}:${flight.echo}`,
          () => {
            const start = flight.fromId === undefined ? this.anchors.staff() : positions.get(flight.fromId);
            if (!start) return;
            const points = [start.clone(), ...(ends as Vector3[])];
            const duration = flight.hits.at(-1)!.at - flight.release;
            const moving = start.clone();
            const tail = start.clone();
            const lane = ((flight.lane % 7) - 3) * 0.23;
            this.pool.emit(
              'arcane_core_a',
              'arcane',
              duration,
              (t, m) => {
                const elapsed = t * duration;
                const index =
                  elapsed < 0.14 ? 0 : Math.min(points.length - 2, 1 + Math.floor((elapsed - 0.14) / 0.045));
                const local = index === 0 ? elapsed / 0.14 : (elapsed - 0.14 - (index - 1) * 0.045) / 0.045;
                Vector3.LerpToRef(points[index], points[index + 1], Math.min(1, local), moving);
                moving.y += Math.sin(local * Math.PI) * lane;
                moving.z += Math.sin(local * Math.PI) * lane * 0.6;
                Vector3.LerpToRef(points[index], points[index + 1], Math.max(0, local - 0.17), tail);
                tail.y += Math.sin(Math.max(0, local - 0.17) * Math.PI) * lane;
                tail.z += Math.sin(Math.max(0, local - 0.17) * Math.PI) * lane * 0.6;
                m.position.copyFrom(moving);
                m.rotation.set(t * 9, 0, -Math.PI / 2);
                m.scaling.setAll((flight.echo ? 0.32 : 0.45) * (flight.hits[0].hit.powerScale ?? 1));
                m.visibility = flight.echo ? 0.45 : 0.95;
              },
              true,
            );
            this.pool.path('arcane', duration + 0.025, tail, moving, false);
            if (!flight.echo)
              this.pool.emit('arcane_core_b', 'arcane', duration, (t, m) => {
                m.position.copyFrom(moving);
                m.rotation.set(t * 9, 0, -Math.PI / 2);
                m.scaling.setAll(0.19);
              });
            if (mechanics?.explosive)
              this.pool.emit('fire_ember', 'fire', duration, (t, m) => {
                m.position.copyFrom(moving);
                m.position.y += 0.1;
                m.scaling.setAll(0.2);
                m.rotation.z = t * 12;
              });
            if (mechanics?.chain || mechanics?.overdrive)
              this.pool.emit('storm_spark', 'storm', duration, (t, m) => {
                m.position.copyFrom(moving);
                m.position.y -= 0.1;
                m.scaling.setAll(0.16);
                m.rotation.y = t * 18;
              });
          },
        );
      }
      const explosions = new Set<number>();
      for (const impact of plan.impacts) {
        const hit = impact.hit,
          p = positions.get(hit.instanceId),
          source = positions.get(impact.fromId!);
        if (!p) continue;
        deathTimes.set(hit.instanceId, Math.max(deathTimes.get(hit.instanceId) ?? 0, impact.at));
        const explode = hit.source === 'splash' && source && !explosions.has(impact.fromId!);
        if (explode) explosions.add(impact.fromId!);
        this.schedule(impact.at, `hit:${hit.source}:${impact.fromId}:${hit.instanceId}`, () => {
          if (hit.source === 'chain' && source) {
            this.pool.path('storm', 0.105, source, p, true, 0, `chain:${impact.fromId}:${hit.instanceId}`);
            if (this.pool.budget.shards > 6)
              this.pool.path(
                'storm',
                0.06,
                Vector3.Lerp(source, p, 0.5),
                p.add(new Vector3(0.15, 0.2, 0)),
                true,
              );
          }
          if (explode && source) {
            // Radius is visual coverage of the emitted splash impacts, never an AoE query.
            const radius = Math.max(
              0.7,
              ...plan.impacts
                .filter((i) => i.hit.source === 'splash' && i.fromId === impact.fromId)
                .map((i) => Vector3.Distance(source, positions.get(i.hit.instanceId) ?? source)),
            );
            this.combat.burst(source, 'fire', Math.min(3, radius));
          }
          if (hit.terminal) this.combat.burst(p, 'storm', 1.65, true);
          // A bolt from the staff has no `fromId`; it came from the mage.
          this.combat.hit(
            hit,
            p,
            this.anchors.actor(hit.instanceId),
            source ?? this.anchors.mage(),
            this.anchors.boss(hit.instanceId),
          );
          if (hit.healing && hit.healing !== '0') this.siphon(p);
        });
      }
    }
    for (const event of events)
      if (event.type === 'enemy_killed') {
        const p = this.anchors.target(event.instanceId)?.clone();
        if (p)
          this.schedule((deathTimes.get(event.instanceId) ?? 0) + 0.015, `death:${event.instanceId}`, () =>
            this.combat.death(event.instanceId, p, this.anchors.actor(event.instanceId)),
          );
      }
  }

  update(dt: number): void {
    if (this.disposed) return;
    const step = Math.max(0, dt);
    this.clock += step;
    this.pool.update(step);
    const due = this.jobs.filter((j) => j.at <= this.clock);
    this.jobs = this.jobs.filter((j) => j.at > this.clock);
    for (const job of due.sort((a, b) => a.at - b.at)) job.run();
    this.combat.update(step, (id) => this.anchors.target(id));
    this.procs.update(step);
  }
  get stats() {
    return { jobs: this.jobs.length, ...this.pool.stats, ...this.combat.stats };
  }
  dispose(): void {
    this.disposed = true;
    this.jobs.length = 0;
    this.procs.dispose();
    this.combat.dispose();
    this.pool.dispose();
  }

  private charge(duration: number) {
    this.pool.emit(
      'arcane_ring_b',
      'arcane',
      duration,
      (t, m) => {
        m.position.copyFrom(this.anchors.staff());
        m.rotation.x = Math.PI / 2;
        m.rotation.y = t * 2;
        m.scaling.setAll(0.23 + t * 0.2);
        m.visibility = 0.25 + t * 0.55;
      },
      true,
    );
    for (let i = 0; i < 3; i++)
      this.pool.emit('arcane_spark', 'arcane', duration, (t, m) => {
        m.position.copyFrom(this.anchors.staff());
        const a = t * 5 + (i * Math.PI * 2) / 3;
        m.position.x += Math.cos(a) * 0.25 * (1 - t);
        m.position.y += Math.sin(a) * 0.25 * (1 - t);
        m.scaling.setAll(0.12);
        m.visibility = t;
      });
  }
  private siphon(from: Vector3) {
    const to = this.anchors.mage();
    this.pool.path('blood', 0.28, from, to, false, 0.4, `blood:${from.x.toFixed(1)}:${from.z.toFixed(1)}`);
    this.pool.emit(
      'blood_droplet',
      'blood',
      0.28,
      (t, m) => {
        Vector3.LerpToRef(from, to, t, m.position);
        m.position.y += Math.sin(t * Math.PI) * 0.4;
        m.scaling.setAll(0.25);
        m.rotation.z = Math.PI / 2;
      },
      true,
      `siphon:${from.x.toFixed(1)}:${from.z.toFixed(1)}`,
    );
    this.schedule(0.28, 'heal:mage', () => this.combat.burst(to, 'blood', 0.42));
  }
  private schedule(delay: number, key: string, run: () => void) {
    const job = { at: this.clock + Math.min(0.65, delay), key, run };
    if (this.jobs.length < this.pool.budget.jobs) this.jobs.push(job);
    else {
      // Coalesce repeated samples of the same semantic edge before sacrificing a distinct one.
      const duplicate = this.jobs.findIndex((j) => j.key === key);
      if (duplicate >= 0) this.jobs[duplicate] = { ...job, at: Math.min(job.at, this.jobs[duplicate].at) };
      else {
        const decorative = this.jobs.findIndex((j) => j.key.startsWith('flight:'));
        this.jobs[decorative >= 0 ? decorative : 0] = job;
      }
    }
  }
}

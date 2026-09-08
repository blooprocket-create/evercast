import type { GameEvent } from '../../engine/events/GameEvent';

export type Hit = Extract<GameEvent, { type: 'projectile_hit' }>;
export type Impact = { hit: Hit; at: number; fromId?: number };
export type Flight = { hits: Impact[]; release: number; lane: number; echo: boolean; fromId?: number };
export function castDuration(interval: number): number {
  return Math.max(0.06, Math.min(0.24, interval * 0.85));
}

/** Consumes one atomic cast's emitted facts. No target selection, range checks or combat RNG. */
export function planCast(hits: readonly Hit[], interval: number): { flights: Flight[]; impacts: Impact[] } {
  const release = castDuration(interval) * 0.5;
  const flights: Flight[] = [],
    impacts: Impact[] = [];
  const groups = new Map<number, Hit[]>();
  for (const hit of hits) {
    const group = groups.get(hit.projectileIndex) ?? [];
    group.push(hit);
    groups.set(hit.projectileIndex, group);
  }
  let lane = 0;
  for (const group of groups.values()) {
    const direct = group.find((h) => h.source === 'direct' || h.source === 'repeat');
    const pierces = group.filter((h) => h.source === 'pierce').sort((a, b) => a.sequence - b.sequence);
    const ordered = direct ? [direct, ...pierces] : pierces;
    const times = new Map<number, number>();
    if (ordered.length) {
      const echo = direct?.source === 'repeat';
      const start = release + (echo ? 0.06 + Math.min(0.08, direct!.sequence * 0.015) : 0);
      const route = ordered.map((hit, i) => {
        const impact = {
          hit,
          at: start + 0.14 + i * 0.045,
          fromId: i ? ordered[i - 1].instanceId : direct ? undefined : hit.sourceInstanceId,
        };
        times.set(hit.instanceId, impact.at);
        return impact;
      });
      flights.push({
        hits: route,
        release: start,
        lane: lane++,
        echo: !!echo,
        fromId: direct ? undefined : ordered[0].sourceInstanceId,
      });
      impacts.push(...route);
    }
    for (const hit of group.filter((h) => h.source === 'chain').sort((a, b) => a.sequence - b.sequence)) {
      const at = (times.get(hit.sourceInstanceId!) ?? release + 0.14) + 0.035;
      impacts.push({ hit, at, fromId: hit.sourceInstanceId });
      times.set(hit.instanceId, at);
    }
    for (const hit of group.filter((h) => h.source === 'splash')) {
      impacts.push({
        hit,
        at: (times.get(hit.sourceInstanceId!) ?? release + 0.14) + 0.04,
        fromId: hit.sourceInstanceId,
      });
    }
  }
  return { flights, impacts: impacts.sort((a, b) => a.at - b.at) };
}

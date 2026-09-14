import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMPANIONS } from '../companions/CompanionCatalog';
import { GEAR_SLOT_ORDER } from '../gear/GearCatalog';
import { describeGameEvent } from './describeGameEvent';
import type { GameEvent } from './GameEvent';

/**
 * The log is the one place the game narrates itself in words, and it used to
 * narrate them in the engine's own identifiers: "dot deals 9.97e47.",
 * "supercharge: 3.", "ringLeft reached gear level 5." All three were captured
 * on screen.
 *
 * This is the guard against the next one. Every variant of `GameEvent` is
 * described here, and the whole set is checked for the shapes an identifier
 * takes when it escapes: camelCase, snake_case, a lowercase word where a name
 * belongs, and a raw `Decimal.toString()`.
 */

const position = { x: 0, z: 0 };
const companion = COMPANIONS[0]!.id;

/**
 * One of every variant. Written out rather than generated so that adding a
 * variant to the union without adding it here is a type error in this file.
 */
const EVERY_EVENT: GameEvent[] = [
  { type: 'encounter_started', time: 1, stage: 4, totalEnemies: 6, boss: false },
  { type: 'enemy_spawned', time: 1, stage: 4, instanceId: 1, enemyId: 'moss_slime', enemyName: 'Moss Slime', boss: false, spawned: 2, total: 6 },
  { type: 'spell_cast', time: 1, castId: 1, projectiles: 1 },
  { type: 'spell_cast', time: 1, castId: 2, projectiles: 3 },
  { type: 'meteor_queued', time: 1, effectId: 1, castId: 1, instanceId: 1, position, dueAt: 2, infect: false },
  ...(['explosion', 'meteor', 'dot', 'necrosis'] as const).map((effect): GameEvent => ({
    type: 'effect_hit', time: 1, effectId: 1, castId: 1, instanceId: 1, sourceInstanceId: 0,
    damage: '1234.5', effect, position,
  })),
  ...(['dot', 'weakness', 'ruin'] as const).flatMap((status): GameEvent[] => [
    { type: 'status_applied', time: 1, instanceId: 1, sourceInstanceId: 0, status, stacks: 1, expiresAt: 4 },
    { type: 'status_applied', time: 1, instanceId: 1, sourceInstanceId: 0, status, stacks: 3, expiresAt: 4 },
  ]),
  ...(['momentum', 'overdrive', 'focus', 'supercharge', 'velocity'] as const).map((state): GameEvent => ({
    type: 'combat_state', time: 1, state, stacks: 3,
  })),
  ...(['direct', 'pierce', 'chain', 'splash', 'repeat'] as const).flatMap((source): GameEvent[] => [
    { type: 'projectile_hit', time: 1, castId: 1, projectileIndex: 0, instanceId: 1, damage: '99', critical: false, source, sequence: 1 },
    { type: 'projectile_hit', time: 1, castId: 1, projectileIndex: 0, instanceId: 1, damage: '99', critical: true, source, sequence: 1 },
  ]),
  { type: 'enemy_windup', time: 1, instanceId: 1, durationSeconds: 0.6 },
  { type: 'enemy_attack', time: 1, instanceId: 1, damage: '12' },
  { type: 'enemy_killed', time: 1, stage: 4, instanceId: 1, enemyId: 'moss_slime', gold: '30' },
  { type: 'mage_defeated', time: 1, stage: 9 },
  ...(['essence', 'knowledge', 'gold', 'starlight'] as const).map((resource): GameEvent => ({
    type: 'resource_gained', time: 1, resource, amount: '5',
  })),
  { type: 'stage_advanced', time: 1, stage: 10 },
  ...(['frontier defeat', 'automatic frontier retry', 'manual frontier retry'] as const).map(
    (reason): GameEvent => ({ type: 'mode_changed', time: 1, mode: reason === 'frontier defeat' ? 'farm' : 'push', reason }),
  ),
  ...GEAR_SLOT_ORDER.map((slot): GameEvent => ({ type: 'gear_leveled', time: 1, slot, level: 5, cost: '40' })),
  { type: 'gear_evolved', time: 1, slot: 'staff', level: 50, evolutionTier: 1, name: 'Runed Staff' },
  { type: 'spell_point_purchased', time: 1, purchasedPoints: 2, cost: '120' },
  { type: 'attunement_purchased', time: 1, attunementId: 'third_identity', attunementName: 'Broadened Study', cost: '1' },
  { type: 'spell_node_activated', time: 1, nodeId: 'twin_cast', nodeName: 'Twin Cast' },
  { type: 'spell_tree_respecced', time: 1, refundedPoints: 1 },
  { type: 'spell_tree_respecced', time: 1, refundedPoints: 12 },
  { type: 'rebirth_performed', time: 1, knowledgeGained: '3', rebirths: 2 },
  { type: 'companion_attack', time: 1, slot: 0, definitionId: companion, instanceId: 1, damage: '42', critical: false },
  { type: 'companion_attack', time: 1, slot: 0, definitionId: companion, instanceId: 1, damage: '42', critical: true },
  ...(['strike', 'volley', 'guard', 'bulwark', 'mend', 'rally', 'hex', 'wither', 'echo', 'revive'] as const).map(
    (ability): GameEvent => ({
      type: 'companion_ability', time: 1, slot: 0, definitionId: companion, ability,
      amount: '10', targets: [1], hits: [{ instanceId: 1, damage: '10' }],
    }),
  ),
  { type: 'companion_damaged', time: 1, slot: 0, instanceId: 1, damage: '8', absorbed: '2' },
  { type: 'companion_downed', time: 1, slot: 0, definitionId: companion },
  { type: 'companion_revived', time: 1, slot: 0, definitionId: companion },
  { type: 'companion_summoned', time: 1, definitionId: companion, rarity: 'rare', duplicate: false, shards: 0, stars: 1 },
  { type: 'companion_summoned', time: 1, definitionId: companion, rarity: 'rare', duplicate: true, shards: 5, stars: 1 },
  { type: 'companion_ascended', time: 1, definitionId: companion, stars: 2 },
  { type: 'companion_equipped', time: 1, definitionId: companion, slot: 0 },
  { type: 'companion_equipped', time: 1, definitionId: null, slot: 0 },
];

const described = EVERY_EVENT.map((event) => ({ event, text: describeGameEvent(event) }));

describe('describeGameEvent', () => {
  it('covers every variant in the union', () => {
    // Counted from the union itself rather than hardcoded, so a variant added
    // without a line above fails here instead of shipping undescribed.
    const source = readFileSync(join(process.cwd(), 'src', 'engine', 'events', 'GameEvent.ts'), 'utf8');
    const declared = new Set([...source.matchAll(/type: '([a-z_]+)'/g)].map((match) => match[1]));
    const covered = new Set(EVERY_EVENT.map((event) => event.type));
    expect([...declared].filter((kind) => !covered.has(kind as never))).toEqual([]);
    expect(declared.size).toBeGreaterThan(0);
  });

  it('never prints a camelCase identifier', () => {
    const offenders = described.filter(({ text }) => /\b[a-z]+[A-Z][a-zA-Z]*\b/.test(text));
    expect(offenders.map(({ event, text }) => `${event.type}: ${text}`)).toEqual([]);
  });

  it('never prints a snake_case identifier', () => {
    const offenders = described.filter(({ text }) => /\b[a-z]+_[a-z_]+\b/.test(text));
    expect(offenders.map(({ event, text }) => `${event.type}: ${text}`)).toEqual([]);
  });

  it('never prints a raw Decimal string', () => {
    // `formatBig` caps at ten characters; an unformatted `toString()` is how a
    // 300-digit number reaches the log.
    const offenders = described.filter(({ text }) => /\d{11,}/.test(text) || /\d+\.\d{3,}/.test(text));
    expect(offenders.map(({ event, text }) => `${event.type}: ${text}`)).toEqual([]);
  });

  it('writes a sentence every time', () => {
    const offenders = described.filter(
      ({ text }) => text.length === 0 || !/^[A-Z★+]/.test(text) || !text.endsWith('.'),
    );
    expect(offenders.map(({ event, text }) => `${event.type}: ${text}`)).toEqual([]);
  });

  it('names the gear slot rather than its field', () => {
    const levelled = described.filter(({ event }) => event.type === 'gear_leveled').map((d) => d.text);
    expect(levelled).toContain('Ring I reached level 5.');
    expect(levelled).toContain('Ring II reached level 5.');
    expect(levelled.join(' ')).not.toContain('ringLeft');
  });

  it('names the effects and states the spell tree authored', () => {
    const texts = described.map((d) => d.text).join('\n');
    expect(texts).toContain('DoT deals');
    expect(texts).toContain('Supercharge at 3.');
    expect(texts).toContain('Terminal Velocity at 3.');
    expect(texts).toContain('Weakness applied.');
    expect(texts).toContain('Ruin applied (x3).');
  });
});

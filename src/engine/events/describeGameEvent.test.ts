import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { describeGameEvent } from './describeGameEvent';
import { EVERY_EVENT } from './everyGameEvent';

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

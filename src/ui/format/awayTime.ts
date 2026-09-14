/**
 * How long the player was gone, in words.
 *
 * The first version was four lines and wrong in four ways, all of them visible
 * on screen:
 *
 *   const hours = Math.floor(seconds / 3600);
 *   const minutes = Math.round((seconds % 3600) / 60);
 *   hours > 0 ? `${hours}h ${minutes}m` : `${minutes} minutes`
 *
 * `Math.round` on the remainder reaches 60, so 3570s rendered "60 minutes" and
 * 7190s rendered "1h 60m" - a time that does not exist. Under a minute it
 * rendered "0 minutes", and between 30 and 89 seconds "1 minutes".
 *
 * Every unit here is floored, and each one only ever carries what the unit
 * above it did not take, so no field can reach its own ceiling. Plurals come
 * from the value rather than from being assumed.
 */

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const plural = (value: number, unit: string): string =>
  `${value} ${unit}${value === 1 ? '' : 's'}`;

export function formatAwayTime(seconds: number): string {
  // A negative or non-finite span is not a duration; say the honest thing
  // rather than arithmetic on it.
  if (!Number.isFinite(seconds) || seconds < MINUTE) return 'less than a minute';

  const whole = Math.floor(seconds);

  if (whole < HOUR) return plural(Math.floor(whole / MINUTE), 'minute');

  if (whole < DAY) {
    const hours = Math.floor(whole / HOUR);
    const minutes = Math.floor((whole - hours * HOUR) / MINUTE);
    return `${hours}h ${minutes}m`;
  }

  const days = Math.floor(whole / DAY);
  const hours = Math.floor((whole - days * DAY) / HOUR);
  return `${days}d ${hours}h`;
}

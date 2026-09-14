/**
 * Seconds into a run, as a clock.
 *
 * The chronicle stamps each line with `GameEvent.time`, which is
 * `run.elapsedSeconds` - so this is a duration read as a clock, not a time of
 * day, and it restarts at a Rebirth because the run does. That is the honest
 * reading: a line's stamp answers "how far into this run", which is the
 * question anyone scrolling back is actually asking.
 *
 * Minutes are not padded and hours are not shown until there are any, so a
 * fresh run reads `0:07` rather than `0:00:07`. Every field below the largest
 * is padded, because an unpadded `1:7:3` is a different number to a reader.
 */
export function formatRunClock(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}

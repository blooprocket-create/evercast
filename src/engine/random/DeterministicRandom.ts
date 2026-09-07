function mix32(value: number): number {
  let x = value | 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  return (x ^ (x >>> 16)) >>> 0;
}

export function hashParts(...parts: number[]): number {
  let hash = 0x811c9dc5;
  for (const part of parts) {
    hash = mix32(hash ^ mix32(part));
  }
  return hash >>> 0;
}

export function random01(...parts: number[]): number {
  return hashParts(...parts) / 0x1_0000_0000;
}

export function chooseDeterministic<T>(items: readonly T[], ...parts: number[]): T {
  if (items.length === 0) throw new Error('Cannot choose from an empty collection.');
  const index = Math.floor(random01(...parts) * items.length);
  const value = items[Math.min(index, items.length - 1)];
  if (value === undefined) throw new Error('Deterministic choice failed.');
  return value;
}

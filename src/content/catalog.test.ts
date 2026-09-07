import { describe, expect, it } from 'vitest';
import { createDefaultCatalog, resolveZone, validateCatalog } from './catalog';

describe('content catalog', () => {
  it('has valid cross references', () => {
    expect(validateCatalog(createDefaultCatalog())).toEqual([]);
  });

  it('resolves zones deterministically beyond the authored set', () => {
    const catalog = createDefaultCatalog();
    expect(resolveZone(catalog, 1, 25).zone.id).toBe('greenfields');
    expect(resolveZone(catalog, 26, 25).zone.id).toBe('whispering_woods');
    expect(resolveZone(catalog, 101, 25).worldTier).toBe(1);
  });
});

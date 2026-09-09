import { describe, expect, it } from 'vitest';
import { familyOf } from './StylizedMaterials';

describe('familyOf', () => {
  it('reads the prefix the models already carry', () => {
    expect(familyOf('Iron / cast bronze')).toBe('metal');
    expect(familyOf('Arcane / ember heart')).toBe('arcane');
    expect(familyOf('Arcane / amethyst')).toBe('arcane');
  });

  it('sorts the cast palette into how it should catch light', () => {
    expect(familyOf('Cast / lavender fold')).toBe('cloth');
    expect(familyOf('Cast / crow plumage')).toBe('cloth');
    expect(familyOf('Cast / oxblood leather')).toBe('leather');
    expect(familyOf('Cast / warm skin')).toBe('skin');
    expect(familyOf('Cast / weathered bark')).toBe('matte');
    expect(familyOf('Cast / terracotta')).toBe('matte');
  });

  it('falls back to matte for anything unrecognised', () => {
    // New materials arrive with new model work; an unknown name has to shade
    // as something sensible rather than throw or render untouched.
    expect(familyOf('Cast / something nobody has authored yet')).toBe('matte');
    expect(familyOf('')).toBe('matte');
  });

  it('never lets a cast material claim to be metal or arcane', () => {
    for (const name of ['Cast / iron filings', 'Cast / arcane dust']) {
      expect(['cloth', 'leather', 'skin', 'matte']).toContain(familyOf(name));
    }
  });
});

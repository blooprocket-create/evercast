import { describe, expect, it } from 'vitest';
import { ASSET_WAIT_CEILING_MS, bootPhase } from './BootPhase';

describe('boot phase', () => {
  it('waits while the assets are still arriving', () => {
    expect(bootPhase({ assetsSettled: false, begun: false })).toBe('preparing');
  });

  it('opens the gate once they have', () => {
    expect(bootPhase({ assetsSettled: true, begun: false })).toBe('ready');
  });

  it('plays once the player has pressed it', () => {
    expect(bootPhase({ assetsSettled: true, begun: true })).toBe('playing');
  });

  it('is never a trap: a player who got in stays in, settled or not', () => {
    // The ceiling lets someone through a stalled download, and a quality change
    // rebuilds the scene under a game already running. Neither may reopen the
    // gate over a session in progress.
    expect(bootPhase({ assetsSettled: false, begun: true })).toBe('playing');
  });

  it('bounds the wait it is willing to impose', () => {
    expect(ASSET_WAIT_CEILING_MS).toBeGreaterThan(0);
    expect(ASSET_WAIT_CEILING_MS).toBeLessThanOrEqual(15_000);
  });
});

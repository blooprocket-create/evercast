import { describe, expect, it } from 'vitest';
import {
  type DeviceFacts,
  frameRateCapFor,
  readDeviceFacts,
  renderProfileFor,
  renderTierFor,
} from './DeviceProfile';

const facts = (patch: Partial<DeviceFacts> = {}): DeviceFacts => ({
  pixelRatio: 1,
  viewportLongEdge: 1920,
  cores: 8,
  memoryGb: 8,
  coarsePointer: false,
  reducedMotion: false,
  ...patch,
});

/** The devices the game is actually played on, as the browser describes them. */
const DEVICES: Record<string, DeviceFacts> = {
  'iphone 13 portrait': facts({ pixelRatio: 3, viewportLongEdge: 844, coarsePointer: true, cores: 6, memoryGb: 0 }),
  'iphone se landscape': facts({ pixelRatio: 2, viewportLongEdge: 667, coarsePointer: true, cores: 6, memoryGb: 0 }),
  'pixel 7 portrait': facts({ pixelRatio: 2.6, viewportLongEdge: 892, coarsePointer: true, cores: 8, memoryGb: 8 }),
  'ipad portrait': facts({ pixelRatio: 2, viewportLongEdge: 1180, coarsePointer: true, cores: 8, memoryGb: 0 }),
  'ipad landscape': facts({ pixelRatio: 2, viewportLongEdge: 1366, coarsePointer: true, cores: 8, memoryGb: 0 }),
  'macbook': facts({ pixelRatio: 2, viewportLongEdge: 1512, cores: 10, memoryGb: 0 }),
  'desktop 1080p': facts({ pixelRatio: 1, viewportLongEdge: 1920, cores: 16, memoryGb: 16 }),
  'cheap chromebook': facts({ pixelRatio: 1, viewportLongEdge: 1366, cores: 2, memoryGb: 2 }),
};

describe('which tier a device lands in', () => {
  it('reads a fingertip as a handheld or a tablet, never a desktop', () => {
    for (const [name, device] of Object.entries(DEVICES)) {
      if (!device.coarsePointer) continue;
      expect(renderTierFor(device), name).not.toBe('desktop');
    }
  });

  it('separates a phone from a tablet by how much screen it has', () => {
    expect(renderTierFor(DEVICES['iphone 13 portrait'])).toBe('handheld');
    expect(renderTierFor(DEVICES['iphone se landscape'])).toBe('handheld');
    expect(renderTierFor(DEVICES['pixel 7 portrait'])).toBe('handheld');
    expect(renderTierFor(DEVICES['ipad portrait'])).toBe('tablet');
    expect(renderTierFor(DEVICES['ipad landscape'])).toBe('tablet');
  });

  it('does not punish a Mac for withholding its memory', () => {
    // Safari reports neither `deviceMemory` nor anything else useful, and a
    // machine that says nothing must not be read as a machine that has nothing.
    expect(renderTierFor(DEVICES.macbook)).toBe('desktop');
    expect(renderTierFor(DEVICES['desktop 1080p'])).toBe('desktop');
  });

  it('still catches a weak machine that reports a mouse', () => {
    expect(renderTierFor(DEVICES['cheap chromebook'])).toBe('tablet');
  });
});

describe('what each tier is allowed to spend', () => {
  it('never spends more on a smaller device than on a larger one', () => {
    const handheld = renderProfileFor(DEVICES['iphone 13 portrait']);
    const tablet = renderProfileFor(DEVICES['ipad landscape']);
    const desktop = renderProfileFor(DEVICES['desktop 1080p']);

    for (const [smaller, larger] of [
      [handheld, tablet],
      [tablet, desktop],
    ] as const) {
      expect(smaller.shadowMapSize).toBeLessThanOrEqual(larger.shadowMapSize);
      expect(smaller.shadowSpan).toBeLessThanOrEqual(larger.shadowSpan);
      expect(smaller.chunksBehind + smaller.chunksAhead).toBeLessThanOrEqual(
        larger.chunksBehind + larger.chunksAhead,
      );
      expect(smaller.groundCover).toBeLessThanOrEqual(larger.groundCover);
      expect(smaller.groundDetail).toBeLessThanOrEqual(larger.groundDetail);
      expect(smaller.motes).toBeLessThanOrEqual(larger.motes);
      expect(smaller.samples).toBeLessThanOrEqual(larger.samples);
      expect(smaller.glowKernel).toBeLessThanOrEqual(larger.glowKernel);
      const passes = (p: typeof handheld) => Object.values(p.effects).filter(Boolean).length;
      expect(passes(smaller)).toBeLessThanOrEqual(passes(larger));
    }
  });

  it('caps the frame rate on everything without a fan, and nothing with one', () => {
    expect(renderProfileFor(DEVICES['iphone 13 portrait']).frameCap).toBe(30);
    expect(renderProfileFor(DEVICES['ipad landscape']).frameCap).toBe(60);
    expect(renderProfileFor(DEVICES['desktop 1080p']).frameCap).toBe(0);
  });

  it('keeps depth of field for the machines that can pay for it', () => {
    expect(renderProfileFor(DEVICES['desktop 1080p']).effects.depthOfField).toBe(true);
    expect(renderProfileFor(DEVICES['ipad landscape']).effects.depthOfField).toBe(false);
    expect(renderProfileFor(DEVICES['iphone 13 portrait']).effects.depthOfField).toBe(false);
  });

  it('trades resolution away on a dense screen that is also a large one', () => {
    // A phone is already cheap to fill; a dense tablet is not, and it is the
    // pixel count rather than the ratio that decides.
    expect(renderProfileFor(DEVICES['ipad landscape']).scaling).toBeGreaterThan(1);
    expect(renderProfileFor(DEVICES['iphone se landscape']).scaling).toBe(1);
    expect(renderProfileFor(DEVICES.macbook).scaling).toBe(1);
  });

  it('leaves the governor somewhere to move in every case', () => {
    for (const [name, device] of Object.entries(DEVICES)) {
      const profile = renderProfileFor(device);
      expect(profile.scalingFloor, name).toBeLessThanOrEqual(profile.scaling);
      expect(profile.scalingCeiling, name).toBeGreaterThan(profile.scaling);
    }
  });

  it('stills the motes when the player has asked for less motion', () => {
    expect(renderProfileFor(facts({ reducedMotion: true })).motes).toBe(0);
    expect(renderProfileFor(facts({ reducedMotion: false })).motes).toBeGreaterThan(0);
  });
});

describe('the player overriding the frame cap', () => {
  it('defers to the tier only while it is on auto', () => {
    const handheld = renderProfileFor(DEVICES['iphone 13 portrait']);
    expect(frameRateCapFor('auto', handheld)).toBe(30);
    expect(frameRateCapFor('smooth', handheld)).toBe(60);
    expect(frameRateCapFor('battery', renderProfileFor(DEVICES['desktop 1080p']))).toBe(30);
    expect(frameRateCapFor('unlimited', handheld)).toBe(0);
  });
});

describe('reading a browser that will not answer', () => {
  it('falls back to the conservative answer rather than throwing', () => {
    expect(() => readDeviceFacts(undefined)).not.toThrow();
    const blind = readDeviceFacts(undefined);
    expect(blind.pixelRatio).toBe(1);
    expect(blind.viewportLongEdge).toBeGreaterThan(0);
    expect(blind.coarsePointer).toBe(false);
  });

  it('survives a matchMedia that throws, as embedded webviews do', () => {
    const hostile = {
      devicePixelRatio: 2,
      innerWidth: 390,
      innerHeight: 844,
      navigator: { hardwareConcurrency: 4 },
      matchMedia: () => {
        throw new Error('not allowed here');
      },
    } as unknown as Window;
    const read = readDeviceFacts(hostile);
    expect(read.viewportLongEdge).toBe(844);
    expect(read.coarsePointer).toBe(false);
    expect(read.cores).toBe(4);
  });
});

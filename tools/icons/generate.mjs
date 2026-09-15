/**
 * Renders the Evercast app icons.
 *
 * Dependency-free on purpose. The project ships four runtime dependencies and
 * an icon generator is not worth a fifth, nor worth a build step that only
 * runs when someone remembers - so this writes PNG by hand (Node already has
 * the only hard part, zlib) and the output is committed.
 *
 *   node tools/icons/generate.mjs
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/* Straight from src/ui/theme/tokens.css - the icon is the same game. */
const BG = [0x07, 0x0d, 0x10];
const INK = [0xee, 0xe5, 0xc9];
const ACCENT = [0xb8, 0xcc, 0x59];

const CRC_TABLE = Int32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** `pixels` is RGBA, row-major, `size` square. */
function png(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // truecolour with alpha
  // Every scanline is filter 0, which costs a few kilobytes and keeps this
  // readable; these are 512px at most and ship once.
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const mix = (a, b, t) => a.map((channel, i) => Math.round(channel + (b[i] - channel) * t));
const clamp01 = (value) => Math.max(0, Math.min(1, value));
/** 1 inside, 0 outside, with a pixel of softness so nothing stairsteps. */
const edge = (distance, radius, feather) => clamp01((radius - distance) / feather);

/**
 * The mark: a bolt held inside a ring, on the game's own night.
 *
 * `inset` is what the maskable variant needs - a launcher may crop a circle
 * out of the middle, so the drawing has to sit inside the safe area while the
 * background still reaches every corner.
 */
function draw(size, inset) {
  const pixels = Buffer.alloc(size * size * 4);
  const centre = (size - 1) / 2;
  const scale = (size / 2) * inset;
  // One device pixel, in the same units the shapes below are described in.
  const soft = (size / 220) / scale;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (x - centre) / scale;
      const dy = (y - centre) / scale;
      const distance = Math.hypot(dx, dy);

      // A little light pooling behind the mark, so the ground is not flat.
      let colour = mix(BG, [0x16, 0x26, 0x2a], clamp01(1 - distance * 1.15));

      /*
       * The bolt: one slender stroke leaning across the ring, widest at the
       * waist and tapering to points. Kept thin deliberately - the first pass
       * at this was three times the width and read as a slab rather than as
       * anything struck.
       */
      const reach = 0.95;
      const along = clamp01(1 - Math.abs(dy) / reach);
      const halfWidth = 0.115 * Math.sin(along * Math.PI * 0.5) + 0.012;
      const lean = dy * 0.44;
      const offBolt = Math.abs(dx - lean);
      const bolt = edge(offBolt, halfWidth, soft + 0.008) * edge(Math.abs(dy), reach, soft + 0.008);

      /*
       * The ring, broken where the bolt passes through it rather than at a
       * fixed angle - so the gap follows the lean instead of drifting off it
       * as the stroke crosses.
       */
      const crossing = edge(offBolt, halfWidth + 0.085, soft + 0.02);
      colour = mix(colour, ACCENT, edge(Math.abs(distance - 0.76), 0.05, soft + 0.012) * (1 - crossing));

      colour = mix(colour, INK, bolt);

      const at = (y * size + x) * 4;
      pixels[at] = colour[0];
      pixels[at + 1] = colour[1];
      pixels[at + 2] = colour[2];
      pixels[at + 3] = 0xff;
    }
  }
  return pixels;
}

const OUTPUT = [
  { file: 'public/icons/icon-192.png', size: 192, inset: 0.82 },
  { file: 'public/icons/icon-512.png', size: 512, inset: 0.82 },
  // Maskable: the drawing pulled well inside the safe area, background full bleed.
  { file: 'public/icons/icon-maskable-512.png', size: 512, inset: 0.6 },
  // iOS composites onto its own rounded rect and does not honour `purpose`.
  { file: 'public/icons/apple-touch-icon.png', size: 180, inset: 0.78 },
];

for (const { file, size, inset } of OUTPUT) {
  const path = resolve(file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, png(size, draw(size, inset)));
  console.log(`wrote ${file} (${size}x${size})`);
}

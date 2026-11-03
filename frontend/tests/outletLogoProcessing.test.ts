import assert from 'node:assert/strict';
import test from 'node:test';
import { crc32, inflateSync } from 'node:zlib';
import { encodeMonochromeLogo, enhanceLogoPixels, LOGO_MAX_BYTES, LOGO_PRINTER_PROFILES } from '../src/pages/outletLogoProcessing.ts';

function decode(bytes: Uint8Array) {
  const png = Buffer.from(bytes);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  let offset = 8;
  const parts = new Map<string, Buffer>();
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    assert.equal(png.readUInt32BE(offset + 8 + length), crc32(png.subarray(offset + 4, offset + 8 + length)), `${type} checksum`);
    parts.set(type, png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  assert.equal(offset, png.length);
  assert.deepEqual([...parts.keys()], ['IHDR', 'IDAT', 'IEND']);
  const header = parts.get('IHDR')!;
  assert.equal(header[8], 1, 'one bit per pixel');
  assert.equal(header[9], 0, 'grayscale without alpha or palette');
  assert.deepEqual([...header.subarray(10)], [0, 0, 0]);
  return { width: header.readUInt32BE(0), height: header.readUInt32BE(4), rows: inflateSync(parts.get('IDAT')!) };
}

for (const size of [2, 3] as const) test(`${size}-inch worst-case monochrome PNG stays within 10 KB with valid checksums`, () => {
  const { width, height } = LOGO_PRINTER_PROFILES[size];
  const pixels = new Uint8ClampedArray(width * height * 4);
  let seed = 123;
  for (let index = 0; index < pixels.length; index += 4) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const color = seed & 0x8000 ? 255 : 0;
    pixels.set([color, color, color, 255], index);
  }
  const png = encodeMonochromeLogo(pixels, width, height);
  assert.equal(png.length, size === 2 ? 5868 : 9068);
  assert.ok(png.length <= LOGO_MAX_BYTES);
  const decoded = decode(png), stride = Math.ceil(width / 8) + 1;
  assert.equal(decoded.width, width); assert.equal(decoded.height, height);
  assert.equal(decoded.rows.length, stride * height);
  for (let y = 0; y < height; y++) {
    assert.equal(decoded.rows[y * stride], 0);
    for (let x = 0; x < width; x++) {
      const white = !!(decoded.rows[y * stride + 1 + (x >> 3)]! & (1 << (7 - (x & 7))));
      assert.equal(white ? 255 : 0, pixels[(y * width + x) * 4]);
    }
  }
});

test('thresholding removes colors and grayscale; transparent pixels composite on white', () => {
  const pixels = new Uint8ClampedArray([
    255, 0, 0, 255, 0, 255, 0, 255, 120, 120, 120, 255, 200, 200, 200, 255,
    0, 0, 0, 0, 0, 0, 0, 100, 0, 0, 0, 255, 255, 255, 255, 255,
  ]);
  const { rows } = decode(encodeMonochromeLogo(pixels, 8, 1));
  assert.deepEqual([...rows], [0, 0b01011001]);
});

test('invalid dimensions and incomplete pixel buffers cannot produce an upload', () => {
  for (const [width, height] of [[0, 1], [281, 250], [280, 251], [1.5, 1], [-1, 1]]) {
    assert.throws(() => encodeMonochromeLogo(new Uint8ClampedArray(), width!, height!), /dimensions/);
  }
  assert.throws(() => encodeMonochromeLogo(new Uint8ClampedArray(3), 1, 1), /dimensions/);
});

test('3-inch text conversion preserves fine light strokes on dark and dark strokes on light', () => {
  for (const [background, stroke] of [[0, 120], [255, 170]]) {
    const pixels = new Uint8ClampedArray(9 * 9 * 4);
    for (let index = 0; index < pixels.length; index += 4) pixels.set([background!, background!, background!, 255], index);
    // A thin, antialiased vertical glyph stroke spanning the full text region.
    for (let y = 1; y < 8; y++) pixels.set([stroke!, stroke!, stroke!, 255], (y * 9 + 4) * 4);
    const fixed = decode(encodeMonochromeLogo(pixels, 9, 9));
    const enhanced = decode(encodeMonochromeLogo(pixels, 9, 9, true));
    const white = (rows: Buffer, x: number, y: number) => !!(rows[y * 3 + 1 + (x >> 3)]! & (1 << (7 - (x & 7))));
    for (let y = 1; y < 8; y++) {
      assert.equal(white(fixed.rows, 4, y), background === 255, 'fixed cutoff loses the faint stroke');
      assert.equal(white(enhanced.rows, 4, y), background === 0, 'adaptive cutoff keeps the complete stroke');
      assert.equal(white(enhanced.rows, 3, y), background === 255, 'neighboring background stays intact');
    }
  }
});

test('enhancement reduces small tonal noise without inventing edges in flat artwork', () => {
  const pixels = new Uint8ClampedArray(16 * 16 * 4);
  for (let index = 0; index < 256; index++) {
    const value = 210 + ((index * 7) % 13) - 6;
    pixels.set([value, value, value, 255], index * 4);
  }
  const enhanced = enhanceLogoPixels(pixels, 16, 16);
  const deviation = (data: Uint8ClampedArray) => {
    const values = Array.from({ length: 256 }, (_, index) => data[index * 4]!);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    return values.reduce((sum, value) => sum + Math.abs(value - mean), 0);
  };
  assert.ok(deviation(enhanced.pixels) < deviation(pixels) * .7);
  const flat = new Uint8ClampedArray(8 * 8 * 4);
  for (let index = 0; index < 64; index++) flat.set([180, 180, 180, 255], index * 4);
  const result = enhanceLogoPixels(flat, 8, 8);
  assert.deepEqual(result.pixels, flat);
  assert.equal(result.hasEdges, false);
  assert.equal(result.contrast, 0);
});

test('contrast improves while sharpening stays inside existing edge values', () => {
  const pixels = new Uint8ClampedArray(16 * 16 * 4);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const value = x < 8 ? 100 : 200;
    pixels.set([value, value, value, 255], (y * 16 + x) * 4);
  }
  const result = enhanceLogoPixels(pixels, 16, 16);
  assert.equal(result.contrast, 100);
  const shades = Array.from({ length: 256 }, (_, index) => result.pixels[index * 4]!);
  assert.ok(Math.min(...shades) < 100 && Math.max(...shades) > 200);
  assert.ok(Math.min(...shades) >= 47 && Math.max(...shades) <= 208, 'no overshooting halos');
});

test('sharpness diagnostics distinguish soft transitions from crisp source edges', () => {
  const make = (soft: boolean) => {
    const pixels = new Uint8ClampedArray(32 * 8 * 4);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 32; x++) {
      const value = soft ? 20 + x * 7 : x < 16 ? 20 : 237;
      pixels.set([value, value, value, 255], (y * 32 + x) * 4);
    }
    return enhanceLogoPixels(pixels, 32, 8);
  };
  assert.ok(make(true).sharpness < 20);
  assert.ok(make(false).sharpness > 200);
});

test('textured coloured backgrounds become solid without deleting white and yellow lettering', () => {
  const width = 64, height = 64, pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = (y * width + x) * 4, noise = (x * 71 + y * 37) % 110;
    let color = [120 + noise, 10 + noise % 35, 5, 255];
    if (x < 4 || x >= 60 || y < 4 || y >= 60) color = [255, 255, 255, 255];
    else if (x < 8 || x >= 56 || y < 8 || y >= 56) color = [180 + noise % 75, 145 + noise % 65, 5, 255];
    if (x >= 18 && x < 22 && y >= 16 && y < 45) color = [255, 255, 255, 255];
    if (x >= 38 && x < 42 && y >= 16 && y < 45) color = [255, 245, 0, 255];
    pixels.set(color, offset);
  }
  const result = enhanceLogoPixels(pixels, width, height);
  assert.equal(result.colourTextureSimplified, true);
  const png = decode(encodeMonochromeLogo(result.pixels, width, height, true));
  const white = (x: number, y: number) => !!(png.rows[y * 9 + 1 + (x >> 3)]! & (1 << (7 - (x & 7))));
  for (let y = 12; y < 50; y++) for (let x = 10; x < 54; x++) {
    if (x >= 16 && x < 24 || x >= 36 && x < 44 || y >= 14 && y < 18 || y >= 43 && y < 47) continue;
    assert.equal(white(x, y), false, 'background texture cannot turn into scattered white dots');
  }
  for (let y = 18; y < 43; y++) {
    assert.equal(white(19, y), true, 'white glyph stroke survives');
    assert.equal(white(39, y), true, 'yellow glyph stroke survives');
  }
  assert.equal(white(1, 1), true, 'outer white background stays white');
});

test('already clean monochrome and flat-colour sources bypass colour texture cleanup', () => {
  for (const color of [[0, 0, 0, 255], [255, 255, 255, 255], [150, 15, 10, 255]]) {
    const pixels = new Uint8ClampedArray(32 * 32 * 4);
    for (let index = 0; index < pixels.length; index += 4) pixels.set(color, index);
    assert.equal(enhanceLogoPixels(pixels, 32, 32).colourTextureSimplified, false);
  }
});

test('colour cleanup preserves dark lettering on light textured panels with outer white paper', () => {
  const width = 64, height = 48, pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const noise = (x * 71 + y * 37) % 75;
    let color = [40, 170 + noise, 40, 255];
    if (x < 4 || x >= 60 || y < 4 || y >= 44) color = [255, 255, 255, 255];
    if (x >= 28 && x < 34 && y >= 12 && y < 36) color = [0, 0, 0, 255];
    pixels.set(color, (y * width + x) * 4);
  }
  const result = enhanceLogoPixels(pixels, width, height);
  assert.equal(result.colourTextureSimplified, true);
  const png = decode(encodeMonochromeLogo(result.pixels, width, height, true));
  for (let y = 14; y < 34; y++) {
    assert.equal(!!(png.rows[y * 9 + 4]! & 8), false, 'black letter stays black');
    assert.equal(!!(png.rows[y * 9 + 2]! & 128), true, 'light coloured panel stays light');
  }
});

test('orange glow does not become white patches behind yellow footer lettering', () => {
  const width = 80, height = 80, pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const noise = (x * 71 + y * 37) % 110;
    let color = [120 + noise, 10 + noise % 35, 5, 255];
    if (x < 4 || x >= 76 || y < 4 || y >= 76) color = [255, 255, 255, 255];
    else if (x < 8 || x >= 72 || y < 8 || y >= 72) color = [235, 200 + noise % 35, 10, 255];
    else if (y > 42 && y < 65) color = [245, 140 + noise % 45, 20, 255];
    if (x >= 40 && x < 69 && y >= 45 && y < 63) color = [250, 240, 10, 255];
    if (x >= 24 && x < 28 && y >= 48 && y < 59) color = [255, 240, 0, 255];
    pixels.set(color, (y * width + x) * 4);
  }
  const result = enhanceLogoPixels(pixels, width, height);
  assert.equal(result.colourTextureSimplified, true);
  const png = decode(encodeMonochromeLogo(result.pixels, width, height, true));
  const white = (x: number, y: number) => !!(png.rows[y * 11 + 1 + (x >> 3)]! & (1 << (7 - (x & 7))));
  for (let y = 46; y < 62; y++) for (let x = 35; x < 68; x++) assert.equal(white(x, y), false, 'warm glow remains background');
  for (let y = 50; y < 57; y++) assert.equal(white(25, y), true, 'yellow footer stroke remains foreground');
  assert.equal(white(5, 40), false, 'decorative gold border becomes a solid outline');
  assert.equal(white(1, 40), true, 'outer paper is preserved');
});

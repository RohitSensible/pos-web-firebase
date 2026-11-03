export type LogoPrinterSize = 2 | 3;
export const LOGO_MAX_BYTES = 10_240;
export const LOGO_PRINTER_PROFILES = {
  2: { width: 220, height: 200 },
  3: { width: 280, height: 250 },
} as const;

export interface ProcessedOutletLogo {
  file: File;
  printerSize: LogoPrinterSize;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  qualityWarnings: string[];
}

function simplifyColourTexture(pixels: Uint8ClampedArray, gray: Float64Array, width: number, height: number) {
  const groups = new Int8Array(gray.length).fill(-1);
  const histograms = Array.from({ length: 6 }, () => new Uint32Array(256));
  const counts = new Uint32Array(6), sums = new Float64Array(6), squares = new Float64Array(6);
  const yellowStrokes = new Uint8Array(gray.length);
  let coloured = 0, dark = 0, light = 0;
  for (let index = 0; index < gray.length; index++) {
    const offset = index * 4, alpha = pixels[offset + 3]! / 255;
    const r = pixels[offset]! * alpha + 255 * (1 - alpha);
    const g = pixels[offset + 1]! * alpha + 255 * (1 - alpha);
    const b = pixels[offset + 2]! * alpha + 255 * (1 - alpha);
    const maximum = Math.max(r, g, b), minimum = Math.min(r, g, b), delta = maximum - minimum;
    if (maximum < 48) dark++;
    if (minimum > 210 && delta < 30) light++;
    // Keep neutral lettering, antialiased edges, white paper and transparency
    // untouched. Texture is grouped by colour before grayscale loses that signal.
    if (maximum < 60 || delta < 40 || delta / maximum < .4) continue;
    let hue = maximum === r ? (g - b) / delta : maximum === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
    hue = (hue * 60 + 360) % 360;
    const group = Math.round(hue / 60) % 6, value = Math.round(gray[index]!);
    groups[index] = group; histograms[group]![value]!++; counts[group]!++;
    if (group === 1 && r >= 200 && g >= 190 && g >= r * .82 && b <= g * .55) yellowStrokes[index] = 1;
    sums[group]! += value; squares[group]! += value * value; coloured++;
  }
  if (coloured < 128 || coloured < gray.length * .08) return null;
  let dominant = 0;
  for (let group = 1; group < 6; group++) if (counts[group]! > counts[dominant]!) dominant = group;
  const mean = sums[dominant]! / counts[dominant]!;
  if (squares[dominant]! / counts[dominant]! - mean * mean < 100) return null;
  let interiorLight = light;
  let outerPaper: Uint8Array | null = null;
  if (mean >= 128 && dark > gray.length * .02 || dominant === 0) {
    // White paper outside the artwork is not evidence of white lettering.
    // Exclude border-connected white so dark text on a light coloured panel
    // is not merged into a black panel when flattening its texture.
    const visited = new Uint8Array(gray.length), queue = new Int32Array(gray.length);
    let read = 0, written = 0;
    const enqueue = (index: number) => {
      if (!visited[index] && groups[index]! < 0 && gray[index]! > 210) { visited[index] = 1; queue[written++] = index; }
    };
    for (let x = 0; x < width; x++) { enqueue(x); enqueue((height - 1) * width + x); }
    for (let y = 0; y < height; y++) { enqueue(y * width); enqueue(y * width + width - 1); }
    while (read < written) {
      const index = queue[read++]!, x = index % width;
      if (x > 0) enqueue(index - 1);
      if (x + 1 < width) enqueue(index + 1);
      if (index >= width) enqueue(index - width);
      if (index + width < gray.length) enqueue(index + width);
    }
    interiorLight = Math.max(0, light - written);
    outerPaper = visited;
  }
  const tones = new Float64Array(6);
  for (let group = 0; group < 6; group++) {
    let cumulative = 0, median = 0;
    for (; median < 255; median++) { cumulative += histograms[group]![median]!; if (cumulative >= counts[group]! / 2) break; }
    tones[group] = group === dominant ? (mean >= 128 && dark > interiorLight && dark > gray.length * .02 ? 224 : 32) : median >= 128 ? 224 : 32;
  }
  const warmBackground = dominant === 0 && tones[dominant]! < 128;
  const outerAccent = new Uint8Array(gray.length);
  if (warmBackground && outerPaper) {
    const queue = new Int32Array(gray.length);
    const borderBand = Math.max(2, Math.ceil(Math.min(width, height) * .08));
    let read = 0, written = 0;
    const enqueue = (index: number, distance = 1) => {
      if (distance <= borderBand && groups[index] === 1 && !outerAccent[index]) { outerAccent[index] = distance; queue[written++] = index; }
    };
    for (let index = 0; index < gray.length; index++) {
      if (groups[index] !== 1) continue;
      const x = index % width;
      if (x === 0 || x === width - 1 || index < width || index >= gray.length - width
        || outerPaper[index - 1] || outerPaper[index + 1] || outerPaper[index - width] || outerPaper[index + width]) enqueue(index);
    }
    while (read < written) {
      const index = queue[read++]!, x = index % width;
      const distance = outerAccent[index]! + 1;
      if (x > 0) enqueue(index - 1, distance);
      if (x + 1 < width) enqueue(index + 1, distance);
      if (index >= width) enqueue(index - width, distance);
      if (index + width < gray.length) enqueue(index + width, distance);
    }
  }
  if (warmBackground) {
    const visited = new Uint8Array(gray.length), queue = new Int32Array(gray.length);
    const minimumThickness = Math.max(6, Math.min(width, height) * .025);
    for (let start = 0; start < gray.length; start++) {
      if (!yellowStrokes[start] || visited[start]) continue;
      let read = 0, written = 1;
      queue[0] = start; visited[start] = 1;
      let left = start % width, right = left, top = Math.floor(start / width), bottom = top;
      while (read < written) {
        const index = queue[read++]!, x = index % width, y = Math.floor(index / width);
        left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (x + dx < 0 || x + dx >= width || y + dy < 0 || y + dy >= height) continue;
          const neighbor = (y + dy) * width + x + dx;
          if (yellowStrokes[neighbor] && !visited[neighbor]) { visited[neighbor] = 1; queue[written++] = neighbor; }
        }
      }
      const patchWidth = right - left + 1, patchHeight = bottom - top + 1;
      // A broad, densely filled glow patch is not a thin text stroke. Do not
      // apply this to neutral white lettering, narrow accents or open glyphs.
      if (written > Math.max(64, gray.length * .01) && patchWidth > minimumThickness && patchHeight > minimumThickness
        && written / (patchWidth * patchHeight) > .7) {
        for (let index = 0; index < written; index++) yellowStrokes[queue[index]!] = 0;
      }
    }
  }
  const flattened = gray.slice();
  for (let index = 0; index < gray.length; index++) {
    const group = groups[index]!;
    if (group < 0 || counts[group]! < 16) continue;
    if (warmBackground && group === 1) {
      // Orange/yellow glow is not necessarily foreground text. Keep bright
      // yellow stroke cores and their immediate antialiased neighbors, without
      // promoting an entire warm-colour region into a large white patch.
      let stroke = !!yellowStrokes[index];
      const x = index % width, y = Math.floor(index / width);
      if (!stroke) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (x + dx >= 0 && x + dx < width && y + dy >= 0 && y + dy < height
          && yellowStrokes[(y + dy) * width + x + dx] && !outerAccent[(y + dy) * width + x + dx]) stroke = true;
      }
      flattened[index] = stroke && !outerAccent[index] ? 224 : 32;
    } else flattened[index] = tones[group]!;
  }
  return flattened;
}

/** Conservative local enhancement, without changing glyph shapes or inventing detail. */
export function enhanceLogoPixels(pixels: Uint8ClampedArray, width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 1024 || height > 1024
    || pixels.length !== width * height * 4) throw new Error('Unable to enhance these logo dimensions.');
  const count = width * height, gray = new Float64Array(count), histogram = new Uint32Array(256);
  for (let index = 0; index < count; index++) {
    const offset = index * 4, alpha = pixels[offset + 3]! / 255;
    const value = (pixels[offset]! * .2126 + pixels[offset + 1]! * .7152 + pixels[offset + 2]! * .0722) * alpha + 255 * (1 - alpha);
    gray[index] = value; histogram[Math.round(value)]!++;
  }
  const percentile = (fraction: number) => {
    let total = 0;
    for (let value = 0; value < 256; value++) { total += histogram[value]!; if (total >= count * fraction) return value; }
    return 255;
  };
  const low = percentile(.01), high = percentile(.99), contrast = high - low;
  let edgeSum = 0, edgeSquares = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = y * width + x;
    for (const previous of [x > 0 ? index - 1 : index, y > 0 ? index - width : index]) {
      const edge = Math.abs(gray[index]! - gray[previous]!);
      edgeSum += edge; edgeSquares += edge * edge;
    }
  }
  const sharpness = edgeSum > 0 && contrast > 0 ? edgeSquares / edgeSum * 255 / contrast : 0;
  const colourCleaned = simplifyColourTexture(pixels, gray, width, height);
  const processingGray = colourCleaned ?? gray;
  const denoised = new Float64Array(count);
  let isolatedSamples = 0;
  const gain = contrast >= 24 ? Math.min(1.6, 255 / contrast) : 1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const center = processingGray[y * width + x]!;
    let total = center * 4, weight = 4, darker = 0, lighter = 0, neighbors = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if ((!dx && !dy) || x + dx < 0 || y + dy < 0 || x + dx >= width || y + dy >= height) continue;
      const neighbor = processingGray[(y + dy) * width + x + dx]!;
      neighbors++;
      if (neighbor < center - 45) darker++;
      if (neighbor > center + 45) lighter++;
      // Average only similar intensities, so noise is reduced without blurring
      // thin strokes, diacritics, punctuation or opposite-polarity edges.
      if (Math.abs(neighbor - center) <= 20) { total += neighbor; weight++; }
    }
    if (neighbors >= 5 && Math.max(darker, lighter) >= Math.ceil(neighbors * .75)) isolatedSamples++;
    const value = total / weight;
    denoised[y * width + x] = gain === 1 ? value : value >= 250 ? 255 : value <= 5 ? 0
      : Math.max(0, Math.min(255, (value - (low + high) / 2) * gain + 127.5));
  }
  const enhanced = new Uint8ClampedArray(pixels.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const center = denoised[y * width + x]!;
    let blur = 0, minimum = center, maximum = center;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const neighbor = denoised[Math.max(0, Math.min(height - 1, y + dy)) * width + Math.max(0, Math.min(width - 1, x + dx))]!;
      blur += neighbor * (dx === 0 ? 2 : 1) * (dy === 0 ? 2 : 1);
      minimum = Math.min(minimum, neighbor); maximum = Math.max(maximum, neighbor);
    }
    const detail = center - blur / 16;
    const adjustment = Math.abs(detail) >= 3 && maximum - minimum >= 24 ? Math.max(-12, Math.min(12, detail * .35)) : 0;
    // Clamp to the existing neighborhood range to avoid artificial halos.
    const value = Math.max(minimum, Math.min(maximum, center + adjustment));
    const offset = (y * width + x) * 4;
    enhanced[offset] = enhanced[offset + 1] = enhanced[offset + 2] = value;
    enhanced[offset + 3] = 255;
  }
  return { pixels: enhanced, contrast, sharpness, hasEdges: edgeSum > 0, noiseFraction: isolatedSamples / count, colourTextureSimplified: colourCleaned !== null };
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, payload: Uint8Array): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(payload.length + 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, payload.length);
  bytes.set(new TextEncoder().encode(type), 4);
  bytes.set(payload, 8);
  view.setUint32(bytes.length - 4, crc32(bytes.subarray(4, bytes.length - 4)));
  return bytes;
}

/** One-bit grayscale PNG: decoded pixels can only be opaque black or white. */
export function encodeMonochromeLogo(pixels: Uint8ClampedArray, width: number, height: number, preserveFineText = false, softSource = false): Uint8Array<ArrayBuffer> {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 280 || height > 250
    || pixels.length !== width * height * 4) throw new Error('Unable to prepare these logo dimensions.');
  const stride = Math.ceil(width / 8) + 1;
  const rows = new Uint8Array(stride * height);
  const luminance = new Float64Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = (y * width + x) * 4;
    const alpha = pixels[index + 3]! / 255;
    // Composite transparency on white before thresholding, including antialiased edges.
    luminance[y * width + x] = (pixels[index]! * .2126 + pixels[index + 1]! * .7152 + pixels[index + 2]! * .0722) * alpha + 255 * (1 - alpha);
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let threshold = 160;
    if (preserveFineText) {
      let total = 0, squares = 0, count = 0;
      const radius = softSource ? 3 : 1;
      for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
        if (x + dx >= 0 && x + dx < width && y + dy >= 0 && y + dy < height) {
          const value = luminance[(y + dy) * width + x + dx]!;
          total += value; squares += value * value; count++;
        }
      }
      // Lower the cutoff around white-on-black lettering; raise it around
      // black-on-white lettering. Preserve thin antialiased strokes in both
      // polarities without dithering, thickening letters or filling their holes.
      const mean = total / count;
      threshold = 64 + mean / 2;
      if (softSource) {
        // Local mean/variance handles weak strokes that a global cutoff loses.
        // Mirror the rule for reverse lettering; retain the quality warning,
        // since binarization cannot establish that missing text was recovered.
        const deviation = Math.sqrt(Math.max(0, squares / count - mean * mean));
        const factor = 1 + .28 * (deviation / 128 - 1);
        threshold = Math.max(12, Math.min(243, mean < 128 ? mean * factor + 6 : 255 - ((255 - mean) * factor + 6)));
      }
    }
    if (luminance[y * width + x]! >= threshold) rows[y * stride + 1 + (x >> 3)]! |= 1 << (7 - (x & 7));
  }
  // A single stored DEFLATE block avoids browser-dependent PNG encoders or lossy
  // JPEG artifacts. Bit-packing bounds even a noisy 280×250 image to 9,068 bytes.
  const compressed = new Uint8Array(rows.length + 11);
  compressed.set([0x78, 0x01, 0x01]);
  const zlib = new DataView(compressed.buffer);
  zlib.setUint16(3, rows.length, true);
  zlib.setUint16(5, (~rows.length) & 0xffff, true);
  compressed.set(rows, 7);
  let a = 1, b = 0;
  for (const byte of rows) { a = (a + byte) % 65521; b = (b + a) % 65521; }
  zlib.setUint32(compressed.length - 4, ((b << 16) | a) >>> 0);
  const header = new Uint8Array(13);
  const dimensions = new DataView(header.buffer);
  dimensions.setUint32(0, width); dimensions.setUint32(4, height);
  header[8] = 1; // 1 bit per pixel; grayscale, no alpha, no interlacing.
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', compressed), chunk('IEND', new Uint8Array())];
  const output = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  if (!output.length || output.length > LOGO_MAX_BYTES) throw new Error('Unable to prepare this logo within 10 KB. Choose another image.');
  return output;
}

function logoContentBounds(image: ImageBitmap) {
  // Inspect a bounded-size copy for blank outer margins. Include every visible
  // mark (including detached header/footer text), with a safety margin, rather
  // than cropping to the largest shape or the center of the logo.
  const scale = Math.min(1, 1024 / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Image processing is unavailable in this browser.');
  context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let left = canvas.width, top = canvas.height, right = -1, bottom = -1;
  for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
    const index = (y * canvas.width + x) * 4;
    if (Math.min(pixels[index]!, pixels[index + 1]!, pixels[index + 2]!) < 250) {
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
  }
  if (right < left) return { x: 0, y: 0, width: image.width, height: image.height };
  const x = Math.max(0, Math.floor((left - 2) * image.width / canvas.width));
  const y = Math.max(0, Math.floor((top - 2) * image.height / canvas.height));
  return { x, y,
    width: Math.min(image.width, Math.ceil((right + 3) * image.width / canvas.width)) - x,
    height: Math.min(image.height, Math.ceil((bottom + 3) * image.height / canvas.height)) - y };
}

export async function processOutletLogo(file: File, printerSize: LogoPrinterSize): Promise<ProcessedOutletLogo> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || !file.size || file.size > 5 * 1024 * 1024) {
    throw new Error('Choose a JPEG, PNG or WebP image up to 5 MB.');
  }
  const profile = LOGO_PRINTER_PROFILES[printerSize];
  if (!profile) throw new Error('Select a 2-inch or 3-inch printer.');
  let image: ImageBitmap;
  try { image = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { throw new Error('The selected file is not a readable image. Choose another image.'); }
  try {
    if (!image.width || !image.height || image.width * image.height > 40_000_000) throw new Error('Choose an image below 40 megapixels.');
    const canvas = document.createElement('canvas');
    canvas.width = profile.width; canvas.height = profile.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image processing is unavailable in this browser.');
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
    const bounds = logoContentBounds(image);
    const work = document.createElement('canvas');
    const workScale = Math.min(1, 1024 / Math.max(bounds.width, bounds.height));
    work.width = Math.max(1, Math.round(bounds.width * workScale));
    work.height = Math.max(1, Math.round(bounds.height * workScale));
    const workContext = work.getContext('2d');
    if (!workContext) throw new Error('Image processing is unavailable in this browser.');
    workContext.fillStyle = '#fff'; workContext.fillRect(0, 0, work.width, work.height);
    workContext.imageSmoothingEnabled = true; workContext.imageSmoothingQuality = 'high';
    workContext.drawImage(image, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, work.width, work.height);
    const workingPixels = workContext.getImageData(0, 0, work.width, work.height);
    const enhanced = enhanceLogoPixels(workingPixels.data, work.width, work.height);
    workingPixels.data.set(enhanced.pixels); workContext.putImageData(workingPixels, 0, 0);
    const scale = Math.min(profile.width / work.width, profile.height / work.height);
    const width = work.width * scale, height = work.height * scale;
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
    // Enhance at source/working resolution, then proportionally fit the complete
    // artwork and convert once to monochrome at the final printer resolution.
    context.drawImage(work, (profile.width - width) / 2, (profile.height - height) / 2, width, height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const softSource = enhanced.contrast >= 30 && enhanced.hasEdges && enhanced.sharpness < 20;
    const bytes = encodeMonochromeLogo(pixels, canvas.width, canvas.height, true, softSource);
    const processed = new File([bytes], 'outlet-logo.png', { type: 'image/png' });
    if (processed.size > LOGO_MAX_BYTES) throw new Error('The processed logo exceeds 10 KB. Choose another image.');
    const qualityWarnings: string[] = [];
    if (Math.min(profile.width / bounds.width, profile.height / bounds.height) > 1.15) {
      qualityWarnings.push('This source is smaller than the printer output. Enlarging cannot recover missing lettering.');
    }
    if (enhanced.contrast < 30) qualityWarnings.push('The source has very little contrast or detail. Fine lettering may not survive black-and-white conversion.');
    if (softSource) {
      qualityWarnings.push('The source appears soft or blurry. Sharpening cannot restore missing text; review both previews carefully.');
    }
    if (enhanced.noiseFraction > .04) qualityWarnings.push('The source has substantial noise or texture. It may print as scattered dots; a cleaner original is recommended.');
    if (enhanced.colourTextureSimplified) qualityWarnings.push('Colour texture was simplified into solid tones. Compare all lettering and outlines with the original before uploading.');
    return { file: processed, printerSize, ...profile, originalWidth: image.width, originalHeight: image.height, qualityWarnings };
  } finally { image.close(); }
}

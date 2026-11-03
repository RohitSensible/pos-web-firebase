import { PRODUCT_IMAGE_MAX_BYTES, PRODUCT_IMAGE_TARGET_BYTES } from '../../../shared/productImageLimits.ts';
export { PRODUCT_IMAGE_MAX_BYTES, PRODUCT_IMAGE_TARGET_BYTES };

export function productImageSizeLabel(file: Blob): string {
  return `${(file.size / 1024).toFixed(2)} KB · ${file.size <= PRODUCT_IMAGE_MAX_BYTES ? 'Within 25 KB limit' : 'Exceeds 25 KB limit'}`;
}
export const IMAGE_INPUT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
export interface CropRegion { x: number; y: number; size: number; width?: number; height?: number }

export function cropRegion(width: number, height: number, zoom: number, x: number, y: number): CropRegion {
  const size = Math.min(width, height) / Math.max(1, zoom);
  return { size, x: (width - size) * Math.min(1, Math.max(0, x)), y: (height - size) * Math.min(1, Math.max(0, y)) };
}

export async function decodeProductImage(file: File): Promise<ImageBitmap> {
  if (!IMAGE_INPUT_TYPES.has(file.type)) throw new Error('Choose a JPEG, PNG, or WebP image.');
  if (file.size > 30 * 1024 * 1024) throw new Error('Choose an image smaller than 30 MB.');
  // Browser decoding applies JPEG EXIF orientation before crop coordinates are calculated.
  const image = await createImageBitmap(file, { imageOrientation: 'from-image' });
  if (image.width * image.height > 40_000_000) {
    image.close(); throw new Error('This image is too large to edit. Choose an image below 40 megapixels.');
  }
  return image;
}

function encode(canvas: HTMLCanvasElement, type = 'image/png', quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob
    ? resolve(blob) : reject(new Error('Unable to process this image. Please try another image.')), type, quality));
}

// The Android POS displays JPEG product images but not WebP, so every upload is
// a JPEG within the 25 KB limit, whatever the source format.
export async function processProductImage(image: ImageBitmap, crop: CropRegion, source?: File): Promise<File> {
  if (source?.type === 'image/jpeg' && source.size <= PRODUCT_IMAGE_TARGET_BYTES && crop.x === 0 && crop.y === 0
    && crop.width === image.width && crop.height === image.height && Math.max(image.width, image.height) <= 1600) return source;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Image editing is unavailable in this browser.');
  const cropWidth = crop.width ?? crop.size, cropHeight = crop.height ?? crop.size;
  const longestSide = Math.max(cropWidth, cropHeight);
  const draw = (size: number) => {
    canvas.width = Math.max(1, Math.floor(size * cropWidth / longestSide));
    canvas.height = Math.max(1, Math.floor(size * cropHeight / longestSide));
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
    // Every candidate comes directly from the decoded original, never encoded output.
    // Honor the chosen crop or the full source proportions without stretching.
    // JPEG has no alpha, so transparent areas become white rather than black.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, crop.x, crop.y, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
  };
  const asFile = (blob: Blob) => {
    if (!blob.size || blob.size > PRODUCT_IMAGE_MAX_BYTES || blob.type !== 'image/jpeg') {
      throw new Error('Unable to prepare an image within 25 KB. Adjust the crop or choose a simpler image.');
    }
    return new File([blob], 'product.jpg', { type: 'image/jpeg' });
  };
  const nativeSize = Math.max(1, Math.floor(longestSide));
  // Resize from the decoded original; never return oversized output.
  const initialSize = Math.min(nativeSize, 1600);
  const minimumSize = Math.min(initialSize, 256);
  let size = initialSize;
  while (true) {
    draw(size);
    const preferred = await encode(canvas, 'image/jpeg', 0.9);
    if (preferred.size <= PRODUCT_IMAGE_MAX_BYTES) return asFile(preferred);
    let best = await encode(canvas, 'image/jpeg', 0.6);
    if (best.size <= PRODUCT_IMAGE_MAX_BYTES) {
      let lower = 0.6, upper = 0.9;
      for (let attempt = 0; attempt < 7; attempt++) {
        const quality = (lower + upper) / 2;
        const candidate = await encode(canvas, 'image/jpeg', quality);
        if (candidate.size <= PRODUCT_IMAGE_MAX_BYTES) { lower = quality; best = candidate; }
        else upper = quality;
      }
      return asFile(best);
    }
    if (size === minimumSize) {
      throw new Error('Unable to prepare a clear image within 25 KB. Adjust the crop or choose a simpler image.');
    }
    size = Math.max(minimumSize, Math.floor(size * 0.85));
  }
}

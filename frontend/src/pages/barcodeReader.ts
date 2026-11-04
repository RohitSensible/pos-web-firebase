// Lazy-load the existing live decoder and preserve the exact scanned text.
export async function createBarcodeReader() {
  const { BrowserMultiFormatReader, BarcodeFormat } = await import('@zxing/browser');
  const reader = new BrowserMultiFormatReader(undefined, { delayBetweenScanAttempts: 250, delayBetweenScanSuccess: 500, tryPlayVideoTimeout: 10000 });
  reader.possibleFormats = [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E,
    BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.ITF, BarcodeFormat.QR_CODE];
  return reader;
}

// Decode locally: barcode images are never uploaded or persisted.
export async function decodeBarcodeImage(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image of the barcode.');
  if (file.size > 20 * 1024 * 1024) throw new Error('Choose an image smaller than 20 MB.');
  const url = URL.createObjectURL(file);
  const image = new Image();
  const canvas = document.createElement('canvas');
  try {
    image.src = url;
    try { await image.decode(); } catch { throw new Error('This image could not be opened. Choose a JPEG, PNG or WebP image.'); }
    const reader = await createBarcodeReader();
    const scale = Math.min(1, 2048 / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    for (let rotation = 0; rotation < 4; rotation++) {
      canvas.width = rotation % 2 ? height : width;
      canvas.height = rotation % 2 ? width : height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Image scanning is unavailable in this browser.');
      context.translate(canvas.width / 2, canvas.height / 2);
      context.rotate(rotation * Math.PI / 2);
      context.drawImage(image, -width / 2, -height / 2, width, height);
      try {
        const value = reader.decodeFromCanvas(canvas).getText();
        if (!value.trim() || value.length > 200) throw new Error('This code does not fit the 200-character Barcode field.');
        return value;
      } catch (reason) {
        const kind = (reason as { getKind?: () => string }).getKind?.();
        if (!['NotFoundException', 'ChecksumException', 'FormatException'].includes(kind ?? '')) throw reason;
      }
    }
    throw new Error('No readable barcode was found. Choose a clear, well-lit image showing the complete barcode.');
  } finally { image.src = ''; canvas.width = canvas.height = 0; URL.revokeObjectURL(url); }
}

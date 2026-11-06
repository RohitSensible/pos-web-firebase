export async function createDeviceQrSvg(deviceId: string): Promise<SVGSVGElement> {
  const { BrowserQRCodeSvgWriter } = await import('@zxing/browser');
  // Pass the raw ID unchanged. ZXing includes a four-module quiet zone.
  const svg = new BrowserQRCodeSvgWriter().write(deviceId, 260, 260);
  const background = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  background.setAttribute('width', '100%'); background.setAttribute('height', '100%'); background.setAttribute('fill', '#fff');
  svg.prepend(background);
  svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', `QR code for device ${deviceId}`);
  svg.setAttribute('shape-rendering', 'crispEdges');
  return svg;
}

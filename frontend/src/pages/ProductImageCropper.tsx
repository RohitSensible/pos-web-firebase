import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Image as ImageIcon, LoaderCircle, Minus, Plus, RotateCcw, RotateCw, ZoomIn } from 'lucide-react';
import { cropRegion, decodeProductImage, processProductImage } from './productImageProcessing.ts';
import './ProductImageCropper.css';

export function ProductImageCropper({ file, onCancel, onApply, onError }: {
  file: File; onCancel: () => void; onApply: (file: File) => void; onError?: (message: string) => void;
}) {
  const [image, setImage] = useState<ImageBitmap | null>(null);
  const [zoom, setZoom] = useState(1);
  const [squareCrop, setSquareCrop] = useState(false);
  const [position, setPosition] = useState({ x: 0.5, y: 0.5 });
  const [rotation, setRotation] = useState(0);
  const [rotated, setRotated] = useState<{ key: string; bitmap: ImageBitmap } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const saving = useRef(false);
  const active = useRef(true);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const panel = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopImmediatePropagation(); event.preventDefault(); if (!saving.current) onCancel(); }
      if (event.key === 'Tab') {
        const controls = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), canvas[tabindex]');
        if (!controls?.length) return;
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', escape, true);
    return () => { window.removeEventListener('keydown', escape, true); previous?.focus(); };
  }, [onCancel]);
  useEffect(() => {
    let active = true; let decoded: ImageBitmap | undefined;
    void decodeProductImage(file).then(value => { decoded = value; if (active) setImage(value); else value.close(); })
      .catch(reason => { if (active) setError((reason as Error).message); });
    return () => { active = false; decoded?.close(); };
  }, [file]);
  // Rotate Left/Right works on a rotated copy, so the preview, crop box and saved image all agree.
  const rotationKey = `${rotation}`;
  useEffect(() => {
    if (!image || rotation === 0) return;
    let live = true; let made: ImageBitmap | undefined;
    const turned = document.createElement('canvas');
    const quarter = rotation % 180 !== 0;
    turned.width = quarter ? image.height : image.width; turned.height = quarter ? image.width : image.height;
    const context = turned.getContext('2d')!;
    context.translate(turned.width / 2, turned.height / 2); context.rotate(rotation * Math.PI / 180);
    context.drawImage(image, -image.width / 2, -image.height / 2);
    void createImageBitmap(turned).then(bitmap => { made = bitmap; if (live) setRotated({ key: rotationKey, bitmap }); else bitmap.close(); });
    return () => { live = false; made?.close(); };
  }, [image, rotation, rotationKey]);
  const working = rotation === 0 ? image : rotated?.key === rotationKey ? rotated.bitmap : null;
  // The whole image is fitted into the dark stage; Square crop draws a movable box over it.
  const fit = (bitmap: ImageBitmap) => {
    const scale = Math.min(592 / bitmap.width, 592 / bitmap.height);
    return { scale, left: (640 - bitmap.width * scale) / 2, top: (640 - bitmap.height * scale) / 2 };
  };
  useEffect(() => {
    const target = canvas.current;
    if (!target || !working) return;
    const context = target.getContext('2d')!;
    const { scale, left, top } = fit(working);
    context.clearRect(0, 0, 640, 640);
    context.drawImage(working, left, top, working.width * scale, working.height * scale);
    if (!squareCrop) return;
    const crop = cropRegion(working.width, working.height, zoom, position.x, position.y);
    const box = { x: left + crop.x * scale, y: top + crop.y * scale, size: crop.size * scale };
    context.fillStyle = 'rgba(15, 23, 42, 0.55)';
    context.beginPath(); context.rect(0, 0, 640, 640); context.rect(box.x, box.y, box.size, box.size); context.fill('evenodd');
    context.strokeStyle = 'rgba(255, 255, 255, 0.45)'; context.lineWidth = 1;
    for (const third of [1, 2]) {
      context.beginPath(); context.moveTo(box.x + box.size * third / 3, box.y); context.lineTo(box.x + box.size * third / 3, box.y + box.size); context.stroke();
      context.beginPath(); context.moveTo(box.x, box.y + box.size * third / 3); context.lineTo(box.x + box.size, box.y + box.size * third / 3); context.stroke();
    }
    context.strokeStyle = '#ffffff'; context.lineWidth = 2; context.strokeRect(box.x, box.y, box.size, box.size);
    context.fillStyle = '#ffffff';
    for (const [x, y] of [[box.x, box.y], [box.x + box.size, box.y], [box.x, box.y + box.size], [box.x + box.size, box.y + box.size]]) context.fillRect(x - 7, y - 7, 14, 14);
  }, [working, zoom, position, squareCrop]);
  const changeZoom = (step: number) => { if (saving.current) return; setSquareCrop(true); setZoom(value => Math.max(1, Math.min(5, Math.round((value + step) * 10) / 10))); };
  const rotate = (quarterTurns: number) => { if (saving.current) return; setRotation(value => (value + quarterTurns * 90 + 360) % 360); setPosition({ x: 0.5, y: 0.5 }); };
  const prepare = async () => {
    if (!working || saving.current) return;
    saving.current = true; setBusy(true); setError('');
    try {
      // Let React paint the loader before rendering and encoding the crop.
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      if (!active.current) return;
      // An unrotated original may be reused as-is when it already fits; a rotated one is always re-encoded.
      const processed = await processProductImage(working, squareCrop ? cropRegion(working.width, working.height, zoom, position.x, position.y)
        : { x: 0, y: 0, size: Math.max(working.width, working.height), width: working.width, height: working.height }, rotation === 0 ? file : undefined);
      if (active.current) onApply(processed);
    }
    catch (reason) {
      if (active.current) {
        const message = (reason as Error).message;
        if (onError) onError(message); else setError(message);
      }
    }
    finally { saving.current = false; if (active.current) setBusy(false); }
  };
  return createPortal(<div className="product-crop-backdrop" onClick={event => event.stopPropagation()}>
    <div ref={panel} className="product-crop-dialog" aria-busy={busy} role="dialog" aria-modal="true" aria-labelledby="product-crop-title" tabIndex={-1}>
      <header className="product-crop-header">
        <span className="product-crop-icon" aria-hidden="true"><ImageIcon size={22} /></span>
        <div><h3 id="product-crop-title">Prepare Product Image</h3>
          <p id="product-crop-help">Crop the image and select the aspect ratio. The selected ratio will be preserved.</p></div>
      </header>
      <div className="product-crop-ratio" role="group" aria-label="Aspect ratio">
        <button type="button" disabled={busy} aria-pressed={!squareCrop} onClick={() => setSquareCrop(false)}>Original</button>
        <button type="button" disabled={busy} aria-pressed={squareCrop} onClick={() => setSquareCrop(true)}>Square crop</button>
      </div>
      <div className="product-crop-stage">
        <canvas ref={canvas} width={640} height={640} aria-label={squareCrop ? 'Square crop preview. Drag to move the crop, scroll or pinch to zoom.' : 'Full image preview'} tabIndex={0}
          onWheel={event => { if (squareCrop && !saving.current) setZoom(value => Math.max(1, Math.min(5, value * Math.exp(-event.deltaY * 0.002)))); }}
          onKeyDown={event => {
            if (saving.current || !squareCrop) return;
            if (['+', '=', '-', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) event.preventDefault();
            if (event.key === '+' || event.key === '=') setZoom(value => Math.min(5, value + 0.1));
            if (event.key === '-') setZoom(value => Math.max(1, value - 0.1));
            if (event.key.startsWith('Arrow')) setPosition(value => ({ x: Math.max(0, Math.min(1, value.x + (event.key === 'ArrowLeft' ? -0.02 : event.key === 'ArrowRight' ? 0.02 : 0))),
              y: Math.max(0, Math.min(1, value.y + (event.key === 'ArrowUp' ? -0.02 : event.key === 'ArrowDown' ? 0.02 : 0))) }));
          }}
          onPointerDown={event => {
            if (saving.current || !squareCrop) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
            if (pointers.current.size === 2) {
              const [a, b] = [...pointers.current.values()];
              pinch.current = { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), zoom }; drag.current = null;
            } else drag.current = { x: event.clientX, y: event.clientY, px: position.x, py: position.y };
          }}
          onPointerUp={event => { pointers.current.delete(event.pointerId); drag.current = null; pinch.current = null; }}
          onPointerCancel={event => { pointers.current.delete(event.pointerId); drag.current = null; pinch.current = null; }}
          onPointerMove={event => {
            if (saving.current || !squareCrop) return;
            if (pointers.current.has(event.pointerId)) pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
            if (pointers.current.size === 2 && pinch.current) {
              const [a, b] = [...pointers.current.values()];
              setZoom(Math.max(1, Math.min(5, pinch.current.zoom * Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.distance))); return;
            }
            if (!drag.current || !working) return;
            // The crop box follows the pointer across the fitted image.
            const size = Math.min(working.width, working.height) / zoom;
            const scale = fit(working).scale * event.currentTarget.getBoundingClientRect().width / 640;
            setPosition({ x: Math.max(0, Math.min(1, drag.current.px + (event.clientX - drag.current.x) / (Math.max(1, working.width - size) * scale))),
              y: Math.max(0, Math.min(1, drag.current.py + (event.clientY - drag.current.y) / (Math.max(1, working.height - size) * scale))) });
          }} />
      </div>
      <div className="product-crop-toolbar">
        <span className="product-crop-zoom-label"><ZoomIn size={16} aria-hidden="true" />Zoom</span>
        <div className="product-crop-zoom">
          <button type="button" aria-label="Zoom out" disabled={busy || (squareCrop && zoom <= 1)} onClick={() => changeZoom(-0.1)}><Minus size={15} /></button>
          <output aria-live="polite">{Math.round((squareCrop ? zoom : 1) * 100)}%</output>
          <button type="button" aria-label="Zoom in" disabled={busy || zoom >= 5} onClick={() => changeZoom(0.1)}><Plus size={15} /></button>
        </div>
        <span className="product-crop-divider" aria-hidden="true" />
        <button type="button" className="product-crop-rotate" disabled={busy || !image} onClick={() => rotate(-1)}><RotateCcw size={17} aria-hidden="true" />Rotate Left</button>
        <button type="button" className="product-crop-rotate" disabled={busy || !image} onClick={() => rotate(1)}><RotateCw size={17} aria-hidden="true" />Rotate Right</button>
      </div>
      {busy && <div className="product-crop-saving" role="status"><LoaderCircle className="product-image-spinner" size={28} aria-hidden="true" /><span>Saving image…</span></div>}
      {error && <p className="local-image-error" role="alert">{error}</p>}
      <div className="product-crop-actions">
        <button type="button" className="btn-secondary" disabled={busy} onClick={onCancel}>Cancel</button>
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => { setZoom(1); setPosition({ x: 0.5, y: 0.5 }); setRotation(0); setError(''); }}>Clear</button>
        <button type="button" className="btn-primary-add" disabled={!working || busy} onClick={() => void prepare()}>{busy ? <><LoaderCircle className="product-image-spinner" size={16} aria-hidden="true" />Saving…</> : 'Save'}</button>
      </div>
    </div>
  </div>, document.body);
}

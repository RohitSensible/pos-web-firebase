import { useEffect, useRef, useState } from 'react';
import { Camera, Check, RefreshCw } from 'lucide-react';
import type { IScannerControls } from '@zxing/browser';
import { ActionPopup } from './ActionPopup.tsx';
import './BarcodeScanner.css';
import { createBarcodeReader } from './barcodeReader.ts';

function cameraMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return 'Camera permission was denied. Allow camera access in your browser settings, then try again.';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'No camera was found by this browser. Open this page in Safari or Chrome on your phone and check that camera access is enabled.';
  if (name === 'NotReadableError' || name === 'TrackStartError') return 'The camera is unavailable or in use by another app. Close other camera apps and try again.';
  return 'The camera scanner could not start or stopped unexpectedly. Try again, or enter the barcode manually.';
}

export function BarcodeScanner({ onCancel, onUse }: { onCancel: () => void; onUse: (barcode: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const stop = useRef<() => void>(() => {});
  const [attempt, setAttempt] = useState(0);
  const [detected, setDetected] = useState('');
  const [status, setStatus] = useState('Starting camera…');
  const [error, setError] = useState('');
  const [previewImage, setPreviewImage] = useState('');

  useEffect(() => {
    let disposed = false, found = false;
    let stream: MediaStream | undefined;
    let controls: IScannerControls | undefined;
    const preview = video.current;
    const ended = () => fail('The camera disconnected. Try again, or enter the barcode manually.');
    const release = () => {
      const active = controls; controls = undefined;
      active?.stop();
      stream?.getTracks().forEach(track => { track.removeEventListener('ended', ended); track.stop(); });
      stream = undefined;
      if (preview) { preview.pause(); preview.srcObject = null; }
    };
    const finish = () => { disposed = true; release(); };
    stop.current = finish;
    const fail = (message: string) => {
      if (disposed || found) return;
      disposed = true; release(); setError(message); setStatus('Live camera could not start. Check the message below, then try again.');
    };
    setDetected(''); setPreviewImage(''); setError(''); setStatus('Starting camera…');
    void (async () => {
      try {
        if (!window.isSecureContext) {
          fail('Live camera access requires trusted HTTPS or localhost. Camera scanning is unavailable on this HTTP network address. Enter the barcode manually.'); return;
        }
        if (!navigator.mediaDevices?.getUserMedia) { fail('Camera scanning is not supported by this browser. Try another browser or enter the barcode manually.'); return; }
        // Skip the cancelled StrictMode setup before opening any camera. The real
        // setup requests permission immediately, without waiting for a decoder download.
        await Promise.resolve();
        if (disposed) return;
        let acquired: MediaStream;
        try {
          acquired = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
        } catch (reason) {
          if (disposed) return;
          // Some mobile browsers cannot satisfy camera-selection hints. Ask for
          // their default camera before reporting that no camera is available.
          const name = reason instanceof Error ? reason.name : '';
          if (!['NotFoundError', 'DevicesNotFoundError', 'OverconstrainedError', 'ConstraintNotSatisfiedError'].includes(name)) throw reason;
          acquired = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
        }
        if (disposed) { acquired.getTracks().forEach(track => track.stop()); return; }
        stream = acquired;
        stream.getVideoTracks().forEach(track => track.addEventListener('ended', ended));
        preview!.srcObject = stream;
        await preview!.play();
        if (disposed) return;
        const reader = await createBarcodeReader();
        if (disposed) return;
        const scanning = await reader.decodeFromStream(stream, preview!, (result, failure, scanner) => {
          if (disposed || found) { scanner.stop(); return; }
          if (result) {
            const value = result.getText();
            if (!value.trim() || value.length > 200) { setStatus('This barcode cannot fit the existing Barcode field. Try another barcode.'); return; }
            // Freeze the actual detected frame before releasing the camera.
            // A preview failure must not discard a successfully decoded code.
            try {
              const frame = document.createElement('canvas');
              frame.width = preview!.videoWidth; frame.height = preview!.videoHeight;
              const context = frame.getContext('2d');
              if (context && frame.width && frame.height) {
                context.drawImage(preview!, 0, 0); setPreviewImage(frame.toDataURL('image/jpeg', 0.85));
              }
              frame.width = frame.height = 0;
            } catch { /* The decoded value is still usable without a frozen frame. */ }
            found = true; setDetected(value); setStatus('Barcode detected. Review it, then choose Use Barcode.');
            scanner.stop(); release();
          } else if (failure && !['NotFoundException', 'ChecksumException', 'FormatException'].includes(failure.getKind?.())) {
            scanner.stop(); fail(cameraMessage(failure));
          }
        });
        if (disposed || found) scanning.stop();
        else { controls = scanning; setStatus('Point the rear camera at the product barcode. Keep it steady and well lit.'); }
      } catch (failure) { fail(cameraMessage(failure)); }
    })();
    return finish;
  }, [attempt]);

  const close = () => { stop.current(); onCancel(); };
  return <ActionPopup className={`barcode-scanner-popup${detected ? ' barcode-scanner-detected' : ''}`} title={<span className="barcode-scanner-heading"><Camera size={20} aria-hidden="true" />Scan Barcode</span>} onCancel={close}
    footer={<><button type="button" className="btn-secondary" data-initial-focus onClick={close}>Cancel</button>
      <button type="button" className="btn-primary-add barcode-use-button" disabled={!detected} onClick={() => { if (detected) { stop.current(); onUse(detected); } }}>Use Barcode</button></>}>
    <div className="barcode-camera">
      {/* Keep the video mounted so retries always have a preview element. */}
      <video ref={video} hidden={!!previewImage} autoPlay muted playsInline aria-label="Live barcode camera preview" />
      {previewImage && <img className="barcode-captured-preview" src={previewImage} alt="Barcode scan preview" />}
      <div className="barcode-target" aria-hidden="true"><i /><i /><i /><i /></div><div className="barcode-scan-line" aria-hidden="true" />
    </div>
    <p className={`barcode-scanner-status${detected ? ' barcode-status-success' : ''}`} role="status">{detected ? <><span className="barcode-success-icon"><Check size={16} aria-hidden="true" /></span>Barcode detected!</> : status}</p>
    {error && <p className="barcode-scanner-error" role="alert">{error}</p>}
    <div className="barcode-result"><output aria-label="Detected barcode" aria-live="polite">{detected || 'No barcode detected yet'}</output></div>
    {error && <button type="button" className="btn-secondary barcode-retry" onClick={() => { stop.current(); setDetected(''); setPreviewImage(''); setError(''); setStatus('Starting camera…'); setAttempt(value => value + 1); }}><RefreshCw size={16} />Try again</button>}
    {!detected && <p className="barcode-scanner-help">Align the code inside the guides. Using a code fills the form; Update still saves the product.</p>}
  </ActionPopup>;
}

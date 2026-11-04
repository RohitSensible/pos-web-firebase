import { useEffect, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { ActionPopup } from './ActionPopup.tsx';
import { decodeBarcodeImage } from './barcodeReader.ts';
import './BarcodeScanner.css';

export function BarcodeImageUpload({ onCancel, onUse }: { onCancel: () => void; onUse: (barcode: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [reading, setReading] = useState(false);
  const [detected, setDetected] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    const url = URL.createObjectURL(file);
    setPreview(file.type.startsWith('image/') ? url : '');
    void decodeBarcodeImage(file).then(value => { if (!cancelled) setDetected(value); })
      .catch(reason => { if (!cancelled) { setError(reason instanceof Error ? reason.message : 'Unable to read this image.'); setPreview(''); } })
      .finally(() => { if (!cancelled) setReading(false); });
    return () => { cancelled = true; URL.revokeObjectURL(url); };
  }, [file]);
  return <ActionPopup className="barcode-scanner-popup barcode-image-popup" title={<span className="barcode-scanner-heading"><Upload size={20} aria-hidden="true" />Upload barcode image</span>} onCancel={onCancel}
    footer={<><button type="button" className="btn-secondary" data-initial-focus onClick={onCancel}>Cancel</button>
      <button type="button" className="btn-primary-add barcode-use-button" disabled={reading || !detected} onClick={() => { if (detected) onUse(detected); }}>Use Barcode</button></>}>
    <p className="barcode-scanner-help">Choose an image containing the barcode. The image is read on this device.</p>
    <input ref={input} className="barcode-image-input" type="file" accept="image/*" aria-label="Choose barcode image" onChange={event => {
      const selected = event.currentTarget.files?.[0]; event.currentTarget.value = '';
      if (selected) { setDetected(''); setError(''); setReading(true); setFile(selected); }
    }} />
    <button type="button" className="btn-secondary barcode-retry" onClick={() => input.current?.click()}><Upload size={16} aria-hidden="true" />{file ? 'Choose another image' : 'Choose image'}</button>
    {preview && <img className="barcode-upload-preview" src={preview} alt="Selected barcode" />}
    <p className="barcode-scanner-status" role="status">{reading ? 'Reading barcode…' : detected ? 'Barcode detected. Choose Use Barcode to fill the form.' : 'No barcode detected yet'}</p>
    {error && <p className="barcode-scanner-error" role="alert">{error}</p>}
    {detected && <div className="barcode-result"><output aria-live="polite" aria-label="Detected barcode">{detected}</output></div>}
  </ActionPopup>;
}

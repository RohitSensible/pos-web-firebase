import { PageHeading } from '../components/PageHeading.tsx';
import { useDataLoading } from '../utils/useDataLoading.ts';
import { useActionConfirmation } from '../utils/useActionConfirmation.tsx';
import { SuccessPopup } from './SuccessPopup.tsx';
import { readMasterSnapshot, rememberMasterSnapshot, masterSnapshotRevision, invalidateMasterSnapshots } from '../utils/masterSnapshots.ts';
import { useEffect, useRef, useState } from 'react';
import { Check, Image as ImageIcon, ImagePlus, Info, LoaderCircle, PanelBottom, PanelTop, RefreshCw, Trash2 } from 'lucide-react';
import { LOGO_MAX_BYTES, LOGO_PRINTER_PROFILES, processOutletLogo, type LogoPrinterSize, type ProcessedOutletLogo } from './outletLogoProcessing.ts';
import './OutletLogoPage.css';

type Props = { outletId: string; outletName: string; token: string };
type Variant = 'header' | 'footer';
type Preview = { revision: number; source: string; generation: string | null; loading: boolean; error: string };
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const emptyPreview = (revision: number): Preview => ({ revision, source: '', generation: null, loading: true, error: '' });

function LogoEditor({ outletId, outletName, token, variant, disabled, onBusyChange }: Props & { variant: Variant; disabled: boolean; onBusyChange: (busy: boolean) => void }) {
  const { confirmAction, confirmation } = useActionConfirmation();
  const [revision, setRevision] = useState(0);
  const [preview, setPreview] = useState<Preview>(() => emptyPreview(0));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ error: boolean; message: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [printerSize, setPrinterSize] = useState<LogoPrinterSize>(2);
  const [processing, setProcessing] = useState(false);
  const [pendingLogo, setPendingLogo] = useState<(ProcessedOutletLogo & { source: string; originalSource: string }) | null>(null);
  const [qualityAccepted, setQualityAccepted] = useState(false);
  const originalFile = useRef<File | null>(null);
  const processingJob = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const mutation = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const alive = useRef(true);
  const current = preview.revision === revision ? preview : emptyPreview(revision);
  useDataLoading(current.loading, 'Outlet Logo');
  const label = variant === 'header' ? 'Header Logo' : 'Footer Logo';
  const endpoint = `/api/outlets/${encodeURIComponent(outletId)}/logo?variant=${variant}`;



  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; mutation.current?.abort(); };
  }, []);
  useEffect(() => () => { if (pendingLogo) { URL.revokeObjectURL(pendingLogo.source); URL.revokeObjectURL(pendingLogo.originalSource); } }, [pendingLogo]);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 16_000);
    let generation: string | null = null, active = true, freshSettled = false;
    const objectUrls = new Set<string>();
    const snapshotKey = `${endpoint}#${outletName}`;
    const cached = readMasterSnapshot<Blob>(snapshotKey, token);
    const snapshotRevision = masterSnapshotRevision();
    const makeUrl = (blob: Blob) => { const url = URL.createObjectURL(blob); objectUrls.add(url); return url; };
    if (cached) void (async () => {
      try {
        const url = makeUrl(cached), image = new Image(); image.src = url; await image.decode();
        if (active && !freshSettled) setPreview({ revision, source: url, generation: null, loading: true, error: '' });
      } catch { /* Fresh validation below remains authoritative. */ }
    })();
    void (async () => {
      try {
        const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal });
        const version = response.headers.get('X-Logo-Generation');
        generation = version && /^[1-9]\d*$/.test(version) ? version : null;
        if (response.status === 404) {
          freshSettled = true;
          if (active) setPreview({ revision, source: '', generation: generation ?? '0', loading: false, error: '' });
          return;
        }
        if (!response.ok) throw new Error('Unable to load this logo. Please retry.');
        if (!generation) throw new Error('The logo version could not be verified. Please retry.');
        const blob = await response.blob();
        if (!IMAGE_TYPES.includes(blob.type) || !blob.size || blob.size > 5 * 1024 * 1024) throw new Error('This image cannot be displayed. Upload a valid JPEG, PNG or WebP image.');
        if (!active || controller.signal.aborted) return;
        const objectUrl = makeUrl(blob);
        const image = new Image(); image.src = objectUrl;
        await image.decode();
        if (active && !controller.signal.aborted) {
          freshSettled = true; rememberMasterSnapshot(snapshotKey, token, blob, snapshotRevision);
          setPreview({ revision, source: objectUrl, generation, loading: false, error: '' });
        }
      } catch (error) {
        freshSettled = true;
        if (active) setPreview({ revision, source: '', generation, loading: false,
          error: controller.signal.aborted ? 'Loading timed out. Please retry.' : (error as Error).message });
      } finally { window.clearTimeout(timeout); }
    })();
    return () => { active = false; controller.abort(); window.clearTimeout(timeout); for (const url of objectUrls) URL.revokeObjectURL(url); };
  }, [endpoint, outletName, token, revision]);

  const prepareLogo = async (file: File, size = printerSize) => {
    if (disabled || busyRef.current || current.loading || current.generation === null) return;
    const job = ++processingJob.current;
    originalFile.current = file;
    setPendingLogo(null); setQualityAccepted(false); setProcessing(true); onBusyChange(true); setNotice(null);
    try {
      const prepared = await processOutletLogo(file, size);
      if (alive.current && job === processingJob.current) setPendingLogo({ ...prepared, source: URL.createObjectURL(prepared.file), originalSource: URL.createObjectURL(file) });
    } catch (error) {
      if (alive.current && job === processingJob.current) {
        originalFile.current = null;
        setNotice({ error: true, message: (error as Error).message });
      }
    } finally {
      if (alive.current && job === processingJob.current) { setProcessing(false); onBusyChange(false); }
    }
  };

  const selectPrinter = (size: LogoPrinterSize) => {
    if (size === printerSize || disabled || busyRef.current) return;
    setPrinterSize(size);
    if (originalFile.current) void prepareLogo(originalFile.current, size);
  };

  const save = async (file?: File) => {
    if (disabled || processing || busyRef.current || current.loading || current.generation === null) return;
    if (file && pendingLogo?.qualityWarnings.length && !qualityAccepted) return;
    if (!file && (!current.source || current.generation === '0')) return;
    if (file && (file.type !== 'image/png' || !file.size || file.size > LOGO_MAX_BYTES)) {
      setNotice({ error: true, message: 'Prepare a PNG logo within 10 KB before uploading.' }); return;
    }
    if (!await confirmAction(file ? (current.source ? 'update' : 'add') : 'remove', label.toLowerCase())) return;
    busyRef.current = true; setBusy(true); onBusyChange(true); setNotice(null);
    const controller = new AbortController(); mutation.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 30_000);
    let attempted = false;
    try {
      if (file) {
        const url = URL.createObjectURL(file);
        try { const image = new Image(); image.src = url; await image.decode(); }
        catch { throw new Error('The selected file is not a readable image. Choose another image.'); }
        finally { URL.revokeObjectURL(url); }
      }
      if (!alive.current || controller.signal.aborted) return;
      attempted = true; invalidateMasterSnapshots(endpoint);
      const response = await fetch(endpoint, { method: file ? 'PUT' : 'DELETE',
        headers: { Authorization: `Bearer ${token}`, 'X-Logo-Expected-Generation': current.generation, ...(file ? { 'Content-Type': file.type } : {}) },
        body: file, signal: controller.signal });
      const result = await response.json() as { success?: boolean; message?: string };
      if (!response.ok || !result.success) throw new Error(result.message || 'Unable to confirm this logo change.');
      if (alive.current) {
        setPendingLogo(null); originalFile.current = null;
        if (!file) {
          setPreview({ revision, source: '', generation: '0', loading: false, error: '' });
        }
        setNotice({ error: false, message: `${label} ${file ? 'uploaded' : 'removed'} successfully.` });
      }
    } catch (error) {
      if (alive.current) setNotice({ error: true, message: controller.signal.aborted
        ? 'The change could not be confirmed. The preview will reload; review it before trying again.' : (error as Error).message });
    } finally {
      window.clearTimeout(timeout); mutation.current = null; busyRef.current = false;
      if (alive.current) {
        setBusy(false); onBusyChange(false);
        if (attempted) { invalidateMasterSnapshots(endpoint); setRevision(value => value + 1); } // Reconcile success, conflicts and uncertain outcomes; never retry mutations automatically.
      }
    }
  };

  return <section className="outlet-logo-card" aria-labelledby={`logo-title-${variant}`}>
    {confirmation}
    <header className="outlet-logo-card-heading">
      <span className="outlet-logo-placement-icon" aria-hidden="true">{variant === 'header' ? <PanelTop size={20} /> : <PanelBottom size={20} />}</span>
      <div><h2 id={`logo-title-${variant}`}>{label}</h2><p>Your outlet’s {variant} image</p></div>
      <span className="outlet-logo-status">{busy ? 'Saving…' : processing ? 'Processing…' : pendingLogo ? 'Preview' : current.loading ? 'Loading…' : current.error ? 'Unavailable' : current.source ? <><Check size={12} aria-hidden="true" />Uploaded</> : 'Not added'}</span>
    </header>
    <fieldset className="outlet-logo-printer" disabled={disabled || busy}>
      <legend>Printer size for upload</legend>
      <div>{([2, 3] as const).map(size => <button type="button" key={size} aria-pressed={printerSize === size} onClick={() => selectPrinter(size)}>
        <span>{size}-inch</span><small>{LOGO_PRINTER_PROFILES[size].width} × {LOGO_PRINTER_PROFILES[size].height} px</small>
      </button>)}</div>
    </fieldset>
    <div className={`outlet-logo-dropzone${!pendingLogo && !current.loading && !current.source && !current.error ? ' empty' : ''}${dragging ? ' dragging' : ''}`}
      onDragOver={event => { if (!disabled && !busy && current.generation !== null) { event.preventDefault(); setDragging(true); } }}
      onDragLeave={() => setDragging(false)}
      onDrop={event => { event.preventDefault(); setDragging(false); const file = event.dataTransfer.files[0]; if (file) void prepareLogo(file); }}>
      <div className={`outlet-logo-preview${pendingLogo ? ' comparing' : ''}`} role="group" aria-label={`${label} preview`} aria-busy={current.loading || busy || processing}>
        {pendingLogo ? <>
          <figure className="outlet-logo-comparison"><figcaption>Original<span>{pendingLogo.originalWidth} × {pendingLogo.originalHeight} px</span></figcaption>
            <div><img src={pendingLogo.originalSource} alt={`${outletName} ${label} original`} decoding="async" /></div>
          </figure>
          <figure className="outlet-logo-comparison"><figcaption>Enhanced<span>Black &amp; White · {pendingLogo.width} × {pendingLogo.height} px</span></figcaption>
            <div><img className="outlet-logo-final-image" src={pendingLogo.source} alt={`${outletName} ${label} processed preview`} decoding="async"
              onError={() => { setPendingLogo(null); setNotice({ error: true, message: 'Unable to display the processed image. Choose another logo.' }); }} /></div>
          </figure>
        </> : current.source && <img src={current.source} alt={`${outletName} ${label}`} decoding="async" onError={() => setPreview(value => ({ ...value, source: '' }))} />}
        {current.loading && !current.source && <span className="outlet-logo-loading" data-inline-loading><LoaderCircle size={20} />Loading logo…</span>}
        {!pendingLogo && !current.loading && !current.source && <div className="outlet-logo-empty"><span className="outlet-logo-empty-icon"><ImageIcon size={26} aria-hidden="true" /></span>
          <strong>{current.error ? 'Preview unavailable' : `No ${label.toLowerCase()} yet`}</strong>
          <p>{current.error ? 'Retry below to load your saved logo.' : `Drop an image here or choose Upload Logo to add your ${variant} image.`}</p></div>}
      </div>
    </div>
    <p className="outlet-logo-hint"><Info size={13} aria-hidden="true" />PNG, JPEG or WebP · Up to 5 MB input · 10 KB output</p>
    {(processing || pendingLogo) && <div className="outlet-logo-processing" aria-live="polite">
      {processing ? <p><LoaderCircle size={14} aria-hidden="true" />Enhancing and preparing your logo…</p> : pendingLogo && <>
        <strong>Preview ready · {pendingLogo.printerSize}-inch printer</strong>
        <p>{pendingLogo.width} × {pendingLogo.height} px · {(pendingLogo.file.size / 1024).toFixed(2)} KB · PNG · Black &amp; White</p>
        <span>Noise reduction, contrast and controlled sharpening applied locally. Compare both images before uploading.</span>
        {!!pendingLogo.qualityWarnings.length && <div className="outlet-logo-quality-warning" role="alert">
          <strong>Image quality needs review</strong>
          <ul>{pendingLogo.qualityWarnings.map(warning => <li key={warning}>{warning}</li>)}</ul>
          <label><input type="checkbox" checked={qualityAccepted} disabled={disabled || busy} onChange={event => setQualityAccepted(event.target.checked)} />I reviewed the previews and accept these quality limitations.</label>
        </div>}
        <div><button type="button" disabled={disabled || busy} onClick={() => input.current?.click()}>Choose another</button>
          <button type="button" disabled={disabled || busy} onClick={() => { setPendingLogo(null); setQualityAccepted(false); originalFile.current = null; setNotice(null); }}>Cancel preview</button>
          <a href={pendingLogo.source} target="_blank" rel="noopener noreferrer">View full-size result</a></div>
      </>}
    </div>}
    <div className="outlet-logo-feedback" aria-live="polite">
      {(notice?.error || (!notice && current.error)) && <p role={notice?.error || (!notice && current.error) ? 'alert' : 'status'} className={notice?.error || (!notice && current.error) ? 'logo-error' : 'logo-success'}>{notice?.message || current.error}</p>}
      {current.error && <button type="button" className="logo-retry" disabled={disabled || busy || current.loading} onClick={() => setRevision(value => value + 1)}><RefreshCw size={13} aria-hidden="true" />Retry</button>}
    </div>
    <div className="outlet-logo-actions">
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" aria-label={`Choose ${label}`} hidden
        onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void prepareLogo(file); }} />
      <button type="button" className="logo-remove" aria-label={`Remove ${label}`} disabled={disabled || busy || processing || !!pendingLogo || current.loading || !current.source || !current.generation || current.generation === '0'}
        onClick={() => void save()}><Trash2 size={16} />Remove</button>
      <button type="button" className="logo-upload" aria-label={`Upload ${label}`} disabled={disabled || busy || processing || current.loading || current.generation === null || (!!pendingLogo?.qualityWarnings.length && !qualityAccepted)} onClick={() => { if (pendingLogo) void save(pendingLogo.file); else input.current?.click(); }}>
        {busy || processing ? <LoaderCircle size={16} /> : <ImagePlus size={16} />}{busy ? 'Please wait…' : processing ? 'Processing…' : 'Upload Logo'}
      </button>
    </div>
    {notice && !notice.error && <SuccessPopup message={notice.message} onDismiss={() => setNotice(null)} />}
  </section>;
}

function LogoManager(props: Props) {
  const [busyVariant, setBusyVariant] = useState<Variant | null>(null);
  return <section className="outlet-logo-page" aria-label="Outlet logo">
    <header className="outlet-logo-heading"><span>MASTERS</span><PageHeading><ImageIcon aria-hidden="true" />Outlet Logo</PageHeading><p>Manage receipt logos.</p></header>
    <div className="outlet-logo-grid">
      {(['header', 'footer'] as const).map(variant => <LogoEditor key={variant} {...props} variant={variant}
        disabled={busyVariant !== null && busyVariant !== variant} onBusyChange={busy => setBusyVariant(busy ? variant : null)} />)}
    </div>
    <p className="outlet-logo-page-note"><Info size={14} aria-hidden="true" />Each action applies only to the logo in that card. Images retain their original proportions.</p>
  </section>;
}
export function OutletLogoPage(props: Props) {
  return <LogoManager key={JSON.stringify([props.token, props.outletId, props.outletName])} {...props} />;
}

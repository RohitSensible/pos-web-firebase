import { PageHeading } from '../components/PageHeading.tsx';
import { useMobileSearch, searchRecords } from '../utils/useMobileSearch.ts';
import { useDataLoading } from '../utils/useDataLoading.ts';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Copy, Monitor, QrCode, RefreshCw, Search, X } from 'lucide-react';
import type { OutletSummary } from './OutletSelectionPage.tsx';
import { createDeviceQrSvg } from '../utils/deviceQr.ts';
import './DevicesPage.css';
import './MobileRecords.css';

interface Device { documentId: string; outletName: string; deviceId: string; active: boolean | null }
interface DeviceList { outletName: string; devices: Device[] }

export function DevicesPage({ outlet, token, onSessionExpired }: {
  outlet: OutletSummary; token: string; onSessionExpired: () => void;
}) {
  return <DevicesContent key={JSON.stringify([outlet.id, token])} outlet={outlet} token={token} onSessionExpired={onSessionExpired} />;
}

function DevicesContent({ outlet, token, onSessionExpired }: {
  outlet: OutletSummary; token: string; onSessionExpired: () => void;
}) {
  const mobileSearch = useMobileSearch();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [copyFeedback, setCopyFeedback] = useState<Record<string, 'copying' | 'copied' | 'failed' | 'unavailable'>>({});
  const [qrDevice, setQrDevice] = useState<Device | null>(null);
  const mounted = useRef(false);
  const copyGeneration = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [data, setData] = useState<DeviceList | null>(null);
  const [loading, setLoading] = useState(true);
  useDataLoading(loading, 'Devices');
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    copyGeneration.current++;
    setLoading(true); setError(''); setData(null); setCopyFeedback({}); setQrDevice(null);
    void (async () => {
      try {
        const response = await fetch(`/api/outlets/${encodeURIComponent(outlet.id)}/devices`, {
          headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal,
        });
        const result = await response.json() as { data?: DeviceList; message?: string };
        if (controller.signal.aborted) return;
        if (response.status === 401) { onSessionExpired(); return; }
        if (!response.ok || !result.data) throw new Error(result.message || 'Unable to load devices.');
        setData(result.data);
      } catch (failure) { if (!controller.signal.aborted) setError((failure as Error).message); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [outlet.id, token, onSessionExpired, reload]);

  const search = query.trim().toLocaleLowerCase();
  const filtered = mobileSearch ? searchRecords((data?.devices ?? []).filter(device => status === 'all' || (status === 'active' ? device.active === true : status === 'inactive' ? device.active === false : device.active !== true && device.active !== false)), query, device => ({ primary: [device.deviceId], text: [device.outletName], identifiers: [device.deviceId] })) : (data?.devices || []).filter(device =>
    (!search || device.deviceId.toLocaleLowerCase().includes(search) || device.outletName.toLocaleLowerCase().includes(search)) &&
    (status === 'all' || (status === 'active' ? device.active === true : status === 'inactive' ? device.active === false : device.active !== true && device.active !== false)));
  function clearFilters() { setQuery(''); setStatus('all'); }
  async function copyId(device: Device) {
    const generation = copyGeneration.current;
    const update = (value: 'copying' | 'copied' | 'failed' | 'unavailable') => {
      if (mounted.current && generation === copyGeneration.current) setCopyFeedback(current => ({ ...current, [device.documentId]: value }));
    };
    if (!navigator.clipboard?.writeText) { update('unavailable'); return; }
    update('copying');
    try { await navigator.clipboard.writeText(device.deviceId); update('copied'); }
    catch { update('failed'); }
  }
  function copyMessage(device: Device) {
    return copyFeedback[device.documentId] && <div className="devices-copy-feedback" role="status">
      {copyFeedback[device.documentId] === 'copied' ? 'ID copied.' : copyFeedback[device.documentId] === 'copying' ? 'Copying ID…' : <>
        <p>{copyFeedback[device.documentId] === 'unavailable' ? 'Clipboard is unavailable. Select the ID below and copy it manually.' : 'Could not copy ID. Retry or select the ID below and copy it manually.'}</p>
        <input type="text" readOnly value={device.deviceId} aria-label={`Select ID for device ${device.deviceId}`} onFocus={event => event.currentTarget.select()} onClick={event => event.currentTarget.select()} />
      </>}
    </div>;
  }

  return <section className="devices-page devices-discovery-page">
    <div className="devices-heading"><div><span>OPERATIONS</span><PageHeading><Monitor size={24} /> Devices</PageHeading><p>View registered devices.</p></div>
      <button type="button" className="devices-refresh" disabled={loading} onClick={() => setReload(value => value + 1)}><RefreshCw size={16} />{loading ? 'Loading…' : 'Refresh'}</button></div>
    {loading ? <div data-inline-loading className="devices-state" role="status"><RefreshCw size={24} /><p>Loading devices…</p></div> : error ?
      <div className="devices-state"><p role="alert">{error}</p><button type="button" className="devices-refresh" onClick={() => setReload(value => value + 1)}><RefreshCw size={16} /> Retry</button></div> : data && !data.devices.length ?
      <div className="devices-state"><Monitor size={32} /><h2>No registered devices</h2><span className="devices-result-count">0 devices</span><p>No devices are registered to this outlet.</p></div> : data &&
      <>
      <div className="devices-filters">
        <label>Search devices<span className="devices-search-input"><Search size={18} aria-hidden="true" /><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Device ID or outlet name" /></span></label>
        <label>Status<select value={status} onChange={event => setStatus(event.target.value)}>
          <option value="all">All</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="unavailable">Unavailable</option>
        </select></label>
        <button type="button" className="devices-refresh" disabled={!query && status === 'all'} onClick={clearFilters}>Clear filters</button>
      </div>
      <p className="devices-result-count" role="status">{filtered.length} of {data.devices.length} devices</p>
      {!filtered.length ? <div className="devices-state"><h2>No matching devices</h2><p>Try a different search or clear the filters.</p><button type="button" className="devices-refresh" onClick={clearFilters}>Clear filters</button></div> :
      <div className="devices-table-scroll" role="region" aria-label="Registered devices" tabIndex={0}><table className="mobile-record-table"><thead><tr><th>Outlet Name</th><th>Device ID</th><th>Status</th></tr></thead><tbody>{filtered.map(device => <tr key={device.documentId}>
        <td data-label="Outlet" className="mobile-record-name">{device.outletName || '—'}</td><td data-label="Device ID" className="device-id mobile-record-wide"><span>{device.deviceId}</span>
          <div className="devices-id-actions">
          <button type="button" className="devices-refresh devices-copy" disabled={copyFeedback[device.documentId] === 'copying'} onClick={() => { void copyId(device); }} aria-label={`Copy ID for device ${device.deviceId}`}><Copy size={15} aria-hidden="true" />{copyFeedback[device.documentId] === 'copying' ? 'Copying…' : copyFeedback[device.documentId] === 'failed' ? 'Retry copy' : 'Copy ID'}</button>
          <button type="button" className="devices-refresh devices-copy devices-qr-action" disabled={typeof device.deviceId !== 'string' || !device.deviceId.trim()} onClick={() => setQrDevice(device)} aria-label={`Show QR for device ${device.deviceId}`}><QrCode size={15} aria-hidden="true" />Show QR</button>
          </div>
          {copyMessage(device)}
        </td><td data-label="Status"><label className={`device-status ${device.active === true ? 'active' : device.active === false ? 'inactive' : 'unavailable'}`}>
          <input type="checkbox" disabled checked={device.active === true} ref={input => { if (input) input.indeterminate = device.active === null; }} aria-label={`Active status for device ${device.deviceId}`} />
          <span>{device.active === true ? 'Active' : device.active === false ? 'Inactive' : 'Unavailable'}</span>
        </label></td>
      </tr>)}</tbody></table></div>}</>}
    {!loading && !error && qrDevice && data?.devices.includes(qrDevice) && <DeviceQrDialog key={qrDevice.documentId} deviceId={qrDevice.deviceId}
      copying={copyFeedback[qrDevice.documentId] === 'copying'} onCopy={() => { void copyId(qrDevice); }} feedback={copyMessage(qrDevice)} onClose={() => setQrDevice(null)} />}
  </section>;
}

function DeviceQrDialog({ deviceId, copying, onCopy, feedback, onClose }: {
  deviceId: string; copying: boolean; onCopy: () => void; feedback: ReactNode; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const code = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [generating, setGenerating] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    const modal = dialog.current!;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    modal.showModal();
    return () => { modal.close(); if (opener?.isConnected) opener.focus(); };
  }, []);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const svg = await createDeviceQrSvg(deviceId);
        if (!active) return;
        code.current?.replaceChildren(svg);
      } catch { if (active) setError('Unable to generate this device’s QR code. Please close and try again, or use Copy ID.'); }
      finally { if (active) setGenerating(false); }
    })();
    return () => { active = false; };
  }, [deviceId]);
  return <dialog ref={dialog} className="device-qr-dialog" aria-labelledby={titleId}
    onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation(); }}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(); }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    }}>
    <header><h2 id={titleId}>Device QR Code</h2><button type="button" className="devices-refresh" aria-label="Close device QR code" onClick={onClose}><X size={18} /></button></header>
    <div className="device-qr-code" ref={code} aria-busy={generating} />
    {generating && <p role="status">Generating QR code…</p>}
    {error && <p className="device-qr-error" role="alert">{error}</p>}
    <div className="device-qr-id"><span>Device ID</span><strong>{deviceId}</strong></div>
    {feedback}
    <footer><button type="button" className="devices-refresh" disabled={copying} onClick={onCopy}><Copy size={15} aria-hidden="true" />{copying ? 'Copying…' : 'Copy ID'}</button><button type="button" className="devices-refresh" onClick={onClose}>Close</button></footer>
  </dialog>;
}

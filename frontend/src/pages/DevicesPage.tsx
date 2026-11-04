import { useDataLoading } from '../utils/useDataLoading.ts';
import { useEffect, useRef, useState } from 'react';
import { Monitor, RefreshCw } from 'lucide-react';
import type { OutletSummary } from './OutletSelectionPage.tsx';
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
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [copyFeedback, setCopyFeedback] = useState<Record<string, 'copying' | 'copied' | 'failed' | 'unavailable'>>({});
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
    setLoading(true); setError(''); setData(null); setCopyFeedback({});
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
  const filtered = (data?.devices || []).filter(device =>
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

  return <section className="devices-page devices-discovery-page">
    <div className="devices-heading"><div><span>OPERATIONS</span><h1><Monitor size={24} /> Devices</h1><p>{data?.outletName || outlet.name} · Devices registered to this outlet.</p></div>
      <button type="button" className="devices-refresh" disabled={loading} onClick={() => setReload(value => value + 1)}><RefreshCw size={16} />{loading ? 'Loading…' : 'Refresh'}</button></div>
    {loading ? <div data-inline-loading className="devices-state" role="status"><RefreshCw size={24} /><p>Loading devices…</p></div> : error ?
      <div className="devices-state"><p role="alert">{error}</p><button type="button" className="devices-refresh" onClick={() => setReload(value => value + 1)}><RefreshCw size={16} /> Retry</button></div> : data && !data.devices.length ?
      <div className="devices-state"><Monitor size={32} /><h2>No registered devices</h2><span className="devices-result-count">0 devices</span><p>No devices are registered to this outlet.</p></div> : data &&
      <>
      <div className="devices-filters">
        <label>Search devices<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Device ID or outlet name" /></label>
        <label>Status<select value={status} onChange={event => setStatus(event.target.value)}>
          <option value="all">All</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="unavailable">Unavailable</option>
        </select></label>
        <button type="button" className="devices-refresh" disabled={!query && status === 'all'} onClick={clearFilters}>Clear filters</button>
      </div>
      <p className="devices-result-count" role="status">{filtered.length} of {data.devices.length} devices</p>
      {!filtered.length ? <div className="devices-state"><h2>No matching devices</h2><p>Try a different search or clear the filters.</p><button type="button" className="devices-refresh" onClick={clearFilters}>Clear filters</button></div> :
      <div className="devices-table-scroll" role="region" aria-label="Registered devices" tabIndex={0}><table className="mobile-record-table"><thead><tr><th>Outlet Name</th><th>Device ID</th><th>Status</th></tr></thead><tbody>{filtered.map(device => <tr key={device.documentId}>
        <td data-label="Outlet" className="mobile-record-name">{device.outletName || '—'}</td><td data-label="Device ID" className="device-id mobile-record-wide"><span>{device.deviceId}</span>
          <button type="button" className="devices-refresh devices-copy" disabled={copyFeedback[device.documentId] === 'copying'} onClick={() => { void copyId(device); }} aria-label={`Copy ID for device ${device.deviceId}`}>{copyFeedback[device.documentId] === 'copying' ? 'Copying…' : copyFeedback[device.documentId] === 'failed' ? 'Retry copy' : 'Copy ID'}</button>
          {copyFeedback[device.documentId] && <div className="devices-copy-feedback" role="status">
            {copyFeedback[device.documentId] === 'copied' ? 'ID copied.' : copyFeedback[device.documentId] === 'copying' ? 'Copying ID…' : <>
              <p>{copyFeedback[device.documentId] === 'unavailable' ? 'Clipboard is unavailable. Select the ID below and copy it manually.' : 'Could not copy ID. Retry or select the ID below and copy it manually.'}</p>
              <input type="text" readOnly value={device.deviceId} aria-label={`Select ID for device ${device.deviceId}`} onFocus={event => event.currentTarget.select()} onClick={event => event.currentTarget.select()} />
            </>}
          </div>}
        </td><td data-label="Status"><label className={`device-status ${device.active === true ? 'active' : device.active === false ? 'inactive' : 'unavailable'}`}>
          <input type="checkbox" disabled checked={device.active === true} ref={input => { if (input) input.indeterminate = device.active === null; }} aria-label={`Active status for device ${device.deviceId}`} />
          <span>{device.active === true ? 'Active' : device.active === false ? 'Inactive' : 'Unavailable'}</span>
        </label></td>
      </tr>)}</tbody></table></div>}</>}
  </section>;
}

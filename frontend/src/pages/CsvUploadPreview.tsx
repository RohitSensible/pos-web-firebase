import { useDataLoading } from '../utils/useDataLoading.ts';
import { useActionConfirmation } from '../utils/useActionConfirmation.tsx';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { SuccessPopup } from './SuccessPopup.tsx';
import { useRowBatches } from '../utils/useRowBatches.ts';
import { FileSpreadsheet, CloudUpload, Info, X } from 'lucide-react';
import { fileSelectionError, namedPremisesHeaders, PRODUCT_COLUMNS, PREMISES_TEMPLATE_COLUMNS, type ProductUploadMode, type CsvPreview } from './productCsvPreview.ts';

export function CsvUploadPreview({ outletId, token, onSessionExpired, onSuccessAcknowledged, footerAction, mode = 'standard' }: { footerAction?: ReactNode; mode?: ProductUploadMode; outletId: string; token: string; onSessionExpired: () => void; onSuccessAcknowledged: () => void }) {
  const { confirmAction, confirmation } = useActionConfirmation();
  const inputRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const selectionGenerationRef = useRef(0);
  const selectionQuotaRef = useRef<AbortController | null>(null);
  const [filename, setFilename] = useState('');
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [error, setError] = useState('');
  const [uploadLimitMessage, setUploadLimitMessage] = useState('');
  const [quotaChecked, setQuotaChecked] = useState(false);
  const [remainingAttempts, setRemainingAttempts] = useState<number | null>(null);
  const [parsing, setParsing] = useState(false);
  useDataLoading(parsing, 'Spreadsheet Preview');
  const [source, setSource] = useState('');
  const [assignedCodes, setAssignedCodes] = useState<(string | number)[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const busyRef = useRef(false);
  const requestRef = useRef<AbortController | null>(null);
  const [successOpen, setSuccessOpen] = useState(false);
  const successVisible = useRef(false);
  const acknowledgeSuccess = () => {
    successVisible.current = false; setSuccessOpen(false);
    onSuccessAcknowledged();
  };

  const cancelSelection = useCallback(() => {
    selectionGenerationRef.current++;
    selectionQuotaRef.current?.abort();
    selectionQuotaRef.current = null;
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  const clearSelection = useCallback(() => {
    cancelSelection();
    setSource(''); setAssignedCodes(null); setUploaded(false); setUploadStatus('');
    setFilename(''); setPreview(null); setError(''); setParsing(false);
    if (inputRef.current) inputRef.current.value = '';
  }, [cancelSelection]);

  useLayoutEffect(() => {
    clearSelection();
    setQuotaChecked(false); setRemainingAttempts(null); setUploadLimitMessage('');
    return cancelSelection;
  }, [outletId, token, mode, clearSelection, cancelSelection]);

  useEffect(() => () => { workerRef.current?.terminate(); requestRef.current?.abort(); }, []);

  const checkQuota = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(`/api/outlets/${encodeURIComponent(outletId)}/products/import/quota`, {
        headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', ...(signal ? { signal } : {}),
      });
      const result = await response.json() as { message?: string; remainingAttempts?: number };
      if (signal?.aborted) return false;
      if (response.status === 401) { onSessionExpired(); return false; }
      if (response.status === 429) {
        setUploadLimitMessage(result.message || 'Upload limit reached. This outlet allows only 2 upload attempts within 24 hours. Please try again when a 24-hour slot becomes available.');
        return false;
      }
      if (!response.ok) throw new Error(result.message || 'Unable to check the upload limit.');
      setUploadLimitMessage('');
      setRemainingAttempts(result.remainingAttempts ?? null);
      setQuotaChecked(true);
      return true;
    } catch (error) {
      if (!signal?.aborted) { setQuotaChecked(false); setError((error as Error).message); }
      return false;
    }
  }, [outletId, token, onSessionExpired]);

  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => {
      if (document.visibilityState !== 'hidden' && !busyRef.current && !successVisible.current) void checkQuota(controller.signal);
    };
    void checkQuota(controller.signal);
    const timer = window.setInterval(refresh, 10_000);
    window.addEventListener('focus', refresh);
    return () => { controller.abort(); window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [checkQuota, mode]);

  const removeFile = () => {
    if (busyRef.current) return;
    clearSelection();
  };

  const selectFile = async (file: File) => {
    if (busyRef.current) return;
    // Invalidate old quota reads and queued worker callbacks before awaiting anything.
    clearSelection();
    const generation = selectionGenerationRef.current;
    const controller = new AbortController();
    selectionQuotaRef.current = controller;
    setFilename(file.name);
    if (!await checkQuota(controller.signal) || controller.signal.aborted || generation !== selectionGenerationRef.current) return;
    selectionQuotaRef.current = null;
    const selectionError = fileSelectionError(file.name, file.size, mode);
    if (selectionError) { setError(selectionError); return; }
    setParsing(true);
    try {
      const worker = mode === 'premises'
        ? new Worker(new URL('./premisesProductPreview.worker.ts', import.meta.url), { type: 'module' })
        : new Worker(new URL('./productCsvPreview.worker.ts', import.meta.url), { type: 'module' });
      workerRef.current = worker;
      worker.onmessage = (event: MessageEvent<{ preview?: CsvPreview; error?: string; source?: string }>) => {
        if (generation !== selectionGenerationRef.current || workerRef.current !== worker) return;
        setPreview(event.data.preview ?? null);
        setSource(event.data.source ?? '');
        setError(event.data.error ?? '');
        setParsing(false);
        worker.terminate();
        workerRef.current = null;

      };
      worker.onerror = () => {
        if (generation !== selectionGenerationRef.current || workerRef.current !== worker) return;
        setError(mode === 'premises'
          ? 'Unable to read or parse this file. Choose an XLSX spreadsheet or a UTF-8 CSV or TSV file.'
          : 'Unable to read or parse this file. Choose a UTF-8 CSV or TSV file.');
        setParsing(false);
        worker.terminate();
        workerRef.current = null;
      };
      worker.postMessage(file);
    } catch {
      if (generation !== selectionGenerationRef.current) return;
      workerRef.current?.terminate();
      workerRef.current = null;
      setParsing(false);
      setError('Local file parsing is unavailable in this browser. No data has been uploaded.');
    }
  };

  const upload = async () => {
    if (mode === 'premises' && !namedPremisesHeaders(preview?.headers ?? []).length) return;
    if (busyRef.current || uploaded || !source || !preview || preview.headerErrors.length || !preview.rows.length || preview.rows.some(row => row.errors.length)) return;
    const generation = selectionGenerationRef.current;
    if (!await confirmAction('add', `${preview.rows.length} products`) || generation !== selectionGenerationRef.current) return;
    busyRef.current = true; setUploading(true); setError(''); setUploadStatus('Checking categories, tax and product mappings…');
    const controller = new AbortController(); requestRef.current = controller;
    let writeAttempted = false;
    try {
      const options = { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ source, mode }), signal: controller.signal };
      // One click validates, assigns Search Codes and uploads. The server re-checks
      // the same codes before writing, so nothing is saved if anything changed.
      let codes = assignedCodes;
      if (!codes) {
        const validation = await fetch(`/api/outlets/${encodeURIComponent(outletId)}/products/import/validate`, options);
        if (controller.signal.aborted || generation !== selectionGenerationRef.current) return;
        if (validation.status === 401) { onSessionExpired(); return; }
        const checked = await validation.json() as { writesEnabled?: boolean; message?: string; data?: { canUpload: boolean; headerErrors: string[]; documents: { rowNumber: number; fields: { code: string | number } }[]; categorySummary?: { reused: number; toCreate: number }; rows: { rowNumber: number; errors: { column: string; message: string }[] }[] } };
        if (controller.signal.aborted || generation !== selectionGenerationRef.current) return;
        if (validation.status === 429) {
          setUploadLimitMessage(checked.message || 'Upload limit reached. This outlet allows only 2 upload attempts within 24 hours. Please try again when a 24-hour slot becomes available.');
          return;
        }
        if (!validation.ok || !checked.data?.canUpload) {
          if (checked.data) {
            const issuesByRow = new Map(checked.data.rows.map(row => [row.rowNumber, row.errors]));
            setPreview({ ...preview, headerErrors: checked.data.headerErrors,
              rows: preview.rows.map(row => ({ ...row, errors: issuesByRow.get(row.rowNumber) ?? row.errors })) });
          }
          const issues = checked.data?.rows.flatMap(row => row.errors.map(issue => `Row ${row.rowNumber} · ${issue.column}: ${issue.message}`)) ?? [];
          throw new Error(checked.message || [...(checked.data?.headerErrors ?? []), ...issues.slice(0, 8)].join(' ') || 'The file cannot be imported.');
        }
        codes = checked.data.documents.map(document => document.fields.code);
        setAssignedCodes(codes);
      }
      setUploadStatus('Uploading products…');
      writeAttempted = true;
      const response = await fetch(`/api/outlets/${encodeURIComponent(outletId)}/products/import${mode === 'premises' ? '/premises' : ''}`, { ...options, body: JSON.stringify({ source, codes }) });
      if (controller.signal.aborted || generation !== selectionGenerationRef.current) return;
      if (response.status === 401) { onSessionExpired(); return; }
      const result = await response.json() as { success: boolean; message?: string; data?: { success: boolean; created: number; existing: number; confirmedRows: number[]; unconfirmedRows: number[]; message: string } };
      if (controller.signal.aborted || generation !== selectionGenerationRef.current) return;
      if (response.status === 429) {
        setUploadLimitMessage(result.message || 'Upload limit reached. This outlet allows only 2 upload attempts within 24 hours. Please try again when a 24-hour slot becomes available.');
        return;
      }
      if (result.data && 'canUpload' in result.data) {
        const validation = result.data as unknown as { headerErrors: string[]; rows: { rowNumber: number; errors: { column: string; message: string }[] }[] };
        const issuesByRow = new Map(validation.rows.map(row => [row.rowNumber, row.errors]));
        setPreview({ ...preview, headerErrors: validation.headerErrors,
          rows: preview.rows.map(row => ({ ...row, errors: issuesByRow.get(row.rowNumber) ?? row.errors })) });
        const issues = validation.rows.flatMap(row => row.errors.map(issue => `Row ${row.rowNumber} · ${issue.column}: ${issue.message}`));
        throw new Error(result.message || [...validation.headerErrors, ...issues.slice(0, 8)].join(' ') || 'The file cannot be imported.');
      }
      if (!response.ok || !result.success || !result.data?.success) {
        throw new Error(result.data ? `${result.data.message} Confirmed rows: ${result.data.confirmedRows.join(', ') || 'none'}. Unconfirmed rows: ${result.data.unconfirmedRows.join(', ') || 'none'}.` : result.message || 'Upload outcome is unknown. Retry the same file to reconcile its document IDs.');
      }
      setUploaded(true); setUploadStatus('');
      successVisible.current = true; setSuccessOpen(true);
    } catch (requestError) {
      if (!controller.signal.aborted && generation === selectionGenerationRef.current) {
        setAssignedCodes(null);
        setError((requestError as Error).message);
        setUploadStatus(writeAttempted
          ? 'No automatic retry was made. Keep this file to reconcile the outcome safely.'
          : 'Nothing was uploaded. Correct the reported file values and select the file again.');
      }
    } finally {
      busyRef.current = false;
      if (!controller.signal.aborted) setUploading(false);
      requestRef.current = null;
      if (writeAttempted && !controller.signal.aborted && generation === selectionGenerationRef.current && !successVisible.current) {
        await checkQuota(controller.signal);
      }
    }
  };

  const rows = preview?.rows ?? [];
  // Every row is in one scrolling table; rows mount in batches as it scrolls.
  const { rows: visibleRows, hasMore, sentinelRef } = useRowBatches(rows, filename);

  if (uploadLimitMessage) return <><p className="csv-upload-error" role="alert">{uploadLimitMessage}</p>{footerAction && <div className="upload-excel-dialog-actions">{footerAction}</div>}</>;
  if (!quotaChecked) return <><p role="status">{error || 'Checking upload limit…'}</p>{footerAction && <div className="upload-excel-dialog-actions">{footerAction}</div>}</>;

  const validRows = rows.filter(row => !row.errors.length).length;
  const warningRows = rows.filter(row => row.warnings.length).length;
  const headers = preview && (mode === 'premises' || preview.headerErrors.length) ? preview.headers : [...(mode === 'premises' ? PREMISES_TEMPLATE_COLUMNS : PRODUCT_COLUMNS)];
  const columns = Math.max(headers.length, ...visibleRows.map(row => row.cells.length));

  const renderUploadButton = (label: string) => <button type="button" className="csv-upload-submit" disabled={(mode === 'premises' && !namedPremisesHeaders(preview?.headers ?? []).length) || uploading || uploaded || parsing || !source || !rows.length || validRows !== rows.length || !!preview?.headerErrors.length} onClick={() => void upload()}>{mode === 'premises' && !namedPremisesHeaders(preview?.headers ?? []).length ? 'Confirm Upload' : uploading ? 'Uploading…' : label}</button>;

  return (
    <div className="csv-upload-preview">{confirmation}
      {remainingAttempts !== null && <p className="csv-upload-help csv-upload-quota" role="status"><Info size={17} aria-hidden="true" /><span>Upload attempts remaining for this outlet: {remainingAttempts} within the rolling 24-hour period.</span></p>}
      {successOpen && <SuccessPopup message="Uploaded successfully." onDismiss={acknowledgeSuccess} />}
      <div className="csv-upload-drop-zone">
        <input ref={inputRef} type="file" accept={mode === 'premises' ? '.xlsx,.csv,.tsv' : '.csv,.tsv'} aria-label={mode === 'premises' ? 'Select premises product spreadsheet' : 'Select product CSV or TSV file'} className="csv-upload-drop-input" disabled={uploading}
          onChange={event => { const file = event.target.files?.[0]; if (file) selectFile(file); }} />
        <span className="csv-upload-cloud"><CloudUpload size={32} aria-hidden="true" /></span>
        <strong className="csv-upload-drop-title">Drag &amp; drop your {mode === 'premises' ? 'spreadsheet' : 'CSV file'} here or browse</strong>
        <span className="csv-upload-drop-description">Choose a file to validate and preview before uploading.</span>
        <button type="button" className="csv-upload-browse" disabled={uploading} onClick={() => inputRef.current?.click()}><FileSpreadsheet size={16} />Select File</button>
        <ul className="csv-upload-format-pills" aria-label="File requirements"><li>{mode === 'premises' ? 'XLSX / CSV / TSV' : 'CSV / TSV'}</li><li>UTF-8</li><li>Max 5 MB</li><li>Up to 10,000 rows</li></ul>
      </div>
      {filename && <div className="csv-upload-filename"><span className="csv-upload-file-icon"><FileSpreadsheet size={24} aria-hidden="true" /></span><div><span>Selected file</span><strong>{filename}</strong></div>{renderUploadButton('Upload File')}<button type="button" className="csv-upload-secondary" disabled={uploading} onClick={removeFile}><X size={16} />Remove File</button></div>}
      {parsing && <p role="status" data-inline-loading>Reading and validating locally…</p>}
      {error && <p className="csv-upload-error" role="alert">{error}</p>}
      {preview && <>
        <dl className="csv-upload-summary">
          <div><dt>Parsed rows</dt><dd>{rows.length}</dd></div>
          <div><dt>{mode === 'premises' ? 'Format-valid rows' : 'Valid rows'}</dt><dd>{validRows}</dd></div>
          <div><dt>Rows with errors</dt><dd>{rows.length - validRows}</dd></div>
          <div><dt>Rows with warnings</dt><dd>{warningRows}</dd></div>
        </dl>
        <p className="csv-upload-help">{preview.blankRows} blank rows skipped. Delimiter: {preview.delimiter === '\t' ? 'tab' : preview.delimiter === ',' ? 'comma' : 'semicolon'}. Search Codes are assigned by the server; Excel codes are ignored. {uploaded ? 'Upload confirmed.' : 'No products have been saved by this preview.'}</p>
        {!!preview.headerErrors.length && <div className="csv-upload-error" role="alert">
          <strong>Header errors — spreadsheet row {preview.headerRow}</strong>
          <ul>{preview.headerErrors.map(message => <li key={message}>{message}</li>)}</ul>
        </div>}
        {!rows.length && <p role="status">No product rows found below the header.</p>}
        <div className="csv-upload-table-scroll" role="region" aria-label="Original spreadsheet cells" tabIndex={0}>
          <table>
            <thead><tr><th>Row</th><th>Validation</th>{Array.from({ length: columns }, (_, index) => <th key={index}>{headers[index] || `Unexpected column ${index + 1}`}</th>)}</tr></thead>
            <tbody>{visibleRows.map(row => <tr key={row.rowNumber}>
              <td>{row.rowNumber}</td>
              <td className="csv-upload-row-status">
                <strong>{row.errors.length ? 'Errors' : mode === 'premises' && !namedPremisesHeaders(preview?.headers ?? []).length ? 'Premises unverified' : row.warnings.length ? 'Valid with warnings' : 'Valid'}</strong>
                {[...row.errors.map(issue => ({ ...issue, level: 'Error' })), ...row.warnings.map(issue => ({ ...issue, level: 'Warning' }))].map((issue, index) => (
                  <div key={index} className={issue.level === 'Error' ? 'csv-upload-error' : 'csv-upload-warning'}>{issue.level} · Row {row.rowNumber} · {issue.column}: {issue.message}</div>
                ))}
              </td>
              {Array.from({ length: columns }, (_, index) => <td key={index}><span className="csv-upload-original-cell">{index === 13 && mode === 'standard' ? (assignedCodes?.[rows.indexOf(row)] ?? 'Assigned on upload') : row.cells[index] ?? ''}</span></td>)}
            </tr>)}</tbody>
          </table>
          {hasMore && <div ref={sentinelRef} className="csv-upload-help" role="status">Showing {visibleRows.length} of {rows.length} rows…</div>}
        </div>
      </>}
      <div className="csv-upload-import-note">{renderUploadButton('Upload')}<span role="status">{uploadStatus || (mode === 'premises' && !namedPremisesHeaders(preview?.headers ?? []).length ? 'Preview only. Saving premises requires a supported premises mapping. Use named premises columns to upload.' : '')}</span>{mode === 'premises' && <button type="button" className="csv-upload-secondary" onClick={onSuccessAcknowledged}>Cancel</button>}{footerAction}</div>
    </div>
  );
}

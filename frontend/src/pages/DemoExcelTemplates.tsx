import { Download, FileSpreadsheet, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { downloadProductUploadTemplate } from '../utils/productUploadTemplate.ts';
import type { ProductUploadMode } from './productCsvPreview.ts';

export function DemoExcelTemplates() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const download = async (mode: ProductUploadMode) => {
    if (busy) return;
    setBusy(true); setError('');
    try { await downloadProductUploadTemplate(mode); }
    catch { setError('Unable to download the template. Please try again.'); }
    finally { setBusy(false); }
  };
  return <details className="csv-upload-preview sheet-template-card" open>
    <summary><span className="sheet-template-icon"><FileSpreadsheet size={22} aria-hidden="true" /></span><span><strong>Template Downloads</strong><small>Demo Excel Sheet · Start with the correct column order</small></span><ChevronDown className="sheet-template-chevron" size={18} aria-hidden="true" /></summary>
    <div className="csv-upload-file-controls">
      <button type="button" disabled={busy} onClick={() => void download('standard')}><Download size={16} aria-hidden="true" />Download Standard Template</button>
      <button type="button" disabled={busy} onClick={() => void download('premises')}><Download size={16} aria-hidden="true" />Download Premises-Wise Template</button>
    </div>
    {error && <p className="csv-upload-error" role="alert">{error}</p>}
  </details>;
}

import { createRoot } from 'react-dom/client';
import { ShiftSummaryReportPage } from '../src/pages/ShiftSummaryReportPage.tsx';
import type { OutletSummary } from '../src/pages/OutletSelectionPage.tsx';
import '../src/index.css';
import '../src/App.css';
const zeroFields = ['billDeletesNumber','billDeletesAmount','openingAmt','creditSale','discount','tax','gstTotal','vatTotal','refundAmount','extraCharges','serviceChargeAmount','roundOff','expensesAmtTotal','expCash','expDigital','advanceAmtTotal','customerReceiveAmtTotal','receiveAmtTotal','swiggyTotal','zomatoTotal'];
const shift = { ...Object.fromEntries(zeroFields.map(field => [field, 0])), id:'shift-1', dayId:'2026-11-01', shiftNo:1, deviceId:'internal-device-123', inActive:true, startTime:Date.UTC(2026,10,1), endTime:Date.UTC(2026,10,1,8), lastBillTime:Date.UTC(2026,10,1,8), startBillNo:'1', lastBillNo:'2', billCount:2, totalSale:100, subTotalBill:100, cashSale:75, digitalSale:25, payments:{cash:75,card:25} };
const shifts = [
  shift,
  { ...shift, id: 'earlier-active', dayId: '2020-01-01', inActive: false, endTime: 0 },
  { ...shift, id: 'earlier-closed-no-end', dayId: '2020-01-01', inActive: true, endTime: 0 },
  { ...shift, id: 'active-with-end', inActive: false },
];
window.fetch = async () => Response.json({data:{shifts,summary:{totalShifts:4,totalBills:8,totalSale:400,cashSale:300,digitalSale:100,creditSale:0,expenses:0}}});
const root = createRoot(document.getElementById('root')!);
root.render(<ShiftSummaryReportPage outlet={{id:'outlet',name:'Outlet'} as OutletSummary} token="mock" onSessionExpired={()=>{throw new Error('Unexpected expiry');}}/>);
const checks:string[]=[];
const assert=(ok:unknown,label:string)=>{if(!ok)throw new Error(label);checks.push(label);};
void(async()=>{
  for(let i=0;i<150&&!document.querySelector('.bill-table-scroll tbody tr');i++)await new Promise(resolve=>setTimeout(resolve,20));
  const table=document.querySelector<HTMLTableElement>('.bill-table-scroll table')!;
  assert(!!table,'Shift report loads');
  const headers=[...table.querySelectorAll('thead th')].map(cell=>cell.textContent);
  assert(headers.join('|')==='Day ID|Shift|Status|Start / End|Bills|Cash|Digital|Credit|Expenses|Total Sale','Report contains the ten intended columns without Device');
  assert(!table.textContent?.includes(shift.deviceId)&&table.querySelectorAll('tbody tr:first-child td').length===10,'Device values are omitted and each row stays aligned');
  assert([...table.querySelectorAll<HTMLTableCellElement>('tfoot td')].reduce((sum,cell)=>sum+cell.colSpan,0)===10,'Totals align under the remaining columns');
  assert(table.querySelector('tfoot td:last-child')?.textContent?.includes('400.00'),'Total sale remains unchanged');
  const rows = [...table.querySelectorAll<HTMLTableRowElement>('tbody tr')];
  assert(rows.map(row => row.querySelector('.shift-status')?.textContent).join('|') === 'Closed|Active|Closed|Active', 'Status follows inactive flag even on earlier dates or with conflicting end timestamps');
  assert(rows[1].querySelector('.shift-status.active') && rows[2].querySelector('.shift-status.closed'), 'Active and Closed use matching badge classes');
  assert(rows[1].querySelectorAll('td')[3].querySelector('small')?.textContent === 'In progress', 'Earlier active shift without end remains in progress');
  assert(rows[2].querySelectorAll('td')[3].querySelector('small')?.textContent === 'Not Available', 'Closed shift without end never substitutes last bill time');
  assert(rows[0].querySelectorAll('td')[3].textContent === rows[3].querySelectorAll('td')[3].textContent, 'Real end time remains visible even when the shift is active');
  table.querySelector<HTMLTableRowElement>('tbody tr')!.click();
  for(let i=0;i<100&&!document.querySelector('.bill-detail-modal');i++)await new Promise(resolve=>setTimeout(resolve,20));
  assert(!!document.querySelector('.bill-detail-modal .grand-total')?.textContent?.includes('100.00'),'Shift row still opens its existing details');
  for (const [index, status, end] of [[1, 'Active', 'In progress'], [2, 'Closed', 'Not Available'], [3, 'Active', null]] as const) {
    document.querySelector<HTMLButtonElement>('[aria-label="Close shift details"]')!.click();
    await new Promise(resolve => setTimeout(resolve, 20));
    rows[index].click();
    await new Promise(resolve => setTimeout(resolve, 20));
    const modal = document.querySelector('.bill-detail-modal')!;
    const statusField = [...modal.querySelectorAll('.bill-detail-meta > div')].find(field => field.querySelector('span')?.textContent === 'Status');
    assert(statusField?.querySelector('strong')?.textContent === status, `Details retain ${status} for ${shifts[index].id}`);
    const expectedEnd = end ?? rows[index].querySelectorAll('td')[3].querySelector('small')!.textContent!;
    assert(modal.querySelector('header p')?.textContent?.endsWith(expectedEnd), `Details preserve truthful end for ${shifts[index].id}`);
  }
  root.unmount();document.getElementById('test-results')!.textContent=JSON.stringify({passed:checks.length,checks});
})().catch(error=>{document.getElementById('test-results')!.textContent=JSON.stringify({failed:String(error),checks});});

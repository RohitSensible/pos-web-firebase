import { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { DataLoadingModal } from '../src/components/DataLoadingModal.tsx';
import { EmployeesPage } from '../src/pages/EmployeesPage.tsx';
import { BillWiseReportPage } from '../src/pages/BillWiseReportPage.tsx';
import { streamList } from '../src/pages/productListApi.ts';
import { beginDataLoading, getDataLoadingSnapshot } from '../src/utils/dataLoading.ts';
import { useMasterSync } from '../src/utils/useMasterSync.ts';
import type { OutletSummary } from '../src/pages/OutletSelectionPage.tsx';
import type { ReactNode } from 'react';
import '../src/index.css';
import '../src/App.css';
import '../src/Theme.css';
const checks: string[]=[];
const assert=(ok:unknown,message:string)=>{if(!ok)throw new Error(message);checks.push(message);};
const pause=(ms=25)=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check:()=>unknown,label:string){for(let i=0;i<200;i++){if(check())return;await pause();}throw new Error('Timeout: '+label);}
const outlet={id:'shop',name:'Test Outlet'} as OutletSummary;
const expired=()=>{throw new Error('Unexpected session expiry');};
const requests:{path:string;signal:AbortSignal|undefined|null;resolve:(response:Response)=>void}[]=[];
let mode='list', stream:ReadableStreamDefaultController<Uint8Array>|undefined, syncStream:ReadableStreamDefaultController<Uint8Array>|undefined;
const encode=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value)+'\n');
window.fetch=async(input,init)=>{
 const path=String(input);assert(!init?.method||init.method==='GET','All loading operations retain their existing read-only request method');
 if(mode==='stream')return new Response(new ReadableStream<Uint8Array>({start(controller){stream=controller;init?.signal?.addEventListener('abort',()=>controller.error(new DOMException('Aborted','AbortError')),{once:true});}}),{headers:{'Content-Type':'application/x-ndjson'}});
 if(mode==='sync')return new Response(new ReadableStream<Uint8Array>({start(controller){syncStream=controller;init?.signal?.addEventListener('abort',()=>controller.close(),{once:true});}}),{headers:{'Content-Type':'application/x-ndjson'}});
 return new Promise<Response>(resolve=>requests.push({path,signal:init?.signal,resolve}));
};
let navigations=0;
function Layout({children}:{children:ReactNode}){return <><div className="retail-dashboard-shell"><aside className="dashboard-sidebar"><button id="sidebar-navigation" onClick={()=>navigations++}>Navigate</button></aside><div className="dashboard-stage"><header className="retail-header">Test Outlet</header><main className="dashboard-workspace">{children}</main></div></div><DataLoadingModal/></>;}
const root=createRoot(document.getElementById('root')!);
const overlay=()=>document.querySelector<HTMLElement>('.data-loading-overlay');
const employeeResponse=()=>Response.json({success:true,data:{employees:[{documentId:'e',name:'Employee',mobile:'99999',searchCode:1,shortName:'E',balanceAmt:'0',dateOfJoining:'',userId:''}],nextSearchCode:2,userAccounts:[]}});
const reportResponse=()=>Response.json({success:true,data:{bills:[],summary:{totalBills:0,totalAmount:0,cashTotal:0,digitalTotal:0},pagination:{page:1,pageSize:50,totalItems:0,totalPages:1}}});
let releaseSync:(()=>void)|undefined;
let finishNative: (() => void) | undefined;
function NativeRead() {
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{dialog.current!.showModal();const finish=beginDataLoading('Dialog Data');finishNative=finish;return finish;},[]);
 return <dialog ref={dialog} className="category-modal" id="native-data-dialog"><p>Loading data for this form.</p></dialog>;
}
function Sync(){useMasterSync('shop','token','categories',true,async()=>new Promise<void>(resolve=>{releaseSync=resolve;}));return <p>Categories are visible while synchronization runs.</p>;}
void(async()=>{
 document.documentElement.dataset.theme='dark';
 root.render(<Layout><EmployeesPage outlet={outlet} token="token" onSessionExpired={expired}/></Layout>);
 await until(()=>requests.length===1&&overlay(),'employee modal');
 assert(getComputedStyle(document.querySelector('[data-inline-loading]')!).display==='none','Inline loading text is hidden while the modal is visible');
 assert(overlay()!.textContent?.includes('Loading Employees… Please Wait'),'Employee fetch automatically opens a context-specific loading dialog');
 assert(!document.querySelector('.data-loading-help') && !overlay()!.textContent?.includes('You can dismiss'), 'Loader shows a single direct status line');
 assert(getComputedStyle(document.querySelector('.data-loading-modal')!).backgroundColor==='rgb(25, 35, 49)','Loading dialog preserves the dark theme');
 const bounds=overlay()!.getBoundingClientRect();
 assert(bounds.top===(innerWidth>820?68:62)&&bounds.right<=innerWidth,'Overlay fits the visible workspace below the header');
 if(innerWidth>820){const button=document.getElementById('sidebar-navigation')!;const rect=button.getBoundingClientRect();assert(document.elementFromPoint(rect.left+5,rect.top+5)?.closest('#sidebar-navigation'),'Sidebar remains clickable outside the dimmed workspace');button.click();assert(navigations===1,'Sidebar navigation stays responsive while loading');}
 const dialog=document.querySelector('.data-loading-modal')!.getBoundingClientRect();assert(dialog.width<=innerWidth-40&&dialog.left>=bounds.left,'Dialog fits desktop and mobile workspace widths');
 if(location.hash.includes('preview')){document.getElementById('test-results')!.textContent=JSON.stringify({passed:checks.length,checks});return;}
 document.querySelector<HTMLButtonElement>('.data-loading-dismiss')!.click();await until(()=>!overlay()&&!document.querySelector('.data-loading-status'),'dismiss');
 assert(!requests[0].signal?.aborted&&getDataLoadingSnapshot().tasks.length===1,'Dismissing keeps the read running without showing a background message');
 requests[0].resolve(employeeResponse());await until(()=>document.querySelector('.employees-table-scroll')&&!overlay()&&!document.querySelector('.data-loading-status'),'employee complete');
 assert(getDataLoadingSnapshot().tasks.length===0,'Response resolution clears both dialog and background status');
 root.render(<Layout><EmployeesPage key="reload" outlet={outlet} token="token" onSessionExpired={expired}/></Layout>);
 await until(()=>requests.length===2&&getDataLoadingSnapshot().tasks.length===1,'cached refresh');
 await pause(220); assert(!!document.querySelector('.employees-table-scroll')&&!overlay()&&!document.querySelector('.data-loading-status'),'Cached data refreshes silently without a popup or Updating message');
 root.render(<Layout><BillWiseReportPage outlet={outlet} token="token" onSessionExpired={expired}/></Layout>);
 await until(()=>requests.length===3,'report request');
 assert(requests[1].signal?.aborted,'Navigation aborts the previous page read');
 requests[1].resolve(employeeResponse());await until(()=>overlay()?.textContent?.includes('Sales Report'),'report modal');
 assert(getDataLoadingSnapshot().tasks.length===1,'Late resolution of an aborted read cannot clear the new report loader');
 document.documentElement.dataset.theme='light';assert(getComputedStyle(document.querySelector('.data-loading-modal')!).backgroundColor==='rgb(255, 255, 255)','Loading dialog follows the existing light theme');
 requests[2].resolve(Response.json({message:'Report unavailable.'},{status:503}));
 await until(()=>document.querySelector('.bill-report-state.error')&&!overlay(),'report failure');
 assert(getDataLoadingSnapshot().tasks.length===0,'Failed reads dismiss the loader and retain the existing error/retry view');
 document.querySelector<HTMLButtonElement>('.bill-report-state.error button')!.click();await until(()=>requests.length===4&&overlay(),'retry modal');
 requests[3].resolve(reportResponse());await until(()=>!overlay()&&document.querySelector('.bill-report-state strong')?.textContent?.includes('No bills'),'report retry');
 assert(true,'Retry starts a fresh loading session and closes cleanly on success');
 mode='stream';let progress=false,complete=false;
 const controller=new AbortController();
 const reading=streamList('/api/outlets/shop/products','token',controller.signal,'products',()=>{progress=true;}).then(rows=>{complete=true;return rows;});
 await until(()=>stream,'stream request');stream!.enqueue(encode({type:'items',data:[{documentId:'p',fields:{name:'Tea'}}]}));
 await until(()=>progress&&overlay(),'stream progress');
 assert(!complete&&overlay()!.textContent?.includes('Products'),'Streaming lists remain in the loader after early rows arrive');
 stream!.enqueue(encode({type:'end'}));stream!.close();const rows=await reading;await until(()=>!overlay(),'stream complete');
 assert(rows.length===1&&getDataLoadingSnapshot().tasks.length===0,'Only completed streaming data dismisses the loading dialog');
 mode='sync';root.render(<Layout><Sync/></Layout>);await until(()=>syncStream,'sync feed');await pause(220);
 assert(!overlay()&&getDataLoadingSnapshot().tasks.length===0,'Permanent synchronization connections never leave an endless loader');
 syncStream!.enqueue(encode({type:'changed',collection:'CATEGORY',version:'1'}));
 await until(()=>releaseSync&&getDataLoadingSnapshot().tasks.length===1,'sync data refresh');await pause(220);assert(!overlay()&&!document.querySelector('.data-loading-status'),'Synchronization runs silently without an Updating message');
 releaseSync!();await until(()=>getDataLoadingSnapshot().tasks.length===0&&!document.querySelector('.data-loading-status'),'sync complete');
 assert(getDataLoadingSnapshot().tasks.length===0,'Sync completion clears the loader while keeping the change feed connected');
 root.render(<Layout><NativeRead/></Layout>);await until(()=>document.querySelector('#native-data-dialog .data-loading-modal'),'loader in native dialog');
 const nativeClose=document.querySelector<HTMLButtonElement>('#native-data-dialog .data-loading-dismiss')!;
 const closeRect=nativeClose.getBoundingClientRect();
 assert(document.elementFromPoint(closeRect.left+closeRect.width/2,closeRect.top+closeRect.height/2)?.closest('.data-loading-modal'),'Reads inside native dialogs display the loader in the same top layer');
 nativeClose.click();await until(()=>!overlay()&&!document.querySelector('.data-loading-status'),'native dismiss');
 assert((document.getElementById('native-data-dialog') as HTMLDialogElement).open,'Dismissing the loader preserves its parent form dialog');
 finishNative!();await until(()=>getDataLoadingSnapshot().tasks.length===0,'native load complete');
 root.unmount();assert(getDataLoadingSnapshot().tasks.length===0,'Unmount leaves no stale loading tasks');
 document.getElementById('test-results')!.textContent=JSON.stringify({passed:checks.length,checks});
})().catch(error=>{document.getElementById('test-results')!.textContent=JSON.stringify({failed:String(error),checks});});

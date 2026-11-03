import { createRoot } from 'react-dom/client';
import { ProductsPage } from '../src/pages/ProductsPage.tsx';
import { CategoryPage } from '../src/pages/CategoryPage.tsx';
import { DataLoadingModal } from '../src/components/DataLoadingModal.tsx';
import { clearMasterSnapshots } from '../src/utils/masterSnapshots.ts';
import { getDataLoadingSnapshot } from '../src/utils/dataLoading.ts';
import type { OutletSummary } from '../src/pages/OutletSelectionPage.tsx';
import '../src/index.css';
import '../src/App.css';
import '../src/Theme.css';
const checks:string[]=[];
const assert=(ok:unknown,message:string)=>{if(!ok)throw new Error(message);checks.push(message);};
const pause=(ms=25)=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check:()=>unknown,label:string){for(let i=0;i<200;i++){if(check())return;await pause();}throw new Error('Timeout: '+label);}
const outlet={id:'shop',name:'Outlet'} as OutletSummary;
const expired=()=>{throw new Error('Unexpected expiry');};
const category={id:'c',name:'Fish',regionalName:'',categoryNo:1,createdAt:'2026-01-01',active:true};
let metadata:((response:Response)=>void)|undefined,counts:((response:Response)=>void)|undefined,stream:ReadableStreamDefaultController<Uint8Array>|undefined;
window.fetch=async(input,init)=>{
 assert(!init?.method||init.method==='GET','Loading changes preserve read-only requests');
 const path=new URL(String(input),location.href).pathname;
 if(path.endsWith('/master-sync'))return new Response('',{status:404});
 if(path.endsWith('/categories'))return new Promise<Response>(resolve=>{if(new Headers(init?.headers).get('X-Category-Counts')==='omit')metadata=resolve;else counts=resolve;});
 if(path.endsWith('/products'))return new Response(new ReadableStream<Uint8Array>({start(controller){stream=controller;}}),{headers:{'Content-Type':'application/x-ndjson'}});
 throw new Error('Unexpected read: '+path);
};
const root=createRoot(document.getElementById('root')!);
const modal=()=>document.querySelector('.data-loading-overlay');
function render(page:'products'|'categories',key:string){root.render(<><main className="dashboard-workspace">{page==='products'?<ProductsPage key={key} outlet={outlet} token="token" onSessionExpired={expired}/>:<CategoryPage key={key} outlet={outlet} token="token" onSessionExpired={expired}/>}</main><DataLoadingModal/></>);}
void(async()=>{
 clearMasterSnapshots();render('products','products');
 await until(()=>metadata&&stream&&modal(),'product modal');
 assert(getComputedStyle(document.querySelector('.products-empty')!).display==='none'&&document.querySelector('.products-empty')!.getBoundingClientRect().height===0,'Products do not display a second loading message behind the modal');
 stream!.enqueue(new TextEncoder().encode(JSON.stringify({type:'items',data:[{documentId:'p',fields:{name:'Fish Tikka',code:1,price:10,category:'c'}}]})+'\n'));
 await until(()=>document.querySelector('.products-table')?.textContent?.includes('Fish Tikka')&&!modal(),'visible products');
 await pause(250);
 assert(!modal()&&!document.querySelector('.data-loading-status'),'Product rows dismiss the popup even while the stream and category metadata remain pending');
 assert(getDataLoadingSnapshot().tasks.every(task=>task.background),'Remaining product-list reads are background updates');
 stream!.enqueue(new TextEncoder().encode('{"type":"end"}\n'));stream!.close();
 await until(()=>getDataLoadingSnapshot().tasks.length===1,'product stream finished');
 assert(!modal(),'A pending category request cannot keep a loaded product list covered');
 metadata!(Response.json({success:true,data:[category]}));await until(()=>getDataLoadingSnapshot().tasks.length===0&&!document.querySelector('.data-loading-status'),'products complete');
 for(const first of ['names','counts']){
  metadata=undefined;counts=undefined;clearMasterSnapshots();render('categories',first);
  await until(()=>metadata&&counts&&modal(),'category modal');
  assert(getComputedStyle(document.querySelector('[data-inline-loading]')!).display==='none','Categories do not display a second spinner or loading message behind the modal');
  assert(document.querySelector('.category-table tbody tr')!.getBoundingClientRect().height===0&&document.querySelector('.category-table-card')!.getBoundingClientRect().height<100,'The entire category loading row collapses, leaving no blank loading panel behind the popup');
  if(location.hash.includes('preview')){document.getElementById('test-results')!.textContent=JSON.stringify({passed:checks.length,checks});return;}
  if(first==='names')metadata!(Response.json({success:true,data:[category]}));else counts!(Response.json({success:true,data:[{...category,productCount:7}]}));
  await until(()=>document.querySelector('.category-table tbody')?.textContent?.includes('Fish')&&!modal(),'visible category rows');
  await pause(250);assert(!modal()&&!document.querySelector('.data-loading-status'),`Category rows remain usable when ${first} finish before the other request`);
  if(first==='names')counts!(Response.json({success:true,data:[{...category,productCount:7}]}));else metadata!(Response.json({success:true,data:[category]}));
  await until(()=>getDataLoadingSnapshot().tasks.length===0&&!document.querySelector('.data-loading-status'),'category reads complete');
  assert(document.querySelector('.product-count-chip')?.textContent?.includes('7 items'),'Late category reads preserve the loaded product counts');
 }
 root.unmount();assert(getDataLoadingSnapshot().tasks.length===0,'Completion leaves no lingering popup or loading tasks');
 document.getElementById('test-results')!.textContent=JSON.stringify({passed:checks.length,checks});
})().catch(error=>{document.getElementById('test-results')!.textContent=JSON.stringify({failed:String(error),checks});});

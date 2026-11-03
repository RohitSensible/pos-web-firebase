import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../src/utils/dataLoading.ts',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.CommonJS}}).outputText;
function fixture(){const exports={};new Function('exports',code)(exports);return exports;}
test('concurrent datasets share one batch and each completion removes only its own task',()=>{
 const f=fixture();const events=[];const stop=f.subscribeDataLoading(()=>events.push(f.getDataLoadingSnapshot()));
 const a=f.beginDataLoading('products'),b=f.beginDataLoading('categories');const batch=f.getDataLoadingSnapshot().batch;
 assert.deepEqual(f.getDataLoadingSnapshot().tasks.map(task=>task.label),['Products','Categories']);
 a();a();assert.equal(f.getDataLoadingSnapshot().tasks.length,1);assert.equal(f.getDataLoadingSnapshot().batch,batch);
 b();assert.equal(f.getDataLoadingSnapshot().tasks.length,0);assert.equal(events.length,4);
 const c=f.beginDataLoading('employees');assert.equal(f.getDataLoadingSnapshot().batch,batch+1);c();stop();
});
test('aborted reads clear immediately, and late cleanup never clears a newer read',()=>{
 const f=fixture(),controller=new AbortController();const old=f.beginDataLoading('customers',controller.signal);
 controller.abort();assert.equal(f.getDataLoadingSnapshot().tasks.length,0);
 const current=f.beginDataLoading('employees');old();assert.equal(f.getDataLoadingSnapshot().tasks[0].label,'Employees');current();
 const before=f.getDataLoadingSnapshot();f.beginDataLoading('products',controller.signal)();assert.equal(f.getDataLoadingSnapshot(),before);
});
test('loading labels identify collection and report names without exposing API paths',()=>{
 const f=fixture();for(const [path,label]of [['/api/outlets/shop/categories?kind=all','Categories'],['/api/outlets/shop/reports/gst','GST Report'],['/api/auth/outlets','Outlets'],['Employees','Employees']])assert.equal(f.dataLoadingLabel(path),label);
});

test('ready lists downgrade current and later related reads without cancelling them',()=>{
 const f=fixture(),controller=new AbortController();
 const first=f.beginDataLoading('products',controller.signal);f.markDataLoadingBackground(controller.signal);
 const later=f.beginDataLoading('categories',controller.signal);
 assert.ok(f.getDataLoadingSnapshot().tasks.every(task=>task.background));assert.equal(controller.signal.aborted,false);
 first();assert.equal(f.getDataLoadingSnapshot().tasks.length,1);later();assert.equal(f.getDataLoadingSnapshot().tasks.length,0);
});
test('a new foreground read gets a new modal batch while background updates remain pending',()=>{
 const f=fixture(),controller=new AbortController();f.markDataLoadingBackground(controller.signal);
 const background=f.beginDataLoading('categories',controller.signal),batch=f.getDataLoadingSnapshot().batch;
 const foreground=f.beginDataLoading('Sales Report');assert.equal(f.getDataLoadingSnapshot().batch,batch+1);
 assert.equal(f.getDataLoadingSnapshot().tasks.filter(task=>!task.background).length,1);foreground();background();
});

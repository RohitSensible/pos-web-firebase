import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { hasUnsavedChanges, requestUnsavedNavigation, UnsavedChangesPrompt, useUnsavedChanges } from '../src/utils/unsavedChanges.tsx';
import { useBrowserHistoryState } from '../src/utils/useBrowserHistoryState.ts';
import { runWorkspaceBack, useWorkspaceBack } from '../src/utils/useWorkspaceBack.ts';
import '../src/index.css';

const passed: string[] = [];
const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message); passed.push(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 25));
async function until(check: () => unknown, label: string) { for (let i = 0; i < 160; i++) { if (check()) return; await pause(); } throw new Error(`Timeout: ${label}`); }
let actions = 0;
const valid = (value: unknown): value is string => typeof value === 'string';
function Draft() {
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  useUnsavedChanges(dirty, busy);
  useWorkspaceBack(true, () => requestUnsavedNavigation(() => { actions++; setDirty(false); }));
  return <><button onClick={() => setDirty(value => !value)}>Toggle dirty</button><button onClick={() => setBusy(value => !value)}>Toggle busy</button></>;
}
function Harness() {
  const [screen, navigate] = useBrowserHistoryState('unsaved-test-screen', 'A', valid, false);
  const [nested, setNested, back] = useBrowserHistoryState('unsaved-test-nested', 'closed', valid);
  const [mounted, setMounted] = useState(true);
  return <><output id="screen">{screen}/{nested}</output><button onClick={() => navigate('B')}>B</button><button onClick={() => navigate('C')}>C</button>
    <button onClick={() => setNested('upload')}>Upload</button><button onClick={back}>Nested back</button>
    <button onClick={() => runWorkspaceBack()}>Workspace back</button><button onClick={() => setMounted(value => !value)}>Forced scope</button>
    {mounted && <Draft key={screen} />}<UnsavedChangesPrompt /></>;
}
const root = createRoot(document.getElementById('root')!);
root.render(<Harness />);
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === label)!;
const click = async (label: string) => { button(label).click(); await pause(); };
const prompt = () => document.querySelector<HTMLDialogElement>('dialog[open]');
const screen = () => document.getElementById('screen')?.textContent;
void (async () => {
  await until(() => button('B'), 'mount');
  assert(!hasUnsavedChanges(), 'Pristine draft registers no unsaved changes');
  await click('B'); await click('C');
  assert(screen() === 'C/closed', 'Pristine navigation runs immediately');
  await click('Toggle dirty');
  const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload);
  assert(unload.defaultPrevented, 'Dirty draft cancels beforeunload');
  await click('B'); await click('B');
  assert(!!prompt() && screen() === 'C/closed', 'Repeated navigation opens one prompt without leaving');
  await click('Stay'); assert(screen() === 'C/closed' && hasUnsavedChanges(), 'Stay keeps the exact active draft');
  history.back(); await until(prompt, 'browser Back prompt');
  assert(screen() === 'C/closed', 'Back restores history position before asking');
  history.back(); await pause(); await click('Stay');
  assert(screen() === 'C/closed', 'Repeated Back and Stay retain the current page');
  history.back(); await until(prompt, 'Back retry'); await click('Discard');
  await until(() => screen() === 'B/closed', 'accepted Back');
  assert(!hasUnsavedChanges(), 'Accepted Back unmounts the previous draft');
  await click('Toggle dirty'); history.forward(); await until(prompt, 'Forward prompt'); await click('Stay');
  assert(screen() === 'B/closed', 'Forward Stay preserves ordering');
  history.forward(); await until(prompt, 'Forward retry'); await click('Discard'); await until(() => screen() === 'C/closed', 'accepted Forward');
  await click('Upload'); await click('Nested back'); await until(() => screen() === 'C/closed', 'nested back');
  history.forward(); await until(() => screen() === 'C/upload', 'nested forward');
  assert(screen() === 'C/upload', 'Nested upload Back and Forward preserve entries');
  await click('Toggle dirty'); await click('Toggle busy'); await click('Workspace back');
  assert(button('Discard').disabled, 'In-flight save disables Discard');
  button('Discard').click(); await pause(); assert(actions === 0, 'Pending mutation cannot discard');
  await click('Stay'); await click('Toggle busy'); await click('Workspace back'); await click('Discard');
  assert(actions === 1 && !prompt(), 'Accepted nested guard action runs exactly once without another prompt');
  await click('Toggle dirty'); await click('B'); await click('Forced scope');
  assert(!hasUnsavedChanges() && !prompt(), 'Forced unmount cleans registry and pending callback');
  const cleanUnload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(cleanUnload);
  assert(!cleanUnload.defaultPrevented, 'Clean registry permits beforeunload');
  root.unmount(); document.getElementById('test-results')!.textContent = JSON.stringify({ passed });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ passed, failed: String(error) }); });

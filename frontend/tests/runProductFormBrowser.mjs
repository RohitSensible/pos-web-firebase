// Runs the real React form in headless Chrome; every API request is mocked in the browser.
import { build } from '../../backend/node_modules/esbuild/lib/main.js';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
const testDirectory = fileURLToPath(new URL('.', import.meta.url));
const testEntry = process.argv[2] || 'addProductForm.browser.tsx';
const previewFragment = process.argv[4] ? `#${encodeURIComponent(process.argv[5] || 'preview')}` : '';
// UI-only fixtures mock their page APIs, not usage lifecycle APIs. Isolate the
// admission hook there; usage suites always exercise the real hook and policy.
const exerciseUsage = process.env.WEB_USAGE_TEST_ENABLED === '1' || /^dailyUsage/.test(testEntry);
const temporary = await mkdtemp(join(tmpdir(), 'pos-product-form-'));
let server;
try {
  await build({ entryPoints: [resolve(testDirectory, testEntry)], bundle: true,
    plugins: exerciseUsage ? [] : [{ name: 'isolate-admission-in-ui-only-fixtures', setup(build) {
      build.onLoad({ filter: /[\\/]utils[\\/]useWebUsage\.ts$/ }, () => ({
        contents: "import { useCallback } from 'react'; export function useWebUsage() { const release = useCallback(() => Promise.resolve(), []); return { authorized: true, ready: true, message: '', blocked: false, suspended: false, release, retry() {} }; }",
        loader: 'ts', resolveDir: resolve(testDirectory, '../src/utils'),
      }));
    } }],
    outfile: join(temporary, 'ui.js'), format: 'iife', jsx: 'automatic', loader: { '.png': 'dataurl' }, define: { 'process.env.NODE_ENV': JSON.stringify(process.env.BROWSER_TEST_DEV === '1' ? 'development' : 'production') } });
  server = createServer(async (req, res) => {
    if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<html><head><link rel="stylesheet" href="/ui.css"></head><body><div id="root"></div><pre id="test-results">pending</pre><script src="/ui.js"></script></body></html>'); return; }
    if (req.url === '/ui.js' || req.url === '/ui.css') {
      res.setHeader('Content-Type', req.url.endsWith('.css') ? 'text/css' : 'text/javascript');
      res.end(await readFile(join(temporary, req.url.slice(1)))); return;
    }
    // Serve only these static brand assets; application APIs remain fixture mocks.
    const publicAssets = {
      '/logo1.png': 'image/png', '/apple-touch-icon.png': 'image/png',
      '/icons/sensible-biz-192.png': 'image/png', '/icons/sensible-biz-512.png': 'image/png',
      '/icons/sensible-biz-maskable-512.png': 'image/png', '/manifest.webmanifest': 'application/manifest+json',
    };
    if (Object.hasOwn(publicAssets, req.url)) {
      res.setHeader('Content-Type', publicAssets[req.url]);
      res.end(await readFile(resolve(testDirectory, '../public', req.url.slice(1)))); return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const realtime = process.env.BROWSER_TEST_REALTIME === '1';
  const chrome = spawn(process.env.CHROME_BIN || '/usr/bin/google-chrome', ['--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    `--window-size=${process.argv[3] || '1280,900'}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', `--user-data-dir=${join(temporary, 'chrome')}`,
    ...(!realtime && process.argv[4] ? [`--screenshot=${process.argv[4]}`] : []), ...(realtime ? ['--remote-debugging-port=0'] : ['--dump-dom', '--virtual-time-budget=12000']), realtime ? 'about:blank' : `http://127.0.0.1:${address.port}/${previewFragment}`]);
  const closed = new Promise((resolve, reject) => {
    chrome.once('close', resolve);
    chrome.once('error', error => reject(new Error(`Cannot launch Chrome. Set CHROME_BIN to an executable Chrome/Chromium path: ${error.message}`)));
  });
  // Realtime mode awaits this after connecting; handle an early spawn failure too.
  closed.catch(() => {});
  let html = '', errors = '';
  chrome.stdout.on('data', chunk => { html += chunk; }); chrome.stderr.on('data', chunk => { errors += chunk; });
  const timer = setTimeout(() => chrome.kill(), 30000);
  let code;
  if (realtime) {
    let socket;
    try {
      let port;
      for (let attempt = 0; attempt < 100; attempt++) {
        try { port = (await readFile(join(temporary, 'chrome', 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; }
        catch { await new Promise(resolve => setTimeout(resolve, 50)); }
      }
      if (!port) throw new Error('Chrome debugging port did not become available');
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const target = targets.find(target => target.type === 'page');
      socket = new WebSocket(target.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
      let requestId = 0;
      const command = (method, params) => new Promise((resolve, reject) => {
        const id = ++requestId;
        const listener = event => {
          const message = JSON.parse(event.data);
          if (message.id !== id) return;
          socket.removeEventListener('message', listener);
          if (message.error) reject(new Error(message.error.message));
          else resolve(message.result);
        };
        socket.addEventListener('message', listener);
        socket.send(JSON.stringify({ id, method, params }));
      });
      const evaluate = async expression => (await command('Runtime.evaluate', { expression, returnByValue: true })).result.value;
      // Chrome's real-time window has a minimum width; set the actual test viewport before loading fixtures.
      const [width, height] = (process.argv[3] || '1280,900').split(',').map(Number);
      await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      await command('Page.navigate', { url: `http://127.0.0.1:${address.port}/${previewFragment}` });
      for (let attempt = 0; attempt < 250; attempt++) {
        const result = await evaluate('document.getElementById("test-results")?.textContent');
        if (result && result !== 'pending') { html = await evaluate('document.documentElement.outerHTML'); break; }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (process.argv[4]) {
        const screenshot = await new Promise(resolve => {
          const id = ++requestId;
          socket.addEventListener('message', function receive(event) {
            const message = JSON.parse(event.data);
            if (message.id === id) { socket.removeEventListener('message', receive); resolve(message.result.data); }
          });
          socket.send(JSON.stringify({ id, method: 'Page.captureScreenshot', params: { format: 'png' } }));
        });
        const { writeFile } = await import('node:fs/promises');
        await writeFile(process.argv[4], Buffer.from(screenshot, 'base64'));
      }
      code = 0;
    } finally { socket?.close(); chrome.kill(); clearTimeout(timer); await closed; }
  } else { try { code = await closed; } finally { clearTimeout(timer); } }
  const match = html.match(/<pre id="test-results"[^>]*>(.*?)<\/pre>/s);
  const output = match?.[1]?.replaceAll('&quot;', '"').replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>');
  if (code !== 0 || !output || output === 'pending') throw new Error(`Browser checks did not complete: ${errors.slice(-1500)}`);
  const result = JSON.parse(output);
  console.log(JSON.stringify(result, null, 2));
  const passed = Array.isArray(result?.passed) ? result.passed.length : result?.passed;
  if (!Number.isSafeInteger(passed) || passed < 1 || (result.failed !== undefined && result.failed !== 0 && result.failed !== false)) process.exitCode = 1;
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  await rm(temporary, { recursive: true, force: true });
}

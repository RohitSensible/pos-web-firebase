import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

async function portAvailable(port = 3000) {
  return new Promise(resolve => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

async function fixture(mode) {
  assert(await portAvailable(), 'Launcher checks require an unused local port 3000');
  const directory = await mkdtemp(join(tmpdir(), 'web-pos-dev-'));
  await mkdir(join(directory, 'scripts')); await mkdir(join(directory, 'bin'));
  let source = await readFile(new URL('../dev.mjs', import.meta.url), 'utf8');
  if (mode === 'timeout') source = source.replace('30_000', '400');
  if (mode === 'terminal-error') source = `import { existsSync } from 'node:fs';
    const terminalFailure = setInterval(() => {
      if (!existsSync('frontend.json')) return;
      clearInterval(terminalFailure);
      process.stdin.emit('error', Object.assign(new Error('read EIO'), {code:'EIO', syscall:'read'}));
    }, 20);
` + source;
  await writeFile(join(directory, 'scripts/dev.mjs'), source);
  await writeFile(join(directory, 'package.json'), '{"type":"module"}');
  await writeFile(join(directory, 'mock-server.mjs'), `import http from 'node:http';
    ${['stubborn', 'repeated-interrupt'].includes(mode) ? "process.on('SIGTERM',()=>{});process.on('SIGINT',()=>{});" : ''}
    http.createServer((_req,res)=>{res.writeHead(${mode === 'timeout' ? 503 : 200});res.end('health');}).listen(3000,'127.0.0.1');`);
  await writeFile(join(directory, 'bin/npm'), `#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
if(process.argv.includes('backend')) {
 const server=spawn(process.execPath,['mock-server.mjs'],{stdio:'ignore'});
 writeFileSync('backend.json',JSON.stringify({pid:server.pid,terminalInput:!!process.stdin.isTTY}));
 setInterval(()=>{},1000);
} else {
 writeFileSync('frontend.json',JSON.stringify({terminalInput:!!process.stdin.isTTY}));
 console.log('MOCK_FRONTEND_READY');
 ${['exit', 'stubborn'].includes(mode) ? 'setTimeout(()=>process.exit(7),100);' : 'setInterval(()=>{},1000);'}
}
`, { mode: 0o755 });
  const child = spawn(process.execPath, ['scripts/dev.mjs'], {
    cwd: directory, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PATH: join(directory, 'bin') + ':' + process.env.PATH },
  });
  let output = ''; child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
  const exit = new Promise(resolve => child.once('exit', code => resolve(code)));
  const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 10_000);
  return { directory, child, exit, output: () => output, async cleanup() {
    clearTimeout(timer);
    try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    try { const { pid } = JSON.parse(await readFile(join(directory, 'backend.json'), 'utf8')); process.kill(pid, 'SIGKILL'); } catch {}
    await rm(directory, { recursive: true, force: true });
  } };
}

for (const mode of ['exit', 'interrupt', 'hangup', 'terminal-error', 'stubborn', 'repeated-interrupt', 'timeout']) {
  test(`development launcher: ${mode}`, { skip: process.platform === 'win32' }, async () => {
    const run = await fixture(mode);
    try {
      if (['interrupt', 'hangup', 'repeated-interrupt'].includes(mode)) {
        for (let attempt = 0; !run.output().includes('MOCK_FRONTEND_READY') && attempt < 100; attempt++) await delay(30);
        assert(run.output().includes('MOCK_FRONTEND_READY'), 'Frontend starts after backend health succeeds');
        run.child.kill(mode === 'hangup' ? 'SIGHUP' : 'SIGINT');
        if (mode === 'repeated-interrupt') { await delay(20); run.child.kill('SIGINT'); await delay(20); run.child.kill('SIGHUP'); }
      }
      assert.equal(await run.exit, ['exit', 'stubborn'].includes(mode) ? 7 : ['interrupt', 'hangup', 'terminal-error', 'repeated-interrupt'].includes(mode) ? 130 : 1);
      const backend = JSON.parse(await readFile(join(run.directory, 'backend.json'), 'utf8'));
      assert.equal(backend.terminalInput, false, 'Backend watcher has no terminal input');
      assert(!run.output().includes('read EIO'), 'No terminal read failure occurs');
      if (mode === 'timeout') assert(!run.output().includes('MOCK_FRONTEND_READY'), 'Frontend never starts before backend readiness');
      else {
        const frontend = JSON.parse(await readFile(join(run.directory, 'frontend.json'), 'utf8'));
        assert.equal(frontend.terminalInput, false, 'Frontend watcher has no terminal input');
      }
      let free = false;
      for (let attempt = 0; attempt < 40 && !free; attempt++) { free = await portAvailable(); if (!free) await delay(25); }
      assert(free, 'Shutdown releases the backend port, including grandchild processes');
    } finally { await run.cleanup(); }
  });
}

for (const port of [3000, 5173]) test(`occupied port ${port} produces an immediate actionable error`, async () => {
  assert(await portAvailable(), 'Port 3000 must be unused before the collision test');
  const server = createServer();
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  try {
    const child = spawn(process.execPath, [new URL('../dev.mjs', import.meta.url).pathname], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; child.stderr.on('data', data => { output += data; });
    assert.equal(await new Promise(resolve => child.once('exit', resolve)), 1);
    assert(output.includes(`Port ${port} is already in use`) && !output.includes('within 30 seconds'));
  } finally { await new Promise(resolve => server.close(resolve)); }
});

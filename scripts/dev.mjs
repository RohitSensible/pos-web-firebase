import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { get } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = new Set();
const processGroups = process.platform !== 'win32';
let stopping = false;
let killTimer;

function startNpm(args, name) {
  const child = spawn(npm, args, {
    cwd: root,
    // Watchers must not read from a terminal after their parent has exited.
    stdio: ['ignore', 'inherit', 'inherit'],
    detached: processGroups,
    shell: process.platform === 'win32',
  });
  children.add(child);
  child.once('error', error => {
    child.spawnError = error;
    console.error(`[${name}] Could not start: ${error.message}`);
    stopAll('SIGTERM');
  });
  return child;
}

function observeExit(child, name) {
  return new Promise(resolve => {
    child.once('error', error => resolve({ child, name, error }));
    child.once('exit', (code, signal) => resolve({ child, name, code, signal }));
  });
}

function signalChildren(signal) {
  for (const child of children) {
    if (!child.pid) continue;
    try {
      if (processGroups) {
        process.kill(-child.pid, signal);
        // A suspended watcher cannot handle termination until it resumes.
        if (signal !== 'SIGKILL') process.kill(-child.pid, 'SIGCONT');
      } else child.kill(signal);
    } catch (error) {
      if (error.code !== 'ESRCH') console.error(`[DEV] Could not stop a child process: ${error.message}`);
    }
  }
}

function stopAll(signal) {
  stopping = true;
  signalChildren(signal);
  if (!killTimer) {
    killTimer = setTimeout(() => signalChildren('SIGKILL'), 3_000);
  }
}

function portAvailable(port) {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', error => error.code === 'EADDRINUSE' ? resolve(false) : reject(error));
    probe.listen(port, '127.0.0.1', () => probe.close(error => error ? reject(error) : resolve(true)));
  });
}

function backendHealthy() {
  return new Promise(resolve => {
    // Probe loopback directly, independently of browser or environment proxies.
    const request = get('http://127.0.0.1:3000/api/health', response => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 300);
    });
    request.setTimeout(1_000, () => request.destroy());
    request.once('error', () => resolve(false));
  });
}

process.on('SIGINT', () => stopAll('SIGINT'));
process.on('SIGTERM', () => stopAll('SIGTERM'));
process.on('SIGHUP', () => stopAll('SIGTERM'));
process.stdin.on('error', error => {
  // Losing the terminal is a shutdown request, never an uncaught stream error.
  if (error.code !== 'EIO' && error.code !== 'ENXIO') {
    console.error(`[DEV] Terminal input failed: ${error.code ?? 'unknown error'}`);
  }
  process.stdin.pause();
  stopAll('SIGTERM');
});

async function waitForShutdown() {
  if (!stopping) return;
  const deadline = Date.now() + 3_200;
  while (Date.now() < deadline) {
    const alive = [...children].some(child => {
      if (!child.pid) return false;
      if (!processGroups) return child.exitCode === null && child.signalCode === null;
      try { process.kill(-child.pid, 0); return true; } catch { return false; }
    });
    if (!alive) break;
    await delay(50);
  }
  clearTimeout(killTimer);
}

try {
  if (!await portAvailable(3000)) {
    console.error('[DEV] Port 3000 is already in use. Stop the existing backend process, then run npm run dev again.');
    process.exitCode = 1;
  } else if (!await portAvailable(5173)) {
    console.error('[DEV] Port 5173 is already in use. Stop the existing frontend process, then run npm run dev again.');
    process.exitCode = 1;
  } else if (!stopping) {
    const backend = startNpm(['run', 'dev', '--prefix', 'backend'], 'BACKEND');
    const backendExit = observeExit(backend, 'BACKEND');
    let backendReady = false;
    const deadline = Date.now() + 30_000;

    while (!backendReady && !stopping && Date.now() < deadline) {
      if (backend.exitCode !== null || backend.signalCode !== null || backend.spawnError) break;
      backendReady = await backendHealthy();
      if (!backendReady && !stopping) await delay(200);
    }

    if (!backendReady || stopping) {
      const wasStopped = stopping;
      if (!wasStopped) console.error('[DEV] Backend did not become ready on port 3000 within 30 seconds.');
      stopAll('SIGTERM');
      if (!backend.spawnError) await backendExit;
      process.exitCode = wasStopped ? 130 : 1;
    } else {
      console.log('[DEV] Backend is ready; starting the frontend.');
      const frontend = startNpm(['run', 'dev', '--prefix', 'frontend'], 'FRONTEND');
      const result = await Promise.race([backendExit, observeExit(frontend, 'FRONTEND')]);
      const wasStopped = stopping;
      stopAll('SIGTERM');
      process.exitCode = wasStopped ? 130 : typeof result.code === 'number' ? result.code : 1;
      if (result.name === 'BACKEND' && !wasStopped) console.error('[DEV] Backend exited; stopping the frontend.');
    }
  }

} finally {
  if (children.size && !stopping) stopAll('SIGTERM');
  await waitForShutdown();
}

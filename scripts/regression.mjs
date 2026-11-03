import { spawn } from 'node:child_process';
import { access, mkdtemp, open, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));

// Resolve relative source .js imports to .ts before tsx loads them. This avoids
// silently testing stale, tracked backend/src/*.js left by an earlier build.
export const sourcePreload = `data:text/javascript,${encodeURIComponent(`
  import { registerHooks } from 'node:module';
  import { existsSync } from 'node:fs';
  registerHooks({ resolve(specifier, context, nextResolve) {
    if (context.parentURL && /^(\\.\\.?\\/|file:)/.test(specifier) && specifier.endsWith('.js')) {
      const candidate = new URL(specifier.replace(/\\.js$/, '.ts'), context.parentURL);
      if (existsSync(candidate)) return nextResolve(candidate.href, context);
    }
    return nextResolve(specifier, context);
  }});
`)}`;

export function parseArgs(args) {
  const options = { list: false, unitOnly: false, browserOnly: false, skipBuild: false, concurrency: 2, timeout: 180_000 };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--list') options.list = true;
    else if (arg === '--unit-only') options.unitOnly = true;
    else if (arg === '--browser-only') options.browserOnly = true;
    else if (arg === '--skip-build') options.skipBuild = true;
    else if (['--concurrency', '--timeout-ms', '--report-dir'].includes(arg)) {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      if (arg === '--report-dir') options.reportDir = resolve(value);
      else {
        const number = Number(value);
        if (!Number.isSafeInteger(number) || number < 1 || (arg === '--concurrency' && number > 2)) throw new Error(`Invalid ${arg}: ${value}`);
        options[arg === '--concurrency' ? 'concurrency' : 'timeout'] = number;
      }
    } else throw new Error(`Unknown option: ${arg}`);
  }
  if (options.unitOnly && options.browserOnly) throw new Error('--unit-only and --browser-only are mutually exclusive');
  return options;
}

export function createPlan(options = {}) {
  const node = (id, file) => ({ id, group: 'unit', command: process.execPath,
    args: ['--import', pathToFileURL(join(root, 'backend/node_modules/tsx/dist/loader.mjs')).href,
      '--import', sourcePreload, '--test', '--test-isolation=none', '--test-reporter=tap', file], result: 'tap' });
  const checks = [
    { id: 'backend-typecheck', group: 'build', command: process.execPath, args: ['backend/node_modules/typescript/bin/tsc', '--noEmit', '-p', 'backend'] },
    { id: 'frontend-production-build', group: 'build', command: 'npm', args: ['run', 'build', '--prefix', 'frontend'] },
    { id: 'regression-runner-tests', group: 'unit', command: process.execPath, args: ['--test', '--test-isolation=none', '--test-reporter=tap', 'scripts/tests/regression.test.mjs'], result: 'tap' },
    ...[
      ['report-excel', 'frontend/tests/reportExcel.test.mjs'],
      ['dashboard-excel', 'frontend/tests/dashboardExcel.test.mjs'],
      ['dashboard-shift-details-excel', 'frontend/tests/dashboardShiftDetailsExcel.test.mjs'],
      ['shift-status', 'frontend/tests/shiftStatus.test.mjs'],
      ['daily-usage-route', 'frontend/tests/dailyUsageRoute.test.mjs'],
      ['daily-usage', 'backend/tests/dailyUsage.test.ts'],
      ['usage-middleware', 'backend/tests/webUsageMiddleware.test.ts'],
      ['usage-policy', 'backend/tests/outletUsagePolicy.test.ts'],
      ['usage-disabled-compatibility', 'backend/tests/webUsageDisabled.test.ts'],
      ['daily-usage-recovery-audit', 'backend/tests/dailyUsageRecoveryAudit.test.mjs'],
    ].map(([id, file]) => node(id, file)),
  ];
  const fixtures = ['lazyWorkspace', 'unsavedChanges', 'unsavedForms', 'remainingReportSafety',
    'dailyUsageRecoveryAudit', 'dashboardShiftSelection', 'stockTransferReadRecovery', 'loginRecovery',
    'billPrinting', 'printDocumentRecovery', 'dailyUsage', 'dailyUsageLogin', 'dailyUsageLockout'];
  for (const fixture of fixtures) {
    for (const [size, viewport] of [['desktop', '1280,900'], ['mobile', '390,844']]) {
      checks.push({ id: `${fixture}-${size}`, group: 'browser', command: process.execPath,
        args: ['frontend/tests/runProductFormBrowser.mjs', `${fixture}.browser.tsx`, viewport], result: 'browser',
        // UI fixtures isolate admission; dailyUsage* always exercises the real hook.
        env: { WEB_USAGE_TEST_ENABLED: fixture.startsWith('dailyUsage') ? '1' : '0' } });
    }
  }
  return checks.filter(check => (!options.unitOnly || check.group === 'unit')
    && (!options.browserOnly || check.group === 'browser') && (!options.skipBuild || check.group !== 'build'));
}

export function validateResult(check, output) {
  if (check.result === 'tap') {
    const tests = output.match(/^# tests (\d+)\s*$/m);
    const passed = output.match(/^# pass (\d+)\s*$/m);
    const failures = output.match(/^# fail (\d+)\s*$/m);
    if (!tests || Number(tests[1]) < 1 || !passed || Number(passed[1]) < 1
      || !failures || Number(failures[1]) !== 0 || /^# cancelled [1-9]/m.test(output)
      || /^not ok\b/m.test(output)) throw new Error('Missing, empty or failing TAP results');
  } else if (check.result === 'browser') {
    let result;
    try { result = JSON.parse(output.trim()); } catch { throw new Error('Invalid browser JSON results'); }
    const passed = Array.isArray(result?.passed) ? result.passed.length : result?.passed;
    if (!Number.isSafeInteger(passed) || passed < 1 || (result.failed !== undefined && result.failed !== 0 && result.failed !== false)) {
      throw new Error('Missing, empty or failing browser results');
    }
  }
}

export async function findChrome(env = process.env) {
  const names = env.CHROME_BIN ? [env.CHROME_BIN] : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', 'google-chrome', 'chromium'];
  for (const name of names) {
    const candidates = name.includes('/') ? [resolve(name)] : (env.PATH || '').split(delimiter).map(directory => join(directory, name));
    for (const candidate of candidates) {
      try { await access(candidate, constants.X_OK); return candidate; } catch { /* try next executable */ }
    }
  }
  throw new Error('Headless Chrome is missing or not executable. Set CHROME_BIN=/absolute/path/to/google-chrome (or chromium).');
}

export async function runCheck(check, { directory, timeout = 180_000, spawnProcess = spawn, env = process.env } = {}) {
  const started = Date.now();
  const log = join(directory, `${check.id}.log`);
  let stdout = '', stderr = '', failure, code = null, timedOut = false;
  const outputFile = await open(join(directory, `${check.id}.stdout.log`), 'w');
  const errorFile = await open(join(directory, `${check.id}.stderr.log`), 'w');
  try {
    await new Promise((resolveCheck, rejectCheck) => {
      const child = spawnProcess(check.command, check.args, { cwd: root, env: { ...env, ...check.env },
        stdio: ['ignore', outputFile.fd, errorFile.fd], detached: process.platform !== 'win32' });
      let killTimer;
      const kill = signal => {
        try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal); else child.kill(signal); } catch { /* already exited */ }
      };
      const timer = setTimeout(() => {
        timedOut = true;
        kill('SIGTERM');
        killTimer = setTimeout(() => kill('SIGKILL'), 1000);
      }, check.timeout ?? timeout);
      child.once('error', error => { clearTimeout(timer); clearTimeout(killTimer); rejectCheck(error); });
      child.once('close', (exitCode, signal) => {
        // The direct process can exit before a stubborn grandchild. Ensure the
        // timed-out process group cannot survive after we clear the grace timer.
        if (timedOut) kill('SIGKILL');
        clearTimeout(timer); clearTimeout(killTimer); code = exitCode;
        if (timedOut) rejectCheck(new Error(`Timed out after ${check.timeout ?? timeout}ms`));
        else if (exitCode !== 0) rejectCheck(new Error(`Process exited ${exitCode ?? signal}`));
        else resolveCheck();
      });
    });
    stdout = await readFile(join(directory, `${check.id}.stdout.log`), 'utf8');
    validateResult(check, stdout);
  } catch (error) { failure = error.message; }
  finally { await outputFile.close(); await errorFile.close(); }
  stdout = await readFile(join(directory, `${check.id}.stdout.log`), 'utf8');
  stderr = await readFile(join(directory, `${check.id}.stderr.log`), 'utf8');
  await writeFile(log, `${stdout}\n${stderr}${failure ? `\nRunner: ${failure}\n` : ''}`);
  return { id: check.id, group: check.group, status: failure ? 'failed' : 'passed', code, timedOut,
    durationMs: Date.now() - started, log, ...(failure ? { error: failure } : {}) };
}

export async function runPlan(plan, options, execute = runCheck) {
  if (!plan.length) throw new Error('No regression checks selected');
  const results = new Array(plan.length);
  let next = 0;
  async function worker() {
    while (next < plan.length) {
      const index = next++;
      results[index] = await execute(plan[index], options);
      options.onResult?.(results[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(options.concurrency ?? 2, 2, plan.length) }, worker));
  return { ok: results.every(result => result?.status === 'passed'), results };
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  const plan = createPlan(options);
  if (options.list) {
    for (const check of plan) console.log(`${check.group.padEnd(7)} ${check.id}${check.group === 'browser' ? ` (${check.args[1]}, ${check.args[2]})` : ''}`);
    console.log(`${plan.length} checks; concurrency ${options.concurrency}; timeout ${options.timeout}ms per process`);
    return 0;
  }
  const { mkdir } = await import('node:fs/promises');
  const directory = options.reportDir || await mkdtemp(join(tmpdir(), 'web-pos-regression-'));
  await mkdir(directory, { recursive: true });
  const started = new Date().toISOString();
  let outcome;
  try {
    const env = { ...process.env };
    if (plan.some(check => check.group === 'browser')) env.CHROME_BIN = await findChrome(env);
    // Complete build checks before concurrent fixtures; retain every failure.
    const results = [];
    const onResult = result => console.log(`${result.status === 'passed' ? 'PASS' : 'FAIL'} ${result.id} (${result.durationMs}ms)${result.error ? `: ${result.error}` : ''}`);
    for (const check of plan.filter(check => check.group === 'build')) results.push(await runCheck(check, { ...options, directory, env }).then(result => { onResult(result); return result; }));
    const rest = await runPlan(plan.filter(check => check.group !== 'build'), { ...options, directory, env, onResult });
    results.push(...rest.results);
    outcome = { ok: results.length === plan.length && results.every(result => result.status === 'passed'), results };
  } catch (error) { outcome = { ok: false, error: error.message, results: [] }; console.error(error.message); }
  const report = join(directory, 'report.json');
  await writeFile(report, JSON.stringify({ started, finished: new Date().toISOString(), selected: plan.map(check => check.id), ...outcome }, null, 2));
  const passed = outcome.results.filter(result => result.status === 'passed').length;
  console.log(`${outcome.ok ? 'PASS' : 'FAIL'}: ${passed}/${plan.length} checks passed. Report: ${report}`);
  return outcome.ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; }).catch(error => { console.error(error.message); process.exitCode = 1; });
}

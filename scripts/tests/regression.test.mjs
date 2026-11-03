import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPlan, findChrome, parseArgs, root, runCheck, runPlan, sourcePreload, validateResult } from '../regression.mjs';

async function withDirectory(action) {
  const directory = await mkdtemp(join(tmpdir(), 'regression-runner-test-'));
  try { return await action(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
const fake = (id, code, extra = {}) => ({ id, group: 'unit', command: process.execPath, args: ['-e', code], ...extra });

test('filters select only the requested groups and never invoke a backend build', () => {
  const all = createPlan();
  assert(all.some(check => check.id === 'backend-typecheck' && check.args.includes('--noEmit')));
  assert(!all.some(check => check.command === 'npm' && check.args.includes('backend')));
  assert(all.some(check => check.id === 'frontend-production-build'));
  assert(createPlan(parseArgs(['--unit-only'])).every(check => check.group === 'unit'));
  assert(createPlan(parseArgs(['--browser-only'])).every(check => check.group === 'browser'));
  assert(createPlan(parseArgs(['--skip-build'])).every(check => check.group !== 'build'));
  const browsers = all.filter(check => check.group === 'browser');
  assert(browsers.some(check => check.args.includes('1280,900')));
  assert(browsers.some(check => check.args.includes('390,844')));
  assert(browsers.filter(check => check.id.startsWith('dailyUsage')).every(check => check.env.WEB_USAGE_TEST_ENABLED === '1'));
  assert(browsers.filter(check => !check.id.startsWith('dailyUsage')).every(check => check.env.WEB_USAGE_TEST_ENABLED === '0'));
});

test('invalid options fail and concurrency cannot exceed two', () => {
  for (const args of [['--oops'], ['--timeout-ms', '0'], ['--concurrency', '3'], ['--concurrency', '1.5'], ['--unit-only', '--browser-only'], ['--report-dir']]) {
    assert.throws(() => parseArgs(args));
  }
  assert.equal(parseArgs(['--list', '--timeout-ms', '50', '--concurrency', '1']).timeout, 50);
});

test('missing/empty/failed browser or TAP results cannot pass with exit zero', () => {
  for (const output of ['', '{}', 'null', '{"passed":0}', '{"passed":[]}', '{"passed":2,"failed":"oops"}', '{"passed":2,"failed":[]}']) {
    assert.throws(() => validateResult({ result: 'browser' }, output));
  }
  validateResult({ result: 'browser' }, '{"passed":["checked" ]}');
  validateResult({ result: 'browser' }, '{"passed":3,"failed":0}');
  for (const output of ['', '# tests 0\n# pass 0\n# fail 0', '# tests 1\n# pass 1\n# fail 1', 'not ok 1\n# tests 1\n# pass 1\n# fail 0']) {
    assert.throws(() => validateResult({ result: 'tap' }, output));
  }
  validateResult({ result: 'tap' }, '# tests 2\n# pass 2\n# fail 0\n');
});

test('real tiny subprocess failures propagate and logs capture both output streams', () => withDirectory(async directory => {
  const check = fake('deliberate-failure', 'console.log("tiny stdout"); console.error("tiny stderr"); process.exit(7)');
  const result = await runCheck(check, { directory, timeout: 2000 });
  assert.equal(result.status, 'failed'); assert.equal(result.code, 7);
  const log = await readFile(result.log, 'utf8');
  assert.match(log, /tiny stdout/); assert.match(log, /tiny stderr/);
  const missing = await runCheck({ ...check, id: 'missing-binary', command: join(directory, 'missing') }, { directory });
  assert.equal(missing.status, 'failed'); assert.match(missing.error, /ENOENT/);
  const invalid = await runCheck(fake('invalid-results', 'console.log("{}")', { result: 'browser' }), { directory });
  assert.equal(invalid.status, 'failed');
}));

test('a hung subprocess times out and fails', () => withDirectory(async directory => {
  const result = await runCheck(fake('timeout', 'setInterval(() => {}, 1000)'), { directory, timeout: 75 });
  assert.equal(result.status, 'failed'); assert.equal(result.timedOut, true);
  assert.match(result.error, /Timed out/); assert(result.durationMs < 4000);
}));

test('subprocess environment preserves realtime and applies fixture usage isolation', () => withDirectory(async directory => {
  const result = await runCheck(fake('isolation', 'console.log(process.env.BROWSER_TEST_REALTIME + ":" + process.env.WEB_USAGE_TEST_ENABLED)',
    { env: { WEB_USAGE_TEST_ENABLED: '0' } }),
  { directory, env: { ...process.env, BROWSER_TEST_REALTIME: '1', WEB_USAGE_TEST_ENABLED: '1' } });
  assert.equal(result.status, 'passed');
  assert.match(await readFile(result.log, 'utf8'), /1:0/);
}));

test('CLI planning executes no check and invalid arguments exit nonzero', () => withDirectory(async directory => {
  const list = await runCheck({ id: 'list', group: 'unit', command: process.execPath,
    args: ['scripts/regression.mjs', '--list', '--browser-only'] }, { directory });
  assert.equal(list.status, 'passed');
  const log = await readFile(list.log, 'utf8');
  assert.match(log, /lazyWorkspace-desktop/); assert.doesNotMatch(log, /^PASS /m);
  const invalid = await runCheck({ id: 'bad-option', group: 'unit', command: process.execPath,
    args: ['scripts/regression.mjs', '--not-a-real-option'] }, { directory });
  assert.equal(invalid.status, 'failed'); assert.equal(invalid.code, 1);
}));

test('source preload chooses real TypeScript even when adjacent JavaScript exists', () => withDirectory(async directory => {
  await writeFile(join(directory, 'source.js'), 'throw new Error("STALE JS MUST NOT RUN")');
  await writeFile(join(directory, 'source.ts'), 'export class Value { constructor(public value: number) {} }');
  await writeFile(join(directory, 'entry.ts'), 'import { Value } from "./source.js"; if(new Value(42).value !== 42) throw Error("wrong value"); console.log("SOURCE_TS_OK")');
  const result = await runCheck({ id: 'source-loader', group: 'unit', command: process.execPath,
    args: ['--import', pathToFileURL(join(root, 'backend/node_modules/tsx/dist/loader.mjs')).href,
      '--import', sourcePreload, join(directory, 'entry.ts')] }, { directory, timeout: 5000 });
  assert.equal(result.status, 'passed', await readFile(result.log, 'utf8'));
  assert.match(await readFile(result.log, 'utf8'), /SOURCE_TS_OK/);
}));

test('plan executes every check after failure with at most two concurrent workers', async () => {
  let active = 0, maximum = 0;
  const visited = [];
  const result = await runPlan([fake('a', ''), fake('b', ''), fake('c', '')], { concurrency: 2 }, async check => {
    active++; maximum = Math.max(maximum, active); visited.push(check.id);
    await new Promise(resolve => setTimeout(resolve, 10)); active--;
    return { id: check.id, status: check.id === 'b' ? 'failed' : 'passed' };
  });
  assert.equal(maximum, 2); assert.equal(result.ok, false);
  assert.deepEqual(visited, ['a', 'b', 'c']); assert.equal(result.results.length, 3);
  await assert.rejects(runPlan([], {}), /No regression checks/);
});

test('Chrome override fails clearly without probing services', async () => {
  await assert.rejects(findChrome({ CHROME_BIN: '/definitely/not/installed/chrome', PATH: '' }), /Set CHROME_BIN/);
  assert.equal(await findChrome({ CHROME_BIN: process.execPath }), process.execPath);
});

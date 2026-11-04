# Offline regression command

From the repository root:

```sh
npm run test:regression
```

Prerequisites: Node.js 24+, npm, the repository's existing frontend/backend dependencies, and an installed Chrome or Chromium executable. No dependencies are installed by this command. Chrome must be able to launch headlessly and bind localhost; the browser harness serves only bundled fixtures on an ephemeral loopback port. It never starts the application backend or Vite server.

```sh
CHROME_BIN=/absolute/path/to/chromium npm run test:regression
npm run test:regression -- --list
npm run test:regression -- --unit-only
npm run test:regression -- --browser-only
npm run test:regression -- --skip-build --concurrency 1 --timeout-ms 120000
npm run test:regression -- --report-dir /tmp/my-pos-regression
```

`--list` only prints the plan; it does not execute checks, launch Chrome or create reports. `--unit-only` selects Node tests without builds or Chrome. `--browser-only` selects browser fixtures without builds or Node tests. `--skip-build` runs both kinds of tests without either build check. Concurrency is bounded to one or two processes (default two). Build checks run sequentially before test suites. Every process has a timeout (default 180 seconds), followed by process-group termination and forced termination if needed. The browser harness also imposes its own 30-second Chrome deadline.

## Coverage

- Backend TypeScript check: `tsc --noEmit -p backend`. The backend build is never invoked, so it does not emit adjacent tracked JavaScript, declaration or map files.
- Frontend production build: the existing `npm run build --prefix frontend` (`tsc -b && vite build`). This produces normal frontend build/cache artifacts.
- Node checks: regression-runner tests; report Excel, Dashboard Excel and shift-detail Excel; authoritative shift status; usage route, accounting engine, middleware, outlet policy, disabled-compatibility behavior and the daily usage recovery audit.
- Every selected browser fixture runs at **1280×900** and **390×844**: `lazyWorkspace`, `unsavedChanges`, `unsavedForms`, `remainingReportSafety`, `dailyUsageRecoveryAudit`, `dashboardShiftSelection`, `stockTransferReadRecovery`, `loginRecovery`, `billPrinting`, `printDocumentRecovery`, `dailyUsage`, `dailyUsageLogin`, and `dailyUsageLockout`. These use mocked services. This is a curated smoke suite, not every fixture in `frontend/tests`.

The suite also covers goods receipt creation and pagination, supplier creation/update, stock planning, and product image workflows. Receipt history and replenishment fixtures run at both viewports. `productImages` exercises the real admission hook because it explicitly verifies usage-session headers; other image fixtures isolate admission. A missing fixture or audit file fails its check; it is never silently counted as passing. `--list` prints the complete current suite.

Node checks load TypeScript through the installed backend `tsx` loader. A synchronous source-resolution preload redirects relative `.js` imports to existing `.ts` siblings, including backend source and shared helpers. Thus adjacent stale emitted `.js` cannot substitute for source TypeScript. The recovery audit also imports `dailyUsage.ts` explicitly. Each Node suite runs in its own runner subprocess with `--test-isolation=none` to avoid another layer of Node test subprocesses. Runner tests prove source selection with deliberately conflicting `.js` and `.ts` files.

Browser fixtures default to real-time Chrome execution so image decoding, workbook generation and UI scheduling complete reliably. Set `BROWSER_TEST_REALTIME=0` to explicitly use Chrome virtual time instead. `WEB_USAGE_TEST_ENABLED=1` is set for the `dailyUsage*` and `productImages` fixtures, which exercise the real usage hook. Other UI fixtures get `WEB_USAGE_TEST_ENABLED=0` and the harness's existing admission-hook mock. These are test isolation settings, not application policy changes.

## Results and exclusions

By default, each execution creates a unique `/tmp/web-pos-regression-*` directory. It contains separate stdout/stderr logs, a combined log for every check, and `report.json` with check statuses, exit codes, durations, timeout flags and log paths. The console prints a short per-check summary and the report path. Reports do not serialize credentials or the process environment. A custom report directory is reused, so choose a fresh directory when retaining multiple runs.

Any failed process, timeout, invalid/empty browser JSON, failing/empty Node TAP results, missing prerequisite or empty selection returns nonzero. Checks continue after ordinary suite failures to collect useful results. Browser success requires a nonempty `passed` array or a positive integer count; exit zero alone is insufficient. Chrome discovery failures explicitly request `CHROME_BIN` and produce a failed report.

This command does not validate real authentication, deployed APIs, databases, migrations, native printer output, device integrations or production credentials. It performs no live database/API calls or schema changes. Printing checks exercise mocked document/preview flows. There is no blocking broad lint gate. Restricted sandboxes may forbid loopback or Chrome; run the browser portion in an environment that permits them. Planning and runner unit tests require neither.

The GitHub Actions workflow in `.github/workflows/regression.yml` runs this command on pull requests, pushes to main/master, and manual dispatch using Node 24, locked dependencies, and the runner's headless Chrome. It uploads logs and `report.json` even after check failures and retains them for 14 days. It has read-only repository permissions and requires no Firebase credentials. The workflow must be pushed to GitHub to run; enforcing it as a required merge check remains a repository-settings choice.

## Live barcode camera checks

`barcodeScanner` runs at desktop and phone sizes. It supplies independently encoded
barcode pixels through canvas-generated video streams and uses the production ZXing
decoder. It verifies automatic startup, rear-camera fallback, permission/missing-camera
errors, EAN-13/Code 39/QR decoding, acceptance, cancellation, cleanup, unchanged product
PATCH behavior and honest errors on HTTP LAN origins. No physical camera or live
database is used. LAN HTTP does not support live camera access in mobile browsers.

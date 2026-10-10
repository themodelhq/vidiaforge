
/* ──────────────────────────────────────────────────────────────────────────
 * VidiaForge V8.7 — Production startup smoke test
 *
 * Rules:
 * 1. Missing production output must NEVER be reported as PASS.
 * 2. Ordinary unit-test runs may explicitly SKIP production startup tests
 *    when no production build exists.
 * 3. Release-gate runs must set VIDIAFORGE_REQUIRE_BUILT_SERVER=1.
 *    In that mode, missing production output is a TEST FAILURE.
 * 4. When the build exists, verify that the real standalone server starts
 *    and returns an HTTP response.
 * 5. Always attempt to terminate the test server after testing.
 * ────────────────────────────────────────────────────────────────────────── */

describe('VidiaForge V8.7 — Production startup smoke test', () => {
  const serverJsPath = path.join(
    REPO_ROOT,
    '.next',
    'standalone',
    'server.js',
  );

  const requireBuiltServer =
    process.env.VIDIAFORGE_REQUIRE_BUILT_SERVER === '1';

  const builtServerExists = existsSync(serverJsPath);

  const TEST_HOST = '127.0.0.1';
  const TEST_PORT = String(
    40000 + Math.floor(Math.random() * 20000),
  );
  const STARTUP_TIMEOUT_MS = 15000;
  const POLL_INTERVAL_MS = 250;

  /*
   * This is a real conditional skip, not a passing assertion.
   *
   * Release mode deliberately does not skip: the tests below must fail
   * when the production server artifact is missing.
   */
  if (!builtServerExists && !requireBuiltServer) {
    test.skip(
      'CHECK 17: standalone server exists (skipped because no production build exists)',
      () => {},
    );

    test.skip(
      'CHECK 18: production server starts and responds over HTTP (skipped because no production build exists)',
      () => {},
    );
  } else {
    test(
      'CHECK 17: .next/standalone/server.js exists',
      () => {
        expect(
          existsSync(serverJsPath),
          [
            'Production standalone server is missing.',
            `Expected: ${serverJsPath}`,
            '',
            'Run the actual production build before running the release gate.',
            'Release-gate command:',
            '  VIDIAFORGE_REQUIRE_BUILT_SERVER=1 bun test tests/unit/build-and-startup.test.ts',
          ].join('\n'),
        ).toBe(true);

        expect(statSync(serverJsPath).isFile()).toBe(true);
      },
    );

    test(
      'CHECK 18: real production server starts and responds over HTTP',
      async () => {
        /*
         * This assertion is deliberately retained even though CHECK 17
         * checks the same artifact. Never spawn a nonexistent server.
         */
        expect(
          existsSync(serverJsPath),
          `Cannot start production server: ${serverJsPath} does not exist.`,
        ).toBe(true);

        const child = spawn('bun', [serverJsPath], {
          cwd: REPO_ROOT,
          env: {
            ...process.env,
            NODE_ENV: 'production',
            PORT: TEST_PORT,
            HOSTNAME: TEST_HOST,

            // These are isolated test configuration values. They do not
            // prove that live PostgreSQL, Redis, or object storage works.
            DATABASE_URL:
              process.env.TEST_DATABASE_URL ??
              'postgresql://test:test@127.0.0.1:5432/vidiaforge_test',
            REDIS_URL:
              process.env.TEST_REDIS_URL ??
              'redis://127.0.0.1:6379',
            STORAGE_PROVIDER:
              process.env.TEST_STORAGE_PROVIDER ?? 'local',
            UPLOAD_DIR:
              process.env.TEST_UPLOAD_DIR ??
              path.join(os.tmpdir(), 'vidiaforge-test-uploads'),
            TEMP_DIR:
              process.env.TEST_TEMP_DIR ??
              path.join(os.tmpdir(), 'vidiaforge-test-tmp'),
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        let output = '';
        let spawnError: Error | undefined;
        let exitCode: number | null = null;
        let exitSignal: NodeJS.Signals | null = null;

        const appendOutput = (chunk: Buffer | string) => {
          output += chunk.toString();

          // Bound memory usage if the application repeatedly logs errors.
          if (output.length > 20000) {
            output = output.slice(-20000);
          }
        };

        child.stdout?.on('data', appendOutput);
        child.stderr?.on('data', appendOutput);

        child.on('error', (error) => {
          spawnError = error;
        });

        child.on('exit', (code, signal) => {
          exitCode = code;
          exitSignal = signal;
        });

        const sleep = (milliseconds: number) =>
          new Promise<void>((resolve) => {
            setTimeout(resolve, milliseconds);
          });

        const startedAt = Date.now();
        const url = `http://${TEST_HOST}:${TEST_PORT}/`;

        let httpResponseReceived = false;
        let lastRequestError = 'No HTTP request has been attempted.';

        try {
          while (Date.now() - startedAt < STARTUP_TIMEOUT_MS) {
            if (spawnError) {
              throw new Error(
                `Could not launch production server: ${spawnError.message}`,
              );
            }

            if (exitCode !== null || exitSignal !== null) {
              throw new Error(
                [
                  'Production server exited before an HTTP response was received.',
                  `Exit code: ${String(exitCode)}`,
                  `Signal: ${String(exitSignal)}`,
                  `Output:\n${output.slice(-5000)}`,
                ].join('\n'),
              );
            }

            try {
              const response = await fetch(url, {
                signal: AbortSignal.timeout(1000),
                redirect: 'manual',
              });

              /*
               * Any HTTP response proves the server is accepting requests.
               * A 3xx or 4xx response still needs separate route-level
               * assertions if a particular endpoint is required.
               */
              expect(response.status).toBeGreaterThanOrEqual(100);
              expect(response.status).toBeLessThan(600);

              httpResponseReceived = true;

              // Consume the body so the request can finish cleanly.
              await response.body?.cancel().catch(() => {});
              break;
            } catch (error) {
              lastRequestError =
                error instanceof Error
                  ? error.message
                  : String(error);
            }

            await sleep(POLL_INTERVAL_MS);
          }

          expect(
            httpResponseReceived,
            [
              'Production server did not return an HTTP response before timeout.',
              `URL: ${url}`,
              `Timeout: ${STARTUP_TIMEOUT_MS} ms`,
              `Last request error: ${lastRequestError}`,
              `Spawn error: ${spawnError?.message ?? 'none'}`,
              `Exit code: ${String(exitCode)}`,
              `Exit signal: ${String(exitSignal)}`,
              `Server output:\n${output.slice(-5000)}`,
            ].join('\n'),
          ).toBe(true);
        } finally {
          /*
           * Do not leave a production server process running after the test.
           */
          if (child.exitCode === null && child.signalCode === null) {
            child.kill('SIGTERM');

            const shutdownStartedAt = Date.now();

            while (
              child.exitCode === null &&
              child.signalCode === null &&
              Date.now() - shutdownStartedAt < 3000
            ) {
              await sleep(100);
            }

            if (
              child.exitCode === null &&
              child.signalCode === null
            ) {
              child.kill('SIGKILL');

              // Wait briefly for the child process to report termination.
              const killWaitStartedAt = Date.now();

              while (
                child.exitCode === null &&
                child.signalCode === null &&
                Date.now() - killWaitStartedAt < 2000
              ) {
                await sleep(50);
              }
            }
          }
        }
      },
      STARTUP_TIMEOUT_MS + 10000,
    );
  }
});

#!/usr/bin/env bun

/**
 * VidiaForge V8.7 — Local Certification Script
 *
 * Certification guarantees:
 * - No stale evidence can influence a new run.
 * - Every run receives its own evidence directory.
 * - PASS means the check actually executed and succeeded.
 * - FAIL means the check executed and failed.
 * - BLOCKED means a required dependency or external prerequisite prevented
 *   completion.
 * - NOT RUN means a check was not executed.
 *
 * Exit codes:
 *   0 = PASS
 *   1 = FAIL
 *   2 = BLOCKED or NOT RUN
 *
 * This script does not claim to verify live production services. Live
 * Netlify/Render checks must be performed separately after deployment.
 */

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import {
  APP_VERSION,
  RELEASE_NAME,
  certificationRunId,
  getGitSha,
} from '../lib/version';

import { getFeatureMatrix } from '../lib/feature-registry';

/* -------------------------------------------------------------------------- */
/* 1. Paths and run identity                                                  */
/* -------------------------------------------------------------------------- */

const REPO_ROOT = process.cwd();
const PACKAGE_JSON_PATH = path.join(REPO_ROOT, 'package.json');

if (!existsSync(PACKAGE_JSON_PATH)) {
  throw new Error(
    `Cannot certify: package.json was not found in ${REPO_ROOT}`,
  );
}

const pkgJson = JSON.parse(
  readFileSync(PACKAGE_JSON_PATH, 'utf8'),
) as { version?: string };

const PKG_VERSION = pkgJson.version ?? 'UNKNOWN';

process.env.CERTIFICATION_MODE = 'true';

const RAW_RUN_ID = certificationRunId();

const RUN_ID = String(RAW_RUN_ID)
  .replace(/[^a-zA-Z0-9_.-]/g, '_')
  .slice(0, 160);

if (!RUN_ID) {
  throw new Error('Certification run ID is empty or invalid.');
}

const GIT_SHA = getGitSha();
const RUN_STARTED_AT = new Date().toISOString();
const RUN_STARTED_MS = Date.now();

const ARTIFACT_ROOT = path.join(
  REPO_ROOT,
  'artifacts',
  'certification',
);

const RUN_DIR = path.join(
  ARTIFACT_ROOT,
  RUN_ID,
);

const SUMMARY_PATH = path.join(
  RUN_DIR,
  'certification-summary.json',
);

const DETAILS_PATH = path.join(
  RUN_DIR,
  'certification-details.json',
);

mkdirSync(RUN_DIR, { recursive: true });

/* -------------------------------------------------------------------------- */
/* 2. Certification data model                                                */
/* -------------------------------------------------------------------------- */

type CertStatus = 'PASS' | 'FAIL' | 'BLOCKED' | 'NOT RUN';

interface CertItem {
  id: string;
  name: string;
  category: string;
  status: CertStatus;
  command: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  evidence?: unknown;
  evidenceFile?: string;
  reason?: string;
}

interface CertificationSummary {
  version: string;
  packageVersion: string;
  releaseName: string;
  status: CertStatus;
  runId: string;
  gitSha: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  artifactDirectory: string;
  counts: Record<CertStatus, number>;
  items: Array<{
    id: string;
    name: string;
    category: string;
    status: CertStatus;
    exitCode: number | null;
    durationMs: number;
    evidenceFile?: string;
    reason?: string;
  }>;
}

const items: CertItem[] = [];

/* -------------------------------------------------------------------------- */
/* 3. Output helpers                                                          */
/* -------------------------------------------------------------------------- */

function toText(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (Buffer.isBuffer(value)) {
    return value.toString('utf8');
  }

  return String(value);
}

function truncateOutput(value: string, limit = 12000): string {
  if (value.length <= limit) {
    return value;
  }

  return `[Output truncated; showing last ${limit} characters]\n${value.slice(
    -limit,
  )}`;
}

function relativeArtifactPath(filePath: string): string {
  return path.relative(REPO_ROOT, filePath).split(path.sep).join('/');
}

function writeJsonArtifact(
  filename: string,
  data: unknown,
): string {
  const outputPath = path.join(RUN_DIR, filename);

  mkdirSync(path.dirname(outputPath), {
    recursive: true,
  });

  writeFileSync(
    outputPath,
    JSON.stringify(data, null, 2) + '\n',
    'utf8',
  );

  return outputPath;
}

function writeTextArtifact(
  filename: string,
  content: string,
): string {
  const outputPath = path.join(RUN_DIR, filename);

  mkdirSync(path.dirname(outputPath), {
    recursive: true,
  });

  writeFileSync(outputPath, content, 'utf8');

  return outputPath;
}

function printResult(item: CertItem): void {
  console.log(
    `   ${item.status}: ${item.name}` +
      (item.exitCode === null
        ? ''
        : ` (exit ${item.exitCode})`),
  );

  if (item.reason) {
    console.log(`   Reason: ${item.reason}`);
  }

  const output = item.stderr || item.stdout;

  if (output.trim()) {
    console.log(
      `   ${truncateOutput(output, 400).trim()}`,
    );
  }

  console.log('');
}

/* -------------------------------------------------------------------------- */
/* 4. Evidence safety                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Every evidence file is stored under the current run directory.
 *
 * Before a command executes, its designated evidence file is removed.
 * Therefore, an evidence file from an earlier certification run cannot
 * accidentally classify the current run.
 *
 * A subprocess can use:
 *
 *   CERTIFICATION_RUN_ID
 *   CERTIFICATION_EVIDENCE_FILE
 *
 * to write current-run evidence.
 */
function prepareEvidenceFile(
  filename?: string,
): string | undefined {
  if (!filename) {
    return undefined;
  }

  const normalizedFilename = filename
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');

  const absolutePath = path.resolve(
    RUN_DIR,
    normalizedFilename,
  );

  const relativeToRun = path.relative(
    RUN_DIR,
    absolutePath,
  );

  if (
    relativeToRun === '..' ||
    relativeToRun.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeToRun)
  ) {
    throw new Error(
      `Evidence filename escapes the run directory: ${filename}`,
    );
  }

  mkdirSync(path.dirname(absolutePath), {
    recursive: true,
  });

  // Remove any previous artifact at this exact location.
  // The current test must generate fresh evidence.
  rmSync(absolutePath, { force: true });

  return absolutePath;
}

function readFreshBlockedEvidence(
  evidencePath: string | undefined,
  commandStartedMs: number,
): unknown | undefined {
  if (!evidencePath || !existsSync(evidencePath)) {
    return undefined;
  }

  try {
    const fileStat = statSync(evidencePath);

    // Reject evidence that predates the current command.
    if (fileStat.mtimeMs < commandStartedMs - 1000) {
      return undefined;
    }

    const evidence = JSON.parse(
      readFileSync(evidencePath, 'utf8'),
    ) as {
      status?: string;
      runId?: string;
      run_id?: string;
    };

    if (evidence.status !== 'BLOCKED') {
      return undefined;
    }

    const evidenceRunId =
      evidence.runId ?? evidence.run_id;

    /*
     * A present run ID must match the current run.
     * If no run ID is supplied, the evidence is accepted only because
     * this exact file was deleted before execution and is now freshly
     * created in the isolated current-run directory.
     */
    if (
      evidenceRunId !== undefined &&
      evidenceRunId !== RUN_ID
    ) {
      return undefined;
    }

    return evidence;
  } catch {
    // Invalid or unreadable evidence must never cause a PASS or BLOCKED.
    return undefined;
  }
}

function hasInfrastructureBlockerMarker(
  output: string,
): boolean {
  const markers = [
    'CertificationBlockedError',
    'CERTIFICATION BLOCKED',
    'SKIP: PostgreSQL unavailable',
    'SKIP: Redis unavailable',
    'BLOCKED: PostgreSQL unavailable',
    'BLOCKED: Redis unavailable',
    'BLOCKED: S3 unavailable',
    'BLOCKED: storage credentials unavailable',
    'BLOCKED: required service unavailable',
    'DEPENDENCY_UNAVAILABLE',
  ];

  return markers.some((marker) =>
    output.includes(marker),
  );
}

/* -------------------------------------------------------------------------- */
/* 5. Command execution                                                       */
/* -------------------------------------------------------------------------- */

function runCommand(
  id: string,
  name: string,
  category: string,
  command: string,
  args: string[],
  extraEnv: Record<string, string> = {},
  evidenceFilename?: string,
): CertItem {
  const startedAt = new Date().toISOString();
  const commandStartedMs = Date.now();

  const evidencePath = prepareEvidenceFile(
    evidenceFilename,
  );

  const commandLabel = [
    command,
    ...args,
  ].join(' ');

  const commandEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...extraEnv,
    CERTIFICATION_MODE: 'true',
    CERTIFICATION_RUN_ID: RUN_ID,
  };

  if (evidencePath) {
    commandEnv.CERTIFICATION_EVIDENCE_FILE =
      evidencePath;
  }

  let stdout = '';
  let stderr = '';
  let exitCode: number | null = null;
  let status: CertStatus;
  let reason: string | undefined;
  let evidence: unknown | undefined;

  try {
    const result = spawnSync(
      command,
      args,
      {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        timeout: 300_000,
        env: commandEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        maxBuffer: 20 * 1024 * 1024,
      },
    );

    stdout = toText(result.stdout);
    stderr = toText(result.stderr);
    exitCode = result.status;

    if (result.error) {
      stderr = [
        stderr,
        result.error.message,
      ].filter(Boolean).join('\n');

      status = 'FAIL';
      reason = `Could not execute command: ${result.error.message}`;
    } else if (result.status === 0) {
      status = 'PASS';
    } else {
      const combinedOutput = `${stdout}\n${stderr}`;

      evidence = readFreshBlockedEvidence(
        evidencePath,
        commandStartedMs,
      );

      if (evidence !== undefined) {
        status = 'BLOCKED';
        reason =
          'The current command generated fresh BLOCKED evidence.';
      } else if (
        hasInfrastructureBlockerMarker(combinedOutput)
      ) {
        status = 'BLOCKED';
        reason =
          'The current command reported a recognized infrastructure blocker.';
      } else {
        status = 'FAIL';
        reason =
          result.signal
            ? `Process terminated by signal ${result.signal}.`
            : `Command exited unsuccessfully with code ${String(result.status)}.`;
      }
    }

    if (
      result.status === null &&
      !result.error
    ) {
      status = 'FAIL';
      reason =
        'The process did not return a usable exit code.';
    }
  } catch (error) {
    status = 'FAIL';

    const message =
      error instanceof Error
        ? error.message
        : String(error);

    stderr = `${stderr}\n${message}`.trim();
    reason = `Unexpected command execution error: ${message}`;
  }

  const completedAt = new Date().toISOString();

  const item: CertItem = {
    id,
    name,
    category,
    status,
    command: commandLabel,
    startedAt,
    completedAt,
    durationMs: Date.now() - commandStartedMs,
    exitCode,
    stdout: truncateOutput(stdout),
    stderr: truncateOutput(stderr),
    evidence,
    evidenceFile: evidencePath
      ? relativeArtifactPath(evidencePath)
      : undefined,
    reason,
  };

  // Save the actual result for this command.
  writeJsonArtifact(
    `tests/${id}.json`,
    item,
  );

  items.push(item);
  return item;
}

/* -------------------------------------------------------------------------- */
/* 6. Internal checks                                                         */
/* -------------------------------------------------------------------------- */

function recordInternalResult(
  id: string,
  name: string,
  category: string,
  status: CertStatus,
  stdout: string,
  stderr = '',
  reason?: string,
): CertItem {
  const now = new Date().toISOString();

  const item: CertItem = {
    id,
    name,
    category,
    status,
    command: 'internal',
    startedAt: now,
    completedAt: now,
    durationMs: 0,
    exitCode:
      status === 'PASS'
        ? 0
        : status === 'FAIL'
          ? 1
          : null,
    stdout,
    stderr,
    reason,
  };

  writeJsonArtifact(
    `tests/${id}.json`,
    item,
  );

  items.push(item);
  return item;
}

/**
 * Register an explicit NOT RUN result if execution is interrupted or a
 * future certification gate is intentionally left unexecuted.
 */
function recordNotRun(
  id: string,
  name: string,
  category: string,
  reason: string,
): CertItem {
  return recordInternalResult(
    id,
    name,
    category,
    'NOT RUN',
    '',
    '',
    reason,
  );
}

/* -------------------------------------------------------------------------- */
/* 7. Run header                                                              */
/* -------------------------------------------------------------------------- */

console.log('================================================');
console.log(`${RELEASE_NAME} — LOCAL CERTIFICATION`);
console.log('================================================');
console.log(`Version:       ${APP_VERSION}`);
console.log(`Package:       ${PKG_VERSION}`);
console.log(`Run ID:        ${RUN_ID}`);
console.log(`Git SHA:       ${GIT_SHA}`);
console.log(`Started:       ${RUN_STARTED_AT}`);
console.log(`Evidence:      ${relativeArtifactPath(RUN_DIR)}`);
console.log('================================================\n');

/* -------------------------------------------------------------------------- */
/* 8. Gate 1 — Version consistency                                             */
/* -------------------------------------------------------------------------- */

console.log('1. Version consistency...');

const versionConsistent =
  PKG_VERSION !== 'UNKNOWN' &&
  (
    PKG_VERSION === APP_VERSION ||
    PKG_VERSION.startsWith(`${APP_VERSION}.`) ||
    APP_VERSION.startsWith(`${PKG_VERSION}.`)
  );

const versionCheck = {
  appVersion: APP_VERSION,
  releaseName: RELEASE_NAME,
  packageJsonVersion: PKG_VERSION,
  consistent: versionConsistent,
  runId: RUN_ID,
  gitSha: GIT_SHA,
  checkedAt: new Date().toISOString(),
};

writeJsonArtifact(
  'version-check.json',
  versionCheck,
);

const versionItem = recordInternalResult(
  'version',
  'Version Consistency',
  'environment',
  versionConsistent ? 'PASS' : 'FAIL',
  JSON.stringify(versionCheck, null, 2),
  versionConsistent
    ? ''
    : 'Application and package versions are inconsistent.',
  versionConsistent
    ? undefined
    : 'Review lib/version and package.json.',
);

printResult(versionItem);

/* -------------------------------------------------------------------------- */
/* 9. Gate 2 — FFmpeg and FFprobe                                              */
/* -------------------------------------------------------------------------- */

console.log('2. FFmpeg + FFprobe validation...');

function checkExecutableVersion(
  executable: string,
  id: string,
): CertItem {
  const startedAt = Date.now();

  const result = spawnSync(
    executable,
    ['-version'],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 5000,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );

  const stdout = toText(result.stdout);
  const stderr = toText(result.stderr);

  if (!result.error && result.status === 0) {
    const firstLine = stdout.split('\n')[0] ?? '';

    return recordInternalResult(
      id,
      executable,
      'dependencies',
      'PASS',
      firstLine,
    );
  }

  const reason = result.error
    ? result.error.message
    : `${executable} exited with code ${String(result.status)}.`;

  return recordInternalResult(
    id,
    executable,
    'dependencies',
    'BLOCKED',
    stdout,
    stderr,
    reason,
  );
}

const ffmpegItem = checkExecutableVersion(
  'ffmpeg',
  'ffmpeg',
);

printResult(ffmpegItem);

const ffprobeItem = checkExecutableVersion(
  'ffprobe',
  'ffprobe',
);

printResult(ffprobeItem);

/* -------------------------------------------------------------------------- */
/* 10. Gate 3 — TypeScript                                                    */
/* -------------------------------------------------------------------------- */

console.log('3. TypeScript typecheck...');

const tsItem = runCommand(
  'typescript',
  'TypeScript',
  'static',
  'bun',
  ['run', 'typecheck'],
);

printResult(tsItem);

/* -------------------------------------------------------------------------- */
/* 11. Gate 4 — ESLint                                                        */
/* -------------------------------------------------------------------------- */

console.log('4. ESLint...');

const lintItem = runCommand(
  'lint',
  'Lint',
  'static',
  'bun',
  ['run', 'lint'],
);

printResult(lintItem);

/* -------------------------------------------------------------------------- */
/* 12. Gate 5 — Unit tests                                                    */
/* -------------------------------------------------------------------------- */

console.log('5. Unit tests...');

const unitItem = runCommand(
  'unit',
  'Unit tests',
  'tests',
  'bun',
  ['run', 'test:unit'],
);

printResult(unitItem);

/* -------------------------------------------------------------------------- */
/* 13. Gate 6 — AIJob concurrency                                             */
/* -------------------------------------------------------------------------- */

console.log('6. AIJob concurrency (requires PostgreSQL)...');

const aijobItem = runCommand(
  'aijob-concurrency',
  'AIJob concurrency',
  'integration',
  'bun',
  ['run', 'test:aijob:concurrency'],
  {},
  'evidence/aijob-concurrency.json',
);

printResult(aijobItem);

/* -------------------------------------------------------------------------- */
/* 14. Gate 7 — Worker crash/recovery                                         */
/* -------------------------------------------------------------------------- */

console.log('7. Worker crash/recovery (requires PostgreSQL + Redis)...');

const crashItem = runCommand(
  'crash-recovery',
  'Worker crash/recovery',
  'integration',
  'bun',
  ['run', 'test:worker:crash-recovery'],
  {},
  'evidence/crash-recovery.json',
);

printResult(crashItem);

/* -------------------------------------------------------------------------- */
/* 15. Gate 8 — Render smoke                                                  */
/* -------------------------------------------------------------------------- */

console.log('8. Render smoke (real FFmpeg)...');

const renderItem = runCommand(
  'render-smoke',
  'Render smoke',
  'render',
  'bun',
  ['run', 'test:render'],
  {},
  'evidence/render-smoke.json',
);

printResult(renderItem);

/* -------------------------------------------------------------------------- */
/* 16. Gate 9 — Chroma key + LUT E2E                                          */
/* -------------------------------------------------------------------------- */

console.log('9. Chroma key + LUT E2E (real FFmpeg)...');

const chromaItem = runCommand(
  'chroma-key-lut',
  'Chroma key + LUT E2E',
  'integration',
  'bun',
  ['test', 'tests/integration/chroma-key-lut.test.ts'],
  {},
  'evidence/chroma-key-lut.json',
);

printResult(chromaItem);

/* -------------------------------------------------------------------------- */
/* 17. Gate 9b — Keyframe render E2E                                          */
/* -------------------------------------------------------------------------- */

console.log('9b. Keyframe Render E2E (real FFmpeg)...');

const keyframeItem = runCommand(
  'keyframe-render',
  'Keyframe Render E2E',
  'integration',
  'bun',
  ['test', 'tests/integration/keyframe-render-e2e.test.ts'],
  {},
  'evidence/keyframe-render.json',
);

printResult(keyframeItem);

/* -------------------------------------------------------------------------- */
/* 18. Gate 10 — Local E2E                                                    */
/* -------------------------------------------------------------------------- */

console.log('10. Local E2E (requires API + worker)...');

const e2eItem = runCommand(
  'local-e2e',
  'Local E2E',
  'e2e',
  'bun',
  ['run', 'test:e2e:local'],
  {},
  'evidence/local-e2e.json',
);

printResult(e2eItem);

/* -------------------------------------------------------------------------- */
/* 19. Gate 11 — Storage E2E                                                  */
/* -------------------------------------------------------------------------- */

console.log('11. S3/R2 storage E2E (requires storage credentials)...');

const storageItem = runCommand(
  'storage-e2e',
  'Storage E2E',
  'e2e',
  'bun',
  ['run', 'test:e2e:storage'],
  {},
  'evidence/storage-e2e.json',
);

printResult(storageItem);

/* -------------------------------------------------------------------------- */
/* 20. Gate 12 — Template E2E                                                 */
/* -------------------------------------------------------------------------- */

console.log('12. Template E2E (requires PostgreSQL)...');

const templateItem = runCommand(
  'template-e2e',
  'Template E2E',
  'e2e',
  'bun',
  ['test', 'tests/templates/template-e2e.test.ts'],
  {},
  'evidence/template-e2e.json',
);

printResult(templateItem);

/* -------------------------------------------------------------------------- */
/* 21. Gate 13 — Feature matrix                                               */
/* -------------------------------------------------------------------------- */

console.log('13. Feature matrix generation...');

try {
  const matrix = getFeatureMatrix();

  const summary = {
    total: matrix.length,
    implemented: matrix.filter(
      (feature) => feature.status === 'IMPLEMENTED',
    ).length,
    partial: matrix.filter(
      (feature) => feature.status === 'PARTIAL',
    ).length,
    comingSoon: matrix.filter(
      (feature) => feature.status === 'COMING_SOON',
    ).length,
    disabled: matrix.filter(
      (feature) => feature.status === 'DISABLED',
    ).length,
  };

  writeJsonArtifact(
    'feature-matrix.json',
    {
      runId: RUN_ID,
      gitSha: GIT_SHA,
      summary,
      features: matrix,
    },
  );

  const featureItem = recordInternalResult(
    'feature-matrix',
    'Feature Matrix',
    'report',
    'PASS',
    JSON.stringify(summary, null, 2),
  );

  printResult(featureItem);
} catch (error) {
  const message =
    error instanceof Error
      ? error.stack ?? error.message
      : String(error);

  const featureItem = recordInternalResult(
    'feature-matrix',
    'Feature Matrix',
    'report',
    'FAIL',
    '',
    message,
    'Feature matrix generation failed.',
  );

  printResult(featureItem);
}

/* -------------------------------------------------------------------------- */
/* 22. Certification summary                                                  */
/* -------------------------------------------------------------------------- */

const RUN_COMPLETED_AT = new Date().toISOString();
const RUN_DURATION_MS = Date.now() - RUN_STARTED_MS;

const counts: Record<CertStatus, number> = {
  PASS: 0,
  FAIL: 0,
  BLOCKED: 0,
  'NOT RUN': 0,
};

for (const item of items) {
  counts[item.status] += 1;
}

/*
 * FAIL takes precedence over BLOCKED.
 * BLOCKED or NOT RUN means certification is incomplete.
 */
let finalStatus: CertStatus = 'PASS';

if (counts.FAIL > 0) {
  finalStatus = 'FAIL';
} else if (
  counts.BLOCKED > 0 ||
  counts['NOT RUN'] > 0
) {
  finalStatus = 'BLOCKED';
}

const summary: CertificationSummary = {
  version: APP_VERSION,
  packageVersion: PKG_VERSION,
  releaseName: RELEASE_NAME,
  status: finalStatus,
  runId: RUN_ID,
  gitSha: GIT_SHA,
  startedAt: RUN_STARTED_AT,
  completedAt: RUN_COMPLETED_AT,
  durationMs: RUN_DURATION_MS,
  artifactDirectory: relativeArtifactPath(RUN_DIR),
  counts,
  items: items.map((item) => ({
    id: item.id,
    name: item.name,
    category: item.category,
    status: item.status,
    exitCode: item.exitCode,
    durationMs: item.durationMs,
    evidenceFile: item.evidenceFile,
    reason: item.reason,
  })),
};

writeJsonArtifact(
  'certification-summary.json',
  summary,
);

writeJsonArtifact(
  'certification-details.json',
  {
    ...summary,
    items,
  },
);

/* -------------------------------------------------------------------------- */
/* 23. Human-readable report                                                  */
/* -------------------------------------------------------------------------- */

const reportLines = [
  `# ${RELEASE_NAME} — Local Certification`,
  '',
  `- Version: ${APP_VERSION}`,
  `- Package version: ${PKG_VERSION}`,
  `- Run ID: ${RUN_ID}`,
  `- Git SHA: ${GIT_SHA}`,
  `- Started: ${RUN_STARTED_AT}`,
  `- Completed: ${RUN_COMPLETED_AT}`,
  `- Duration: ${RUN_DURATION_MS} ms`,
  `- Final status: **${finalStatus}**`,
  '',
  '## Summary',
  '',
  `- PASS: ${counts.PASS}`,
  `- FAIL: ${counts.FAIL}`,
  `- BLOCKED: ${counts.BLOCKED}`,
  `- NOT RUN: ${counts['NOT RUN']}`,
  '',
  '## Test results',
  '',
  '| ID | Check | Category | Status | Exit code | Duration (ms) |',
  '|---|---|---|---|---:|---:|',
  ...items.map((item) =>
    `| ${item.id} | ${item.name.replace(/\|/g, '\\|')} | ${item.category} | ${item.status} | ${item.exitCode ?? 'N/A'} | ${item.durationMs} |`,
  ),
  '',
  '## Details',
  '',
  ...items.flatMap((item) => [
    `### ${item.name} — ${item.status}`,
    '',
    `- ID: ${item.id}`,
    `- Category: ${item.category}`,
    `- Command: \`${item.command}\``,
    `- Started: ${item.startedAt}`,
    `- Completed: ${item.completedAt}`,
    `- Exit code: ${item.exitCode ?? 'N/A'}`,
    ...(item.evidenceFile
      ? [`- Evidence: \`${item.evidenceFile}\``]
      : []),
    ...(item.reason
      ? [`- Reason: ${item.reason}`]
      : []),
    '',
    ...(item.stdout
      ? ['**stdout:**', '', '```text', item.stdout, '```', '']
      : []),
    ...(item.stderr
      ? ['**stderr:**', '', '```text', item.stderr, '```', '']
      : []),
  ]),
  '',
  '## Important limitation',
  '',
  'This report reflects only the checks executed by this local certification run.',
  'It does not prove that Netlify, Render, production PostgreSQL, production Redis,',
  'production object storage, or deployed video-processing workflows are healthy.',
  'Those require separate verification against the actual deployed services.',
  '',
];

writeTextArtifact(
  'certification-report.md',
  reportLines.join('\n'),
);

/* -------------------------------------------------------------------------- */
/* 24. Final console output                                                   */
/* -------------------------------------------------------------------------- */

console.log('================================================');
console.log(`${RELEASE_NAME} — CERTIFICATION SUMMARY`);
console.log('================================================');
console.log(`Version:     ${APP_VERSION}`);
console.log(`Run ID:      ${RUN_ID}`);
console.log(`Git SHA:     ${GIT_SHA}`);
console.log(`Duration:    ${RUN_DURATION_MS} ms`);
console.log('------------------------------------------------');

for (const item of items) {
  console.log(
    `${item.status.padEnd(8)} ${item.name}` +
      (item.exitCode === null
        ? ''
        : ` (exit ${item.exitCode})`),
  );
}

console.log('------------------------------------------------');
console.log(`PASS:       ${counts.PASS}`);
console.log(`FAIL:       ${counts.FAIL}`);
console.log(`BLOCKED:    ${counts.BLOCKED}`);
console.log(`NOT RUN:    ${counts['NOT RUN']}`);
console.log('------------------------------------------------');
console.log(`FINAL RESULT: ${finalStatus}`);
console.log(`Report: ${relativeArtifactPath(path.join(RUN_DIR, 'certification-report.md'))}`);
console.log(`Summary: ${relativeArtifactPath(SUMMARY_PATH)}`);
console.log('================================================');

/* -------------------------------------------------------------------------- */
/* 25. Exit status                                                            */
/* -------------------------------------------------------------------------- */

if (finalStatus === 'PASS') {
  process.exit(0);
}

if (finalStatus === 'FAIL') {
  process.exit(1);
}

process.exit(2);
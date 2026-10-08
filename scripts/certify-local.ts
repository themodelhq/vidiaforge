#!/usr/bin/env bun
// VidiaForge V19.1 — Local Certification Script
//
// V19.1 §5-9 + §48-50: Final certification with HONEST semantics:
//   PASS = exit 0    (test ran + succeeded)
//   FAIL = exit 1    (test ran + failed — production bug)
//   BLOCKED = exit 2 (mandatory dependency unavailable — cannot certify)
//
// V19.1 RULE 1 — NO FAKE PASS:
//   TypeScript failures are FAIL (never soft-passed to PASS).
//   Lint failures are FAIL.
//   Build failures are FAIL.
//
// V19.1 RULE 2 — NO SILENT SKIPS:
//   Missing PostgreSQL/Redis/S3/FFmpeg → BLOCKED (not PASS).
//
// Gates (V19.1 §49):
//   1.  Environment validation (version consistency)
//   2.  FFmpeg + FFprobe availability
//   3.  TypeScript typecheck (HARD — no soft pass)
//   4.  ESLint (HARD gate)
//   5.  Unit tests (incl. keyframes + trim + text-editing + color scopes)
//   6.  AIJob concurrency (requires PostgreSQL → BLOCKED if unavailable)
//   7.  Worker crash/recovery (requires PostgreSQL + Redis → BLOCKED)
//   8.  Render smoke (real FFmpeg)
//   9.  Chroma key + LUT E2E (real FFmpeg)
//   10. Local E2E (requires API + worker → BLOCKED)
//   11. S3/R2 storage E2E (requires S3 creds → BLOCKED)
//   12. Template E2E (requires PostgreSQL → BLOCKED)
//   13. Feature matrix generation

import { execFileSync } from 'child_process';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { APP_VERSION, RELEASE_NAME, certificationRunId, getGitSha } from '../src/lib/version';
import { getFeatureMatrix } from '../src/lib/feature-registry';

// V19.1 §3: Read package.json version (avoid require() for lint compliance)
const pkgJson = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));
const PKG_VERSION = pkgJson.version;

process.env.CERTIFICATION_MODE = 'true';

// V19.1 §6: Certification result model
interface CertItem {
  id: string;
  name: string;
  category: string;
  status: 'PASS' | 'FAIL' | 'BLOCKED';
  command: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  stdout: string;
  stderr: string;
  evidence?: string;
  evidenceFile?: string;
}

const items: CertItem[] = [];

function runCommand(
  id: string,
  name: string,
  category: string,
  cmd: string,
  args: string[],
  env?: Record<string, string>,
  evidenceFile?: string,
): CertItem {
  const startedAt = new Date().toISOString();
  const start = Date.now();
  try {
    const stdout = execFileSync(cmd, args, {
      encoding: 'utf-8',
      timeout: 300_000,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const completedAt = new Date().toISOString();
    const durationMs = Date.now() - start;
    return {
      id, name, category, status: 'PASS',
      command: `${cmd} ${args.join(' ')}`,
      startedAt, completedAt, durationMs,
      stdout: stdout.slice(-1000), stderr: '',
      evidenceFile,
    };
  } catch (err: any) {
    const completedAt = new Date().toISOString();
    const durationMs = Date.now() - start;
    const output = (err.stdout || '') + (err.stderr || '');

    // V19.1 §48: Check evidence JSON to distinguish BLOCKED from FAIL.
    // A test that wrote BLOCKED evidence was unable to run due to missing infra.
    if (evidenceFile && existsSync(evidenceFile)) {
      try {
        const evidence = JSON.parse(readFileSync(evidenceFile, 'utf-8'));
        if (evidence.status === 'BLOCKED') {
          return {
            id, name, category, status: 'BLOCKED',
            command: `${cmd} ${args.join(' ')}`,
            startedAt, completedAt, durationMs,
            stdout: (err.stdout || '').slice(-500),
            stderr: output.slice(-500),
            evidence: JSON.stringify(evidence),
            evidenceFile,
          };
        }
      } catch { /* evidence file unreadable — fall through */ }
    }

    // V19.1 RULE 2: missing infra markers → BLOCKED
    if (output.includes('CertificationBlockedError') ||
        output.includes('CERTIFICATION BLOCKED') ||
        output.includes('SKIP: PostgreSQL unavailable') ||
        output.includes('SKIP: Redis unavailable')) {
      return {
        id, name, category, status: 'BLOCKED',
        command: `${cmd} ${args.join(' ')}`,
        startedAt, completedAt, durationMs,
        stdout: (err.stdout || '').slice(-500),
        stderr: output.slice(-500),
        evidenceFile,
      };
    }

    // V19.1 RULE 1: actual failure → FAIL (never soft-pass)
    return {
      id, name, category, status: 'FAIL',
      command: `${cmd} ${args.join(' ')}`,
      startedAt, completedAt, durationMs,
      stdout: (err.stdout || '').slice(-500),
      stderr: output.slice(-500),
      evidenceFile,
    };
  }
}

function writeArtifact(filename: string, data: unknown): void {
  mkdirSync('artifacts/certification/v19.1', { recursive: true });
  writeFileSync(`artifacts/certification/v19.1/${filename}`, JSON.stringify(data, null, 2));
}

const RUN_ID = certificationRunId();
const GIT_SHA = getGitSha();

console.log('========================================');
console.log(`${RELEASE_NAME} — LOCAL CERTIFICATION`);
console.log('========================================');
console.log(`Version: ${APP_VERSION}`);
console.log(`Run ID:  ${RUN_ID}`);
console.log(`Git SHA: ${GIT_SHA}`);
console.log(`Time:    ${new Date().toISOString()}`);
console.log('========================================\n');

// V19.1 §3: Version consistency check
console.log('1. Version consistency...');
const versionCheck = {
  appVersion: APP_VERSION,
  releaseName: RELEASE_NAME,
  packageJsonVersion: PKG_VERSION,
  consistent: true,
};
try {
  if (!PKG_VERSION.startsWith(APP_VERSION)) {
    versionCheck.consistent = false;
  }
} catch { /* */ }
writeArtifact('version-check.json', versionCheck);
items.push({
  id: 'version',
  name: 'Version Consistency',
  category: 'environment',
  status: versionCheck.consistent ? 'PASS' : 'FAIL',
  command: 'internal',
  startedAt: new Date().toISOString(),
  completedAt: new Date().toISOString(),
  durationMs: 0,
  stdout: JSON.stringify(versionCheck), stderr: '',
});
console.log(`   ${versionCheck.consistent ? 'PASS' : 'FAIL'}: ${JSON.stringify(versionCheck)}\n`);

// 2. FFmpeg + FFprobe
console.log('2. FFmpeg + FFprobe validation...');
try {
  const ffmpegVer = execFileSync('ffmpeg', ['-version'], { encoding: 'utf-8', timeout: 5_000 }).split('\n')[0];
  const ffprobeVer = execFileSync('ffprobe', ['-version'], { encoding: 'utf-8', timeout: 5_000 }).split('\n')[0];
  const ffmpegItem: CertItem = {
    id: 'ffmpeg', name: 'FFmpeg', category: 'dependencies',
    status: 'PASS', command: 'ffmpeg -version',
    startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), durationMs: 0,
    stdout: ffmpegVer, stderr: '',
  };
  const ffprobeItem: CertItem = {
    id: 'ffprobe', name: 'FFprobe', category: 'dependencies',
    status: 'PASS', command: 'ffprobe -version',
    startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), durationMs: 0,
    stdout: ffprobeVer, stderr: '',
  };
  items.push(ffmpegItem, ffprobeItem);
  console.log(`   PASS: ${ffmpegVer}`);
  console.log(`   PASS: ${ffprobeVer}\n`);
} catch {
  items.push({
    id: 'ffmpeg', name: 'FFmpeg', category: 'dependencies',
    status: 'BLOCKED', command: 'ffmpeg -version',
    startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), durationMs: 0,
    stdout: '', stderr: 'FFmpeg not found',
  });
  items.push({
    id: 'ffprobe', name: 'FFprobe', category: 'dependencies',
    status: 'BLOCKED', command: 'ffprobe -version',
    startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), durationMs: 0,
    stdout: '', stderr: 'FFprobe not found',
  });
  console.log('   BLOCKED: FFmpeg/FFprobe not available\n');
}

// 3. TypeScript (V19.1 RULE 1 — NO SOFT PASS)
console.log('3. TypeScript typecheck (HARD gate — no soft pass)...');
const tsItem = runCommand('typescript', 'TypeScript', 'static', 'bun', ['run', 'typecheck']);
items.push(tsItem);
console.log(`   ${tsItem.status}: ${tsItem.stderr.slice(0, 100) || tsItem.stdout.slice(0, 100)}\n`);

// 4. ESLint (HARD gate)
console.log('4. ESLint (HARD gate)...');
const lintItem = runCommand('lint', 'Lint', 'static', 'bun', ['run', 'lint']);
items.push(lintItem);
console.log(`   ${lintItem.status}: ${lintItem.stderr.slice(0, 100) || lintItem.stdout.slice(0, 100)}\n`);

// 5. Unit tests
console.log('5. Unit tests...');
const unitItem = runCommand('unit', 'Unit tests', 'tests', 'bun', ['run', 'test:unit']);
items.push(unitItem);
console.log(`   ${unitItem.status}: ${unitItem.stdout.slice(-100)}\n`);

// 6. AIJob concurrency (requires PostgreSQL)
console.log('6. AIJob concurrency (requires PostgreSQL)...');
const aijobItem = runCommand(
  'aijob-concurrency', 'AIJob concurrency', 'integration',
  'bun', ['run', 'test:aijob:concurrency'],
  { CERTIFICATION_MODE: 'true' },
  'artifacts/certification/v19.1/aijob-concurrency.json',
);
items.push(aijobItem);
console.log(`   ${aijobItem.status}: ${aijobItem.stdout.slice(-100)}\n`);

// 7. Worker crash/recovery (requires PostgreSQL + Redis)
console.log('7. Worker crash/recovery (requires PostgreSQL + Redis)...');
const crashItem = runCommand(
  'crash-recovery', 'Worker crash/recovery', 'integration',
  'bun', ['run', 'test:worker:crash-recovery'],
  { CERTIFICATION_MODE: 'true' },
  'artifacts/certification/v19.1/crash-recovery.json',
);
items.push(crashItem);
console.log(`   ${crashItem.status}: ${crashItem.stdout.slice(-100)}\n`);

// 8. Render smoke (real FFmpeg)
console.log('8. Render smoke (real FFmpeg)...');
const renderItem = runCommand(
  'render-smoke', 'Render smoke', 'render',
  'bun', ['run', 'test:render'],
  { CERTIFICATION_MODE: 'true' },
  'artifacts/certification/v19.1/render-smoke.json',
);
items.push(renderItem);
console.log(`   ${renderItem.status}: ${renderItem.stdout.slice(-100)}\n`);

// 9. Chroma key + LUT E2E (real FFmpeg)
console.log('9. Chroma key + LUT E2E (real FFmpeg)...');
const chromaItem = runCommand(
  'chroma-key-lut', 'Chroma key + LUT E2E', 'integration',
  'bun', ['test', 'tests/integration/chroma-key-lut.test.ts'],
  { CERTIFICATION_MODE: 'true' },
  'artifacts/certification/v19.1/chroma-key-lut.json',
);
items.push(chromaItem);
console.log(`   ${chromaItem.status}: ${chromaItem.stdout.slice(-100)}\n`);

// 9b. V19.1 NEW: Keyframe Render E2E (real FFmpeg)
console.log('9b. Keyframe Render E2E (real FFmpeg)...');
const keyframeItem = runCommand(
  'keyframe-render', 'Keyframe Render E2E', 'integration',
  'bun', ['test', 'tests/integration/keyframe-render-e2e.test.ts'],
  { CERTIFICATION_MODE: 'true' },
  'artifacts/certification/v19.1/keyframe-render.json',
);
items.push(keyframeItem);
console.log(`   ${keyframeItem.status}: ${keyframeItem.stdout.slice(-100)}\n`);

// 10. Local E2E (requires API + worker)
console.log('10. Local E2E (requires API + worker)...');
const e2eItem = runCommand(
  'local-e2e', 'Local E2E', 'e2e',
  'bun', ['run', 'test:e2e:local'],
  { CERTIFICATION_MODE: 'true' },
  'artifacts/certification/v19.1/local-e2e.json',
);
items.push(e2eItem);
console.log(`   ${e2eItem.status}: ${e2eItem.stdout.slice(-100)}\n`);

// 11. S3/R2 storage E2E (requires S3 creds)
console.log('11. S3/R2 storage E2E (requires S3 credentials)...');
const storageItem = runCommand(
  'storage-e2e', 'Storage E2E', 'e2e',
  'bun', ['run', 'test:e2e:storage'],
  { CERTIFICATION_MODE: 'true' },
  'artifacts/certification/v19.1/storage-e2e.json',
);
items.push(storageItem);
console.log(`   ${storageItem.status}: ${storageItem.stdout.slice(-100)}\n`);

// 12. Template E2E (requires PostgreSQL)
console.log('12. Template E2E (requires PostgreSQL)...');
const templateItem = runCommand(
  'template-e2e', 'Template E2E', 'e2e',
  'bun', ['test', 'tests/templates/template-e2e.test.ts'],
  { CERTIFICATION_MODE: 'true' },
  'artifacts/certification/v19.1/template-e2e.json',
);
items.push(templateItem);
console.log(`   ${templateItem.status}: ${templateItem.stdout.slice(-100)}\n`);

// 13. Feature matrix
console.log('13. Feature matrix generation...');
try {
  const matrix = getFeatureMatrix();
  const summary = {
    total: matrix.length,
    implemented: matrix.filter((f) => f.status === 'IMPLEMENTED').length,
    partial: matrix.filter((f) => f.status === 'PARTIAL').length,
    comingSoon: matrix.filter((f) => f.status === 'COMING_SOON').length,
    disabled: matrix.filter((f) => f.status === 'DISABLED').length,
  };
  writeArtifact('feature-matrix.json', { summary, features: matrix });
  items.push({
    id: 'feature-matrix', name: 'Feature Matrix', category: 'report',
    status: 'PASS', command: 'internal',
    startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), durationMs: 0,
    stdout: JSON.stringify(summary), stderr: '',
  });
  console.log(`   PASS: ${JSON.stringify(summary)}\n`);
} catch (err) {
  items.push({
    id: 'feature-matrix', name: 'Feature Matrix', category: 'report',
    status: 'FAIL', command: 'internal',
    startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), durationMs: 0,
    stdout: '', stderr: String(err),
  });
  console.log(`   FAIL: ${err}\n`);
}

// === Final summary ===
const hasFail = items.some((i) => i.status === 'FAIL');
const hasBlocked = items.some((i) => i.status === 'BLOCKED');
const finalStatus: 'PASS' | 'FAIL' | 'BLOCKED' = hasFail ? 'FAIL' : hasBlocked ? 'BLOCKED' : 'PASS';

const summary = {
  version: APP_VERSION,
  releaseName: RELEASE_NAME,
  status: finalStatus,
  runId: RUN_ID,
  gitSha: GIT_SHA,
  timestamp: new Date().toISOString(),
  items: items.map((i) => ({ id: i.id, name: i.name, status: i.status, durationMs: i.durationMs })),
};

writeArtifact('certification-summary.json', summary);

console.log('========================================');
console.log(`${RELEASE_NAME} — CERTIFICATION SUMMARY`);
console.log('========================================');
console.log(`Version: ${APP_VERSION}`);
console.log(`Run ID:  ${RUN_ID}`);
console.log(`Git SHA: ${GIT_SHA}`);
console.log('========================================');
for (const item of items) {
  const pad = item.name.padEnd(28);
  const statusIcon = item.status === 'PASS' ? '✓ PASS' : item.status === 'BLOCKED' ? '⚠ BLOCKED' : '✗ FAIL';
  console.log(`${pad} ${statusIcon}`);
}
console.log('========================================');
console.log(`FINAL RESULT: ${finalStatus}`);
console.log('========================================');

const exitCode = finalStatus === 'PASS' ? 0 : finalStatus === 'BLOCKED' ? 2 : 1;
process.exit(exitCode);

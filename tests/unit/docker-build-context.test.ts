// VidiaForge V19.1 v8.1 — Docker build context integrity test
//
// V19.1 v8.1 — ROOT CAUSE FIX for the Render deployment build failure.
//
// The V8 archive had NO `.dockerignore`. The Dockerfile's `COPY . .` (line 63
// in the build stage) copies the ENTIRE build context into `/app`. Without a
// `.dockerignore`, a stale `node_modules/` or `.next/` in the build context
// would OVERWRITE the carefully-resolved deps from the deps stage, causing
// `Module not found: Can't resolve '@/lib/db'` errors during `next build`.
//
// This test verifies:
//   1. `.dockerignore` exists at the repo root.
//   2. `.dockerignore` excludes `node_modules` (the primary root cause).
//   3. `.dockerignore` excludes `.next` (stale build cache).
//   4. `.dockerignore` excludes `.git` (unnecessary in image).
//   5. `.dockerignore` excludes `.env` files (secrets).
//   6. `.dockerignore` does NOT exclude required source directories.
//   7. `.gitignore` exists at the repo root.
//   8. `.gitignore` excludes `node_modules/` + `.next/`.
//   9. All required application source files exist (the modules that were
//      reported as "missing" in the Render build log all exist in the
//      archive — this test verifies they remain present).
//  10. The TypeScript alias `@/*` maps to `./src/*` in tsconfig.json.

import { test, expect, describe } from 'bun:test';
import { existsSync, readFileSync, statSync } from 'fs';
import path from 'path';

const REPO_ROOT = process.cwd();

function readFile(relPath: string): string {
  return readFileSync(path.join(REPO_ROOT, relPath), 'utf-8');
}

function fileExists(relPath: string): boolean {
  return existsSync(path.join(REPO_ROOT, relPath));
}

describe('V19.1 v8.1 — Docker build context integrity (.dockerignore)', () => {
  test('CHECK 1: .dockerignore exists at the repo root', () => {
    expect(fileExists('.dockerignore')).toBe(true);
  });

  test('CHECK 2: .dockerignore excludes node_modules (primary root cause)', () => {
    const content = readFile('.dockerignore');
    // The .dockerignore must have a line that excludes node_modules.
    // It could be `node_modules` or `node_modules/` — both are valid.
    expect(content).toMatch(/^node_modules\/?$/m);
  });

  test('CHECK 3: .dockerignore excludes .next (stale build cache)', () => {
    const content = readFile('.dockerignore');
    expect(content).toMatch(/^\.next\/?$/m);
  });

  test('CHECK 4: .dockerignore excludes .git (unnecessary in image)', () => {
    const content = readFile('.dockerignore');
    expect(content).toMatch(/^\.git\/?$/m);
  });

  test('CHECK 5: .dockerignore excludes .env files (secrets)', () => {
    const content = readFile('.dockerignore');
    expect(content).toMatch(/^\.env$/m);
    expect(content).toMatch(/^\.env\.\*/m);
  });

  test('CHECK 6: .dockerignore does NOT exclude required source directories', () => {
    const content = readFile('.dockerignore');
    // These directories MUST NOT be excluded — they contain required source.
    // Check that none of them appear as exclusion patterns.
    const requiredDirs = ['src', 'mini-services', 'prisma', 'public', 'scripts', 'tests'];
    for (const dir of requiredDirs) {
      // The directory should NOT appear as an exclusion (a line starting
      // with the dir name, possibly with a trailing slash). Comments
      // (starting with #) are OK.
      const lines = content.split('\n');
      const exclusionLines = lines.filter(
        (l) => l.trim() && !l.trim().startsWith('#'),
      );
      for (const line of exclusionLines) {
        const pattern = line.trim();
        // An exclusion like `src` or `src/` would exclude the whole dir.
        // An exclusion like `src/foo` would only exclude a subpath (OK).
        if (pattern === dir || pattern === `${dir}/`) {
          throw new Error(
            `.dockerignore excludes required source directory "${dir}" (line: "${line}") — this would cause module-resolution failures`,
          );
        }
      }
    }
  });

  test('CHECK 7: .dockerignore does NOT exclude required config files', () => {
    const content = readFile('.dockerignore');
    const requiredFiles = [
      'package.json',
      'bun.lock',
      'tsconfig.json',
      'next.config.ts',
      'Dockerfile',
      'worker.Dockerfile',
      'render.yaml',
      'netlify.toml',
      '.node-version',
      '.bun-version',
    ];
    const lines = content.split('\n');
    const exclusionLines = lines.filter(
      (l) => l.trim() && !l.trim().startsWith('#'),
    );
    for (const file of requiredFiles) {
      for (const line of exclusionLines) {
        if (line.trim() === file) {
          throw new Error(
            `.dockerignore excludes required config file "${file}" (line: "${line}")`,
          );
        }
      }
    }
  });
});

describe('V19.1 v8.1 — Git repository integrity (.gitignore)', () => {
  test('CHECK 8: .gitignore exists at the repo root', () => {
    expect(fileExists('.gitignore')).toBe(true);
  });

  test('CHECK 9: .gitignore excludes node_modules/', () => {
    const content = readFile('.gitignore');
    expect(content).toMatch(/^node_modules\/?$/m);
  });

  test('CHECK 10: .gitignore excludes .next/', () => {
    const content = readFile('.gitignore');
    expect(content).toMatch(/^\.next\/?$/m);
  });

  test('CHECK 11: .gitignore does NOT exclude bun.lock (MUST be committed)', () => {
    const content = readFile('.gitignore');
    const lines = content.split('\n');
    const exclusionLines = lines.filter(
      (l) => l.trim() && !l.trim().startsWith('#'),
    );
    for (const line of exclusionLines) {
      if (line.trim() === 'bun.lock' || line.trim() === 'bun.lock*') {
        throw new Error(
          `.gitignore excludes bun.lock (line: "${line}") — the lockfile MUST be committed`,
        );
      }
    }
  });
});

describe('V19.1 v8.1 — Required application source files exist', () => {
  // These are the modules that were reported as "missing" in the Render
  // build log. They all exist in the V8 archive — this test verifies they
  // remain present in V8.1 (the .dockerignore + .gitignore must NOT
  // exclude them).

  const requiredModules = [
    'src/lib/db.ts',
    'src/lib/env-validation.ts',
    'src/lib/errors/codes.ts',
    'src/lib/get-client-ip.ts',
    'src/lib/queue.ts',
    'src/lib/queue-names.ts',
    'src/lib/rate-limit.ts',
    'src/lib/render/render-identity.ts',
    'src/lib/render/timeline-hash.ts',
    'src/lib/timeline.ts',
    'src/stores/auth-store.ts',
    'src/stores/ui-store.ts',
    'src/lib/storage/index.ts',
    'src/lib/templates/index.ts',
    'src/lib/templates/builtin-templates.ts',
  ];

  test('CHECK 12: all modules reported as "missing" in the Render build log exist', () => {
    for (const mod of requiredModules) {
      expect(
        fileExists(mod),
        `Required module "${mod}" is missing — this would cause the Render build failure`,
      ).toBe(true);
    }
  });

  test('CHECK 13: each required module has a non-trivial implementation (> 5 lines)', () => {
    // Verify these are real implementations, not empty stubs.
    for (const mod of requiredModules) {
      const content = readFile(mod);
      const lineCount = content.split('\n').length;
      expect(
        lineCount,
        `${mod} has only ${lineCount} lines — expected a real implementation`,
      ).toBeGreaterThan(5);
    }
  });
});

describe('V19.1 v8.1 — TypeScript alias resolution', () => {
  test('CHECK 14: tsconfig.json maps @/* to ./src/*', () => {
    const tsconfig = JSON.parse(readFile('tsconfig.json'));
    expect(tsconfig.compilerOptions).toBeDefined();
    expect(tsconfig.compilerOptions.paths).toBeDefined();
    expect(tsconfig.compilerOptions.paths['@/*']).toBeDefined();
    expect(Array.isArray(tsconfig.compilerOptions.paths['@/*'])).toBe(true);
    expect(tsconfig.compilerOptions.paths['@/*']).toContain('./src/*');
  });

  test('CHECK 15: src/ directory exists at the repo root', () => {
    const srcStat = statSync(path.join(REPO_ROOT, 'src'));
    expect(srcStat.isDirectory()).toBe(true);
  });
});

describe('V19.1 v8.1 — Dockerfile build context verification', () => {
  test('CHECK 16: Dockerfile uses COPY . . (which requires .dockerignore to filter)', () => {
    const dockerfile = readFile('Dockerfile');
    // The Dockerfile's build stage must have `COPY . .` to copy source.
    expect(dockerfile).toMatch(/^COPY \. \.$/m);
  });

  test('CHECK 17: Dockerfile deps stage copies node_modules from deps stage', () => {
    const dockerfile = readFile('Dockerfile');
    // The build stage must copy the resolved node_modules from the deps stage.
    expect(dockerfile).toMatch(/COPY --from=deps \/app\/node_modules \.\/node_modules/);
  });

  test('CHECK 18: Dockerfile uses oven/bun:1.3.14-alpine (pinned in v7)', () => {
    const dockerfile = readFile('Dockerfile');
    expect(dockerfile).toMatch(/FROM oven\/bun:1\.3\.14-alpine/);
  });
});

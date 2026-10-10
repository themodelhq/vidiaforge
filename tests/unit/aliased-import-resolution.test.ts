
/**
 * VidiaForge V8.7 — Authoritative aliased-import resolution tests.
 *
 * PURPOSE
 * -------
 * Every discovered @/... import is resolved using TypeScript's actual
 * module-resolution API and the project's parsed tsconfig.json.
 *
 * This test deliberately does NOT implement its own path resolver.
 *
 * Coverage:
 * - Reads the actual tsconfig.json, including inherited configuration.
 * - Scans source files for static imports, re-exports, dynamic imports,
 *   and require() calls.
 * - Uses ts.resolveModuleName for every discovered aliased import.
 * - Reports the source file and exact import path for every failure.
 * - Verifies the known Render build-failure paths.
 * - Checks that representative alias categories resolve correctly.
 * - Includes a negative test for a nonexistent module.
 *
 * Run:
 *   bun test tests/unit/aliased-import-resolution.test.ts
 */

import { describe, expect, test } from 'bun:test';
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import * as ts from 'typescript';

const REPO_ROOT = process.cwd();
const TSCONFIG_PATH = path.join(REPO_ROOT, 'tsconfig.json');

/* -------------------------------------------------------------------------- */
/* 1. Load the actual TypeScript configuration                                */
/* -------------------------------------------------------------------------- */

if (!existsSync(TSCONFIG_PATH)) {
  throw new Error(
    `Cannot run alias tests: tsconfig.json was not found at ${TSCONFIG_PATH}`,
  );
}

const configReadResult = ts.readConfigFile(
  TSCONFIG_PATH,
  ts.sys.readFile,
);

if (configReadResult.error) {
  throw new Error(
    `Could not read tsconfig.json:\n${ts.flattenDiagnosticMessageText(
      configReadResult.error.messageText,
      '\n',
    )}`,
  );
}

const parsedConfig = ts.parseJsonConfigFileContent(
  configReadResult.config,
  ts.sys,
  path.dirname(TSCONFIG_PATH),
  undefined,
  TSCONFIG_PATH,
);

if (parsedConfig.errors.length > 0) {
  const diagnostics = parsedConfig.errors
    .map((diagnostic) =>
      ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
    )
    .join('\n');

  throw new Error(
    `TypeScript configuration contains errors:\n${diagnostics}`,
  );
}

const compilerOptions = parsedConfig.options;

if (
  !compilerOptions.paths ||
  Object.keys(compilerOptions.paths).length === 0
) {
  throw new Error(
    'tsconfig.json does not define compilerOptions.paths; ' +
      'cannot validate the project aliases.',
  );
}

/*
 * Use TypeScript's system host for module resolution. This respects the
 * filesystem, configured extensions, directory entry points, package
 * metadata, and the parsed compiler options.
 *
 * Do not substitute custom file-existence checks for this resolver.
 */
const moduleResolutionHost: ts.ModuleResolutionHost = {
  fileExists: ts.sys.fileExists,
  readFile: ts.sys.readFile,
  directoryExists: ts.sys.directoryExists,
  getCurrentDirectory: ts.sys.getCurrentDirectory,
  getDirectories: ts.sys.getDirectories,
  realpath: ts.sys.realpath,
  useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
};

interface ResolvedImport {
  sourceFile: string;
  importPath: string;
  resolved: boolean;
  resolvedFileName?: string;
  extension?: ts.Extension;
  resolutionFailure?: string;
}

/* -------------------------------------------------------------------------- */
/* 2. Resolve an import using the actual TypeScript module resolver            */
/* -------------------------------------------------------------------------- */

function resolveWithTypeScript(
  importPath: string,
  containingFile: string,
): ResolvedImport {
  const absoluteContainingFile = path.resolve(containingFile);

  const result = ts.resolveModuleName(
    importPath,
    absoluteContainingFile,
    compilerOptions,
    moduleResolutionHost,
  );

  const resolvedModule = result.resolvedModule;

  return {
    sourceFile: path.relative(REPO_ROOT, absoluteContainingFile),
    importPath,
    resolved: resolvedModule !== undefined,
    resolvedFileName: resolvedModule?.resolvedFileName,
    extension: resolvedModule?.extension,
    resolutionFailure: result.failedLookupLocations?.length
      ? result.failedLookupLocations.slice(0, 5).join('\n')
      : undefined,
  };
}

/* -------------------------------------------------------------------------- */
/* 3. Discover source files                                                   */
/* -------------------------------------------------------------------------- */

const SOURCE_DIRECTORIES = [
  path.join(REPO_ROOT, 'src'),
  path.join(REPO_ROOT, 'lib'),
  path.join(REPO_ROOT, 'stores'),
  path.join(REPO_ROOT, 'mini-services', 'worker', 'src'),
];

const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
]);

function listSourceFiles(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }

  let directoryStat;

  try {
    directoryStat = statSync(directory);
  } catch {
    return [];
  }

  if (!directoryStat.isDirectory()) {
    return [];
  }

  const results: string[] = [];

  for (const entry of readdirSync(directory, {
    withFileTypes: true,
  })) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      /*
       * Avoid generated output and installed dependencies.
       * Do not skip application source directories.
       */
      if (
        entry.name === 'node_modules' ||
        entry.name === '.next' ||
        entry.name === 'dist' ||
        entry.name === 'build' ||
        entry.name === 'coverage'
      ) {
        continue;
      }

      results.push(...listSourceFiles(fullPath));
      continue;
    }

    if (
      entry.isFile() &&
      SOURCE_EXTENSIONS.has(path.extname(entry.name))
    ) {
      results.push(fullPath);
    }
  }

  return results;
}

/* -------------------------------------------------------------------------- */
/* 4. Extract imports using the TypeScript AST                                 */
/* -------------------------------------------------------------------------- */

/**
 * The AST captures import syntax without depending on fragile regular
 * expressions. It covers:
 *
 *   import x from '@/module'
 *   import type { X } from '@/module'
 *   export { x } from '@/module'
 *   export * from '@/module'
 *   import('@/module')
 *   require('@/module')
 */
function extractAliasedImports(sourceFilePath: string): string[] {
  const sourceText = readFileSync(sourceFilePath, 'utf8');

  const sourceFile = ts.createSourceFile(
    sourceFilePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    sourceFilePath.endsWith('.tsx') || sourceFilePath.endsWith('.jsx')
      ? ts.ScriptKind.TSX
      : ts.ScriptKind.TS,
  );

  const imports = new Set<string>();

  function addModuleSpecifier(
    expression: ts.Expression | undefined,
  ): void {
    if (
      expression &&
      (ts.isStringLiteral(expression) ||
        ts.isNoSubstitutionTemplateLiteral(expression))
    ) {
      const value = expression.text;

      if (value.startsWith('@/')) {
        imports.add(value);
      }
    }
  }

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node)) {
      addModuleSpecifier(node.moduleSpecifier);
    }

    if (ts.isExportDeclaration(node)) {
      addModuleSpecifier(node.moduleSpecifier);
    }

    if (ts.isCallExpression(node)) {
      /*
       * Dynamic import: import('@/module')
       */
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        addModuleSpecifier(node.arguments[0]);
      }

      /*
       * CommonJS import: require('@/module')
       */
      if (
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'require'
      ) {
        addModuleSpecifier(node.arguments[0]);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  return [...imports].sort();
}

/* -------------------------------------------------------------------------- */
/* 5. Resolve every discovered aliased import                                 */
/* -------------------------------------------------------------------------- */

function collectAllAliasedImports(): ResolvedImport[] {
  const allFiles = SOURCE_DIRECTORIES.flatMap(listSourceFiles);
  const checks: ResolvedImport[] = [];
  const seen = new Set<string>();

  for (const filePath of allFiles) {
    const imports = extractAliasedImports(filePath);

    for (const importPath of imports) {
      const absoluteSourceFile = path.resolve(filePath);
      const key = `${absoluteSourceFile}\0${importPath}`;

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);

      /*
       * This is the authoritative check. Every import is resolved using
       * TypeScript's actual resolver, with its actual containing source file.
       */
      checks.push(
        resolveWithTypeScript(importPath, absoluteSourceFile),
      );
    }
  }

  return checks;
}

function formatFailures(
  failures: ResolvedImport[],
): string {
  return failures
    .map((failure) => {
      const lines = [
        `  Source: ${failure.sourceFile}`,
        `  Import: ${failure.importPath}`,
        `  Result: unresolved by TypeScript`,
      ];

      if (failure.resolutionFailure) {
        lines.push(
          '  Sample failed lookup locations:',
          ...failure.resolutionFailure
            .split('\n')
            .map((location) => `    ${location}`),
        );
      }

      return lines.join('\n');
    })
    .join('\n\n');
}

/* -------------------------------------------------------------------------- */
/* 6. Test suite                                                              */
/* -------------------------------------------------------------------------- */

describe('VidiaForge V8.7 — TypeScript alias resolution', () => {
  const allChecks = collectAllAliasedImports();

  test('the actual tsconfig.json defines the required aliases', () => {
    const paths = compilerOptions.paths ?? {};
    const patterns = Object.keys(paths);

    expect(patterns.length).toBeGreaterThan(0);

    /*
     * These mappings are expected for the previously identified repository
     * layout. If the architecture has intentionally changed, review the
     * expected mappings rather than weakening the resolution test.
     */
    const requiredMappings: Record<string, string> = {
      '@/components/*': './src/app/components/*',
      '@/hooks/*': './src/app/hooks/*',
      '@/lib/*': './lib/*',
      '@/stores/*': './stores/*',
      '@/*': './src/*',
    };

    for (const [pattern, expectedTarget] of Object.entries(
      requiredMappings,
    )) {
      expect(
        patterns,
        `Missing required tsconfig alias: ${pattern}`,
      ).toContain(pattern);

      const configuredTargets = paths[pattern] ?? [];

      expect(
        configuredTargets,
        `Alias ${pattern} must target ${expectedTarget}`,
      ).toContain(expectedTarget);
    }
  });

  test('source scan discovers aliased imports', () => {
    expect(
      allChecks.length,
      'No @/... imports were discovered. Check the source directories and scanner.',
    ).toBeGreaterThan(0);
  });

  test('EVERY discovered aliased import resolves using TypeScript', () => {
    const failures = allChecks.filter((check) => !check.resolved);

    if (failures.length > 0) {
      throw new Error(
        [
          `${failures.length} aliased import(s) failed TypeScript module resolution.`,
          '',
          formatFailures(failures),
          '',
          'Fix the source import or the actual tsconfig mapping.',
          'Do not add empty placeholder files or bypass the resolver.',
        ].join('\n'),
      );
    }
  });

  test('the previously reported Render import paths resolve using TypeScript', () => {
    const renderFailingPaths = [
      '@/components/editor/export-dialog',
      '@/components/editor/keyboard-shortcuts-dialog',
      '@/components/pwa/service-worker-register',
      '@/components/views/auth-view',
      '@/lib/ai/command-engine/safety',
      '@/lib/ai/command-engine/schema',
      '@/lib/ai/command-engine/validator',
      '@/lib/ai/transcription',
      '@/lib/ai/translation',
      '@/lib/audio',
      '@/lib/auth',
      '@/lib/db',
      '@/lib/env-validation',
      '@/lib/errors/codes',
      '@/lib/get-client-ip',
      '@/lib/queue',
      '@/lib/queue-names',
      '@/lib/rate-limit',
      '@/lib/storage',
      '@/lib/templates',
      '@/lib/timeline',
      '@/stores/auth-store',
      '@/stores/ui-store',
    ];

    /*
     * Use a real source file from the project as the containing file.
     * Path aliases are resolved from the actual parsed tsconfig settings.
     */
    const containingFileCandidates = [
      path.join(REPO_ROOT, 'src', 'app', 'page.tsx'),
      path.join(REPO_ROOT, 'src', 'app', 'layout.tsx'),
      path.join(REPO_ROOT, 'src', 'index.ts'),
    ];

    const containingFile = containingFileCandidates.find(existsSync);

    expect(
      containingFile,
      'Could not find a source file to use as the TypeScript resolver context.',
    ).toBeDefined();

    const failures: ResolvedImport[] = [];

    for (const importPath of renderFailingPaths) {
      const result = resolveWithTypeScript(
        importPath,
        containingFile!,
      );

      if (!result.resolved) {
        failures.push(result);
      }
    }

    if (failures.length > 0) {
      throw new Error(
        [
          `${failures.length} previously reported Render import path(s) still fail TypeScript resolution.`,
          '',
          formatFailures(failures),
        ].join('\n'),
      );
    }
  });

  test('representative aliases resolve through the real TypeScript resolver', () => {
    const containingFileCandidates = [
      path.join(REPO_ROOT, 'src', 'app', 'page.tsx'),
      path.join(REPO_ROOT, 'src', 'app', 'layout.tsx'),
    ];

    const containingFile = containingFileCandidates.find(existsSync);

    expect(
      containingFile,
      'No application source file is available for the resolver test.',
    ).toBeDefined();

    const representativeImports = [
      '@/stores/auth-store',
      '@/stores/ui-store',
      '@/lib/db',
      '@/lib/queue',
      '@/lib/storage',
      '@/lib/templates',
      '@/components/views/auth-view',
    ];

    const failures = representativeImports
      .map((importPath) =>
        resolveWithTypeScript(importPath, containingFile!),
      )
      .filter((result) => !result.resolved);

    if (failures.length > 0) {
      throw new Error(
        [
          'Representative aliases failed TypeScript resolution:',
          '',
          formatFailures(failures),
        ].join('\n'),
      );
    }
  });

  test('the TypeScript resolver rejects a nonexistent aliased module', () => {
    const containingFileCandidates = [
      path.join(REPO_ROOT, 'src', 'app', 'page.tsx'),
      path.join(REPO_ROOT, 'src', 'app', 'layout.tsx'),
    ];

    const containingFile = containingFileCandidates.find(existsSync);

    expect(
      containingFile,
      'No application source file is available for the negative test.',
    ).toBeDefined();

    const result = resolveWithTypeScript(
      '@/__vidiaforge_test_missing_module__/does-not-exist',
      containingFile!,
    );

    expect(
      result.resolved,
      'The TypeScript resolver unexpectedly resolved a nonexistent test module.',
    ).toBe(false);
  });

  test('resolved aliased imports point to files that exist', () => {
    const invalidResults = allChecks.filter((check) => {
      if (!check.resolved || !check.resolvedFileName) {
        return true;
      }

      return !existsSync(check.resolvedFileName);
    });

    if (invalidResults.length > 0) {
      throw new Error(
        [
          `${invalidResults.length} aliased import(s) have no existing resolved file.`,
          '',
          formatFailures(invalidResults),
        ].join('\n'),
      );
    }
  });
});
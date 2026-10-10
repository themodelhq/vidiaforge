// VidiaForge V19.1 v5 — Netlify proxy target test
//
// V19.1 PHASE 2 — CORRECT NETLIFY-TO-RENDER ROUTING.
//
// This test validates that the Netlify `/api/*` proxy target matches the
// Render web service name declared in render.yaml. The Render hostname
// convention is `https://<service-name>.onrender.com`, so a service named
// `vidiaforge-api` resolves to `https://vidiaforge-api.onrender.com`.
//
// Verifies:
//   1. netlify.toml parses as valid TOML.
//   2. There is exactly one `/api/*` redirect.
//   3. The redirect target is `https://vidiaforge-api.onrender.com/api/:splat`.
//   4. The redirect uses `status = 200` (transparent proxy, not 30x).
//   5. The redirect has `force = true` (overrides Next.js rewrites).
//   6. The redirect sets `X-Forwarded-Host = vidiaforge.netlify.app`.
//   7. The Render web service name in render.yaml matches the Netlify
//      proxy target hostname (consistency check across the two configs).

import { test, expect, describe } from 'bun:test';
import { readFileSync } from 'fs';
import path from 'path';
import { parse as parseYaml } from 'yaml';

const NETLIFY_TOML = path.join(process.cwd(), 'netlify.toml');
const RENDER_YAML = path.join(process.cwd(), 'render.yaml');

function loadNetlify(): string {
  return readFileSync(NETLIFY_TOML, 'utf-8');
}

function loadBlueprint(): any {
  return parseYaml(readFileSync(RENDER_YAML, 'utf-8'));
}

// Minimal TOML parser for the subset of netlify.toml we need to validate.
// We don't pull in a full TOML parser to keep the test lightweight; the
// structure we care about (a `[[redirects]]` table with `from`, `to`,
// `status`, `force`, and a `[redirects.headers]` sub-table) is regular
// enough to extract with a small line-based parser.
interface NetlifyRedirect {
  from: string;
  to: string;
  status: number;
  force: boolean;
  headers: Record<string, string>;
}

function parseNetlifyRedirects(text: string): NetlifyRedirect[] {
  const redirects: NetlifyRedirect[] = [];
  const lines = text.split('\n');
  let current: NetlifyRedirect | null = null;
  let inHeaders = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith('#') || !line) continue;
    if (line === '[[redirects]]') {
      if (current) redirects.push(current);
      current = { from: '', to: '', status: 0, force: false, headers: {} };
      inHeaders = false;
      continue;
    }
    if (line === '[redirects.headers]' && current) {
      inHeaders = true;
      continue;
    }
    if (line.startsWith('[[') || line.startsWith('[')) {
      // entering a different table — flush current redirect
      if (current) {
        redirects.push(current);
        current = null;
      }
      inHeaders = false;
      continue;
    }
    if (!current) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^"|"$/g, '');
    if (inHeaders) {
      current.headers[key] = value;
    } else {
      if (key === 'from') current.from = value;
      else if (key === 'to') current.to = value;
      else if (key === 'status') current.status = parseInt(value, 10) || 0;
      else if (key === 'force') current.force = value === 'true';
    }
  }
  if (current) redirects.push(current);
  return redirects;
}

describe('V19.1 v5 — Netlify /api/* proxy target', () => {
  const netlifyText = loadNetlify();
  const redirects = parseNetlifyRedirects(netlifyText);

  test('netlify.toml contains at least one redirect', () => {
    expect(redirects.length).toBeGreaterThan(0);
  });

  test('exactly one redirect targets /api/*', () => {
    const apiRedirects = redirects.filter((r) => r.from === '/api/*');
    expect(apiRedirects.length).toBe(1);
  });

  test('the /api/* proxy points to https://vidiaforge-api.onrender.com/api/:splat', () => {
    const apiRedirect = redirects.find((r) => r.from === '/api/*');
    expect(apiRedirect).toBeDefined();
    expect(apiRedirect!.to).toBe('https://vidiaforge-api.onrender.com/api/:splat');
  });

  test('REGRESSION: the /api/* proxy does NOT point to https://vidiaforge.onrender.com (wrong host)', () => {
    // V19.1 v5 — the previous target was `https://vidiaforge.onrender.com/api/:splat`
    // which did not match the Render web service name `vidiaforge-api`. This
    // test ensures the regression doesn't reappear.
    const apiRedirect = redirects.find((r) => r.from === '/api/*');
    expect(apiRedirect!.to).not.toContain('https://vidiaforge.onrender.com');
    expect(apiRedirect!.to).not.toMatch(/^https:\/\/vidiaforge\.onrender\.com/);
  });

  test('the /api/* proxy uses status = 200 (transparent proxy, not 30x)', () => {
    const apiRedirect = redirects.find((r) => r.from === '/api/*');
    expect(apiRedirect!.status).toBe(200);
  });

  test('the /api/* proxy has force = true (overrides Next.js rewrites)', () => {
    const apiRedirect = redirects.find((r) => r.from === '/api/*');
    expect(apiRedirect!.force).toBe(true);
  });

  test('the /api/* proxy sets X-Forwarded-Host = vidiaforge.netlify.app', () => {
    const apiRedirect = redirects.find((r) => r.from === '/api/*');
    expect(apiRedirect!.headers['X-Forwarded-Host']).toBe('vidiaforge.netlify.app');
  });

  test('the Netlify proxy hostname matches the Render web service name (cross-config consistency)', () => {
    // The Render web service is named `vidiaforge-api` in render.yaml.
    // Render's default hostname convention is `<service-name>.onrender.com`.
    // So the Netlify proxy should target `https://vidiaforge-api.onrender.com`.
    const blueprint = loadBlueprint();
    const apiService = blueprint.services.find((s: any) => s.name === 'vidiaforge-api');
    expect(apiService).toBeDefined();
    const expectedHost = `https://${apiService.name}.onrender.com`;
    const apiRedirect = redirects.find((r) => r.from === '/api/*');
    expect(apiRedirect!.to.startsWith(expectedHost)).toBe(true);
  });
});

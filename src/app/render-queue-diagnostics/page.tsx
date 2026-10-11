'use client';

import { FormEvent, useState } from 'react';

type DiagnosticResult = Record<string, unknown>;

export default function RenderQueueDiagnosticsPage() {
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DiagnosticResult | null>(null);
  const [error, setError] = useState('');
  const [httpStatus, setHttpStatus] = useState<number | null>(null);

  async function runDiagnostics(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError('');
    setResult(null);
    setHttpStatus(null);

    try {
      // Use the same-origin /api proxy so the browser can use the app's
      // normal routing. The token is kept in component memory only; it is
      // not placed in the URL or saved to localStorage/sessionStorage.
      const response = await fetch('/api/health/render-queue', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token.trim()}`,
          Accept: 'application/json',
        },
        credentials: 'include',
        cache: 'no-store',
      });

      setHttpStatus(response.status);
      const bodyText = await response.text();
      let body: unknown;

      try {
        body = bodyText ? JSON.parse(bodyText) : {};
      } catch {
        body = { responseText: bodyText };
      }

      if (!response.ok) {
        setResult(
          body && typeof body === 'object'
            ? (body as DiagnosticResult)
            : { response: body },
        );
        setError(
          response.status === 401
            ? 'Unauthorized. Confirm the RENDER_DIAGNOSTICS_TOKEN on the Render API matches the token entered here, and confirm the deployed endpoint supports Bearer authentication.'
            : `The diagnostics request failed with HTTP ${response.status}. See the response below.`,
        );
        return;
      }

      setResult(
        body && typeof body === 'object'
          ? (body as DiagnosticResult)
          : { response: body },
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Could not reach the diagnostics endpoint. Check the frontend deployment and its /api proxy.',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10 text-foreground">
      <div className="mb-8">
        <p className="mb-2 text-sm font-medium uppercase tracking-wider text-muted-foreground">
          VidiaForge · Admin diagnostics
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">Render queue diagnostics</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
          Check whether render jobs are waiting, active, or have a registered worker.
          Enter the diagnostic token configured on the Render API service. The token
          is held in this page's memory only and is not saved in browser storage or the URL.
        </p>
      </div>

      <form onSubmit={runDiagnostics} className="space-y-4 rounded-xl border border-border p-5">
        <label htmlFor="diagnostic-token" className="block text-sm font-medium">
          Render diagnostics token
        </label>
        <input
          id="diagnostic-token"
          type="password"
          autoComplete="off"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="Paste RENDER_DIAGNOSTICS_TOKEN"
          required
          className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={loading || !token.trim()}
            className="rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? 'Checking queue…' : 'Run diagnostics'}
          </button>
          <button
            type="button"
            onClick={() => {
              setToken('');
              setResult(null);
              setError('');
              setHttpStatus(null);
            }}
            className="rounded-lg border border-border px-4 py-2.5 text-sm font-medium"
          >
            Clear
          </button>
          {httpStatus !== null && (
            <span className="text-sm text-muted-foreground">HTTP {httpStatus}</span>
          )}
        </div>
      </form>

      {error && (
        <div role="alert" className="mt-5 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <p className="font-semibold">Request needs attention</p>
          <p className="mt-1 whitespace-pre-wrap">{error}</p>
        </div>
      )}

      {result && (
        <section className="mt-6 rounded-xl border border-border p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Diagnostic response</h2>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(JSON.stringify(result, null, 2));
              }}
              className="rounded-lg border border-border px-3 py-2 text-sm font-medium"
            >
              Copy JSON
            </button>
          </div>
          <pre className="max-h-[32rem] overflow-auto rounded-lg bg-muted p-4 text-xs leading-5">
            {JSON.stringify(result, null, 2)}
          </pre>
          <p className="mt-3 text-xs text-muted-foreground">
            Before sharing this output, check that it contains no secrets or private URLs.
          </p>
        </section>
      )}
    </main>
  );
}

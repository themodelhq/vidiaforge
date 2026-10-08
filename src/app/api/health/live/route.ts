// /api/health/live — Liveness check.
// Returns 200 if the process is alive. Does NOT check external dependencies.
// This endpoint must NEVER fail due to infrastructure issues (DB, Redis, etc.)
// — it only verifies the process is running.
export async function GET() {
  return Response.json({
    status: 'alive',
    time: new Date().toISOString(),
    uptime: process.uptime(),
  });
}

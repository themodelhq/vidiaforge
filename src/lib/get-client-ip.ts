// VidiaForge — Extract client IP from request (behind proxy/gateway).
export function getClientIP(req: Request): string {
  // Check common proxy headers
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  const realIp = req.headers.get('x-real-ip');
  if (realIp) return realIp;
  const cfConnecting = req.headers.get('cf-connecting-ip');
  if (cfConnecting) return cfConnecting;
  // Fallback (development)
  return '127.0.0.1';
}

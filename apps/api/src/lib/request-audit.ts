import type { FastifyRequest } from 'fastify';

/** Best-effort client IP for audit rows (trimmed to audit_logs.ip_address length). */
export function clientIpForAudit(request: FastifyRequest): string | null {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0]!.trim().slice(0, 45);
  }
  const raw = request.socket.remoteAddress;
  return raw ? raw.slice(0, 45) : null;
}

export function clientUserAgentForAudit(request: FastifyRequest): string | null {
  const ua = request.headers['user-agent'];
  return typeof ua === 'string' ? ua : null;
}

/**
 * Redaction for diagnostic reports. The runtime already avoids collecting sensitive data
 * (no key values, no code, no query strings); this is a second, defensive layer applied
 * to the final text before it can leave the device.
 */

const URL_RE = /\b(https?|wss?):\/\/[^\s"'<>)]+/gi;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const BEARER_RE = /\b(bearer|token|session|sessionid|sid|auth|authorization|cookie|set-cookie|password|passwd|secret|api[_-]?key)\b\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi;
const LONG_SECRET_RE = /\b[A-Za-z0-9_-]{32,}\b/g;
const HEX_RE = /\b[a-f0-9]{24,}\b/gi;

/** Keep scheme, host and path; drop query and fragment; mask long opaque path segments. */
export function redactUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const path = u.pathname
      .split('/')
      .map((seg) => (seg.length >= 24 && /[0-9]/.test(seg) ? '[id]' : seg))
      .join('/');
    const q = u.search ? '?[redacted]' : '';
    const h = u.hash ? '#[redacted]' : '';
    return `${u.protocol}//${u.host}${path}${q}${h}`;
  } catch {
    return '[url]';
  }
}

export function redactText(text: string): string {
  return text
    .replace(URL_RE, (m) => redactUrl(m))
    .replace(JWT_RE, '[jwt]')
    .replace(BEARER_RE, (_m, k: string) => `${k}=[redacted]`)
    .replace(EMAIL_RE, '[email]')
    .replace(LONG_SECRET_RE, (m) => (/^[a-z-]+$/.test(m) ? m : '[secret]'))
    .replace(HEX_RE, '[hex]');
}

/** Deep-redacts all string values of a JSON-compatible structure. */
export function redactDeep<T>(value: T): T {
  if (typeof value === 'string') return redactText(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/cookie|password|token|secret|authorization/i.test(k)) out[k] = '[redacted]';
      else out[k] = redactDeep(v);
    }
    return out as T;
  }
  return value;
}

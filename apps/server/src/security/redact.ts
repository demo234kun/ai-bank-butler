const SECRET_KEYS = [
  'apikey',
  'api_key',
  'token',
  'authorization',
  'password',
  'passwd',
  'secret',
  'idnumber',
  'id_number',
  'cardnumber',
  'card_number',
  'accountnumber',
  'account_number',
  'cvv',
];

const PHONE_RE = /(?<!\d)(1[3-9]\d{9})(?!\d)/g;
const CARD_RE = /(?<!\d)(\d{4})[\s-]?(\d{4})[\s-]?(\d{4})[\s-]?(\d{4,7})(?!\d)/g;

function maskString(value: string): string {
  return value
    .replace(PHONE_RE, (_, phone: string) => `${phone.slice(0, 3)}****${phone.slice(-4)}`)
    .replace(CARD_RE, (_, a: string, b: string, c: string, d: string) => `${a} **** **** ${d.slice(-4)}`);
}

function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[MAX_DEPTH]';
  if (typeof value === 'string') return maskString(value);
  if (Array.isArray(value)) return value.slice(0, 80).map((item) => redactValue(item, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEYS.includes(key.toLowerCase())) {
        out[key] = '[REDACTED]';
      } else {
        out[key] = redactValue(val, depth + 1);
      }
    }
    return out;
  }
  return value;
}

export function redactPayload(payload: unknown): unknown {
  const redacted = redactValue(payload);
  try {
    const json = JSON.stringify(redacted);
    if (json.length > 6000) {
      return { truncated: true, preview: json.slice(0, 6000) };
    }
  } catch {
    return { truncated: true, preview: '[unserializable payload]' };
  }
  return redacted;
}

export function maskAccountNo(value: string): string {
  return maskString(value);
}

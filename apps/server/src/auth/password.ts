import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const scrypt = (pw: string, salt: Buffer, keylen: number, opts: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) =>
    scryptCb(pw, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );

export const MIN_PASSWORD_LENGTH = 12;
const KEYLEN = 64;
const DEFAULT_COST = { N: 2 ** 15, r: 8, p: 1 };

/** Format: scrypt$N$r$p$saltB64$hashB64 */
export async function hashPassword(password: string, cost = DEFAULT_COST): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, KEYLEN, {
    ...cost,
    maxmem: 256 * cost.N * cost.r,
  });
  return ['scrypt', cost.N, cost.r, cost.p, salt.toString('base64'), key.toString('base64')].join(
    '$',
  );
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [N, r, p] = parts.slice(1, 4).map(Number) as [number, number, number];
  if (![N, r, p].every((n) => Number.isInteger(n) && n > 0) || N > 2 ** 20) return false;
  const salt = Buffer.from(parts[4]!, 'base64');
  const expected = Buffer.from(parts[5]!, 'base64');
  if (expected.length < 32) return false;
  const actual = await scrypt(password.normalize('NFKC'), salt, expected.length, {
    N,
    r,
    p,
    maxmem: 256 * N * r,
  });
  return timingSafeEqual(actual, expected);
}

export function checkPasswordStrength(password: string): string | undefined {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > 1024) return 'Password is too long.';
  if (new Set(password).size < 5) return 'Password is too repetitive.';
  return undefined;
}

import {createRemoteJWKSet, jwtVerify} from 'jose';
import {WorkerHttpError} from './worker';

// Only public verification keys are cached, never tokens or request identities.
// The issuer comes from server configuration and is checked before this lookup.
const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
function accessKeys(issuer: string) {
  let keys = keySets.get(issuer);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`), {timeoutDuration: 10000});
    if (keySets.size >= 4) keySets.clear();
    keySets.set(issuer, keys);
  }
  return keys;
}

export interface AdminAuthConfig {
  ADMIN_ORIGIN: string;
  ACCESS_ISSUER: string;
  ACCESS_AUD: string;
  ADMIN_EMAILS: string;
}

export function exactOrigin(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password) throw new Error();
    return url.origin;
  } catch {
    throw new WorkerHttpError(503, 'Server configuration is incomplete.');
  }
}

/** Access is the identity gateway; this independent check also protects alternate hosts. */
export async function authorizeAdmin(request: Request, env: AdminAuthConfig): Promise<string> {
  const adminOrigin = exactOrigin(env.ADMIN_ORIGIN);
  if (new URL(request.url).origin !== adminOrigin) throw new WorkerHttpError(404, 'Endpoint not found.');
  if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_ISSUER ?? '') ||
      !env.ACCESS_AUD?.trim() || !env.ADMIN_EMAILS?.trim()) {
    throw new WorkerHttpError(503, 'Administrator access has not been configured.');
  }
  const allowlist = env.ADMIN_EMAILS.split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
  if (allowlist.some(x => !/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(x))) {
    throw new WorkerHttpError(503, 'Administrator access has not been configured.');
  }
  const jwt = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!jwt || jwt.length > 16384 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(jwt)) {
    throw new WorkerHttpError(401, 'Administrator sign-in is required.');
  }
  let email: string;
  try {
    const {payload} = await jwtVerify(jwt, accessKeys(env.ACCESS_ISSUER), {
      algorithms: ['RS256'], issuer: env.ACCESS_ISSUER, audience: env.ACCESS_AUD, clockTolerance: 10,
      requiredClaims: ['exp', 'iat', 'sub', 'email'],
    });
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.email !== 'string' || !/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(payload.email) ||
        payload.email.length > 320 || typeof payload.sub !== 'string' || !payload.sub ||
        typeof payload.iat !== 'number' || payload.iat > now + 10 || now - payload.iat > 86400 ||
        typeof payload.exp !== 'number' || payload.exp <= now - 10) throw new Error();
    email = payload.email.toLowerCase();
  } catch {
    throw new WorkerHttpError(401, 'Administrator session is invalid or expired. Sign in again.');
  }
  if (!allowlist.includes(email)) throw new WorkerHttpError(403, 'This identity is not an administrator.');
  if (!['GET', 'HEAD'].includes(request.method)) {
    if (request.headers.get('Origin') !== adminOrigin || request.headers.get('X-Requested-With') !== 'root-admin' ||
        (request.headers.get('Sec-Fetch-Site') && request.headers.get('Sec-Fetch-Site') !== 'same-origin')) {
      throw new WorkerHttpError(403, 'The administrator request did not pass the origin check.');
    }
  }
  return email;
}

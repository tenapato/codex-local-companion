import { isIP } from 'node:net';
import { Failure } from './errors.js';

export interface NetworkConfig { bind: '127.0.0.1' | '0.0.0.0'; publicOrigin?: string }

// Remote exposure is explicit. An ordinary local start retains the loopback boundary.
export function networkConfig(env: Record<string, string | undefined> = process.env): NetworkConfig {
  const bind = env.CLC_BIND ?? '127.0.0.1';
  if (bind !== '127.0.0.1' && bind !== '0.0.0.0') throw new Failure('invalid_bind');
  let publicOrigin: string | undefined;
  if (env.CLC_PUBLIC_ORIGIN !== undefined) {
    try {
      const url = new URL(env.CLC_PUBLIC_ORIGIN);
      if (url.protocol !== 'https:' || url.origin !== env.CLC_PUBLIC_ORIGIN ||
          isIP(url.hostname) || !url.hostname.includes('.') || url.hostname.endsWith('.localhost')) throw new Error();
      publicOrigin = url.origin;
    } catch { throw new Failure('invalid_public_origin'); }
  }
  if (bind === '0.0.0.0' && !publicOrigin) throw new Failure('public_origin_required');
  return { bind, publicOrigin };
}

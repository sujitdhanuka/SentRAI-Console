/**
 * Outbound webhook transport (E3.3). Resolves the host itself, refuses private,
 * loopback and link-local addresses unless GOV_WEBHOOK_ALLOW_PRIVATE is set,
 * and connects to the address it checked (no second lookup, so DNS rebinding
 * cannot swap it). Redirects are never followed.
 */
import { lookup as dnsLookup } from 'dns';
import { request } from 'https';
import { LookupFunction } from 'net';

import { isPrivateAddress } from './incident-ext.model';

export interface SafeResponse { ok: boolean; status: number; json(): Promise<any> }

const MAX_BODY = 256 * 1024;

export function safeFetch(
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
  allowPrivate = false,
  resolve: typeof dnsLookup = dnsLookup,
): Promise<SafeResponse> {
  return new Promise((done, fail) => {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return fail(new Error('invalid url'));
    }
    if (u.protocol !== 'https:') return fail(new Error('https only'));
    const pinned: LookupFunction = (host, opts, cb) => {
      resolve(host, { all: true }, (err, addrs) => {
        if (err) return cb(err, '', 4);
        const list = (addrs as unknown as Array<{ address: string; family: number }>) ?? [];
        if (!list.length) return cb(new Error('no address'), '', 4);
        if (!allowPrivate && list.some((a) => isPrivateAddress(a.address))) return cb(new Error('blocked: the host resolves to a private address'), '', 4);
        const a = list[0];
        if ((opts as any)?.all) return (cb as any)(null, [{ address: a.address, family: a.family }]);
        cb(null, a.address, a.family);
      });
    };
    const req = request(u, { method: init.method, headers: { ...init.headers, 'Content-Length': Buffer.byteLength(init.body) }, lookup: pinned, signal: init.signal }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (c: Buffer) => {
        size += c.length;
        if (size <= MAX_BODY) chunks.push(c);
      });
      res.on('end', () => {
        const status = res.statusCode ?? 0;
        const text = Buffer.concat(chunks).toString('utf8');
        // 3xx counts as a failure: redirects are not followed.
        done({ ok: status >= 200 && status < 300, status, json: async () => JSON.parse(text) });
      });
      res.on('error', fail);
    });
    req.on('error', fail);
    req.end(init.body);
  });
}

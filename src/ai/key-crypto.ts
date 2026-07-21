import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

/**
 * At-rest encryption for per-org AI provider API keys (AES-256-GCM).
 *
 * Ciphertext format: `v1:<iv-hex>:<auth-tag-hex>:<ciphertext-hex>` — versioned
 * so a future key rotation / algorithm change can coexist with old rows.
 *
 * The 256-bit key is derived (SHA-256) from APP_ENCRYPTION_KEY, falling back
 * to the JWT secret so existing deployments work without new configuration —
 * the config layer warns in production when the fallback is in use, since
 * rotating the JWT secret would then orphan every stored provider key.
 *
 * Keys are WRITE-ONLY at the API layer: nothing ever decrypts for display,
 * only for outbound provider calls. `maskKey` is the only read-path shape.
 */

const VERSION = 'v1';

function deriveKey(secret: string): Buffer {
  return createHash('sha256').update(`sentrai-ai-key:${secret}`).digest();
}

export function encryptSecret(plaintext: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('hex'), cipher.getAuthTag().toString('hex'), enc.toString('hex')].join(':');
}

export function decryptSecret(stored: string, secret: string): string {
  const [version, ivHex, tagHex, dataHex] = stored.split(':');
  if (version !== VERSION || !ivHex || !tagHex || !dataHex) {
    throw new Error('Unrecognized encrypted-key format');
  }
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
}

/** The only representation of a key that may leave the server: `sk-…x4Q2`. */
export function maskKey(plaintext: string | null | undefined): string | null {
  if (!plaintext) return null;
  const tail = plaintext.length > 8 ? plaintext.slice(-4) : '';
  const head = plaintext.length > 12 ? plaintext.slice(0, 3) : '';
  return `${head}…${tail}`;
}

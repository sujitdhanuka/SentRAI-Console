import * as bcrypt from 'bcryptjs';

/**
 * bcrypt password helpers. bcryptjs is wire-compatible with Python's bcrypt
 * ($2a/$2b hashes), so hashes are portable in either direction.
 */
export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, bcrypt.genSaltSync());
}

export function verifyPassword(plain: string, hashed: string): boolean {
  try {
    return bcrypt.compareSync(plain, hashed);
  } catch {
    return false;
  }
}

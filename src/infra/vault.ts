/**
 * AES-256-GCM secret vault.
 *
 * Secrets (Gmail refresh tokens) are encrypted at rest as an envelope of
 * { iv, tag, ciphertext } - all hex - matching the `vault` table columns
 * (client_id, kind, iv, tag, ciphertext). The 32-byte key comes from the
 * ENCRYPTION_KEY environment variable via the typed env module; it is never
 * logged and never stored next to the data it protects.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_LENGTH = 16;
const KEY_HEX_LENGTH = 64;

export interface VaultEnvelope {
  iv: string;
  tag: string;
  ciphertext: string;
}

/** Raised when decryption fails authentication (tampering or wrong key). */
export class VaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultError";
  }
}

/** Validates a hex-encoded 32-byte key and returns its raw bytes. */
export function parseVaultKey(keyHex: string): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
    throw new VaultError(
      `Vault key must be exactly ${KEY_HEX_LENGTH} hex characters (32 bytes).`,
    );
  }
  return Buffer.from(keyHex, "hex");
}

function toHex(buffer: Buffer): string {
  return buffer.toString("hex");
}

const HEX_RE = /^[0-9a-fA-F]*$/;

/**
 * Decodes an envelope field, rejecting non-hex input up front:
 * Buffer.from(x, "hex") silently ignores invalid characters instead of
 * throwing, so explicit validation is required to fail loudly.
 */
function fromHexField(name: string, value: string, expectedBytes?: number): Buffer {
  if (!HEX_RE.test(value) || value.length % 2 !== 0 || (expectedBytes !== undefined && value.length / 2 !== expectedBytes)) {
    throw new VaultError(`vault: envelope field "${name}" is not valid hex of the expected length`);
  }
  return Buffer.from(value, "hex");
}

/** Encrypts a plaintext string under the given key. Uses a fresh random IV per call. */
export function encrypt(plaintext: string, key: Buffer): VaultEnvelope {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    iv: toHex(iv),
    tag: toHex(cipher.getAuthTag()),
    ciphertext: toHex(ciphertext),
  };
}

/**
 * Decrypts an envelope. Throws {@link VaultError} when authentication fails,
 * so a tampered tag/ciphertext or a wrong key can never yield silent garbage.
 */
export function decrypt(envelope: VaultEnvelope, key: Buffer): string {
  const iv = fromHexField("iv", envelope.iv, IV_BYTES);
  const tag = fromHexField("tag", envelope.tag, TAG_LENGTH);
  const ciphertext = fromHexField("ciphertext", envelope.ciphertext);

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new VaultError("vault: authentication failed (tampered envelope or wrong key)");
  }
}

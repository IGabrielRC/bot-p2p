import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { VaultError, decrypt, encrypt, parseVaultKey } from "../../src/infra/vault.js";

const KEY = parseVaultKey("ab".repeat(32));
const OTHER_KEY = parseVaultKey("cd".repeat(32));

function tamperHex(hex: string): string {
  const first = hex[0];
  const flipped = first === "0" ? "1" : "0";
  return flipped + hex.slice(1);
}

describe("parseVaultKey", () => {
  it("accepts a valid 64-char hex key", () => {
    expect(parseVaultKey("ef".repeat(32))).toHaveLength(32);
  });

  it("rejects keys that are the wrong length or non-hex", () => {
    expect(() => parseVaultKey("ab".repeat(31))).toThrow(VaultError);
    expect(() => parseVaultKey("zz".repeat(32))).toThrow(VaultError);
    expect(() => parseVaultKey("")).toThrow(VaultError);
  });
});

describe("vault roundtrip", () => {
  it("recovers the original plaintext", () => {
    const secret = "gmail-refresh-token-1//aBc123";
    expect(decrypt(encrypt(secret, KEY), KEY)).toBe(secret);
  });

  it("handles unicode and empty-string secrets", () => {
    for (const secret of ["señal ñ €€ — ✓", ""]) {
      expect(decrypt(encrypt(secret, KEY), KEY)).toBe(secret);
    }
  });

  it("never stores plaintext: ciphertext differs and does not contain the secret", () => {
    const secret = "PLAINTEXT-SAMPLE-TOKEN";
    const envelope = encrypt(secret, KEY);
    expect(envelope.ciphertext).not.toBe(secret);
    expect(envelope.ciphertext).not.toContain(secret);
  });

  it("uses a fresh IV per call, so identical inputs yield different envelopes", () => {
    const a = encrypt("same-secret", KEY);
    const b = encrypt("same-secret", KEY);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });
});

describe("vault tamper resistance", () => {
  it("rejects a tampered auth tag", () => {
    const envelope = encrypt("secret", KEY);
    const tampered = { ...envelope, tag: tamperHex(envelope.tag) };
    expect(() => decrypt(tampered, KEY)).toThrow(VaultError);
  });

  it("rejects tampered ciphertext", () => {
    const envelope = encrypt("secret", KEY);
    const tampered = { ...envelope, ciphertext: tamperHex(envelope.ciphertext) };
    expect(() => decrypt(tampered, KEY)).toThrow(VaultError);
  });

  it("rejects decryption under a different key", () => {
    const envelope = encrypt("secret", KEY);
    expect(() => decrypt(envelope, OTHER_KEY)).toThrow(VaultError);
  });

  it("rejects non-hex envelope fields instead of returning garbage", () => {
    expect(() =>
      decrypt({ iv: "nothex!!", tag: "aa".repeat(16), ciphertext: "bb" }, KEY),
    ).toThrow(VaultError);
  });
});

describe("key material hygiene", () => {
  it("derives keys from crypto-strength randomness without pattern issues", () => {
    const key = parseVaultKey(randomBytes(32).toString("hex"));
    const envelope = encrypt("roundtrip-with-random-key", key);
    expect(decrypt(envelope, key)).toBe("roundtrip-with-random-key");
  });
});

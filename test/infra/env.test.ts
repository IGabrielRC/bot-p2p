import { describe, expect, it } from "vitest";
import { EnvError, loadEnv } from "../../src/infra/env.js";

const VALID_KEY = "a".repeat(64);

function validSource(): Record<string, string> {
  return {
    BOT_TOKEN: "123:abc",
    DEVELOPER_CHAT_ID: "111",
    ENCRYPTION_KEY: VALID_KEY,
    ALLOWLIST_TELEGRAM_IDS: "222,333",
  };
}

describe("loadEnv", () => {
  it("parses a fully valid configuration", () => {
    const env = loadEnv(validSource());
    expect(env.botToken).toBe("123:abc");
    expect(env.developerChatId).toBe(111);
    expect(env.encryptionKey).toBe(VALID_KEY);
    expect(env.allowlistTelegramIds).toEqual([222, 333]);
  });

  it("throws on an empty source listing every missing required variable", () => {
    try {
      loadEnv({});
      expect.unreachable("expected EnvError");
    } catch (err) {
      expect(err).toBeInstanceOf(EnvError);
      const message = (err as Error).message;
      for (const name of ["BOT_TOKEN", "DEVELOPER_CHAT_ID", "ENCRYPTION_KEY", "ALLOWLIST_TELEGRAM_IDS"]) {
        expect(message).toContain(name);
      }
    }
  });

  it("throws when a single required variable is missing", () => {
    const src = validSource();
    delete src.BOT_TOKEN;
    expect(() => loadEnv(src)).toThrow(/BOT_TOKEN/);
  });

  it("rejects an ENCRYPTION_KEY that is not 64 hex chars", () => {
    const short = validSource();
    short.ENCRYPTION_KEY = "abcd";
    expect(() => loadEnv(short)).toThrow(/ENCRYPTION_KEY/);

    const nonHex = validSource();
    nonHex.ENCRYPTION_KEY = "z".repeat(64);
    expect(() => loadEnv(nonHex)).toThrow(/ENCRYPTION_KEY/);
  });

  it("rejects a non-numeric or empty ALLOWLIST_TELEGRAM_IDS entry", () => {
    const bad = validSource();
    bad.ALLOWLIST_TELEGRAM_IDS = "222, notanumber";
    expect(() => loadEnv(bad)).toThrow(/ALLOWLIST_TELEGRAM_IDS/);
  });

  it("rejects a non-integer DEVELOPER_CHAT_ID", () => {
    const bad = validSource();
    bad.DEVELOPER_CHAT_ID = "12.5";
    expect(() => loadEnv(bad)).toThrow(/DEVELOPER_CHAT_ID/);
  });

  it("applies documented defaults for optional knobs", () => {
    const env = loadEnv(validSource());
    expect(env.gmailPollIntervalS).toBe(45);
    expect(env.alertRetryBaseS).toBe(30);
    expect(env.alertRetryCapS).toBe(600);
    expect(env.alertRetryMaxAttempts).toBe(5);
    expect(env.bapiTimeoutMs).toBe(10000);
  });

  it("honors explicit overrides of optional knobs (retry constants stay configurable)", () => {
    const src = validSource();
    src.GMAIL_POLL_INTERVAL_S = "60";
    src.ALERT_RETRY_BASE_S = "10";
    src.ALERT_RETRY_CAP_S = "120";
    src.ALERT_RETRY_MAX_ATTEMPTS = "3";
    src.BAPI_TIMEOUT_MS = "5000";
    const env = loadEnv(src);
    expect(env.gmailPollIntervalS).toBe(60);
    expect(env.alertRetryBaseS).toBe(10);
    expect(env.alertRetryCapS).toBe(120);
    expect(env.alertRetryMaxAttempts).toBe(3);
    expect(env.bapiTimeoutMs).toBe(5000);
  });

  it("rejects invalid numeric overrides", () => {
    const bad = validSource();
    bad.ALERT_RETRY_MAX_ATTEMPTS = "zero";
    expect(() => loadEnv(bad)).toThrow(/ALERT_RETRY_MAX_ATTEMPTS/);

    const zero = validSource();
    zero.GMAIL_POLL_INTERVAL_S = "0";
    expect(() => loadEnv(zero)).toThrow(/GMAIL_POLL_INTERVAL_S/);
  });

  it("rejects ALERT_RETRY_CAP_S below ALERT_RETRY_BASE_S", () => {
    const bad = validSource();
    bad.ALERT_RETRY_BASE_S = "600";
    bad.ALERT_RETRY_CAP_S = "30";
    expect(() => loadEnv(bad)).toThrow(/ALERT_RETRY_CAP_S/);
  });
});

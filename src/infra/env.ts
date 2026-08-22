/**
 * Typed, fail-fast environment configuration.
 *
 * Every operational knob is consumed through `loadEnv()` at the composition
 * root and injected downward - call sites never read `process.env` nor embed
 * literal values (retry/backoff constants are configurable per design risk
 * note, not hard-coded).
 */

export interface Env {
  /** Telegram Bot API token issued by @BotFather. */
  botToken: string;
  /** Chat that receives fail-loud developer alerts (distinct from client chat). */
  developerChatId: number;
  /** AES-256-GCM key as 64 hex chars (32 bytes). Encrypts vault rows at rest. */
  encryptionKey: string;
  /** Telegram user IDs allowed to interact with the bot (strict allowlist). */
  allowlistTelegramIds: number[];
  /** Seconds between Gmail poll cycles. Default: 45 (supports the <60 s target). */
  gmailPollIntervalS: number;
  /** Base delay in seconds for alert redelivery backoff. Default: 30. */
  alertRetryBaseS: number;
  /** Upper bound in seconds for exponential backoff growth. Default: 600 (10 min). */
  alertRetryCapS: number;
  /** Failed attempts before escalating to a developer alert. Default: 5. */
  alertRetryMaxAttempts: number;
  /** Outbound BAPI HTTP timeout in milliseconds. Default: 10000. */
  bapiTimeoutMs: number;
}

/** Thrown once with every configuration problem found, so boot fails loudly. */
export class EnvError extends Error {
  constructor(problems: string[]) {
    super(
      `Invalid environment configuration:\n` +
        problems.map((p) => `  - ${p}`).join("\n") +
        `\nSee .env.example for the expected variables.`,
    );
    this.name = "EnvError";
  }
}

type Source = Record<string, string | undefined>;

const HEX_32_BYTES = /^[0-9a-fA-F]{64}$/;

function requireNonEmpty(source: Source, name: string, problems: string[]): string {
  const value = source[name];
  if (value === undefined || value.trim() === "") {
    problems.push(`Missing required variable ${name}.`);
    return "";
  }
  return value.trim();
}

function parseIntValue(
  raw: string,
  name: string,
  problems: string[],
  min: number,
): number | undefined {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) {
    problems.push(`Variable ${name} must be an integer >= ${min}, got "${raw}".`);
    return undefined;
  }
  return value;
}

function requireInt(source: Source, name: string, problems: string[], min: number): number {
  const raw = source[name];
  if (raw === undefined || raw.trim() === "") {
    problems.push(`Missing required variable ${name}.`);
    return Number.NaN;
  }
  return parseIntValue(raw, name, problems, min) ?? Number.NaN;
}

function optionalInt(
  source: Source,
  name: string,
  problems: string[],
  min: number,
  def: number,
): number {
  const raw = source[name];
  if (raw === undefined || raw.trim() === "") return def;
  return parseIntValue(raw, name, problems, min) ?? def;
}

function parseAllowlist(raw: string, problems: string[]): number[] {
  const ids = new Set<number>();
  for (const part of raw.split(",")) {
    const value = Number(part.trim());
    if (!Number.isInteger(value) || value <= 0) {
      problems.push(`Variable ALLOWLIST_TELEGRAM_IDS must be comma-separated positive integers, got entry "${part.trim()}".`);
      continue;
    }
    ids.add(value);
  }
  return [...ids];
}

/**
 * Parses and validates all environment variables up front.
 * Collects EVERY problem into a single {@link EnvError} instead of failing on
 * the first one, so a broken deploy surfaces its whole misconfiguration at once.
 */
export function loadEnv(source: Source = process.env): Env {
  const problems: string[] = [];

  const botToken = requireNonEmpty(source, "BOT_TOKEN", problems);
  const developerChatId = requireInt(source, "DEVELOPER_CHAT_ID", problems, 1);

  const encryptionKey = requireNonEmpty(source, "ENCRYPTION_KEY", problems);
  if (encryptionKey !== "" && !HEX_32_BYTES.test(encryptionKey)) {
    problems.push(
      `Variable ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes), got length ${encryptionKey.length}.`,
    );
  }

  let allowlistTelegramIds: number[] = [];
  const allowlistRaw = requireNonEmpty(source, "ALLOWLIST_TELEGRAM_IDS", problems);
  if (allowlistRaw !== "") {
    allowlistTelegramIds = parseAllowlist(allowlistRaw, problems);
  }

  const gmailPollIntervalS = optionalInt(source, "GMAIL_POLL_INTERVAL_S", problems, 1, 45);
  const alertRetryBaseS = optionalInt(source, "ALERT_RETRY_BASE_S", problems, 1, 30);
  const alertRetryCapS = optionalInt(source, "ALERT_RETRY_CAP_S", problems, 1, 600);
  const alertRetryMaxAttempts = optionalInt(source, "ALERT_RETRY_MAX_ATTEMPTS", problems, 1, 5);
  const bapiTimeoutMs = optionalInt(source, "BAPI_TIMEOUT_MS", problems, 1, 10000);

  if (alertRetryCapS < alertRetryBaseS) {
    problems.push(
      `Variable ALERT_RETRY_CAP_S (${alertRetryCapS}) must be >= ALERT_RETRY_BASE_S (${alertRetryBaseS}).`,
    );
  }

  if (problems.length > 0) throw new EnvError(problems);

  return {
    botToken,
    developerChatId,
    encryptionKey,
    allowlistTelegramIds,
    gmailPollIntervalS,
    alertRetryBaseS,
    alertRetryCapS,
    alertRetryMaxAttempts,
    bapiTimeoutMs,
  };
}

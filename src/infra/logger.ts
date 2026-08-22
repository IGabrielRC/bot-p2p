/**
 * Redacting structured logger.
 *
 * Single pino instance factory used everywhere. Secret-shaped fields are
 * censored before serialization so no readable credential material can reach
 * log lines (spec: bot-access-config "Secrets & Audit Hygiene"). Call sites
 * pass a level/stream explicitly; nothing here reads process.env.
 */

import pino from "pino";

/** Field names treated as secret material wherever they may appear. */
const SECRET_FIELDS = [
  "botToken",
  "encryptionKey",
  "token",
  "refreshToken",
  "accessToken",
  "idToken",
  "apiKey",
  "apiSecret",
  "password",
  "secret",
  "authorization",
  "key",
] as const;

/**
 * Redact each secret field name at the root, one level deep, and two levels
 * deep - e.g. { botToken }, { auth: { token } }, { ctx: { vault: { key } } }.
 */
const REDACT_PATHS: string[] = SECRET_FIELDS.flatMap((name) => [
  name,
  `*.${name}`,
  `*.*.${name}`,
]);

export interface LoggerOptions {
  /** Defaults to "info". */
  level?: string;
  /** Destination override (tests inject a capturing stream). */
  stream?: pino.DestinationStream;
}

export type Logger = pino.Logger;

export function createLogger(options: LoggerOptions = {}): Logger {
  return pino(
    {
      level: options.level ?? "info",
      redact: {
        paths: REDACT_PATHS,
        censor: "[REDACTED]",
      },
    },
    options.stream,
  );
}

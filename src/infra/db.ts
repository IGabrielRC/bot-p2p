/**
 * SQLite persistence layer.
 *
 * Single entry point for all durable state (design "Cross-cutting"): clients,
 * processed_messages (D3 at-least-once dedupe), parse_anomalies, audit_log and
 * the encrypted vault. Schema changes land exclusively through ordered,
 * transactional migrations tracked with `PRAGMA user_version`, so an existing
 * deployment upgrades in place on boot.
 *
 * Conventions:
 * - Timestamps are UTC ISO-8601 strings ("2026-08-22T12:00:00.000Z").
 * - File-backed databases run in WAL mode (single long-lived process per D5);
 *   in-memory databases (":memory:") skip WAL, which they do not support.
 * - Callers receive the raw better-sqlite3 handle; higher-level modules
 *   (e.g. core/audit) wrap it behind typed functions.
 */

import Database from "better-sqlite3";

export type Db = Database.Database;

/** Current schema version - bumped whenever MIGRATIONS grows. */
export const SCHEMA_VERSION = 1;

interface Migration {
  version: number;
  up: (db: Db) => void;
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    up: (db: Db) => {
      db.exec(`
        CREATE TABLE clients (
          chat_id            INTEGER PRIMARY KEY,
          name               TEXT    NOT NULL,
          default_margin_pct REAL    NOT NULL DEFAULT 10,
          conv_margin_pct    REAL    NOT NULL DEFAULT 13.5,
          locale             TEXT    NOT NULL DEFAULT 'es',
          onboarded_at       TEXT
        );

        CREATE TABLE processed_messages (
          message_id TEXT PRIMARY KEY,
          status     TEXT NOT NULL CHECK (status IN ('pending', 'sent')),
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );

        CREATE TABLE parse_anomalies (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          gmail_message_id TEXT,
          snippet          TEXT NOT NULL,
          received_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );

        CREATE TABLE audit_log (
          actor  TEXT NOT NULL,
          action TEXT NOT NULL,
          detail TEXT NOT NULL DEFAULT '',
          ts     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );

        CREATE TABLE vault (
          client_id  INTEGER NOT NULL REFERENCES clients (chat_id),
          kind       TEXT    NOT NULL,
          iv         TEXT    NOT NULL,
          tag        TEXT    NOT NULL,
          ciphertext TEXT    NOT NULL,
          PRIMARY KEY (client_id, kind)
        );
      `);
    },
  },
];

/**
 * Opens the database at `path` (use ":memory:", the default, for tests),
 * enables the pragmas appropriate for our single-process model, and applies
 * any pending migrations. Each migration runs inside a transaction so a
 * crash mid-upgrade cannot leave a half-migrated schema behind.
 */
export function openDatabase(path: string = ":memory:"): Db {
  const db = new Database(path);

  // WAL lets the healthz read probe run while the poller writes (D5 single
  // process, but reads and writes still interleave). Not available for
  // ":memory:" databases, which report their journal mode as "memory".
  if (path !== ":memory:") {
    db.pragma("journal_mode = WAL");
  }
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  const current = Number(db.pragma("user_version", { simple: true }));
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    applyMigration(db, migration);
  }
  return db;
}

function applyMigration(db: Db, migration: Migration): void {
  const run = db.transaction(() => {
    migration.up(db);
    db.pragma(`user_version = ${migration.version}`);
  });
  run();
}

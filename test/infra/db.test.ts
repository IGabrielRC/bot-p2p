import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Db } from "../../src/infra/db.js";
import { SCHEMA_VERSION, openDatabase } from "../../src/infra/db.js";

const EXPECTED_TABLES = new Set([
  "clients",
  "processed_messages",
  "parse_anomalies",
  "audit_log",
  "vault",
]);

function tableNames(db: Db): Set<string> {
  const rows = db.prepare<{ name: string }, []>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
  ).all();
  return new Set(rows.map((r) => r.name));
}

function insertClient(db: Db, chatId: number): void {
  db.prepare(
    "INSERT INTO clients (chat_id, name) VALUES (?, ?)",
  ).run(chatId, "Kelly");
}

describe("openDatabase schema", () => {
  it("creates every design table in a fresh database", () => {
    const db = openDatabase();
    try {
      expect(tableNames(db)).toEqual(EXPECTED_TABLES);
      expect(Number(db.pragma("user_version", { simple: true }))).toBe(SCHEMA_VERSION);
    } finally {
      db.close();
    }
  });

  it("defaults client config columns to the D2 conventions", () => {
    const db = openDatabase();
    try {
      insertClient(db, 111);
      const row = db.prepare<
        { default_margin_pct: number; conv_margin_pct: number; locale: string },
        []
      >("SELECT default_margin_pct, conv_margin_pct, locale FROM clients").get();
      expect(row).toEqual({
        default_margin_pct: 10,
        conv_margin_pct: 13.5,
        locale: "es",
      });
    } finally {
      db.close();
    }
  });

  it("stamps processed_messages.created_at automatically", () => {
    const db = openDatabase();
    try {
      db.prepare(
        "INSERT INTO processed_messages (message_id, status) VALUES (?, 'pending')",
      ).run("gmail-abc");
      const row = db.prepare<{ created_at: string }, []>(
        "SELECT created_at FROM processed_messages",
      ).get();
      expect(row?.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    } finally {
      db.close();
    }
  });

  it("enforces WAL on file databases but not on :memory:", () => {
    const dir = mkdtempSync(join(tmpdir(), "botp2p-db-"));
    const fileDbPath = join(dir, "state.sqlite");
    let fileDb: Db | undefined;
    try {
      fileDb = openDatabase(fileDbPath);
      expect(String(fileDb.pragma("journal_mode", { simple: true }))).toBe("wal");
      fileDb.close();

      const memDb = openDatabase();
      expect(String(memDb.pragma("journal_mode", { simple: true }))).toBe("memory");
      memDb.close();
    } finally {
      fileDb?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("migration roundtrip", () => {
  const dir = mkdtempSync(join(tmpdir(), "botp2p-db-"));
  const fileDbPath = join(dir, "roundtrip.sqlite");
  let db: Db | undefined;

  it("persists data across close/reopen without re-migrating destructively", () => {
    try {
      db = openDatabase(fileDbPath);
      insertClient(db, 222);
      db.prepare(
        "INSERT INTO audit_log (actor, action, detail) VALUES ('gabri', 'test_write', 'before restart')",
      ).run();
      db.close();
      db = undefined;

      const reopened = openDatabase(fileDbPath);
      const clients = reopened.prepare<{ chat_id: number }, []>(
        "SELECT chat_id FROM clients",
      ).all();
      const audits = reopened.prepare<{ action: string }, []>(
        "SELECT action FROM audit_log",
      ).all();
      expect(clients).toEqual([{ chat_id: 222 }]);
      expect(audits).toEqual([{ action: "test_write" }]);
      // Reopening must be idempotent: same version, no duplicate work.
      expect(Number(reopened.pragma("user_version", { simple: true }))).toBe(SCHEMA_VERSION);
      reopened.close();
    } finally {
      db?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("constraint enforcement", () => {
  it("rejects a second row for the same message_id (D3 dedupe key)", () => {
    const db = openDatabase();
    try {
      const insert = db.prepare(
        "INSERT INTO processed_messages (message_id, status) VALUES (?, 'pending')",
      );
      insert.run("gmail-dup");
      expect(() => insert.run("gmail-dup")).toThrow(/UNIQUE constraint failed/);
    } finally {
      db.close();
    }
  });

  it("rejects statuses outside the pending|sent state machine", () => {
    const db = openDatabase();
    try {
      expect(() =>
        db.prepare(
          "INSERT INTO processed_messages (message_id, status) VALUES (?, 'bogus')",
        ).run("gmail-x"),
      ).toThrow(/CHECK constraint failed/);
    } finally {
      db.close();
    }
  });

  it("rejects duplicate client chat ids", () => {
    const db = openDatabase();
    try {
      insertClient(db, 333);
      expect(() => insertClient(db, 333)).toThrow(/UNIQUE constraint failed/);
    } finally {
      db.close();
    }
  });

  it("keeps vault rows unique per (client, kind) and enforces the client foreign key", () => {
    const db = openDatabase();
    try {
      expect(() =>
        db.prepare(
          "INSERT INTO vault (client_id, kind, iv, tag, ciphertext) VALUES (999, 'gmail_refresh', 'aa', 'bb', 'cc')",
        ).run(),
      ).toThrow(/FOREIGN KEY constraint failed/);

      insertClient(db, 444);
      const insert = db.prepare(
        "INSERT INTO vault (client_id, kind, iv, tag, ciphertext) VALUES (?, 'gmail_refresh', 'aa', 'bb', 'cc')",
      );
      insert.run(444);
      expect(() => insert.run(444)).toThrow(/UNIQUE constraint failed/);
    } finally {
      db.close();
    }
  });
});

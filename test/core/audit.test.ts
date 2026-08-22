import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { query, record } from "../../src/core/audit.js";
import { openDatabase } from "../../src/infra/db.js";

const FIXED_TIME = new Date("2026-08-22T12:00:00.000Z");

describe("audit trail", () => {
  it("persists an entry and reads it back with who / what / when", () => {
    const db = openDatabase();
    try {
      const stored = record(db, "gabri", "config_change", "margin 10 -> 8", () => FIXED_TIME);
      expect(stored).toEqual({
        actor: "gabri",
        action: "config_change",
        detail: "margin 10 -> 8",
        ts: "2026-08-22T12:00:00.000Z",
      });

      const [readBack] = query(db);
      expect(readBack).toEqual(stored);
    } finally {
      db.close();
    }
  });

  it("stamps a real UTC timestamp when no clock seam is provided", () => {
    const db = openDatabase();
    try {
      record(db, "gabri", "onboard", "first contact");
      const { ts } = query(db)[0]!;
      expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    } finally {
      db.close();
    }
  });

  it("defaults detail to an empty string", () => {
    const db = openDatabase();
    try {
      record(db, "gabri", "startup");
      expect(query(db)[0]?.detail).toBe("");
    } finally {
      db.close();
    }
  });

  it("filters by actor and by action independently (AND when combined)", () => {
    const db = openDatabase();
    try {
      let tick = 0;
      const clock = () => new Date(FIXED_TIME.getTime() + tick++);
      record(db, "gabri", "config_change", "a", clock);
      record(db, "intruder", "access_denied", "b", clock);
      record(db, "gabri", "access_denied", "c", clock);

      expect(query(db, { actor: "gabri" }).map((e) => e.detail)).toEqual(["c", "a"]);
      expect(query(db, { action: "access_denied" })).toHaveLength(2);
      expect(query(db, { actor: "gabri", action: "access_denied" }).map((e) => e.detail)).toEqual(["c"]);
    } finally {
      db.close();
    }
  });

  it("returns newest first and honors the limit", () => {
    const db = openDatabase();
    try {
      let tick = 0;
      const clock = () => new Date(FIXED_TIME.getTime() + tick++);
      for (let i = 0; i < 5; i++) record(db, "gabri", `event_${i}`, String(i), clock);

      const page = query(db, {}, 3);
      expect(page.map((e) => e.action)).toEqual(["event_4", "event_3", "event_2"]);
      expect(page[0]).toBeDefined();
    } finally {
      db.close();
    }
  });

  it("survives a reopen on a file-backed database (audit is durable)", () => {
    const dir = mkdtempSync(join(tmpdir(), "botp2p-audit-"));
    const path = join(dir, "audit.sqlite");
    let db = openDatabase(path);
    try {
      record(db, "gabri", "grant", "gmail oauth granted", () => FIXED_TIME);
      db.close();

      db = openDatabase(path);
      const rows = query(db);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ action: "grant", actor: "gabri" });
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

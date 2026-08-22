/**
 * Audit trail (design "Cross-cutting", bot-access-config "Secrets & Audit
 * Hygiene"): every privileged action - access rejections, config edits,
 * token grants - is persisted with who / what / when.
 *
 * The database handle is injected; nothing here reaches into env or global
 * state, so tests run against a throwaway in-memory SQLite instance.
 */

import type { Db } from "../infra/db.js";

export interface AuditEntry {
  actor: string;
  action: string;
  detail: string;
  /** UTC ISO-8601 timestamp, stamped by this module at write time. */
  ts: string;
}

export interface AuditFilter {
  actor?: string;
  action?: string;
  limit?: number;
}

/** Clock seam for deterministic tests. */
export type Now = () => Date;

const wallClock: Now = () => new Date();

/**
 * Records one audited event and returns the stored row. `detail` is free-form
 * context (e.g. the rejected Telegram id or the changed margin tier); it must
 * never contain secret material, mirroring the logger's redaction contract.
 */
export function record(
  db: Db,
  actor: string,
  action: string,
  detail = "",
  now: Now = wallClock,
): AuditEntry {
  const entry: AuditEntry = { actor, action, detail, ts: now().toISOString() };
  db.prepare(
    "INSERT INTO audit_log (actor, action, detail, ts) VALUES (?, ?, ?, ?)",
  ).run(entry.actor, entry.action, entry.detail, entry.ts);
  return entry;
}

/**
 * Reads audit entries, newest first. Filters are AND-combined when present;
 * `limit` defaults to a generous page rather than unbounded reads.
 */
export function query(db: Db, filter: AuditFilter = {}, limit = 100): AuditEntry[] {
  const clauses: string[] = [];
  const params: (string | number)[] = [];

  if (filter.actor !== undefined) {
    clauses.push("actor = ?");
    params.push(filter.actor);
  }
  if (filter.action !== undefined) {
    clauses.push("action = ?");
    params.push(filter.action);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  params.push(limit);
  const rows = db.prepare<{ actor: string; action: string; detail: string; ts: string }, (string | number)[]>(
    `SELECT actor, action, detail, ts FROM audit_log ${where} ORDER BY ts DESC, rowid DESC LIMIT ?`,
  ).all(...params);
  return rows.map((r) => ({ ...r }));
}

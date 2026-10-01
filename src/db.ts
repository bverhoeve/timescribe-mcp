import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { assertTimezone } from "./time.js";

/** An expected failure with a message Claude can act on. */
export class TimeScribeError extends Error {}

export const BUILT_AGAINST = "TimeScribe schema as of 2026-09 (v1.x)";

export interface TimestampRow {
  id: number;
  type: "work" | "break";
  started_at: string;
  ended_at: string | null;
  last_ping_at: string | null;
  description: string | null;
  source: string | null;
  project_id: number | null;
  paid: number;
}

export interface ProjectRow {
  id: number;
  name: string;
  description: string | null;
  color: string;
  hourly_rate: number | null;
  currency: string | null;
  deleted_at: string | null;
}

export interface WorkScheduleRow {
  valid_from: string; // "YYYY-MM-DD"
  monday: number;
  tuesday: number;
  wednesday: number;
  thursday: number;
  friday: number;
  saturday: number;
  sunday: number;
}

export function defaultDbPaths(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, home: string): string[] {
  if (platform === "darwin") return [join(home, "Library", "Application Support", "timescribe", "database", "database.sqlite")];
  if (platform === "win32" && env.APPDATA) return [join(env.APPDATA, "timescribe", "database", "database.sqlite")];
  return [];
}

export function resolveDbPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string {
  const candidates = env.TIMESCRIBE_DB_PATH ? [env.TIMESCRIBE_DB_PATH] : defaultDbPaths(platform, env, home);
  const found = candidates.find((p) => existsSync(p));
  if (found) return found;
  const tried = candidates.length ? candidates.join(", ") : `no default location for platform "${platform}"`;
  throw new TimeScribeError(
    `TimeScribe database not found (tried: ${tried}). Is TimeScribe installed? Set TIMESCRIBE_DB_PATH to the full path of database.sqlite.`,
  );
}

const REQUIRED_COLUMNS: Record<string, string[]> = {
  timestamps: ["id", "type", "started_at", "ended_at", "last_ping_at", "description", "source", "project_id", "paid", "deleted_at"],
  projects: ["id", "name", "description", "color", "hourly_rate", "currency", "deleted_at"],
  work_schedules: ["valid_from", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"],
  settings: ["group", "name", "payload"],
};

function checkSchema(db: DatabaseSync): void {
  for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
    const present = new Set(db.prepare(`PRAGMA table_info("${table}")`).all().map((c) => String(c.name)));
    if (present.size === 0) throw new TimeScribeError(schemaMessage(`table "${table}" is missing`));
    const missing = columns.filter((c) => !present.has(c));
    if (missing.length) throw new TimeScribeError(schemaMessage(`table "${table}" is missing column(s) ${missing.join(", ")}`));
  }
}

function schemaMessage(detail: string): string {
  return `Unsupported TimeScribe database: ${detail}. This server was built against ${BUILT_AGAINST}; a TimeScribe update may have changed the schema. Please open an issue.`;
}

const SQLITE_BUSY = 5;
const SQLITE_LOCKED = 6;

/** Opens the database read-only, verifies the schema, runs `fn`, always closes. */
export function withDb<T>(path: string, fn: (db: DatabaseSync) => T): T {
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(path, { readOnly: true, timeout: 2000 });
  } catch (e) {
    throw new TimeScribeError(`Could not open TimeScribe database at ${path}: ${(e as Error).message}`);
  }
  try {
    checkSchema(db);
    return fn(db);
  } catch (e) {
    const code = (e as { errcode?: number }).errcode;
    if (code === SQLITE_BUSY || code === SQLITE_LOCKED) {
      throw new TimeScribeError("TimeScribe database is busy (the app is writing). This is temporary; retry in a moment.");
    }
    if (code !== undefined) {
      throw new TimeScribeError(`Could not read TimeScribe database at ${path}: ${(e as Error).message}`);
    }
    throw e;
  } finally {
    db.close();
  }
}

/** The app's `general.timezone` setting; UTC when unset or unusable (the app's own default). */
export function getTimezone(db: DatabaseSync): string {
  const row = db.prepare(`SELECT payload FROM settings WHERE "group" = 'general' AND name = 'timezone'`).get();
  try {
    const tz = row ? JSON.parse(String(row.payload)) : null;
    if (typeof tz !== "string" || !tz) return "UTC";
    assertTimezone(tz);
    return tz;
  } catch {
    console.error(`[timescribe-mcp] unusable timezone setting ${row?.payload}, using UTC`);
    return "UTC";
  }
}

export function listProjectRows(db: DatabaseSync): ProjectRow[] {
  return db
    .prepare(`SELECT id, name, description, color, hourly_rate, currency, deleted_at FROM projects ORDER BY name, id`)
    .all() as unknown as ProjectRow[];
}

const TIMESTAMP_COLUMNS = `id, type, started_at, ended_at, last_ping_at, description, source, project_id, paid`;

export interface TimestampQuery {
  from: string; // inclusive "YYYY-MM-DD"
  to: string; // inclusive "YYYY-MM-DD"
  projectId?: number;
  type?: "work" | "break";
  limit?: number;
}

/** Non-deleted entries whose start date falls in [from, to], oldest first. */
export function listTimestampRows(db: DatabaseSync, q: TimestampQuery): TimestampRow[] {
  const where = [`deleted_at IS NULL`, `substr(started_at, 1, 10) BETWEEN ? AND ?`];
  const params: (string | number)[] = [q.from, q.to];
  if (q.projectId !== undefined) {
    where.push(`project_id = ?`);
    params.push(q.projectId);
  }
  if (q.type) {
    where.push(`type = ?`);
    params.push(q.type);
  }
  const limit = q.limit !== undefined ? ` LIMIT ${Math.floor(q.limit)}` : "";
  return db
    .prepare(`SELECT ${TIMESTAMP_COLUMNS} FROM timestamps WHERE ${where.join(" AND ")} ORDER BY started_at, id${limit}`)
    .all(...params) as unknown as TimestampRow[];
}

/** The most recently started non-deleted entry without an end, if any. */
export function getOpenTimestampRow(db: DatabaseSync): TimestampRow | undefined {
  return db
    .prepare(`SELECT ${TIMESTAMP_COLUMNS} FROM timestamps WHERE deleted_at IS NULL AND ended_at IS NULL ORDER BY started_at DESC, id DESC LIMIT 1`)
    .get() as unknown as TimestampRow | undefined;
}

export function listWorkScheduleRows(db: DatabaseSync): WorkScheduleRow[] {
  return db
    .prepare(
      `SELECT substr(valid_from, 1, 10) AS valid_from, monday, tuesday, wednesday, thursday, friday, saturday, sunday
       FROM work_schedules ORDER BY valid_from`,
    )
    .all() as unknown as WorkScheduleRow[];
}

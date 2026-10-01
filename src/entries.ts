import { type ProjectRow, TimeScribeError, type TimestampRow } from "./db.js";
import { dateIn, isoWeek, naiveToEpoch, toIso } from "./time.js";

/** TimeScribe auto-closes open entries whose last ping is older than this (createStopByOldTimestamps). */
export const STALE_PING_MS = 60 * 60 * 1000;

export interface Range {
  from: string;
  to: string;
  timezone: string;
}

/** Both dates or neither; neither = the ISO week containing today in `tz`. */
export function resolveRange(args: { from?: string; to?: string }, tz: string, nowMs: number): Range {
  if ((args.from === undefined) !== (args.to === undefined)) {
    throw new TimeScribeError("Pass both `from` and `to`, or neither for the current week.");
  }
  if (args.from !== undefined && args.to !== undefined) {
    if (args.from > args.to) throw new TimeScribeError(`\`from\` (${args.from}) is after \`to\` (${args.to}).`);
    return { from: args.from, to: args.to, timezone: tz };
  }
  return { ...isoWeek(dateIn(nowMs, tz)), timezone: tz };
}

export interface ResolvedTimestamp {
  row: TimestampRow;
  date: string; // start date, "YYYY-MM-DD"
  startMs: number;
  endMs: number;
  seconds: number;
  running: boolean;
}

/**
 * Closed entry: ended_at. Open entry with a ping in the last hour: now (the timer is running).
 * Open entry with an older ping: last_ping_at (the app was closed; don't count phantom hours).
 */
export function resolveTimestamp(row: TimestampRow, tz: string, nowMs: number): ResolvedTimestamp {
  const startMs = naiveToEpoch(row.started_at, tz);
  let endMs: number;
  let running = false;
  if (row.ended_at) {
    endMs = naiveToEpoch(row.ended_at, tz);
  } else {
    const pingMs = row.last_ping_at ? naiveToEpoch(row.last_ping_at, tz) : startMs;
    running = nowMs - pingMs <= STALE_PING_MS;
    endMs = running ? nowMs : pingMs;
  }
  const seconds = Math.max(0, Math.floor((endMs - startMs) / 1000));
  return { row, date: row.started_at.slice(0, 10), startMs, endMs, seconds, running };
}

export function hours(seconds: number): number {
  return Math.round(seconds / 36) / 100;
}

export function projectMap(rows: ProjectRow[]): Map<number, ProjectRow> {
  return new Map(rows.map((p) => [p.id, p]));
}

export function projectName(projects: Map<number, ProjectRow>, id: number | null): string | null {
  return id === null ? null : (projects.get(id)?.name ?? null);
}

export interface Entry {
  id: number;
  type: "work" | "break";
  project_id: number | null;
  project: string | null;
  description: string | null;
  started_at: string;
  ended_at: string | null;
  hours: number;
  running: boolean;
  paid: boolean;
  source: string | null;
}

export function toEntry(t: ResolvedTimestamp, projects: Map<number, ProjectRow>, tz: string): Entry {
  const { row } = t;
  return {
    id: row.id,
    type: row.type,
    project_id: row.project_id,
    project: projectName(projects, row.project_id),
    description: row.description,
    started_at: toIso(t.startMs, tz),
    ended_at: row.ended_at ? toIso(t.endMs, tz) : null,
    hours: hours(t.seconds),
    running: t.running,
    paid: Boolean(row.paid),
    source: row.source,
  };
}

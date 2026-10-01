import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  TimeScribeError,
  defaultDbPaths,
  getOpenTimestampRow,
  getTimezone,
  listProjectRows,
  listTimestampRows,
  listWorkScheduleRows,
  resolveDbPath,
  withDb,
} from "../src/db.js";
import { createFixtureDb } from "./fixture.js";

describe("resolveDbPath", () => {
  it("has OS defaults for macOS and Windows only", () => {
    expect(defaultDbPaths("darwin", {}, "/Users/me")).toEqual([
      "/Users/me/Library/Application Support/timescribe/database/database.sqlite",
    ]);
    expect(defaultDbPaths("win32", { APPDATA: "C:\\Users\\me\\AppData\\Roaming" }, "C:\\Users\\me")[0]).toMatch(
      /timescribe[\\/]database[\\/]database\.sqlite$/,
    );
    expect(defaultDbPaths("linux", {}, "/home/me")).toEqual([]);
  });

  it("prefers TIMESCRIBE_DB_PATH", () => {
    const path = createFixtureDb();
    expect(resolveDbPath({ TIMESCRIBE_DB_PATH: path }, "darwin", "/nowhere")).toBe(path);
  });

  it("names the paths it tried when nothing exists", () => {
    expect(() => resolveDbPath({ TIMESCRIBE_DB_PATH: "/nope/database.sqlite" }, "darwin", "/x")).toThrow(
      /tried: \/nope\/database\.sqlite.*TIMESCRIBE_DB_PATH/,
    );
    expect(() => resolveDbPath({}, "linux", "/home/me")).toThrow(/no default location for platform "linux"/);
  });
});

describe("withDb", () => {
  it("opens read-only", () => {
    const path = createFixtureDb();
    expect(() => withDb(path, (db) => db.exec("DELETE FROM timestamps"))).toThrow(/readonly/);
    expect(withDb(path, (db) => listTimestampRows(db, { from: "2026-01-01", to: "2026-12-31" }).length)).toBe(9);
  });

  it("reports a schema mismatch with the missing column", () => {
    const path = createFixtureDb({ sql: `ALTER TABLE timestamps DROP COLUMN last_ping_at;` });
    expect(() => withDb(path, () => 1)).toThrow(TimeScribeError);
    expect(() => withDb(path, () => 1)).toThrow(/table "timestamps" is missing column\(s\) last_ping_at/);
  });

  it("reports a file that is not a database", () => {
    const path = join(mkdtempSync(join(tmpdir(), "ts-")), "database.sqlite");
    writeFileSync(path, "definitely not sqlite");
    expect(() => withDb(path, () => 1)).toThrow(TimeScribeError);
  });

  it("reports a busy database as retryable", () => {
    const path = createFixtureDb();
    const writer = new DatabaseSync(path);
    writer.exec("PRAGMA locking_mode = EXCLUSIVE; BEGIN EXCLUSIVE;");
    try {
      expect(() => withDb(path, (db) => listProjectRows(db))).toThrow(/busy.*retry/);
    } finally {
      writer.exec("ROLLBACK");
      writer.close();
    }
  }, 10_000);
});

describe("queries", () => {
  it("reads the timezone setting, falling back to UTC", () => {
    expect(withDb(createFixtureDb(), getTimezone)).toBe("Europe/Amsterdam");
    expect(withDb(createFixtureDb({ timezone: null }), getTimezone)).toBe("UTC");
  });

  it("falls back to UTC for an unknown zone or a corrupt payload", () => {
    expect(withDb(createFixtureDb({ timezone: "Mars/Olympus_Mons" }), getTimezone)).toBe("UTC");
    const corrupt = createFixtureDb({ timezone: null, sql: `INSERT INTO settings ("group", name, payload) VALUES ('general', 'timezone', 'not json');` });
    expect(withDb(corrupt, getTimezone)).toBe("UTC");
  });

  it("filters entries by start date, excludes soft-deleted, orders by start", () => {
    const ids = withDb(createFixtureDb(), (db) => listTimestampRows(db, { from: "2026-09-28", to: "2026-10-04" })).map((r) => r.id);
    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 10]);
  });

  it("filters by project, type and limit", () => {
    const path = createFixtureDb();
    const range = { from: "2026-09-28", to: "2026-10-04" };
    expect(withDb(path, (db) => listTimestampRows(db, { ...range, projectId: 2 })).map((r) => r.id)).toEqual([3, 4, 10]);
    expect(withDb(path, (db) => listTimestampRows(db, { ...range, type: "break" })).map((r) => r.id)).toEqual([2]);
    expect(withDb(path, (db) => listTimestampRows(db, { ...range, limit: 2 })).map((r) => r.id)).toEqual([1, 2]);
  });

  it("finds the latest open entry", () => {
    expect(withDb(createFixtureDb(), getOpenTimestampRow)?.id).toBe(10);
  });

  it("includes archived projects", () => {
    const projects = withDb(createFixtureDb(), listProjectRows);
    expect(projects.map((p) => [p.id, p.deleted_at !== null])).toEqual([
      [3, true],
      [1, false],
      [2, false],
    ]);
  });

  it("normalises schedule valid_from to a date", () => {
    expect(withDb(createFixtureDb(), listWorkScheduleRows).map((s) => [s.valid_from, s.monday])).toEqual([
      ["2026-09-07", 8],
      ["2026-09-30", 6],
    ]);
  });
});

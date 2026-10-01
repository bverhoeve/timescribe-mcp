import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

// CREATE TABLE statements copied from a real TimeScribe database (2026-09).
const SCHEMA = `
CREATE TABLE "settings" ("id" integer primary key autoincrement not null, "group" varchar not null, "name" varchar not null, "locked" tinyint(1) not null default '0', "payload" text not null, "created_at" datetime, "updated_at" datetime);
CREATE TABLE "projects" ("id" integer primary key autoincrement not null, "name" varchar not null, "description" varchar, "color" varchar not null default '#000000', "icon" varchar, "hourly_rate" numeric, "currency" varchar, "created_at" datetime, "updated_at" datetime, "deleted_at" datetime, "metadata" text);
CREATE TABLE "timestamps" ("id" integer primary key autoincrement not null, "type" varchar not null, "started_at" datetime not null, "ended_at" datetime, "description" varchar, "created_at" datetime, "updated_at" datetime, "deleted_at" datetime, "last_ping_at" datetime, "source" varchar, "project_id" integer, "paid" tinyint(1) not null default '0', foreign key("project_id") references "projects"("id") on delete set null);
CREATE TABLE "work_schedules" ("id" integer primary key autoincrement not null, "sunday" numeric not null default '0', "monday" numeric not null default '0', "tuesday" numeric not null default '0', "wednesday" numeric not null default '0', "thursday" numeric not null default '0', "friday" numeric not null default '0', "saturday" numeric not null default '0', "valid_from" date not null, "created_at" datetime, "updated_at" datetime);
`;

/** "Now" for tests: Wednesday 2026-09-30 16:00:00 Europe/Amsterdam. */
export const NOW = Date.parse("2026-09-30T14:00:00Z");

export interface Seed {
  timezone?: string | null; // null = no timezone setting row
  sql?: string; // extra statements run after the default seed
}

/**
 * Creates a TimeScribe-shaped database in a temp dir and returns its path.
 *
 * Default seed (timezone Europe/Amsterdam, week of Mon 2026-09-28):
 * - projects: 1 Reviews, 2 Roadmap, 3 Old (soft-deleted)
 * - schedule: 8h Mon-Fri from 2026-09-07; 6h Mon-Fri from 2026-09-30
 * - Mon 09:00-11:00 work Reviews (2h), 11:00-11:30 break
 * - Mon 23:00-23:59:59 work Roadmap; Tue 00:00-01:00 work Roadmap (midnight split by the app)
 * - Tue 10:00-10:30 work no project
 * - Tue 12:00-13:00 work Old (archived project)
 * - Tue 14:00-15:00 work Reviews, soft-deleted (must be ignored)
 * - Sun 2026-09-27 10:00-11:00 work Reviews (previous week, outside default range)
 * - Mon 2026-09-21 09:00, open, last ping 09:30 (stale; counts until the ping)
 * - Wed 15:00, open, last ping 15:59 Roadmap (running; counts until NOW)
 */
export function createFixtureDb(seed: Seed = {}): string {
  const path = join(mkdtempSync(join(tmpdir(), "timescribe-mcp-")), "database.sqlite");
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  const tz = seed.timezone === undefined ? "Europe/Amsterdam" : seed.timezone;
  if (tz !== null) {
    db.prepare(`INSERT INTO settings ("group", name, payload) VALUES ('general', 'timezone', ?)`).run(JSON.stringify(tz));
  }
  db.exec(`
    INSERT INTO projects (id, name, color, hourly_rate, currency, deleted_at) VALUES
      (1, 'Reviews', '#ff0000', 100, 'EUR', NULL),
      (2, 'Roadmap', '#00ff00', NULL, NULL, NULL),
      (3, 'Old', '#0000ff', NULL, NULL, '2026-09-01 10:00:00');
    INSERT INTO work_schedules (valid_from, monday, tuesday, wednesday, thursday, friday) VALUES
      ('2026-09-07 00:00:00', 8, 8, 8, 8, 8),
      ('2026-09-30 00:00:00', 6, 6, 6, 6, 6);
    INSERT INTO timestamps (id, type, started_at, ended_at, last_ping_at, description, source, project_id, paid, deleted_at) VALUES
      (1, 'work',  '2026-09-28 09:00:00', '2026-09-28 11:00:00', '2026-09-28 11:00:00', 'PR reviews', NULL, 1, 1, NULL),
      (2, 'break', '2026-09-28 11:00:00', '2026-09-28 11:30:00', '2026-09-28 11:30:00', NULL, NULL, NULL, 0, NULL),
      (3, 'work',  '2026-09-28 23:00:00', '2026-09-28 23:59:59', '2026-09-28 23:59:59', NULL, NULL, 2, 0, NULL),
      (4, 'work',  '2026-09-29 00:00:00', '2026-09-29 01:00:00', '2026-09-29 01:00:00', NULL, NULL, 2, 0, NULL),
      (5, 'work',  '2026-09-29 10:00:00', '2026-09-29 10:30:00', '2026-09-29 10:30:00', NULL, 'import', NULL, 0, NULL),
      (6, 'work',  '2026-09-29 12:00:00', '2026-09-29 13:00:00', '2026-09-29 13:00:00', NULL, NULL, 3, 0, NULL),
      (7, 'work',  '2026-09-29 14:00:00', '2026-09-29 15:00:00', '2026-09-29 15:00:00', NULL, NULL, 1, 0, '2026-09-29 16:00:00'),
      (8, 'work',  '2026-09-27 10:00:00', '2026-09-27 11:00:00', '2026-09-27 11:00:00', NULL, NULL, 1, 0, NULL),
      (9, 'work',  '2026-09-21 09:00:00', NULL, '2026-09-21 09:30:00', NULL, NULL, 1, 0, NULL),
      (10, 'work', '2026-09-30 15:00:00', NULL, '2026-09-30 15:59:00', NULL, NULL, 2, 0, NULL);
  `);
  if (seed.sql) db.exec(seed.sql);
  db.close();
  return path;
}

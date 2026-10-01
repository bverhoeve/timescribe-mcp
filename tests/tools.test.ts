import { describe, expect, it } from "vitest";
import { withDb } from "../src/db.js";
import { getTimeSummary, scheduledHours } from "../src/tools/getTimeSummary.js";
import { MAX_ENTRIES, listEntries } from "../src/tools/listEntries.js";
import { listProjects } from "../src/tools/listProjects.js";
import { NOW, createFixtureDb } from "./fixture.js";

describe("list_projects", () => {
  it("returns all projects with archived flag and numeric rate", () => {
    const { projects } = withDb(createFixtureDb(), listProjects);
    expect(projects).toContainEqual({ id: 1, name: "Reviews", description: null, color: "#ff0000", hourly_rate: 100, currency: "EUR", archived: false });
    expect(projects.find((p) => p.id === 3)?.archived).toBe(true);
  });
});

describe("list_entries", () => {
  const run = (args = {}, seed = {}) => withDb(createFixtureDb(seed), (db) => listEntries(db, args, NOW));

  it("defaults to the current week and maps every field", () => {
    const out = run();
    expect(out.range).toEqual({ from: "2026-09-28", to: "2026-10-04", timezone: "Europe/Amsterdam" });
    expect(out.entries.map((e) => e.id)).toEqual([1, 2, 3, 4, 5, 6, 10]);
    expect(out.entries[0]).toEqual({
      id: 1, type: "work", project_id: 1, project: "Reviews", description: "PR reviews",
      started_at: "2026-09-28T09:00:00+02:00", ended_at: "2026-09-28T11:00:00+02:00",
      hours: 2, running: false, paid: true, source: null,
    });
    expect(out.truncated).toBe(false);
  });

  it("marks the running entry and resolves archived and missing projects", () => {
    const out = run();
    expect(out.entries.find((e) => e.id === 10)).toMatchObject({ running: true, ended_at: null, hours: 1 });
    expect(out.entries.find((e) => e.id === 6)?.project).toBe("Old");
    expect(out.entries.find((e) => e.id === 5)).toMatchObject({ project_id: null, project: null, source: "import" });
  });

  it("stale open entry counts until its last ping and is not running", () => {
    const out = run({ from: "2026-09-21", to: "2026-09-21" });
    expect(out.entries).toEqual([expect.objectContaining({ id: 9, running: false, ended_at: null, hours: 0.5 })]);
  });

  it("filters by project and type", () => {
    expect(run({ project_id: 2 }).entries.map((e) => e.id)).toEqual([3, 4, 10]);
    expect(run({ type: "break" }).entries.map((e) => e.id)).toEqual([2]);
  });

  it(`truncates at ${MAX_ENTRIES}`, () => {
    const values = Array.from({ length: MAX_ENTRIES + 5 }, (_, i) => `('work', '2026-09-02 08:00:00', '2026-09-02 08:01:00', ${i})`).join(",");
    const out = run({ from: "2026-09-02", to: "2026-09-02" }, { sql: `INSERT INTO timestamps (type, started_at, ended_at, paid) VALUES ${values};` });
    expect(out.entries).toHaveLength(MAX_ENTRIES);
    expect(out.truncated).toBe(true);
  });
});

describe("get_time_summary", () => {
  const run = (args = {}) => withDb(createFixtureDb(), (db) => getTimeSummary(db, args, NOW));

  it("totals the current week: work, break, schedule, running timer", () => {
    const out = run();
    // Work: 2 (Reviews) + 0.999722 + 1 (Roadmap, midnight split) + 0.5 (no project) + 1 (Old) + 1 (running) = 6.4997h
    expect(out.totals).toEqual({ work_hours: 6.5, break_hours: 0.5, scheduled_hours: 8 + 8 + 6 + 6 + 6 });
    expect(out.running_timer).toEqual({ id: 10, type: "work", project_id: 2, project: "Roadmap", started_at: "2026-09-30T15:00:00+02:00" });
  });

  it("groups per project, largest first, with a no-project group", () => {
    expect(run().groups).toEqual([
      { project_id: 2, project: "Roadmap", work_hours: 3 },
      { project_id: 1, project: "Reviews", work_hours: 2 },
      { project_id: 3, project: "Old", work_hours: 1 },
      { project_id: null, project: null, work_hours: 0.5 },
    ]);
  });

  it("groups per day including breaks; entries count on their start day", () => {
    expect(run({ group_by: "day" }).groups).toEqual([
      { date: "2026-09-28", work_hours: 3, break_hours: 0.5 },
      { date: "2026-09-29", work_hours: 2.5, break_hours: 0 },
      { date: "2026-09-30", work_hours: 1, break_hours: 0 },
    ]);
  });

  it("groups per project per day", () => {
    expect(run({ group_by: "project_day" }).groups).toContainEqual({ date: "2026-09-29", project_id: 2, project: "Roadmap", work_hours: 1 });
  });

  it("an explicit past range excludes other weeks and still reports the running timer", () => {
    const out = run({ from: "2026-09-27", to: "2026-09-27" });
    expect(out.totals).toEqual({ work_hours: 1, break_hours: 0, scheduled_hours: 0 });
    expect(out.running_timer?.id).toBe(10);
  });

  it("empty range gives zeros, not errors", () => {
    expect(run({ from: "2025-01-01", to: "2025-01-07" })).toMatchObject({ totals: { work_hours: 0, break_hours: 0, scheduled_hours: 0 }, groups: [] });
  });
});

describe("scheduledHours", () => {
  const schedules = [
    { valid_from: "2026-09-07", monday: 8, tuesday: 8, wednesday: 8, thursday: 8, friday: 8, saturday: 0, sunday: 0 },
    { valid_from: "2026-09-30", monday: 6, tuesday: 6, wednesday: 6, thursday: 6, friday: 6, saturday: 0, sunday: 0 },
  ];
  it("switches schedule mid-week and ignores days before any schedule", () => {
    expect(scheduledHours(schedules, "2026-09-28", "2026-10-04")).toBe(34);
    expect(scheduledHours(schedules, "2026-09-01", "2026-09-06")).toBe(0);
  });
  it("handles fractional hours", () => {
    expect(scheduledHours([{ ...schedules[0], monday: 7.6 }], "2026-09-28", "2026-09-28")).toBe(7.6);
  });
});

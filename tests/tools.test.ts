import { describe, expect, it } from "vitest";
import { withDb } from "../src/db.js";
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

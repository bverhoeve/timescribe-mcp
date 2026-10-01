import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { getTimezone, listProjectRows, listTimestampRows } from "../db.js";
import { projectMap, resolveRange, resolveTimestamp, toEntry } from "../entries.js";
import { rangeArgs, rangeOut } from "./schemas.js";

export const MAX_ENTRIES = 500;

const args = {
  ...rangeArgs,
  project_id: z.number().int().optional().describe("Only entries for this project id (see list_projects)"),
  type: z.enum(["work", "break"]).optional().describe("Only work or only break entries; default both"),
};

export const listEntriesTool = {
  name: "list_entries",
  config: {
    title: "List TimeScribe time entries",
    description:
      "List individual TimeScribe time entries (work and break intervals) that started in a date range, oldest first. " +
      "Use for detail behind a total; use get_time_summary for totals. Defaults to the current ISO week. " +
      `Returns at most ${MAX_ENTRIES} entries; truncated=true means narrow the range.`,
    inputSchema: args,
    outputSchema: {
      range: rangeOut,
      entries: z.array(
        z.object({
          id: z.number(),
          type: z.enum(["work", "break"]),
          project_id: z.number().nullable(),
          project: z.string().nullable(),
          description: z.string().nullable(),
          started_at: z.string(),
          ended_at: z.string().nullable(),
          hours: z.number(),
          running: z.boolean(),
          paid: z.boolean(),
          source: z.string().nullable(),
        }),
      ),
      truncated: z.boolean(),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
};

export type ListEntriesArgs = { from?: string; to?: string; project_id?: number; type?: "work" | "break" };

export function listEntries(db: DatabaseSync, a: ListEntriesArgs, nowMs: number) {
  const tz = getTimezone(db);
  const range = resolveRange(a, tz, nowMs);
  const rows = listTimestampRows(db, { from: range.from, to: range.to, projectId: a.project_id, type: a.type, limit: MAX_ENTRIES + 1 });
  const projects = projectMap(listProjectRows(db));
  return {
    range,
    entries: rows.slice(0, MAX_ENTRIES).map((r) => toEntry(resolveTimestamp(r, tz, nowMs), projects, tz)),
    truncated: rows.length > MAX_ENTRIES,
  };
}

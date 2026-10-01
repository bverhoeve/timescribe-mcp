import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { type WorkScheduleRow, getOpenTimestampRow, getTimezone, listProjectRows, listTimestampRows, listWorkScheduleRows } from "../db.js";
import { hours, projectMap, projectName, resolveRange, resolveTimestamp } from "../entries.js";
import { eachDate, toIso, weekday } from "../time.js";
import { rangeArgs, rangeOut } from "./schemas.js";

const args = {
  ...rangeArgs,
  group_by: z
    .enum(["project", "day", "project_day"])
    .optional()
    .describe("How to split the totals: per project (default), per day, or per project per day"),
};

const group = z.object({
  date: z.string().optional(),
  project_id: z.number().nullable().optional(),
  project: z.string().nullable().optional(),
  work_hours: z.number(),
  break_hours: z.number().optional(),
});

export const getTimeSummaryTool = {
  name: "get_time_summary",
  config: {
    title: "Summarise tracked time",
    description:
      "Total tracked work and break hours in TimeScribe for a date range (default: current ISO week, Monday to Sunday), " +
      "split per project, per day, or per project per day. Entries count on the day they started. " +
      "work_hours is tracked time only: unlike the TimeScribe app it does not credit public holidays or absences. " +
      "scheduled_hours is the planned hours from the work schedule, without deducting holidays or absences. " +
      "Entries without a project appear with project_id null. Also reports the currently running timer.",
    inputSchema: args,
    outputSchema: {
      range: rangeOut,
      totals: z.object({ work_hours: z.number(), break_hours: z.number(), scheduled_hours: z.number() }),
      groups: z.array(group),
      running_timer: z
        .object({
          id: z.number(),
          type: z.enum(["work", "break"]),
          project_id: z.number().nullable(),
          project: z.string().nullable(),
          started_at: z.string(),
        })
        .nullable(),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
};

export type GroupBy = "project" | "day" | "project_day";
export type GetTimeSummaryArgs = { from?: string; to?: string; group_by?: GroupBy };

export function getTimeSummary(db: DatabaseSync, a: GetTimeSummaryArgs, nowMs: number) {
  const tz = getTimezone(db);
  const range = resolveRange(a, tz, nowMs);
  const groupBy = a.group_by ?? "project";
  const projects = projectMap(listProjectRows(db));
  const resolved = listTimestampRows(db, { from: range.from, to: range.to }).map((r) => resolveTimestamp(r, tz, nowMs));

  let workSeconds = 0;
  let breakSeconds = 0;
  const groups = new Map<string, { date?: string; project_id?: number | null; work: number; break: number }>();

  for (const t of resolved) {
    const isWork = t.row.type === "work";
    if (isWork) workSeconds += t.seconds;
    else breakSeconds += t.seconds;
    // Breaks have no project, so they only show up in per-day groups.
    if (!isWork && groupBy !== "day") continue;
    const key = groupBy === "project" ? `${t.row.project_id}` : groupBy === "day" ? t.date : `${t.date}|${t.row.project_id}`;
    let g = groups.get(key);
    if (!g) {
      g = { work: 0, break: 0 };
      if (groupBy !== "project") g.date = t.date;
      if (groupBy !== "day") g.project_id = t.row.project_id;
      groups.set(key, g);
    }
    if (isWork) g.work += t.seconds;
    else g.break += t.seconds;
  }

  const out = [...groups.values()].map((g) => {
    if (groupBy === "day") return { date: g.date, work_hours: hours(g.work), break_hours: hours(g.break) };
    const project = { project_id: g.project_id ?? null, project: projectName(projects, g.project_id ?? null) };
    return groupBy === "project" ? { ...project, work_hours: hours(g.work) } : { date: g.date, ...project, work_hours: hours(g.work) };
  });
  if (groupBy === "project") out.sort((x, y) => y.work_hours - x.work_hours);

  const open = getOpenTimestampRow(db);
  const openResolved = open ? resolveTimestamp(open, tz, nowMs) : undefined;

  return {
    range,
    totals: {
      work_hours: hours(workSeconds),
      break_hours: hours(breakSeconds),
      scheduled_hours: scheduledHours(listWorkScheduleRows(db), range.from, range.to),
    },
    groups: out,
    running_timer:
      open && openResolved?.running
        ? {
            id: open.id,
            type: open.type,
            project_id: open.project_id,
            project: projectName(projects, open.project_id),
            started_at: toIso(openResolved.startMs, tz),
          }
        : null,
  };
}

/** Sum of each day's planned hours, using the schedule with the latest valid_from on or before that day. */
export function scheduledHours(schedules: WorkScheduleRow[], from: string, to: string): number {
  let total = 0;
  for (const date of eachDate(from, to)) {
    const active = schedules.filter((s) => s.valid_from <= date).at(-1); // rows are sorted by valid_from
    if (active) total += Number(active[weekday(date)]);
  }
  return Math.round(total * 100) / 100;
}

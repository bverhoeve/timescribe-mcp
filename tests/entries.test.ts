import { describe, expect, it } from "vitest";
import type { TimestampRow } from "../src/db.js";
import { hours, resolveRange, resolveTimestamp } from "../src/entries.js";
import { NOW } from "./fixture.js";

const AMS = "Europe/Amsterdam";
const row = (over: Partial<TimestampRow>): TimestampRow => ({
  id: 1,
  type: "work",
  started_at: "2026-09-30 09:00:00",
  ended_at: "2026-09-30 10:00:00",
  last_ping_at: null,
  description: null,
  source: null,
  project_id: null,
  paid: 0,
  ...over,
});

describe("resolveRange", () => {
  it("defaults to the ISO week of today in the app timezone", () => {
    expect(resolveRange({}, AMS, NOW)).toEqual({ from: "2026-09-28", to: "2026-10-04", timezone: AMS });
  });

  it("uses the app timezone to decide what today is", () => {
    // Sunday 23:30 UTC is already Monday in Amsterdam: next week.
    expect(resolveRange({}, AMS, Date.parse("2026-10-04T22:30:00Z")).from).toBe("2026-10-05");
  });

  it("accepts an explicit inclusive range, including a single day", () => {
    expect(resolveRange({ from: "2026-09-30", to: "2026-09-30" }, AMS, NOW).to).toBe("2026-09-30");
  });

  it("rejects half a range and reversed ranges", () => {
    expect(() => resolveRange({ from: "2026-09-01" }, AMS, NOW)).toThrow(/both/);
    expect(() => resolveRange({ from: "2026-09-30", to: "2026-09-01" }, AMS, NOW)).toThrow(/after/);
  });
});

describe("resolveTimestamp", () => {
  it("closed entry: ended_at - started_at in whole seconds", () => {
    const t = resolveTimestamp(row({ ended_at: "2026-09-30 10:00:00.9" }), AMS, NOW);
    expect([t.seconds, t.running, t.date]).toEqual([3600, false, "2026-09-30"]);
  });

  it("open entry with a fresh ping runs until now", () => {
    const t = resolveTimestamp(row({ started_at: "2026-09-30 15:00:00", ended_at: null, last_ping_at: "2026-09-30 15:59:00" }), AMS, NOW);
    expect([t.seconds, t.running]).toEqual([3600, true]);
  });

  it("open entry with a stale ping stops at the ping", () => {
    const t = resolveTimestamp(row({ started_at: "2026-09-30 09:00:00", ended_at: null, last_ping_at: "2026-09-30 09:30:00" }), AMS, NOW);
    expect([t.seconds, t.running]).toEqual([1800, false]);
  });

  it("open entry without any ping counts zero", () => {
    const t = resolveTimestamp(row({ started_at: "2026-09-21 09:00:00", ended_at: null }), AMS, NOW);
    expect([t.seconds, t.running]).toEqual([0, false]);
  });

  it("accepts ISO 'T' separators from imported entries", () => {
    expect(resolveTimestamp(row({ started_at: "2026-09-30T09:00:00", ended_at: "2026-09-30T09:30:00" }), AMS, NOW).seconds).toBe(1800);
  });

  it("never returns negative durations", () => {
    expect(resolveTimestamp(row({ ended_at: "2026-09-30 08:00:00" }), AMS, NOW).seconds).toBe(0);
  });

  it("counts real time across the DST change", () => {
    expect(resolveTimestamp(row({ started_at: "2026-10-25 01:00:00", ended_at: "2026-10-25 04:00:00" }), AMS, NOW).seconds).toBe(4 * 3600);
  });
});

it("hours rounds to 2 decimals", () => {
  expect(hours(3600)).toBe(1);
  expect(hours(1321)).toBe(0.37);
  expect(hours(0)).toBe(0);
});

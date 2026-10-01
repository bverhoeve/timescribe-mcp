import { describe, expect, it } from "vitest";
import { dateIn, eachDate, isoWeek, naiveToEpoch, toIso, weekday } from "../src/time.js";

const AMS = "Europe/Amsterdam";

describe("naiveToEpoch / toIso", () => {
  it("round-trips a summer time", () => {
    const ms = naiveToEpoch("2026-09-30 15:09:21", AMS);
    expect(new Date(ms).toISOString()).toBe("2026-09-30T13:09:21.000Z");
    expect(toIso(ms, AMS)).toBe("2026-09-30T15:09:21+02:00");
  });

  it("uses the winter offset after the October DST change", () => {
    const ms = naiveToEpoch("2026-10-26 09:00:00", AMS);
    expect(toIso(ms, AMS)).toBe("2026-10-26T09:00:00+01:00");
  });

  it("measures real elapsed time across the DST change", () => {
    // Clocks go back 03:00 -> 02:00 on 2026-10-25, so 00:00 -> 06:00 is 7 real hours.
    const start = naiveToEpoch("2026-10-25 00:00:00", AMS);
    const end = naiveToEpoch("2026-10-25 06:00:00", AMS);
    expect((end - start) / 3_600_000).toBe(7);
  });

  it("handles UTC and negative offsets", () => {
    expect(toIso(naiveToEpoch("2026-01-15 08:00:00", "UTC"), "UTC")).toBe("2026-01-15T08:00:00+00:00");
    expect(toIso(naiveToEpoch("2026-01-15 08:00:00", "America/New_York"), "America/New_York")).toBe(
      "2026-01-15T08:00:00-05:00",
    );
  });

  it("rejects garbage", () => {
    expect(() => naiveToEpoch("not a date", AMS)).toThrow(/Unparseable/);
  });
});

describe("calendar helpers", () => {
  it("dateIn uses the zone, not UTC", () => {
    // 23:30 UTC on Sep 30 is already Oct 1 in Amsterdam.
    expect(dateIn(Date.parse("2026-09-30T23:30:00Z"), AMS)).toBe("2026-10-01");
  });

  it("isoWeek runs Monday to Sunday", () => {
    expect(isoWeek("2026-09-30")).toEqual({ from: "2026-09-28", to: "2026-10-04" });
    expect(isoWeek("2026-10-04")).toEqual({ from: "2026-09-28", to: "2026-10-04" });
    expect(isoWeek("2026-09-28")).toEqual({ from: "2026-09-28", to: "2026-10-04" });
  });

  it("eachDate is inclusive and crosses months", () => {
    expect(eachDate("2026-09-29", "2026-10-02")).toEqual(["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]);
  });

  it("weekday names", () => {
    expect(weekday("2026-09-30")).toBe("wednesday");
    expect(weekday("2026-10-04")).toBe("sunday");
  });
});

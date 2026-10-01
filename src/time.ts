// TimeScribe stores naive local wall-clock strings ("2026-09-30 15:09:21")
// in the app timezone. These helpers convert them to real instants and back.

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(tz, f);
  }
  return f;
}

function wallClock(epochMs: number, tz: string): { date: string; time: string; utcMs: number } {
  const p = Object.fromEntries(formatter(tz).formatToParts(new Date(epochMs)).map((x) => [x.type, x.value]));
  const date = `${p.year}-${p.month}-${p.day}`;
  const time = `${p.hour}:${p.minute}:${p.second}`;
  return { date, time, utcMs: Date.parse(`${date}T${time}Z`) };
}

/** Offset of `tz` from UTC at the given instant, in ms (Amsterdam summer: +7_200_000). */
export function offsetMs(epochMs: number, tz: string): number {
  return wallClock(epochMs, tz).utcMs - Math.floor(epochMs / 1000) * 1000;
}

/** Throws RangeError for an unknown IANA zone. */
export function assertTimezone(tz: string): void {
  formatter(tz);
}

/** "2026-09-30 15:09:21" in `tz` -> epoch ms. */
export function naiveToEpoch(naive: string, tz: string): number {
  const asUtc = Date.parse(`${naive.slice(0, 10)}T${naive.slice(11, 19) || "00:00:00"}Z`);
  if (Number.isNaN(asUtc)) throw new Error(`Unparseable TimeScribe datetime: ${naive}`);
  // First guess uses the offset at the UTC reading; the second pass corrects it near DST changes.
  const guess = asUtc - offsetMs(asUtc, tz);
  return asUtc - offsetMs(guess, tz);
}

/** epoch ms -> "2026-09-30T15:09:21+02:00" */
export function toIso(epochMs: number, tz: string): string {
  const { date, time } = wallClock(epochMs, tz);
  const off = offsetMs(epochMs, tz) / 60_000;
  const sign = off < 0 ? "-" : "+";
  const abs = Math.abs(off);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${date}T${time}${sign}${hh}:${mm}`;
}

/** Calendar date ("YYYY-MM-DD") of the instant in `tz`. */
export function dateIn(epochMs: number, tz: string): string {
  return wallClock(epochMs, tz).date;
}

const DAY_MS = 86_400_000;

/** Monday..Sunday of the ISO week containing `date`. */
export function isoWeek(date: string): { from: string; to: string } {
  const ms = Date.parse(`${date}T00:00:00Z`);
  const mondayOffset = (new Date(ms).getUTCDay() + 6) % 7;
  const monday = ms - mondayOffset * DAY_MS;
  return { from: iso(monday), to: iso(monday + 6 * DAY_MS) };
}

/** Every date from `from` to `to`, inclusive. */
export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  for (let ms = Date.parse(`${from}T00:00:00Z`); ms <= Date.parse(`${to}T00:00:00Z`); ms += DAY_MS) out.push(iso(ms));
  return out;
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export function weekday(date: string): Weekday {
  return WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
}

function iso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

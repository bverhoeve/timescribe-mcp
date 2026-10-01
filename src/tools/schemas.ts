import { z } from "zod";

export const dateArg = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((s) => {
    // Rejects dates that don't exist (2026-02-30 would otherwise roll over to March 2).
    const ms = Date.parse(`${s}T00:00:00Z`);
    return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === s;
  }, "Not a real calendar date")
  .describe("Inclusive date (YYYY-MM-DD) in the TimeScribe app timezone");

export const rangeArgs = {
  from: dateArg.optional().describe("Start date, inclusive (YYYY-MM-DD). Pass with `to`, or omit both for the current ISO week."),
  to: dateArg.optional().describe("End date, inclusive (YYYY-MM-DD). Pass with `from`, or omit both for the current ISO week."),
};

export const rangeOut = z.object({ from: z.string(), to: z.string(), timezone: z.string() });

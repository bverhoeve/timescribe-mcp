import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, expect, it } from "vitest";
import { createFixtureDb } from "./fixture.js";

// Runs the built server (npm test builds first) as Claude Code would: a child process over stdio.
async function connect(env: Record<string, string>) {
  const client = new Client({ name: "e2e", version: "0.0.0" });
  await client.connect(
    new StdioClientTransport({ command: process.execPath, args: ["dist/index.js"], env: { ...env, PATH: process.env.PATH ?? "" }, stderr: "ignore" }),
  );
  return client;
}

let client: Client | undefined;
afterEach(async () => {
  await client?.close();
  client = undefined;
});

describe("stdio server", () => {
  it("lists the three read-only tools", async () => {
    client = await connect({ TIMESCRIBE_DB_PATH: createFixtureDb() });
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["get_time_summary", "list_entries", "list_projects"]);
    expect(tools.every((t) => t.annotations?.readOnlyHint === true && t.outputSchema)).toBe(true);
  });

  it("answers each tool with structured content", async () => {
    client = await connect({ TIMESCRIBE_DB_PATH: createFixtureDb() });
    const projects = await client.callTool({ name: "list_projects", arguments: {} });
    expect((projects.structuredContent as { projects: unknown[] }).projects).toHaveLength(3);

    const entries = await client.callTool({ name: "list_entries", arguments: { from: "2026-09-28", to: "2026-09-28" } });
    expect((entries.structuredContent as { entries: { id: number }[] }).entries.map((e) => e.id)).toEqual([1, 2, 3]);

    const summary = await client.callTool({ name: "get_time_summary", arguments: { from: "2026-09-28", to: "2026-09-29", group_by: "day" } });
    expect(summary.isError).toBeFalsy();
    expect((summary.structuredContent as { totals: { break_hours: number } }).totals.break_hours).toBe(0.5);
  });

  it("returns an actionable tool error when the database is missing", async () => {
    client = await connect({ TIMESCRIBE_DB_PATH: "/definitely/missing/database.sqlite" });
    const res = await client.callTool({ name: "list_projects", arguments: {} });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toMatch(/TIMESCRIBE_DB_PATH/);
  });

  it("rejects invalid dates", async () => {
    client = await connect({ TIMESCRIBE_DB_PATH: createFixtureDb() });
    const res = await client.callTool({ name: "list_entries", arguments: { from: "30-09-2026", to: "2026-09-30" } }).catch((e: Error) => e);
    expect(String(res instanceof Error ? res.message : JSON.stringify(res))).toMatch(/YYYY-MM-DD/);
  });

  it("rejects dates that do not exist", async () => {
    client = await connect({ TIMESCRIBE_DB_PATH: createFixtureDb() });
    const res = await client.callTool({ name: "get_time_summary", arguments: { from: "2026-02-30", to: "2026-03-01" } }).catch((e: Error) => e);
    expect(String(res instanceof Error ? res.message : JSON.stringify(res))).toMatch(/real calendar date/);
  });
});

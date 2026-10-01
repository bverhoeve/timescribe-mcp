import type { DatabaseSync } from "node:sqlite";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { TimeScribeError, withDb } from "./db.js";
import { getTimeSummary, getTimeSummaryTool } from "./tools/getTimeSummary.js";
import { listEntries, listEntriesTool } from "./tools/listEntries.js";
import { listProjects, listProjectsTool } from "./tools/listProjects.js";

export const VERSION = "0.1.0";

export interface ServerDeps {
  dbPath: () => string; // resolved per call, so installing TimeScribe later needs no restart
  now: () => number;
}

export function createServer(deps: ServerDeps): McpServer {
  const server = new McpServer({ name: "timescribe-mcp", version: VERSION });

  const run = <A>(fn: (db: DatabaseSync, args: A, nowMs: number) => object) => async (args: A): Promise<CallToolResult> => {
    try {
      const result = withDb(deps.dbPath(), (db) => fn(db, args, deps.now()));
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result as Record<string, unknown> };
    } catch (e) {
      if (!(e instanceof TimeScribeError)) console.error("[timescribe-mcp]", e);
      const message = e instanceof TimeScribeError ? e.message : `Unexpected error: ${(e as Error).message}`;
      return { content: [{ type: "text", text: message }], isError: true };
    }
  };

  server.registerTool(listProjectsTool.name, listProjectsTool.config, run((db) => listProjects(db)));
  server.registerTool(listEntriesTool.name, listEntriesTool.config, run(listEntries));
  server.registerTool(getTimeSummaryTool.name, getTimeSummaryTool.config, run(getTimeSummary));
  return server;
}

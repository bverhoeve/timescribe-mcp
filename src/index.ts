#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolveDbPath } from "./db.js";
import { createServer } from "./server.js";

// stdout carries JSON-RPC; log only to stderr.
const server = createServer({ dbPath: () => resolveDbPath(), now: () => Date.now() });
await server.connect(new StdioServerTransport());
console.error("[timescribe-mcp] ready on stdio");

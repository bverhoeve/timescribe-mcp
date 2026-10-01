import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { listProjectRows } from "../db.js";

export const listProjectsTool = {
  name: "list_projects",
  config: {
    title: "List TimeScribe projects",
    description:
      "List all TimeScribe projects, including archived (deleted) ones, which old entries may still reference. Use the ids to filter list_entries.",
    inputSchema: {},
    outputSchema: {
      projects: z.array(
        z.object({
          id: z.number(),
          name: z.string(),
          description: z.string().nullable(),
          color: z.string(),
          hourly_rate: z.number().nullable(),
          currency: z.string().nullable(),
          archived: z.boolean(),
        }),
      ),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
};

export function listProjects(db: DatabaseSync) {
  return {
    projects: listProjectRows(db).map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      color: p.color,
      hourly_rate: p.hourly_rate === null ? null : Number(p.hourly_rate),
      currency: p.currency,
      archived: p.deleted_at !== null,
    })),
  };
}

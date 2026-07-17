/**
 * memory_write tool — Write a memory to the project memory store.
 *
 * Supports explicit category or auto-detection from content.
 */

import { tool } from "@mimo-ai/plugin"
import { getMemoryStore } from "../memory/store"
import { captureMemory } from "../memory/hooks"
import type { MemoryCategory } from "../memory/types"
import { MEMORY_CATEGORIES, getMemoryDbPath } from "../memory/types"
import { resolveProjectPath } from "./tool-utils"

export function createMemoryWriteTool(ctx: any) {
  return tool({
    description:
      "Write a memory to the project memory store. Deduplicates by normalized hash. Categories: PROJECT_RULES, ARCHITECTURE, CONSTRAINTS, CONFIG_VALUES, NAMING, LESSONS_LEARNED, BUG_FIXES, USER_PREFERENCES.",
    args: {
      content: tool.schema
        .string()
        .describe("Memory content to store (technical decisions, rules, lessons, etc.)"),
      category: tool.schema
        .string()
        .optional()
        .describe(
          `Memory category. Options: ${MEMORY_CATEGORIES.join(", ")}. If omitted, auto-detected from content.`,
        ),
      importance: tool.schema
        .number()
        .optional()
        .describe("Importance score 1-100 (default: 50). Higher = decays slower."),
    },
    async execute(args, context) {
      const projectPath = resolveProjectPath(context)
      const store = getMemoryStore(getMemoryDbPath(projectPath))

      const category = args.category as MemoryCategory | undefined
      if (category && !MEMORY_CATEGORIES.includes(category)) {
        return `Invalid category "${category}". Valid categories: ${MEMORY_CATEGORIES.join(", ")}`
      }

      const result = captureMemory(store, projectPath, args.content, {
        category,
        importance: args.importance,
        sourceSessionId: context.sessionID,
        sourceType: "manual",
      })

      if (!result.success) {
        return "Failed to capture memory. Content may be too short, too long, or not technical enough."
      }

      if (result.duplicate) {
        return `Memory already exists (id:${result.memoryId}). Seen count incremented.`
      }

      if (result.memoryId == null) {
        return "Memory saved but ID unavailable."
      }
      const memory = store.getById(result.memoryId)
      return `Memory saved (id:${result.memoryId}, category:${memory?.category ?? "auto"})`
    },
  })
}

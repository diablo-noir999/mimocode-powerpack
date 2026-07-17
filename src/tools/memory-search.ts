/**
 * memory_search tool — Search the project memory store.
 *
 * Supports hybrid (vector+BM25), semantic-only, FTS-only, and TF-IDF modes.
 */

import { tool } from "@mimo-ai/plugin"
import { getMemoryStore } from "../memory/store"
import { searchMemories, type SearchMode } from "../memory/search"
import { isEmbeddingsReady } from "../memory/embeddings"
import { getMemoryDbPath } from "../memory/types"
import { resolveProjectPath } from "./tool-utils"

export function createMemorySearchTool(ctx: any) {
  return tool({
    description:
      "Search project memories using vector embeddings + BM25 (hybrid), semantic-only, FTS-only, or TF-IDF. Returns ranked results with scores.",
    args: {
      query: tool.schema.string().describe("Search query (supports natural language or keywords)"),
      limit: tool.schema
        .number()
        .optional()
        .describe("Max results to return (default: 10)"),
      category: tool.schema
        .string()
        .optional()
        .describe(
          "Filter by category: PROJECT_RULES, ARCHITECTURE, CONSTRAINTS, CONFIG_VALUES, NAMING, LESSONS_LEARNED, BUG_FIXES, USER_PREFERENCES",
        ),
      mode: tool.schema
        .string()
        .optional()
        .describe(
          "Search mode: hybrid (default, vector+BM25), semantic (vector-only, requires embeddings), fts (BM25-only), tfidf (TF-IDF cosine only)",
        ),
    },
    async execute(args, context) {
      const projectPath = resolveProjectPath(context)
      const store = getMemoryStore(getMemoryDbPath(projectPath))

      let mode: SearchMode = "hybrid"
      if (args.mode && ["hybrid", "semantic", "fts", "tfidf"].includes(args.mode)) {
        mode = args.mode as SearchMode
      }

      // Fall back to FTS if semantic/hybrid requested but embeddings unavailable
      if ((mode === "hybrid" || mode === "semantic") && !isEmbeddingsReady()) {
        mode = "fts"
      }

      let results = await searchMemories(store, projectPath, args.query, args.limit ?? 10, mode)

      // Filter by category if specified
      if (args.category) {
        results = results.filter((r) => r.memory.category === args.category)
      }

      if (results.length === 0) {
        return `No memories found for query: "${args.query}" (mode: ${mode})`
      }

      const lines = [`## Memory Search Results (${results.length}, mode: ${mode})\n`]

      for (const result of results) {
        const m = result.memory
        const score = result.score.toFixed(3)
        const matchType = result.matchType
        const age = formatAge(m.createdAt)
        const retrieved = m.retrievalCount > 0 ? `retrieved ${m.retrievalCount}x` : "never retrieved"

        lines.push(`### [${m.category}] (score: ${score}, ${matchType})`)
        lines.push(m.content)
        lines.push(`_id:${m.id} | importance:${m.importance} | age:${age} | ${retrieved}_\n`)
      }

      return lines.join("\n")
    },
  })
}

function formatAge(timestamp: number): string {
  const ms = Date.now() - timestamp
  const days = Math.floor(ms / (1000 * 60 * 60 * 24))
  if (days === 0) return "today"
  if (days === 1) return "1d ago"
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}

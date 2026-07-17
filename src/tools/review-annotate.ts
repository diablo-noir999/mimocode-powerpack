/**
 * Review Annotate Tool
 *
 * Adds a comment or annotation to the current code review session.
 * Can target specific files and line numbers.
 *
 * Adapted from dev/plannotator/packages/server/review.ts feedback endpoint
 */

import { tool } from "@mimo-ai/plugin"

export function createReviewAnnotateTool(ctx: any) {
  return tool({
    description:
      "Add a comment annotation to the current code review. Target a specific file and line number to leave feedback on code changes.",
    args: {
      session: tool.schema
        .string()
        .describe("Review session ID (returned by review_start)"),
      file: tool.schema
        .string()
        .describe("File path to annotate (relative to project root)"),
      line: tool.schema
        .number()
        .optional()
        .describe("Line number to annotate (1-indexed)"),
      comment: tool.schema
        .string()
        .describe("The annotation comment text"),
    },
    async execute(args) {
      const { getReviewSession } = await import("../review/server")

      const session = getReviewSession(args.session)
      if (!session) {
        return `Error: Review session \`${args.session}\` not found. Start a new review with review_start.`
      }

      // Add annotation directly to the session
      const annotation = {
        id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        filePath: args.file,
        lineNumber: args.line,
        text: args.comment,
        type: "comment" as const,
        createdAt: Date.now(),
      }

      session.annotations.push(annotation)

      // Save session
      const { writeFileSync, mkdirSync } = await import("node:fs")
      const { join } = await import("node:path")
      const dir = join(session.workspace, ".powerpack", "review", session.id)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, "session.json"), JSON.stringify({
        ...session,
        stagedFiles: Array.from(session.stagedFiles),
      }, null, 2))

      const location = args.line ? `${args.file}:${args.line}` : args.file
      return [
        `Annotation added to review \`${args.session}\`:`,
        ``,
        `**File**: ${location}`,
        `**Comment**: ${args.comment}`,
        ``,
        `The annotation is visible in the review UI at the annotated line.`,
      ].join("\n")
    },
  })
}

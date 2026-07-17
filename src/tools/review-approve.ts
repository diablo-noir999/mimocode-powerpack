/**
 * Review Approve Tool
 *
 * Approves or denies the current code review, optionally staging files.
 * Sends the decision back to the review session.
 *
 * Adapted from dev/plannotator/packages/server/review.ts approve endpoint
 */

import { tool } from "@mimo-ai/plugin"
import { $ } from "bun"

export function createReviewApproveTool(ctx: any) {
  return tool({
    description:
      "Approve or deny the current code review. Optionally stage approved files via git add. Provide feedback when denying.",
    args: {
      session: tool.schema
        .string()
        .describe("Review session ID (returned by review_start)"),
      decision: tool.schema
        .enum(["approve", "deny"])
        .describe("Whether to approve or deny the review"),
      feedback: tool.schema
        .string()
        .optional()
        .describe("Feedback text (required when denying, optional when approving)"),
      stage_files: tool.schema
        .boolean()
        .optional()
        .describe("Whether to git-add all changed files on approval (default: false)"),
    },
    async execute(args) {
      const { getReviewSession } = await import("../review/server")

      const session = getReviewSession(args.session)
      if (!session) {
        return `Error: Review session \`${args.session}\` not found. Start a new review with review_start.`
      }

      const approved = args.decision === "approve"
      session.approved = approved
      if (args.feedback) {
        session.feedback = args.feedback
      }

      // Save session
      const { existsSync, mkdirSync, writeFileSync } = await import("node:fs")
      const { join } = await import("node:path")
      const dir = join(session.workspace, ".powerpack", "review", session.id)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, "session.json"), JSON.stringify({
        ...session,
        stagedFiles: Array.from(session.stagedFiles),
      }, null, 2))

      const results: string[] = []

      if (approved) {
        results.push(`## Review Approved`)
        results.push(``)

        // Optionally stage files
        if (args.stage_files) {
          try {
            const files = await $`git diff --name-only ${session.gitRef === "--cached" ? "--cached" : "HEAD"}`
              .cwd(session.workspace)
              .text()
            const fileList = files.split("\n").filter(Boolean)

            if (fileList.length > 0) {
              await $`git add ${fileList}`.cwd(session.workspace).text()
              results.push(`**Staged ${fileList.length} files**:`)
              for (const f of fileList) {
                results.push(`- \`${f}\``)
                session.stagedFiles.add(f)
              }
              results.push(``)
            }
          } catch (err) {
            results.push(`Warning: Failed to stage files: ${err instanceof Error ? err.message : String(err)}`)
            results.push(``)
          }
        }

        if (session.annotations.length > 0) {
          results.push(`**Annotations** (${session.annotations.length}):`)
          for (const ann of session.annotations) {
            const loc = ann.lineNumber ? `${ann.filePath}:${ann.lineNumber}` : ann.filePath
            results.push(`- ${loc}: ${ann.text}`)
          }
          results.push(``)
        }

        if (args.feedback) {
          results.push(`**Notes**: ${args.feedback}`)
          results.push(``)
        }

        results.push(`The review is complete. Proceed with implementation.`)
      } else {
        results.push(`## Changes Requested`)
        results.push(``)

        if (args.feedback) {
          results.push(`**Feedback**: ${args.feedback}`)
          results.push(``)
        }

        if (session.annotations.length > 0) {
          results.push(`**Annotations** (${session.annotations.length}):`)
          for (const ann of session.annotations) {
            const loc = ann.lineNumber ? `${ann.filePath}:${ann.lineNumber}` : ann.filePath
            results.push(`- ${loc}: ${ann.text}`)
          }
          results.push(``)
        }

        results.push(`Please address the feedback above and resubmit the review.`)
      }

      return results.join("\n")
    },
  })
}

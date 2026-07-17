/**
 * Review Start Tool
 *
 * Launches a code review session by:
 * 1. Computing the git diff
 * 2. Starting the review server
 * 3. Opening the browser to the review UI
 *
 * Adapted from dev/plannotator/apps/opencode-plugin/index.ts
 */

import { tool } from "@mimo-ai/plugin"
import { resolveProjectPath } from "./tool-utils"
import { $ } from "bun"

let activeServer: { stop: () => void } | null = null

export function createReviewStartTool(ctx: any) {
  return tool({
    description:
      "Start an interactive code review session. Computes the git diff, opens a browser-based review UI where the user can annotate code, request changes, or approve. Returns the review session ID.",
    args: {
      ref: tool.schema
        .string()
        .optional()
        .describe("Git ref to diff against (e.g. 'HEAD', 'main', '--staged'). Defaults to unstaged working tree changes."),
      port: tool.schema
        .number()
        .optional()
        .describe("Port for the review server (default: 5174)"),
    },
    async execute(args) {
      const cwd = resolveProjectPath(ctx)

      // Stop any existing server
      if (activeServer) {
        activeServer.stop()
        activeServer = null
      }

      // Compute git diff
      const ref = args.ref
      let rawPatch = ""
      let gitRef = ref ?? "HEAD"
      let diffType = ref ? `branch:${ref}` : "uncommitted"
      let error: string | undefined

      try {
        if (ref === "--staged") {
          rawPatch = await $`git diff --cached`.cwd(cwd).text()
          diffType = "staged"
          gitRef = "--cached"
        } else if (ref) {
          rawPatch = await $`git diff ${ref}`.cwd(cwd).text()
        } else {
          rawPatch = await $`git diff`.cwd(cwd).text()
        }
      } catch (err) {
        error = err instanceof Error ? err.message : String(err)
      }

      if (!rawPatch && !error) {
        // Check if there are untracked files
        try {
          const status = await $`git status --porcelain`.cwd(cwd).text()
          if (!status.trim()) {
            return "No changes to review. Working tree is clean."
          }
          // There are untracked files but no diff — try to include them
          rawPatch = await $`git diff --no-index /dev/null`.cwd(cwd).text().catch(() => "")
          if (!rawPatch) {
            return "Changes detected but could not compute diff. The changes may be untracked files only. Try: git add <files> then review_start with --staged."
          }
        } catch {
          return "No changes to review."
        }
      }

      // Import and start server
      const { startReviewServer, createReviewSession, loadReviewHtml } = await import("../review/server")

      const htmlContent = loadReviewHtml()
      const session = createReviewSession(cwd, rawPatch, gitRef, diffType, error)

      const port = args.port ?? 5174
      const server = await startReviewServer({
        port,
        htmlContent,
        onReady: () => {},
      })

      activeServer = server
      const reviewUrl = `${server.url}?session=${session.id}`

      // Try to open browser
      try {
        const platform = process.platform
        if (platform === "darwin") {
          await $`open ${reviewUrl}`.quiet()
        } else if (platform === "win32") {
          await $`cmd.exe /c start ${reviewUrl}`.quiet()
        } else {
          await $`xdg-open ${reviewUrl}`.quiet()
        }
      } catch {
        // Browser opening is best-effort
      }

      const fileCount = rawPatch.split("\ndiff --git ").length
      const sessionResult = [
        `## Code Review Started`,
        ``,
        `**Session ID**: \`${session.id}\``,
        `**Review URL**: ${reviewUrl}`,
        `**Diff type**: ${diffType}`,
        `**Files changed**: ${fileCount - 1}${error ? `\n**Error**: ${error}` : ""}`,
        ``,
        `The review UI is open in your browser. You can:`,
        `- **Annotate** specific lines by clicking the + button`,
        `- **Approve** when satisfied with the changes`,
        `- **Request changes** to send feedback back here`,
        ``,
        `Use \`review_annotate\` to add comments programmatically.`,
        `Use \`review_approve\` to approve or deny the review.`,
      ].join("\n")

      return sessionResult
    },
  })
}

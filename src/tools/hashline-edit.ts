/**
 * Hash-Anchored Edit Tool (Hashline)
 *
 * Every line in read output is tagged with a content hash (LINE#HASH).
 * Edits reference lines by hash, and the tool validates the hash before
 * applying — stale hashes are rejected, preventing corrupt edits.
 *
 * Source: Adapted from dev/oh-my-opencode/packages/hashline-core/ and
 *         dev/oh-my-opencode/packages/omo-opencode/src/tools/hashline-edit/
 */

import { tool } from "@mimo-ai/plugin"
import { computeLineHash } from "./hashline-utils"
import { resolve } from "path"

export function createHashlineEditTool(_ctx: any) {
  return tool({
    description:
      "Edit a file using hash-anchored line references. Every line is identified by a content hash (LINE#HASH). This prevents stale-line errors — if the file changed since you last read it, the hash won't match and the edit is rejected.",
    args: {
      file_path: tool.schema.string().describe("Path to the file to edit"),
      edits: tool.schema
        .array(
          tool.schema.object({
            line: tool.schema.number().describe("Line number to edit"),
            hash: tool.schema.string().describe("LINE#HASH from the read output"),
            old_content: tool.schema.string().describe("Expected content at this line (must match hash)"),
            new_content: tool.schema.string().describe("New content to replace with"),
          })
        )
        .describe("Array of edits to apply, each anchored by line hash"),
    },
    async execute(args, context) {
      const { file_path, edits } = args

      // SECURITY: Validate file_path to prevent path traversal attacks
      if (file_path.includes("..")) {
        return "Error: file_path contains '..' segments which are not allowed for security reasons"
      }

      // SECURITY: Ensure file_path is within the workspace directory
      const resolved = resolve(file_path)
      const workspace = (context as any)?.directory ?? process.cwd()
      if (!resolved.startsWith(resolve(workspace))) {
        return "Error: file_path must be within the workspace"
      }

      // Read the current file content
      const fs = await import("fs/promises")
      let content: string
      try {
        content = await fs.readFile(file_path, "utf-8")
      } catch (error) {
        return `Error reading file: ${error instanceof Error ? error.message : String(error)}`
      }

      const lines = content.split("\n")
      const appliedEdits: string[] = []
      const rejectedEdits: string[] = []

      // Sort edits by line number (descending) to avoid index shifting
      const sortedEdits = [...edits].sort((a, b) => b.line - a.line)

      for (const edit of sortedEdits) {
        const lineIndex = edit.line - 1
        if (lineIndex < 0 || lineIndex >= lines.length) {
          rejectedEdits.push(`Line ${edit.line}: out of range (file has ${lines.length} lines)`)
          continue
        }

        const currentLine = lines[lineIndex]
        const currentHash = computeLineHash(currentLine)

        // Validate hash
        if (currentHash !== edit.hash) {
          rejectedEdits.push(
            `Line ${edit.line}: hash mismatch (expected ${edit.hash}, got ${currentHash}). File has changed since last read.`
          )
          continue
        }

        // Validate content — compare raw content (hash is on raw content)
        if (currentLine !== edit.old_content) {
          // Also try trimmed comparison as fallback
          if (currentLine.trimEnd() !== edit.old_content.trimEnd()) {
            rejectedEdits.push(
              `Line ${edit.line}: content mismatch. Expected "${edit.old_content}", found "${currentLine}"`
            )
            continue
          }
        }

        // Apply edit
        lines[lineIndex] = edit.new_content
        appliedEdits.push(`Line ${edit.line}: applied`)
      }

      // Write the modified content back
      if (appliedEdits.length > 0) {
        await fs.writeFile(file_path, lines.join("\n"))
      }

      // Format result
      const result: string[] = []
      if (appliedEdits.length > 0) {
        result.push(`Applied ${appliedEdits.length} edit(s):`)
        result.push(...appliedEdits)
      }
      if (rejectedEdits.length > 0) {
        result.push(`\nRejected ${rejectedEdits.length} edit(s):`)
        result.push(...rejectedEdits)
      }

      return result.join("\n") || "No edits to apply."
    },
  })
}

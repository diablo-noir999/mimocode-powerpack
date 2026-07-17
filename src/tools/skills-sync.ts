/**
 * Skills Sync Tool
 *
 * Pulls updates for installed skills by re-cloning from their recorded sources.
 *
 * Source: Adapted from dev/openskills/src/commands/sync.ts
 */

import { tool } from "@mimo-ai/plugin"
import { syncSkills } from "../skills/syncer"

export function createSkillsSyncTool() {
  return tool({
    description:
      "Sync (update) installed skills by pulling latest versions from their sources. " +
      "If no names given, syncs all skills with recorded source metadata.",
    args: {
      names: tool.schema
        .array(tool.schema.string())
        .optional()
        .describe("Specific skill names to sync. If omitted, syncs all installed skills."),
    },
    async execute(args) {
      const result = syncSkills(".mimocode/skills", args.names ?? undefined)

      const lines: string[] = []

      if (result.updated.length > 0) {
        lines.push(`Updated ${result.updated.length} skill(s):`)
        for (const name of result.updated) {
          lines.push(`  * ${name}`)
        }
      }

      if (result.unchanged.length > 0) {
        lines.push(`Unchanged ${result.unchanged.length} skill(s):`)
        for (const name of result.unchanged) {
          lines.push(`  = ${name}`)
        }
      }

      if (result.failed.length > 0) {
        lines.push(`Failed ${result.failed.length} skill(s):`)
        for (const { name, error } of result.failed) {
          lines.push(`  ! ${name}: ${error}`)
        }
      }

      if (result.notFound.length > 0) {
        lines.push(`Not found:`)
        for (const name of result.notFound) {
          lines.push(`  ? ${name}`)
        }
      }

      if (
        result.updated.length === 0 &&
        result.unchanged.length === 0 &&
        result.failed.length === 0
      ) {
        lines.push("No installed skills found. Install skills first with skills_install.")
      }

      return lines.join("\n")
    },
  })
}

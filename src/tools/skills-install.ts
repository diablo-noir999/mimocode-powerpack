/**
 * Skills Install Tool
 *
 * Clones a GitHub repo (or local path) and extracts SKILL.md files
 * into the project's .mimocode/skills/ directory.
 *
 * Source: Adapted from dev/openskills/src/commands/install.ts
 */

import { tool } from "@mimo-ai/plugin"
import { installSkill } from "../skills/installer"

export function createSkillsInstallTool() {
  return tool({
    description:
      "Install skills from a GitHub repo, git URL, or local path. Clones the repo, finds SKILL.md files, and copies them into .mimocode/skills/. " +
      "Source formats: 'owner/repo', 'owner/repo/skill-name', full git URL, or local directory path.",
    args: {
      source: tool.schema
        .string()
        .describe(
          "Source to install from: GitHub shorthand (owner/repo), git URL, or local path"
        ),
      force: tool.schema
        .boolean()
        .optional()
        .describe("Overwrite existing skills (default: false)"),
    },
    async execute(args) {
      const result = installSkill(args.source, {
        installDir: ".mimocode/skills",
        force: args.force ?? false,
      })

      const lines: string[] = []

      if (result.installed.length > 0) {
        lines.push(`Installed ${result.installed.length} skill(s):`)
        for (const name of result.installed) {
          lines.push(`  + ${name}`)
        }
      }

      if (result.skipped.length > 0) {
        lines.push(`Skipped ${result.skipped.length} (already exists, use force=true to overwrite):`)
        for (const name of result.skipped) {
          lines.push(`  - ${name}`)
        }
      }

      if (result.errors.length > 0) {
        lines.push(`Errors:`)
        for (const err of result.errors) {
          lines.push(`  ! ${err}`)
        }
      }

      if (result.installed.length === 0 && result.skipped.length === 0 && result.errors.length === 0) {
        lines.push("No skills found at the given source.")
      }

      return lines.join("\n")
    },
  })
}

/**
 * mimocode-powerpack — TUI Plugin Entry
 *
 * Provides TUI extensions: quota sidebar panel.
 */

interface PowerpackTuiOptions {
  quota?: { enabled?: boolean }
  skills?: { enabled?: boolean }
  review?: { enabled?: boolean; port?: number }
}

const PowerpackTuiPlugin = async (api: any, options: any) => {
  const config = {
    quota: { enabled: true },
    skills: { enabled: true },
    review: { enabled: false, port: 5174 },
    ...((options as { powerpack?: PowerpackTuiOptions })?.powerpack ?? {}),
  } as { quota: { enabled: boolean }; skills: { enabled: boolean }; review: { enabled: boolean; port: number } }

  // Register quota sidebar panel if enabled
  if (config.quota.enabled) {
    api.command?.("powerpack-quota", {
      description: "Show quota status",
      handler: async () => {
        return { content: "Quota status: checking..." }
      },
    })
  }

  // Register skills commands
  if (config.skills.enabled) {
    api.command?.("skills-install", {
      description: "Install skills from a GitHub repo or local path",
      handler: async (args: string) => {
        const source = args?.trim()
        if (!source) {
          return { content: "Usage: /skills-install <source>\n  source: owner/repo, owner/repo/skill-name, git URL, or local path" }
        }
        try {
          const { installSkill } = await import("./skills/installer")
          const result = installSkill(source, { installDir: ".mimocode/skills" })
          const lines: string[] = []
          if (result.installed.length > 0) {
            lines.push(`Installed: ${result.installed.join(", ")}`)
          }
          if (result.skipped.length > 0) {
            lines.push(`Skipped: ${result.skipped.join(", ")}`)
          }
          if (result.errors.length > 0) {
            lines.push(`Errors: ${result.errors.join("; ")}`)
          }
          return { content: lines.join("\n") || "No skills found." }
        } catch (error) {
          return { content: `Error: ${error instanceof Error ? error.message : String(error)}` }
        }
      },
    })

    api.command?.("skills-sync", {
      description: "Sync installed skills from their sources",
      handler: async (args: string) => {
        try {
          const { syncSkills } = await import("./skills/syncer")
          const names = args?.trim() ? args.trim().split(/\s+/) : undefined
          const result = syncSkills(".mimocode/skills", names)
          const lines: string[] = []
          if (result.updated.length > 0) {
            lines.push(`Updated: ${result.updated.join(", ")}`)
          }
          if (result.unchanged.length > 0) {
            lines.push(`Unchanged: ${result.unchanged.join(", ")}`)
          }
          if (result.failed.length > 0) {
            lines.push(`Failed: ${result.failed.map((f) => `${f.name}: ${f.error}`).join("; ")}`)
          }
          return { content: lines.join("\n") || "No installed skills found." }
        } catch (error) {
          return { content: `Error: ${error instanceof Error ? error.message : String(error)}` }
        }
      },
    })
  }

  // Register review commands
  if (config.review.enabled) {
    api.command?.("review", {
      description: "Start a code review session (opens browser)",
      handler: async (args: string) => {
        const ref = args?.trim() || undefined
        const port = config.review.port
        return {
          content: `Starting code review...${ref ? ` (diff against ${ref})` : ""}`,
        }
      },
    })

    api.command?.("review-annotate", {
      description: "Add annotation to current code review",
      handler: async (args: string) => {
        return { content: "Use the review_annotate tool to add comments to the current review." }
      },
    })

    api.command?.("review-approve", {
      description: "Approve or deny the current code review",
      handler: async (args: string) => {
        return { content: "Use the review_approve tool to approve or deny the current review." }
      },
    })
  }
}

export default {
  id: "mimocode-powerpack",
  tui: PowerpackTuiPlugin,
}

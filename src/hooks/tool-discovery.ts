/**
 * Tool Discovery Hook
 *
 * Injects tool context at the beginning of new conversations and periodic
 * reminders so the agent doesn't forget about powerpack tools mid-session.
 */

import type { HookInput, HookOutput } from "../types"

const TOOL_DISCOVERY_CONTEXT = `## Powerpack Tools Available

You have these additional tools:
- **memory_search** / **memory_write**: Persistent memory across sessions
- **context_breakdown**: Show token usage breakdown
- **ralph_loop**: Repeat prompt until completion signal
- **actor_guide**: Get JSON format for spawning subagents
- **skills_install** / **skills_sync**: Install/update skills from GitHub
- **review_start** / **review_annotate** / **review_approve**: Code review workflow
- **team_send** / **team_receive** / **team_status**: Multi-agent coordination
- **kimaki_send** / **kimaki_status**: Discord integration
- **quota_status**: Check API quota usage

Subagent dispatch: prefer "spawn" (background, non-blocking) over "run" (blocking). Use "wait" only when you need the result before proceeding.`

const PERIODIC_NUDGE = `[Powerpack reminder] Use memory_search before tasks and memory_write after decisions. Use actor_guide before spawning subagents. Prefer spawn over run.`

export function createToolDiscoveryHook() {
  return async (input: HookInput, output: HookOutput) => {
    if (!output?.messages || !Array.isArray(output.messages)) return

    const userMessages = output.messages.filter(m => m.role === "user")
    const msgCount = userMessages.length

    // Full injection on first message only (before any assistant response)
    if (msgCount <= 1) {
      const alreadyInjected = output.messages.some(
        m => m.role === "system" && m.content?.includes("Powerpack Tools Available")
      )
      if (!alreadyInjected) {
        output.messages.unshift({
          role: "system",
          content: TOOL_DISCOVERY_CONTEXT,
        })
      }
      return
    }

    // Short nudge every 15 messages to prevent tool forgetting
    if (msgCount % 15 === 0) {
      const alreadyNudged = output.messages.some(
        m => m.role === "system" && m.content?.includes("[Powerpack reminder]")
      )
      if (!alreadyNudged) {
        output.messages.unshift({
          role: "system",
          content: PERIODIC_NUDGE,
        })
      }
    }
  }
}

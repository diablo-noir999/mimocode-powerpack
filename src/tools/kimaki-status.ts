/**
 * kimaki_status tool — Show connected channels, active threads, agent status
 *
 * Queries the Kimaki adapter for current state: which Discord channels
 * are mapped, how many threads are active, and agent assignments.
 */

import { tool } from "@mimo-ai/plugin"
import { getStatus, isKimakiConnected } from "../kimaki/adapter"
import type { KimakiConfig } from "../kimaki/config"

export interface KimakiStatusToolConfig {
  enabled: boolean
  config: KimakiConfig
}

export function createKimakiStatusTool(config: KimakiStatusToolConfig) {
  if (!config.enabled) {
    return null
  }

  return tool({
    description:
      "Show Kimaki Discord integration status: connected channels, active threads, agent assignments, and connection health.",
    args: {
      channel: tool.schema
        .string()
        .optional()
        .describe("Filter by specific Discord channel ID"),
      detailed: tool.schema
        .boolean()
        .optional()
        .default(false)
        .describe("Show detailed thread and agent info"),
    },
    execute: async (args: { channel?: string; detailed?: boolean }) => {
      const connected = isKimakiConnected()
      const status = getStatus()

      if (!connected) {
        return [
          "## Kimaki Status",
          "",
          "**Connection**: Disconnected",
          "",
          "Kimaki is not reachable. Ensure the Kimaki process is running",
          `at ${config.config.connection.baseUrl}.`,
          "",
          "To enable: set `kimaki.enabled: true` and configure `kimaki.connection.baseUrl`.",
        ].join("\n")
      }

      const lines = ["## Kimaki Status", "", "**Connection**: Connected"]

      // Channels
      lines.push("")
      lines.push(`### Channels (${status.channels.length})`)
      if (status.channels.length === 0) {
        lines.push("_No channels configured._")
      } else {
        for (const ch of status.channels) {
          if (args.channel && ch.channelId !== args.channel) continue
          const agent = ch.agentName ? ` — agent: ${ch.agentName}` : ""
          lines.push(
            `- **${ch.channelId}** → \`${ch.directory}\`${agent} (${ch.threadCount} threads)`,
          )
        }
      }

      // Active threads
      lines.push("")
      lines.push(`### Active Threads (${status.activeThreads.length})`)
      if (status.activeThreads.length === 0) {
        lines.push("_No active threads._")
      } else {
        for (const t of status.activeThreads) {
          if (args.channel && t.channelId !== args.channel) continue
          const queue =
            t.queueDepth > 0 ? ` [${t.queueDepth} queued]` : ""
          lines.push(
            `- **${t.threadId}** → session \`${t.sessionId}\`${queue}`,
          )
        }
      }

      // Agents (detailed mode)
      if (args.detailed) {
        lines.push("")
        lines.push(`### Agents (${status.agents.length})`)
        if (status.agents.length === 0) {
          lines.push("_No agents configured._")
        } else {
          for (const a of status.agents) {
            lines.push(`- **${a.name}** — ${a.assignedChannels} channel(s)`)
          }
        }
      }

      return lines.join("\n")
    },
  })
}

/**
 * team_receive tool - Check mailbox for messages
 * 
 * Simplified from oh-my-opencode's team-mode mailbox polling.
 */

import { tool } from "@mimo-ai/plugin"
import type { MailboxConfig, Message } from "../team/mailbox"
import { listUnreadMessages, ackMessages, buildEnvelope } from "../team/mailbox"

export interface TeamReceiveToolConfig {
  enabled: boolean
  baseDir: string
}

export function createTeamReceiveTool(config: TeamReceiveToolConfig) {
  if (!config.enabled) {
    return null
  }

  const mailboxConfig: MailboxConfig = {
    baseDir: config.baseDir,
  }

  return tool({
    description: "Check mailbox for messages from other team members.",
    args: {
      teamRunId: tool.schema.string().describe("Team run ID"),
      agentName: tool.schema.string().describe("Agent name to check mailbox for"),
      ack: tool.schema.boolean().optional().default(true).describe("Acknowledge messages after reading"),
    },
    execute: async (args: {
      teamRunId: string
      agentName: string
      ack?: boolean
    }) => {
      const messages = await listUnreadMessages(args.teamRunId, args.agentName, mailboxConfig)

      if (messages.length === 0) {
        return JSON.stringify({ messages: [], count: 0 })
      }

      // Build envelopes for injection
      const envelopes = messages.map(buildEnvelope)

      // Acknowledge messages if requested
      if (args.ack !== false) {
        const messageIds = messages.map(m => m.messageId)
        await ackMessages(args.teamRunId, args.agentName, messageIds, mailboxConfig)
      }

      return JSON.stringify({
        messages,
        count: messages.length,
        envelopes,
      })
    },
  })
}

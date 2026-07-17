/**
 * team_send tool - Send message to specific agent or broadcast
 * 
 * Simplified from oh-my-opencode's team-mode messaging tool.
 */

import { randomUUID } from "node:crypto"
import { tool } from "@mimo-ai/plugin"
import type { MailboxConfig, Message } from "../team/mailbox"
import { sendMessage } from "../team/mailbox"

export interface TeamSendToolConfig {
  enabled: boolean
  baseDir: string
  maxMessageSizeBytes?: number
}

export function createTeamSendTool(config: TeamSendToolConfig) {
  if (!config.enabled) {
    return null
  }

  const mailboxConfig: MailboxConfig = {
    baseDir: config.baseDir,
    maxMessageSizeBytes: config.maxMessageSizeBytes,
  }

  return tool({
    description: "Send a message to a team member or broadcast to the team.",
    args: {
      teamRunId: tool.schema.string().describe("Team run ID"),
      to: tool.schema.string().describe("Recipient agent name or * for broadcast"),
      body: tool.schema.string().describe("Message body"),
      kind: tool.schema.enum(["message", "announcement"]).optional().default("message").describe("Message kind"),
    },
    execute: async (args: {
      teamRunId: string
      to: string
      body: string
      kind?: "message" | "announcement"
    }) => {
      const message: Message = {
        version: 1,
        messageId: randomUUID(),
        from: "lead", // Caller is always lead for simplicity
        to: args.to,
        body: args.body,
        kind: args.kind ?? "message",
        timestamp: Date.now(),
      }

      // Handle broadcast by sending to all agents
      if (args.to === "*") {
        // For simplicity, we'll just send to the specified recipient
        // In a full implementation, we'd need to know all team members
        const result = await sendMessage(message, args.teamRunId, mailboxConfig)
        return JSON.stringify({ messageId: result.messageId, deliveredTo: [result.deliveredTo] })
      }

      const result = await sendMessage(message, args.teamRunId, mailboxConfig)
      return JSON.stringify(result)
    },
  })
}

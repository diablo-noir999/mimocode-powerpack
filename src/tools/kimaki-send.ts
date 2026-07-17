/**
 * kimaki_send tool — Send message to Discord channel via Kimaki CLI
 *
 * Uses `kimaki send` to create threads and send messages through Discord.
 * Kimaki doesn't expose a message HTTP API — it works through the Discord bot.
 */

import { tool } from "@mimo-ai/plugin"
import { execFileSync } from "child_process"
import { getChannel, isKimakiConnected, autoDiscoverChannel } from "../kimaki/adapter"
import type { KimakiConfig } from "../kimaki/config"

export interface KimakiSendToolConfig {
  enabled: boolean
  config: KimakiConfig
}

function resolveKimakiBinary(): string {
  return process.env.KIMAKI_BIN ?? "kimaki"
}

export function createKimakiSendTool(config: KimakiSendToolConfig) {
  if (!config.enabled) {
    return null
  }

  return tool({
    description:
      "Send a message to a Discord channel or thread via Kimaki. " +
      "Creates a new thread in the channel with the message. " +
      "Use this to interact with Discord-based agents or relay information to Discord channels.",
    args: {
      channelId: tool.schema
        .string()
        .describe("Discord channel ID to send to"),
      threadId: tool.schema
        .string()
        .optional()
        .describe("Discord thread ID (if sending to a specific thread, not yet supported)"),
      message: tool.schema
        .string()
        .describe("Message content to send"),
      agent: tool.schema
        .string()
        .optional()
        .describe("Agent name to route the message to"),
      model: tool.schema
        .string()
        .optional()
        .describe("Model override for this message"),
      username: tool.schema
        .string()
        .optional()
        .default("MiMoCode")
        .describe("Thread name (defaults to 'MiMoCode')"),
    },
    execute: async (args: {
      channelId: string
      threadId?: string
      message: string
      agent?: string
      model?: string
      username?: string
    }) => {
      if (!isKimakiConnected()) {
        return JSON.stringify({
          success: false,
          error: "Kimaki is not connected. Ensure the Kimaki process is running.",
          baseUrl: config.config.connection.baseUrl,
        })
      }

      // Auto-discover channel from kimaki if not in local map
      const channel = getChannel(args.channelId) ?? await autoDiscoverChannel(args.channelId, config.config)
      if (!channel) {
        return JSON.stringify({
          success: false,
          error: `Channel ${args.channelId} is not available in Kimaki. Use kimaki_status to list available channels.`,
        })
      }

      // Build kimaki send command
      const binary = resolveKimakiBinary()
      const cmdParts = [
        binary,
        "send",
        "--channel", args.channelId,
        "--prompt", args.message,
        "--name", args.username ?? "MiMoCode",
      ]

      if (args.agent) {
        cmdParts.push("--agent", args.agent)
      }
      if (args.model) {
        cmdParts.push("--model", args.model)
      }

      try {
        const output = execFileSync(binary, cmdParts.slice(1), {
          encoding: "utf-8",
          timeout: 30000,
          stdio: ["pipe", "pipe", "pipe"],
        })

        // Parse output for thread URL and session ID
        const urlMatch = output.match(/(https:\/\/discord\.com\/channels\/\S+)/)
        const sessionMatch = output.match(/Session:\s*(ses_\S+)/)
        const threadMatch = output.match(/Thread:\s*(.+)/)

        return JSON.stringify({
          success: true,
          type: "message",
          channelId: args.channelId,
          agent: args.agent,
          threadName: threadMatch?.[1]?.trim(),
          session: sessionMatch?.[1],
          url: urlMatch?.[1],
          messagePreview: args.message.slice(0, 200),
        })
      } catch (err: any) {
        const stderr = err.stderr ?? ""
        const stdout = err.stdout ?? ""
        const combined = `${stdout}\n${stderr}`

        // Extract useful error info
        const errorMsg = combined.includes("Failed to")
          ? combined.split("\n").filter((l: string) => l.includes("Failed")).join("; ")
          : err.message

        return JSON.stringify({
          success: false,
          type: "message",
          error: errorMsg,
          channelId: args.channelId,
          command: cmdParts.join(" "),
        })
      }
    },
  })
}

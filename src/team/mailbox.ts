/**
 * Mailbox for agent-to-agent messaging
 * 
 * Simplified from oh-my-opencode's team-core mailbox.
 * Uses file-based persistence in .powerpack/team/ directory.
 * 
 * Pattern: per-agent .jsonl files, append-only, read from offset
 */

import { readFile, readdir, rename, stat, writeFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { ensureDir } from "./utils"

export interface Message {
  version: 1
  messageId: string
  from: string
  to: string
  body: string
  kind: "message" | "announcement"
  timestamp: number
}

export interface MailboxConfig {
  baseDir: string
  maxMessageSizeBytes?: number
}

function getMailboxDir(baseDir: string, teamRunId: string, agentName: string): string {
  // SECURITY: Validate inputs to prevent path traversal attacks
  // Reject inputs containing "..", "/", or "\" which could escape the mailbox directory
  if (teamRunId.includes("..") || teamRunId.includes("/") || teamRunId.includes("\\")) {
    throw new Error("Invalid teamRunId: contains path traversal characters")
  }
  if (agentName.includes("..") || agentName.includes("/") || agentName.includes("\\")) {
    throw new Error("Invalid agentName: contains path traversal characters")
  }
  return join(baseDir, "runtime", teamRunId, "mailbox", agentName)
}

function getMessagePath(inboxDir: string, messageId: string): string {
  return join(inboxDir, `${messageId}.json`)
}

function getProcessedDir(inboxDir: string): string {
  return join(inboxDir, "processed")
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}

/**
 * Send a message to an agent's mailbox
 */
export async function sendMessage(
  message: Message,
  teamRunId: string,
  config: MailboxConfig,
): Promise<{ messageId: string; deliveredTo: string }> {
  const maxSize = config.maxMessageSizeBytes ?? 32 * 1024
  const serializedMessage = JSON.stringify(message, null, 2) + "\n"
  const messageBytes = Buffer.byteLength(serializedMessage, "utf8")
  
  if (messageBytes > maxSize) {
    throw new Error(`payload exceeds ${maxSize} bytes`)
  }

  const inboxDir = getMailboxDir(config.baseDir, teamRunId, message.to)
  await ensureDir(inboxDir)

  const messagePath = getMessagePath(inboxDir, message.messageId)
  const tempPath = `${messagePath}.tmp.${Date.now()}`
  
  try {
    await writeFile(tempPath, serializedMessage, "utf8")
    await rename(tempPath, messagePath)
  } catch (error) {
    // Clean up temp file on error
    try {
      await rm(tempPath, { force: true })
    } catch (cleanupErr) { console.debug("[mailbox] temp file cleanup failed:", cleanupErr instanceof Error ? cleanupErr.message : cleanupErr) }
    throw error
  }

  return { messageId: message.messageId, deliveredTo: message.to }
}

/**
 * List unread messages for an agent
 */
export async function listUnreadMessages(
  teamRunId: string,
  agentName: string,
  config: MailboxConfig,
): Promise<Message[]> {
  const inboxDir = getMailboxDir(config.baseDir, teamRunId, agentName)

  try {
    const entries = await readdir(inboxDir, { withFileTypes: true })
    const messages: Message[] = []

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name.startsWith(".")) {
        continue
      }

      const filePath = join(inboxDir, entry.name)
      try {
        const content = await readFile(filePath, "utf8")
        const parsed = JSON.parse(content) as Message
        
        if (parsed.version === 1 && typeof parsed.messageId === "string") {
          messages.push(parsed)
        }
      } catch (readErr) {
        console.debug("[mailbox] Skipping malformed message:", readErr instanceof Error ? readErr.message : readErr)
      }
    }

    return messages.sort((a, b) => a.timestamp - b.timestamp)
  } catch (error: any) {
    if (error.code === "ENOENT") {
      return []
    }
    throw error
  }
}

/**
 * Acknowledge messages (move to processed directory)
 */
export async function ackMessages(
  teamRunId: string,
  agentName: string,
  messageIds: string[],
  config: MailboxConfig,
): Promise<void> {
  const inboxDir = getMailboxDir(config.baseDir, teamRunId, agentName)
  const processedDir = getProcessedDir(inboxDir)
  await ensureDir(processedDir)

  for (const messageId of messageIds) {
    const sourcePath = getMessagePath(inboxDir, messageId)
    const targetPath = join(processedDir, `${messageId}.json`)

    try {
      await rename(sourcePath, targetPath)
    } catch (error: any) {
      if (error.code === "ENOENT") {
        continue
      }
      throw error
    }
  }
}

/**
 * Build envelope for message injection
 */
export function buildEnvelope(message: Message): string {
  const attrs = [
    `from="${escapeAttr(message.from)}"`,
    `timestamp="${escapeAttr(String(message.timestamp))}"`,
    `messageId="${escapeAttr(message.messageId)}"`,
    `kind="${escapeAttr(message.kind)}"`,
  ]

  return `<peer_message ${attrs.join(" ")}>
${message.body}
</peer_message>`
}

function escapeAttr(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}

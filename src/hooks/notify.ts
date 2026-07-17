/**
 * Native OS Notifications Hook
 *
 * Sends native OS notifications for session events (idle, error, permission, question).
 * Supports macOS (alerter/osascript), Linux (notify-send), and Windows (PowerShell).
 *
 * Features:
 * - Shows current message content in notifications
 * - Event-specific icons and formatting
 * - Quiet hours support
 * - Message truncation for readability
 */

import { platform } from "os"
import { execFileSync } from "child_process"

interface NotifyConfig {
  enabled: boolean
  quietHours?: { start: string; end: string }
  notifyChildSessions?: boolean
  /** Show message content in notification body (default: true) */
  showMessage?: boolean
  /** Maximum message length in notification (default: 100) */
  maxMessageLength?: number
}

// Event-specific formatting
const EVENT_FORMAT: Record<string, { icon: string; titlePrefix: string }> = {
  "session.idle": { icon: "✅", titlePrefix: "Ready" },
  "session.completed": { icon: "✅", titlePrefix: "Done" },
  "session.error": { icon: "❌", titlePrefix: "Error" },
  "permission.asked": { icon: "🔒", titlePrefix: "Permission" },
  "permission.updated": { icon: "🔓", titlePrefix: "Permission" },
  "question.asked": { icon: "❓", titlePrefix: "Question" },
}

export function createNotifyHook(config: NotifyConfig) {
  const showMessage = config.showMessage !== false
  const maxLen = config.maxMessageLength ?? 100

  return async (event: any) => {
    if (!config.enabled) return

    // Check quiet hours
    if (config.quietHours && isQuietHours(config.quietHours)) return

    const eventType = event?.type ?? event?.event?.type ?? ""
    const format = EVENT_FORMAT[eventType]
    if (!format) return

    // Skip child sessions unless configured
    if (config.notifyChildSessions === false && event?.parentSessionID) return

    // Build notification content
    const title = `${format.icon} ${format.titlePrefix}`
    let body = buildBody(event, eventType, showMessage, maxLen)

    // Send native notification
    await sendNativeNotification(title, body)
  }
}

function buildBody(event: any, eventType: string, showMessage: boolean, maxLen: number): string {
  const parts: string[] = []

  switch (eventType) {
    case "session.idle":
    case "session.completed": {
      parts.push("Ready for review")
      if (showMessage && event?.lastMessage) {
        const msg = truncate(event.lastMessage, maxLen)
        parts.push(`\n${msg}`)
      }
      break
    }
    case "session.error": {
      const errMsg = event?.error?.message ?? event?.error ?? "Unknown error"
      parts.push(truncate(errMsg, maxLen))
      break
    }
    case "permission.asked":
    case "permission.updated": {
      parts.push("Permission needed")
      if (showMessage && event?.tool) {
        parts.push(`\nTool: ${event.tool}`)
      }
      if (showMessage && event?.description) {
        parts.push(`\n${truncate(event.description, maxLen)}`)
      }
      break
    }
    case "question.asked": {
      parts.push("Your input needed")
      if (showMessage && event?.question) {
        parts.push(`\n${truncate(event.question, maxLen)}`)
      } else if (showMessage && event?.message) {
        parts.push(`\n${truncate(event.message, maxLen)}`)
      }
      break
    }
  }

  // Add session ID suffix for identification
  if (event?.sessionID) {
    const shortId = event.sessionID.slice(-8)
    parts.push(`\n[...${shortId}]`)
  }

  return parts.join("")
}

function truncate(text: string, maxLen: number): string {
  if (!text || typeof text !== "string") return ""
  const cleaned = text.replace(/\s+/g, " ").trim()
  if (cleaned.length <= maxLen) return cleaned
  return cleaned.slice(0, maxLen - 3) + "..."
}

function isQuietHours(quietHours: { start: string; end: string }): boolean {
  const now = new Date()
  const hours = now.getHours()
  const minutes = now.getMinutes()
  const currentMinutes = hours * 60 + minutes

  const [startH, startM] = quietHours.start.split(":").map(Number)
  const [endH, endM] = quietHours.end.split(":").map(Number)
  const startMinutes = startH * 60 + startM
  const endMinutes = endH * 60 + endM

  if (startMinutes <= endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes
  } else {
    // Quiet hours span midnight
    return currentMinutes >= startMinutes || currentMinutes < endMinutes
  }
}

function escapeAppleScript(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function escapePowerShell(s: string): string {
  return s.replace(/'/g, "''")
}

async function sendNativeNotification(title: string, body: string): Promise<void> {
  const os = platform()

  try {
    if (os === "darwin") {
      // macOS: use alerter if available, fall back to osascript
      try {
        execFileSync("alerter", ["-title", title, "-message", body, "-ignoreProfile"], {
          timeout: 5000,
          stdio: "ignore",
        })
      } catch {
        execFileSync(
          "osascript",
          ["-e", `display notification "${escapeAppleScript(body)}" with title "${escapeAppleScript(title)}" sound name "default"`],
          { timeout: 5000, stdio: "ignore" }
        )
      }
    } else if (os === "linux") {
      execFileSync("notify-send", ["-u", "normal", title, body], {
        timeout: 5000,
        stdio: "ignore",
      })
    } else if (os === "win32") {
      // Windows: use PowerShell toast notification
      execFileSync(
        "powershell",
        ["-Command", `New-BurntToastNotification -Text '${escapePowerShell(title)}','${escapePowerShell(body)}'`],
        { timeout: 5000, stdio: "ignore" }
      )
    }
  } catch {
    // Notification failed silently — don't crash the plugin
  }
}

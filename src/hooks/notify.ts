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
import { spawn } from "child_process"

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
    try {
      if (!config.enabled) return

      // Check quiet hours
      if (config.quietHours && isQuietHours(config.quietHours)) return

      // MiMoCode v0.1.7+ delivers { event: Event } where
      // EventSessionIdle = { type, properties: { sessionID } }; some runtimes
      // wrap further ({ directory, project, workspace, payload }). Unwrap to
      // the innermost object that actually carries { type, ... }.
      const evt = eventData(event)
      const eventType = evt?.type ?? ""
      const format = EVENT_FORMAT[eventType]
      if (!format) return

      // Skip child sessions unless configured
      if (config.notifyChildSessions === false && evt?.parentSessionID) return

      // Build notification content
      const title = `${format.icon} ${format.titlePrefix}`
      const body = buildBody(evt, eventType, showMessage, maxLen)

      // Send native notification — non-blocking fire-and-forget, never throws
      sendNativeNotification(title, body)
    } catch (err) {
      console.error("[notify] hook failed:", err instanceof Error ? err.message : err)
    }
  }
}

/**
 * Unwrap the event envelope to the innermost object carrying { type, ... }.
 * Handles bare events ({ type, properties }), the MiMoCode hook input
 * ({ event: Event }), and payload-wrapped shapes
 * ({ directory, project, workspace, payload: Event }).
 */
function eventData(event: any): any {
  if (event?.type) return event
  if (event?.event?.type) return event.event
  if (event?.payload?.type) return event.payload
  return event
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

/**
 * Send a native OS notification without ever blocking the event loop.
 * Detached, unref'd, fire-and-forget — never awaited, never throws.
 */
function sendNativeNotification(title: string, body: string): void {
  const os = platform()

  try {
    if (os === "darwin") {
      // macOS: prefer alerter; fall back to osascript on failure
      const alerter = spawn("alerter", ["-title", title, "-message", body, "-ignoreProfile"], {
        detached: true,
        stdio: "ignore",
      })
      alerter.unref()
      alerter.on("error", () => {
        const osa = spawn(
          "osascript",
          ["-e", `display notification "${escapeAppleScript(body)}" with title "${escapeAppleScript(title)}" sound name "default"`],
          { detached: true, stdio: "ignore" }
        )
        osa.unref()
        osa.on("error", () => {})
      })
    } else if (os === "linux") {
      const child = spawn("notify-send", ["-u", "normal", title, body], {
        detached: true,
        stdio: "ignore",
      })
      child.unref()
      child.on("error", () => {})
    } else if (os === "win32") {
      // Windows: use PowerShell toast notification
      const child = spawn(
        "powershell",
        ["-Command", `New-BurntToastNotification -Text '${escapePowerShell(title)}','${escapePowerShell(body)}'`],
        { detached: true, stdio: "ignore" }
      )
      child.unref()
      child.on("error", () => {})
    }
  } catch {
    // Notification failed silently — don't crash the plugin
  }
}

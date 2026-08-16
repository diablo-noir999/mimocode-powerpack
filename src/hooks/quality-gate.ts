/**
 * Quality Gate Hook
 *
 * When the agent is about to idle with uncommitted changes, run a
 * configurable validation pipeline. Injects a message when failures
 * are detected.
 *
 * Note: session.idle is deprecated in MiMo-Code v0.1.7+ (bus event).
 * This hook may not fire in all versions.
 */

import { execFile } from "child_process"
import { GIT_STATUS_TIMEOUT_MS } from "../constants"

const DEFAULT_COMMANDS = [
  { name: "typecheck", cmd: "bun run typecheck", timeout: 30000 },
  { name: "test", cmd: "bun test", timeout: 60000 },
]

/** Check whether an object looks like a flat { role, content } message */
function isFlatMessage(obj: unknown): boolean {
  return typeof obj === "object" && obj !== null && "role" in obj && !("info" in obj)
}

/** Check whether an object looks like a WithParts { info, parts } message */
function isWithPartsMessage(obj: unknown): boolean {
  return typeof obj === "object" && obj !== null && "info" in obj && "parts" in obj
}

export function createQualityGateHook(config?: { commands?: Array<{ name: string; cmd: string; timeout?: number }> }) {
  const commands = config?.commands ?? DEFAULT_COMMANDS

  return async (input: any, output: any) => {
    try {
      if (!input?.directory) return

      const dir = input.directory

      try {
        const status = await new Promise<string>((resolve, reject) => {
          execFile("git", ["status", "--porcelain"], { cwd: dir, timeout: GIT_STATUS_TIMEOUT_MS }, (err, stdout) => {
            if (err) reject(err)
            else resolve(stdout.toString().trim())
          })
        })
        if (!status) return
      } catch {
        return
      }

    const runCommand = async ({ name, cmd, timeout }: { name: string; cmd: string; timeout?: number }): Promise<string> => {
      if (/[;&|`$(){}!<>]/.test(cmd)) {
        return `⚠️ ${name}: SKIPPED (unsafe command)`
      }
      const parts = cmd.split(/\s+/).filter(Boolean)
      return new Promise<string>((resolve) => {
        execFile(parts[0], parts.slice(1), { cwd: dir, timeout }, (err, _stdout, stderr) => {
          if (err) {
            const lastLines = (stderr?.toString() || "").split("\n").slice(-10).join("\n")
            resolve(`❌ ${name}: FAIL` + (lastLines ? `\n   ${lastLines}` : ""))
          } else {
            resolve(`✅ ${name}: PASS`)
          }
        })
      })
    }

    const results = await Promise.all(commands.map(runCommand))
    const allPassed = results.every(r => r.startsWith("✅") || r.startsWith("⚠️"))

    if (allPassed) return
    if (!output) return

    const summary = results.join("\n")

    // Push a message in the format matching existing messages (or skip if unknown)
    if (Array.isArray(output.messages)) {
        if (output.messages.length === 0 || isFlatMessage(output.messages[0])) {
          output.messages.push({
            role: "system",
            content: `⚠️ Quality gate failed:\n${summary}\n\nFix the issues above before completing.`,
          })
        } else if (isWithPartsMessage(output.messages[0])) {
          // WithParts format — push a user message with the gate results
          output.messages.push({
            info: {
              role: "user",
              id: `quality-gate-${Date.now()}`,
              sessionID: input.sessionID ?? "",
              time: { created: Date.now() },
              agent: "powerpack",
              model: {},
            },
            parts: [{ type: "text", text: `⚠️ Quality gate failed:\n${summary}\n\nFix the issues above before completing.` }],
          })
        }
      }
    } catch (err) {
      console.error("[quality-gate] hook failed:", err instanceof Error ? err.message : err)
    }
  }
}

/**
 * Quality Gate Hook
 *
 * When the agent is about to idle with uncommitted changes, run a
 * configurable validation pipeline. Inspired by ECC's post-edit quality
 * gate and no-mistakes' validation pipeline concept.
 */

import { execFile } from "child_process"
import { GIT_STATUS_TIMEOUT_MS } from "../constants"

const DEFAULT_COMMANDS = [
  { name: "typecheck", cmd: "bun run typecheck", timeout: 30000 },
  { name: "test", cmd: "bun test", timeout: 60000 },
]

export function createQualityGateHook(config?: { commands?: Array<{ name: string; cmd: string; timeout?: number }> }) {
  const commands = config?.commands ?? DEFAULT_COMMANDS

  return async (input: any, output: any) => {
    // Only trigger on session.idle
    if (!input?.directory) return

    const dir = input.directory

    // Check if there are uncommitted changes (async to avoid blocking event loop)
    try {
      const status = await new Promise<string>((resolve, reject) => {
        execFile("git", ["status", "--porcelain"], { cwd: dir, timeout: GIT_STATUS_TIMEOUT_MS }, (err, stdout) => {
          if (err) reject(err)
          else resolve(stdout.toString().trim())
        })
      })
      if (!status) return // No changes, nothing to validate
    } catch {
      return // Not a git repo or git not available
    }

    const runCommand = async ({ name, cmd, timeout }: { name: string; cmd: string; timeout?: number }): Promise<string> => {
      if (/[;&|`$(){}!<>]/.test(cmd)) {
        return `⚠️ ${name}: SKIPPED (unsafe command)`;
      }
      const parts = cmd.split(/\s+/).filter(Boolean);
      return new Promise<string>((resolve) => {
        execFile(parts[0], parts.slice(1), { cwd: dir, timeout }, (err, _stdout, stderr) => {
          if (err) {
            const lastLines = (stderr?.toString() || "").split("\n").slice(-10).join("\n");
            resolve(`❌ ${name}: FAIL` + (lastLines ? `\n   ${lastLines}` : ""));
          } else {
            resolve(`✅ ${name}: PASS`);
          }
        });
      });
    };

    const results = await Promise.all(commands.map(runCommand));
    const allPassed = results.every(r => r.startsWith("✅") || r.startsWith("⚠️"));

    if (!allPassed) {
      // Inject a message suggesting the agent fix the issues
      const summary = results.join("\n")
      output.messages = output.messages || []
      output.messages.push({
        role: "system",
        content: `⚠️ Quality gate failed:\n${summary}\n\nFix the issues above before completing.`,
      })
    }
  }
}

/**
 * Error Input Purging Hook
 *
 * For tool errors (ToolPart with state.status === "error"), prunes the
 * input payload after a configurable number of turns. Preserves the error
 * message but removes potentially large input data that is no longer useful.
 *
 * Source: Adapted from dev/opencode-dynamic-context-pruning/src/strategies/purge-errors.ts
 * Rewritten for MiMo-Code v0.1.7+ WithParts { info, parts } format.
 */

import type { HookInput, HookOutput } from "../types"
import { MAX_ERROR_CONTENT_LENGTH } from "../constants"

export function createErrorPruneHook(turnsBeforePrune: number = 4) {
  return async (input: HookInput, output: HookOutput) => {
    try {
      if (!output?.messages?.length) return

      const messages = output.messages

      // Find the last user message index (represents "current turn")
      let lastUserIndex = -1
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].info?.role === "user") {
          lastUserIndex = i
          break
        }
      }

      if (lastUserIndex === -1) return

      // Pre-compute prefix sum: userCountBefore[i] = number of user messages
      // at indices [0, i-1]. This lets us count user messages in any range in O(1).
      const userCountBefore: number[] = new Array(messages.length + 1)
      userCountBefore[0] = 0
      for (let i = 0; i < messages.length; i++) {
        userCountBefore[i + 1] = userCountBefore[i] + (messages[i].info?.role === "user" ? 1 : 0)
      }

      // Scan for tool errors and prune old ones
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i]
        if (msg.info?.role !== "assistant") continue
        if (!Array.isArray(msg.parts)) continue

        for (const part of msg.parts) {
          if (part?.type !== "tool") continue
          if (part.state?.status !== "error") continue

          // User messages in [i+1, lastUserIndex] via prefix sum
          const turnsSince = userCountBefore[lastUserIndex + 1] - userCountBefore[i + 1]

          if (turnsSince < turnsBeforePrune) continue

          // Preserve the error message but remove large input payload
          const errorMsg = (part.state.error ?? "[Error]").slice(0, MAX_ERROR_CONTENT_LENGTH)
          part.state.input = {}
          part.state.error = `${errorMsg}\n\n[Input content pruned after ${turnsSince} turns to save tokens]`
        }
      }
    } catch (err) {
      console.error("[error-prune] hook failed:", err instanceof Error ? err.message : err)
    }
  }
}

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

    // Scan for tool errors and prune old ones
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]
      if (msg.info?.role !== "assistant") continue
      if (!Array.isArray(msg.parts)) continue

      for (const part of msg.parts) {
        if (part?.type !== "tool") continue
        if (part.state?.status !== "error") continue

        // Count user messages between this error and the last user message.
        // Each user message represents one conversation turn.
        let turnsSince = 0
        for (let j = i + 1; j <= lastUserIndex; j++) {
          if (messages[j].info?.role === "user") turnsSince++
        }

        if (turnsSince < turnsBeforePrune) continue

        // Preserve the error message but remove large input payload
        const errorMsg = (part.state.error ?? "[Error]").slice(0, MAX_ERROR_CONTENT_LENGTH)
        part.state.input = {}
        part.state.error = `${errorMsg}\n\n[Input content pruned after ${turnsSince} turns to save tokens]`
      }
    }
  }
}

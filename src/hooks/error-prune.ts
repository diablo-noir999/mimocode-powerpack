/**
 * Error Input Purging Hook
 *
 * Prunes the input content of errored tool calls after a configurable
 * number of turns. Preserves the error message but removes potentially
 * large input payloads that are no longer useful.
 *
 * Source: Adapted from dev/opencode-dynamic-context-pruning/src/strategies/purge-errors.ts
 */

import type { HookInput, HookOutput } from "../types"
import { MAX_ERROR_CONTENT_LENGTH } from "../constants"

export function createErrorPruneHook(turnsBeforePrune: number = 4) {
  return async (input: HookInput, output: HookOutput) => {
    if (!output?.messages || !Array.isArray(output.messages)) return

    const messages = output.messages

    // Find the last user message index (represents "current turn")
    let lastUserIndex = -1
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        lastUserIndex = i
        break
      }
    }

    if (lastUserIndex === -1) return

    // Prune errored tool inputs that are older than turnsBeforePrune
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]

      // Only process tool result messages with errors
      if (msg.role !== "tool") continue
      if (!msg.is_error && !msg.isError && !msg.error) continue

      // Count user messages between this error and the last user message.
      // Each user message represents one conversation turn.
      let turnsSince = 0
      for (let j = i + 1; j <= lastUserIndex; j++) {
        if (messages[j].role === "user") turnsSince++
      }

      // Only prune if enough turns have passed
      if (turnsSince < turnsBeforePrune) continue

      // Preserve the error message but remove large input content
      const toolName = msg.name ?? msg.tool ?? "tool"
      const errorMessage = typeof msg.content === "string"
        ? msg.content.slice(0, MAX_ERROR_CONTENT_LENGTH)
        : "[Error content]"

      messages[i] = {
        ...msg,
        content: `${errorMessage}\n\n[Input content pruned after ${turnsSince} turns to save tokens]`,
      }
    }
  }
}

/**
 * Token Estimation Utilities
 *
 * Shared helpers for rough token counting used by
 * context-analysis. Consolidates the duplicated estimateMessageTokens /
 * estimateTokens logic into a single source of truth.
 */

import { CHARS_PER_TOKEN_ESTIMATE } from "../constants"
import { isRecord } from "./message-utils"

/**
 * Estimate the number of tokens in a text string.
 * Uses the simple heuristic: 1 token ≈ CHARS_PER_TOKEN_ESTIMATE characters.
 */
export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE)
}

/**
 * Estimate the total tokens consumed by a message.
 *
 * Handles both flat `content` strings and the `parts[]` array format
 * used by the SDK. Tool-bearing parts (tool-call input objects, tool
 * results, error strings) are always counted so they carry nonzero
 * weight and never become prime drop candidates. Returns 0 for messages
 * with no recognisable content.
 */
export function estimateMessageTokens(message: any): number {
  // Flat string content
  if (typeof message.content === "string") {
    return estimateTextTokens(message.content)
  }

  // Parts-based format (SDK messages)
  if (Array.isArray(message.parts)) {
    let total = 0
    for (const part of message.parts) {
      if (!isRecord(part)) continue
      if (typeof part.text === "string") total += estimateTextTokens(part.text)
      if (typeof part.thinking === "string") total += estimateTextTokens(part.thinking)
      if (typeof part.content === "string") total += estimateTextTokens(part.content)
      if (typeof part.error === "string") total += estimateTextTokens(part.error)
      if (isRecord(part.state)) {
        // Tool results: string output, or object output serialized
        if (typeof part.state.output === "string") {
          total += estimateTextTokens(part.state.output)
        } else if (part.state.output !== undefined && part.state.output !== null) {
          total += estimateTextTokens(safeStringify(part.state.output))
        }
        // Tool-call input: always counted (object or string) so tool-bearing
        // messages have nonzero weight
        if (part.state.input !== undefined && part.state.input !== null) {
          if (typeof part.state.input === "string") {
            total += estimateTextTokens(part.state.input)
          } else {
            total += estimateTextTokens(safeStringify(part.state.input))
          }
        }
        // Error state
        if (typeof part.state.error === "string") {
          total += estimateTextTokens(part.state.error)
        }
      }
    }
    return total
  }

  return 0
}

/**
 * JSON.stringify that never throws (e.g. circular references).
 * Returns "" on failure so token estimation stays pure and fast.
 */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? ""
  } catch {
    return ""
  }
}

/**
 * Tool Call Deduplication Hook
 *
 * Detects repeated identical tool calls (same tool name + same arguments)
 * and keeps only the most recent output. Older duplicates are replaced with
 * a placeholder to save tokens.
 *
 * Source: Adapted from dev/opencode-dynamic-context-pruning/src/strategies/deduplication.ts
 */

import type { HookInput, HookOutput } from "../types"

export function createDedupPruneHook() {
  return async (input: HookInput, output: HookOutput) => {
    if (!output?.messages || !Array.isArray(output.messages)) return

    const messages = output.messages
    const seen = new Map<string, number>() // hash -> last seen index
    const toPrune = new Set<number>()

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]

      // Only process tool result messages
      if (msg.role !== "tool") continue

      // Build a hash key from tool name + arguments (NOT tool_call_id, which is unique)
      const toolName = msg.name ?? msg.tool ?? ""
      const args = JSON.stringify(msg.arguments ?? msg.input ?? msg.args ?? msg.parameters ?? {})
      // FNV-1a hash for fast dedup (SHA-256 is overkill for hot path)
      const key = `${toolName}:${args}`
      let hashVal = 0x811c9dc5
      for (let j = 0; j < key.length; j++) {
        hashVal ^= key.charCodeAt(j)
        hashVal = (hashVal * 0x01000193) | 0
      }
      const hash = (hashVal >>> 0).toString(36)

      if (seen.has(hash)) {
        // Duplicate found — mark the OLDER one for pruning
        const olderIndex = seen.get(hash)!
        toPrune.add(olderIndex)
        // Update to point to the newer one
        seen.set(hash, i)
      } else {
        seen.set(hash, i)
      }
    }

    // Replace pruned messages with placeholders
    if (toPrune.size > 0) {
      for (const idx of toPrune) {
        const msg = messages[idx]
        const toolName = msg.name ?? msg.tool ?? "tool"
        messages[idx] = {
          ...msg,
          content: `[Duplicate ${toolName} output pruned — same call exists later in conversation]`,
        }
      }
    }
  }
}

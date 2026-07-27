/**
 * Tool Call Deduplication Hook
 *
 * Scans assistant messages for ToolPart objects and removes duplicate
 * tool calls (same tool name + same arguments). Older duplicates have
 * their input/output cleared to save tokens while preserving structure.
 *
 * Source: Adapted from dev/opencode-dynamic-context-pruning/src/strategies/deduplication.ts
 * Rewritten for MiMo-Code v0.1.7+ WithParts { info, parts } format.
 */

import type { HookInput, HookOutput } from "../types"

export function createDedupPruneHook() {
  return async (input: HookInput, output: HookOutput) => {
    if (!output?.messages?.length) return

    const messages = output.messages
    // hash -> latest { msgIdx, partIdx }
    const seen = new Map<string, { msgIdx: number; partIdx: number }>()

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]
      if (msg.info?.role !== "assistant") continue
      if (!Array.isArray(msg.parts)) continue

      for (let j = 0; j < msg.parts.length; j++) {
        const part = msg.parts[j]
        if (part?.type !== "tool") continue

        // FNV-1a hash from tool name + serialized input
        const key = `${part.tool}:${JSON.stringify(part.state?.input ?? {})}`
        let hashVal = 0x811c9dc5
        for (let k = 0; k < key.length; k++) {
          hashVal ^= key.charCodeAt(k)
          hashVal = (hashVal * 0x01000193) | 0
        }
        const hash = (hashVal >>> 0).toString(36)

        if (seen.has(hash)) {
          // Duplicate — clear the OLDER one's payload
          const older = seen.get(hash)!
          const olderMsg = messages[older.msgIdx]
          if (olderMsg && olderMsg.parts[older.partIdx]) {
            const olderPart = olderMsg.parts[older.partIdx]
            if (olderPart.state?.status === "completed") {
              olderPart.state.input = {}
              olderPart.state.output = "[Duplicate tool output pruned]"
            }
          }
          // Track the newer occurrence
          seen.set(hash, { msgIdx: i, partIdx: j })
        } else {
          seen.set(hash, { msgIdx: i, partIdx: j })
        }
      }
    }
  }
}

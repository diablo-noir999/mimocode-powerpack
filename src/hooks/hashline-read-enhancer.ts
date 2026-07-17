/**
 * Hashline Read Enhancer Hook
 *
 * Tags every line in `read` tool output with a content hash (LINE#HASH).
 * This allows the hashline edit tool to reference lines by hash.
 *
 * Source: Adapted from dev/oh-my-opencode/packages/omo-opencode/src/hooks/hashline-read-enhancer/
 */

import type { HookInput, HookOutput } from "../types"
import { computeLineHash } from "../tools/hashline-utils"

export function createHashlineReadEnhancerHook() {
  return async (input: HookInput, output: HookOutput) => {
    if (input.tool !== "read") return
    if (!output?.content || typeof output.content !== "string") return

    const lines = output.content.split("\n")
    const enhanced: string[] = []

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const hash = computeLineHash(line)
      const lineNum = String(i + 1).padStart(4, " ")
      enhanced.push(`${lineNum}#${hash}| ${line}`)
    }

    output.content = enhanced.join("\n")
  }
}

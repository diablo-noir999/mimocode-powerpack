/**
 * Tool Discovery Hook
 *
 * MiMo-Code v0.1.7+ changed the experimental.chat.messages.transform
 * output format to { info: Message; parts: Part[] } (WithParts).
 * Flat { role, content } messages cannot be injected into this array —
 * MiMoCode's runtime iterates parts.length and crashes.
 *
 * Tool discovery instructions should be delivered via system prompt
 * (experimental.chat.system.transform) instead.
 */

import type { HookInput, HookOutput } from "../types"

export function createToolDiscoveryHook() {
  return async (_input: HookInput, _output: HookOutput) => {
    // DISABLED: Flat message injection is incompatible with MiMo-Code v0.1.7+.
    // System-level tool discovery should use the system.transform hook instead.
  }
}

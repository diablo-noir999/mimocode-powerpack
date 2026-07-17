// Compatibility declarations for opencode-quota copied code
// These types exist in @opencode-ai/plugin but not in @mimo-ai/plugin
// Build passes; these are type-level only.

declare module "@opencode-ai/plugin/tui" {
  export interface TuiPluginApi {
    [key: string]: any
  }
}

// Allow importing any path as an OpenCode plugin module
declare module "opencode-dynamic-context-pruning" {
  import type { Plugin } from "@opencode-ai/plugin"
  const plugin: Plugin
  export default plugin
}

declare module "opencode-notify" {
  import type { Plugin } from "@opencode-ai/plugin"
  const plugin: Plugin
  export default plugin
}

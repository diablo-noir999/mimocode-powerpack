/**
 * Shared type interfaces for plugin hooks and tool context.
 */

/** Common fields in hook input objects */
export interface HookInput {
  /** Working directory for the session */
  directory?: string
  /** Session identifier */
  sessionID?: string
  /** Whether this is a child session */
  parentSessionID?: string
  /** Tool name that triggered the hook */
  tool?: string
}

/** Common fields in hook output objects that hooks can mutate */
export interface HookOutput {
  /** Message array that hooks can prune/modify */
  messages?: any[]
  /** String content that hooks can append to */
  content?: string
  /** Whether the output was modified by a hook */
  modified?: boolean
}

/** Context passed to tool execute functions */
export interface ToolContext {
  /** Working directory */
  directory?: string
  /** Session ID */
  sessionID?: string
  /** Parent session ID (for child sessions) */
  parentSessionID?: string
  /** Raw SDK client */
  client?: any
}

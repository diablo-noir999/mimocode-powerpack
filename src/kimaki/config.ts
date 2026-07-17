/**
 * Kimaki configuration for the MiMoCode compat layer
 *
 * Mirrors the subset of Kimaki's config needed for the adapter.
 * Kimaki runs as a separate process; this config tells the adapter
 * how to reach it and how to map concepts between the two systems.
 */

import type {
  BotMode,
  ChannelType,
  VerbosityLevel,
  KimakiChannelMapping,
  KimakiAgentMapping,
} from "./types"

export interface KimakiConfig {
  /** Master switch — disabled by default */
  enabled: boolean

  /** How to reach the running Kimaki instance */
  connection: {
    /** Base URL of Kimaki's Hrana server (default: http://127.0.0.1:31099) */
    baseUrl: string
    /** Bearer token for Hrana auth */
    token?: string
  }

  /** Discord bot credentials (only needed for self-hosted mode) */
  bot?: {
    token: string
    mode: BotMode
    clientId?: string
    clientSecret?: string
    proxyUrl?: string
  }

  /** Auto-start Kimaki process when plugin loads */
  autoStart?: {
    /** Enable auto-start (default: false — requires kimaki binary in PATH or KIMAKI_BIN env) */
    enabled: boolean
    /** Lock port to avoid conflicts with user's kimaki (default: 31099) */
    lockPort?: string
    /** Data directory (default: ~/.kimaki) */
    dataDir?: string
    /** Extra args to pass to the kimaki binary */
    args?: string[]
  }

  /** Channel → project mappings */
  channels: KimakiChannelMapping[]

  /** Agent name mappings (Kimaki agent → MiMoCode agent) */
  agents: KimakiAgentMapping[]

  /** Default verbosity for new channels */
  defaultVerbosity: VerbosityLevel

  /** Default mention mode for new channels */
  defaultMentionMode: boolean

  /** Whether to create git worktrees for new sessions */
  useWorktrees: boolean

  /** Permission timeout in milliseconds */
  permissionTimeoutMs: number

  /** Shell command prefix (default: "!") */
  shellPrefix: string
}

export const DEFAULT_KIMAKI_CONFIG: KimakiConfig = {
  enabled: false,
  connection: {
    baseUrl: "http://127.0.0.1:31099",
  },
  channels: [],
  agents: [],
  defaultVerbosity: "text_and_essential_tools",
  defaultMentionMode: false,
  useWorktrees: false,
  permissionTimeoutMs: 600_000,
  shellPrefix: "!",
}

/**
 * Merge user-provided Kimaki config with defaults.
 */
export function resolveKimakiConfig(userConfig?: Partial<KimakiConfig>): KimakiConfig {
  if (!userConfig) return { ...DEFAULT_KIMAKI_CONFIG, channels: [], agents: [] }

  return {
    ...DEFAULT_KIMAKI_CONFIG,
    ...userConfig,
    connection: { ...DEFAULT_KIMAKI_CONFIG.connection, ...userConfig.connection },
    channels: [...(userConfig.channels ?? [])],
    agents: [...(userConfig.agents ?? [])],
  }
}

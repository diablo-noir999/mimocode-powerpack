/**
 * Kimaki Discord compat layer — type definitions
 *
 * Adapted from Kimaki's Drizzle schema (cli/src/schema.ts),
 * runtime state (thread-runtime-state.ts), and ingress types.
 * This module defines the subset of Kimaki's data model needed
 * for the MiMoCode adapter bridge.
 */

// ── Enums ──────────────────────────────────────────────────────

export type BotMode = "self_hosted" | "gateway"
export type ChannelType = "text" | "voice"
export type VerbosityLevel = "tools_and_text" | "text_and_essential_tools" | "text_only"
export type ThreadSessionSource = "kimaki" | "external_poll"
export type WorktreeStatus = "pending" | "ready" | "error"
export type WorkspaceStatus = "pending" | "ready" | "error"

// ── Core domain types (mirrors Kimaki DB rows) ─────────────────

export interface KimakiChannel {
  channelId: string       // Discord channel ID
  directory: string       // project directory path
  channelType: ChannelType
  agentName?: string      // from channel_agents
  modelId?: string        // from channel_models
  verbosity: VerbosityLevel
  mentionMode: boolean
  worktreesEnabled: boolean
}

export interface KimakiThread {
  threadId: string        // Discord thread ID
  sessionId: string       // MiMoCode/OpenCode session ID
  source: ThreadSessionSource
  channelId: string       // parent channel
  lastSyncedName?: string
  worktree?: KimakiWorktree
}

export interface KimakiWorktree {
  worktreeName: string
  worktreeDirectory?: string
  projectDirectory: string
  status: WorktreeStatus
  errorMessage?: string
}

export interface KimakiMessage {
  messageId: string
  threadId: string
  partId?: string         // from part_messages
  content: string
  authorId: string
  authorUsername: string
  images?: KimakiFileAttachment[]
  timestamp: number
  command?: KimakiCommand
  agent?: string
  model?: string
}

export interface KimakiFileAttachment {
  contentType?: string | null
  name?: string | null
  sourceUrl?: string
}

export interface KimakiCommand {
  name: string
  arguments: string
}

// ── Agent mapping ──────────────────────────────────────────────

export interface KimakiAgent {
  name: string
  channelId?: string     // channel-level assignment
  sessionId?: string     // session-level override
  modelId?: string
  variant?: string
}

// ── Queued message (runtime) ───────────────────────────────────

export interface KimakiQueuedMessage {
  prompt: string
  userId: string
  username: string
  images?: KimakiFileAttachment[]
  appId?: string
  command?: KimakiCommand
  agent?: string
  model?: string
  permissions?: string[]
  sourceMessageId?: string
  sourceThreadId?: string
  repliedMessage?: KimakiRepliedMessageContext
}

export interface KimakiRepliedMessageContext {
  authorUsername?: string
  text: string
}

// ── Thread run state ───────────────────────────────────────────

export interface KimakiThreadRunState {
  sessionId: string | undefined
  sessionUsername: string | undefined
  sessionUserId: string | undefined
  queueItems: KimakiQueuedMessage[]
  sentPartIds: Set<string>
}

// ── Voice / transcription ──────────────────────────────────────

export type TranscriptionProvider = "openai" | "gemini"
export type SpeechProvider = "openai" | "gemini"

export interface TranscriptionResult {
  transcription: string
  queueMessage: boolean
  agent?: string
}

export interface SpeechResult {
  audio: Buffer
  mediaType: string
}

// ── Ingress (how Kimaki feeds messages into a session) ─────────

export interface KimakiIngressInput {
  prompt: string
  userId: string
  username: string
  sourceMessageId?: string
  sourceThreadId?: string
  repliedMessage?: KimakiRepliedMessageContext
  images?: KimakiFileAttachment[]
  appId?: string
  command?: KimakiCommand
  agent?: string
  model?: string
  permissions?: string[]
}

// ── Adapter bridge types (Kimaki → MiMoCode mapping) ───────────

export interface KimakiChannelMapping {
  kimakiChannelId: string
  mimocodeProjectId: string   // mapped project identifier
  directory: string
}

export interface KimakiThreadMapping {
  kimakiThreadId: string
  mimocodeSessionId: string   // mapped session identifier
  kimakiChannelId: string
}

export interface KimakiAgentMapping {
  kimakiAgentName: string
  mimocodeAgentName: string   // mapped MiMoCode agent
  role?: string               // Kimaki role for RBAC
}

export interface KimakiEventMapping {
  kimakiEvent: string         // Discord event type
  mimocodeEvent: string       // MiMoCode event type
  transform?: (data: any) => any
}

// ── Scheduled tasks ────────────────────────────────────────────

export type ScheduledTaskStatus = "planned" | "running" | "completed" | "cancelled" | "failed"
export type ScheduledTaskScheduleKind = "at" | "cron"

export interface KimakiScheduledTask {
  id: number
  status: ScheduledTaskStatus
  scheduleKind: ScheduledTaskScheduleKind
  runAt?: string
  cronExpr?: string
  timezone?: string
  nextRunAt: string
  payloadJson: string
  promptPreview: string
  channelId?: string
  threadId?: string
  sessionId?: string
}

/**
 * Kimaki ↔ MiMoCode adapter bridge
 *
 * Translates Kimaki's Discord-centric concepts into MiMoCode's
 * project/session/message/agent model. This adapter does NOT
 * reimplement Kimaki — it calls Kimaki's HTTP API (Hrana) and
 * maps the responses.
 *
 * Concept mapping:
 *   Kimaki channel  → MiMoCode project
 *   Kimaki thread   → MiMoCode session
 *   Kimaki message  → MiMoCode message
 *   Kimaki agent    → MiMoCode agent
 */

import type {
  KimakiChannel,
  KimakiThread,
  KimakiMessage,
  KimakiAgent,
  KimakiChannelMapping,
  KimakiThreadMapping,
  KimakiAgentMapping,
  KimakiIngressInput,
  KimakiFileAttachment,
  KimakiQueuedMessage,
  KimakiRepliedMessageContext,
  KimakiThreadRunState,
} from "./types"
import type { KimakiConfig } from "./config"
import { startKimaki, stopKimaki, getKimakiProcessState } from "./process"

// ── Adapter state ──────────────────────────────────────────────

interface AdapterState {
  channels: Map<string, KimakiChannel>
  threads: Map<string, KimakiThread>
  agents: Map<string, KimakiAgent>
  threadRunStates: Map<string, KimakiThreadRunState>
  connected: boolean
}

let state: AdapterState = {
  channels: new Map(),
  threads: new Map(),
  agents: new Map(),
  threadRunStates: new Map(),
  connected: false,
}

// ── HTTP helpers ───────────────────────────────────────────────

async function kimakiFetch(
  config: KimakiConfig,
  path: string,
  options: RequestInit = {},
): Promise<any> {
  const url = `${config.connection.baseUrl}${path}`
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) ?? {}),
  }
  if (config.connection.token) {
    headers["Authorization"] = `Bearer ${config.connection.token}`
  }
  const res = await fetch(url, { ...options, headers })
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`Kimaki API ${res.status}: ${body}`)
  }
  return res.json()
}

// ── Health / connection ────────────────────────────────────────

export async function connectKimaki(config: KimakiConfig): Promise<boolean> {
  if (!config.enabled) return false

  // Try auto-start if configured and not already running
  if (config.autoStart?.enabled) {
    const started = await startKimaki(config)
    if (started) {
      state.connected = true
      return true
    }
  }

  // Try connecting to existing instance
  try {
    const res = await kimakiFetch(config, "/health")
    state.connected = res?.status === "ok"
    return state.connected
  } catch {
    state.connected = false
    return false
  }
}

export function isKimakiConnected(): boolean {
  return state.connected
}

// ── Channel mapping ────────────────────────────────────────────

export function mapChannel(
  kimakiChannelId: string,
  config: KimakiConfig,
): KimakiChannel | null {
  const mapping = config.channels.find((c) => c.kimakiChannelId === kimakiChannelId)
  if (!mapping) return null

  const channel: KimakiChannel = {
    channelId: kimakiChannelId,
    directory: mapping.directory,
    channelType: "text",
    verbosity: config.defaultVerbosity,
    mentionMode: config.defaultMentionMode,
    worktreesEnabled: config.useWorktrees,
  }

  state.channels.set(kimakiChannelId, channel)
  return channel
}

export function getChannel(kimakiChannelId: string): KimakiChannel | undefined {
  return state.channels.get(kimakiChannelId)
}

/**
 * Auto-discover a channel from kimaki's API if it's not in the local map.
 * Queries kimaki's project list to check if the channel exists, and if so,
 * creates a temporary mapping so subsequent sends don't need to re-query.
 */
export async function autoDiscoverChannel(
  kimakiChannelId: string,
  config: KimakiConfig,
): Promise<KimakiChannel | undefined> {
  // Already mapped?
  const existing = state.channels.get(kimakiChannelId)
  if (existing) return existing

  // Try to discover from kimaki's API
  if (!state.connected) return undefined

  try {
    // Query kimaki's project list — returns channel configurations
    const data = await kimakiFetch(config, "/v1/project/list")
    const projects = data?.projects ?? data ?? []

    // Check if the channel exists in kimaki's project list
    const found = Array.isArray(projects) && projects.some((p: any) =>
      p.channelId === kimakiChannelId || p.channel_id === kimakiChannelId,
    )

    if (found) {
      // Create the channel directly — don't require it in config.channels
      const channel: KimakiChannel = {
        channelId: kimakiChannelId,
        directory: process.cwd(),
        channelType: "text",
        verbosity: config.defaultVerbosity,
        mentionMode: config.defaultMentionMode,
        worktreesEnabled: config.useWorktrees,
      }
      state.channels.set(kimakiChannelId, channel)
      return channel
    }
  } catch {
    // API not available or channel not found — fall through
  }

  // Last resort: if kimaki is connected, allow the channel anyway
  // (kimaki will handle routing even if we don't have a local mapping)
  // SECURITY: Log a warning since this creates an unverified channel mapping.
  // An attacker could potentially craft channel IDs that bypass config validation.
  console.warn(`[kimaki] autoDiscoverChannel: creating unverified mapping for channel ${kimakiChannelId} (not in config.channels)`)
  const channel: KimakiChannel = {
    channelId: kimakiChannelId,
    directory: process.cwd(),
    channelType: "text",
    verbosity: config.defaultVerbosity,
    mentionMode: config.defaultMentionMode,
    worktreesEnabled: config.useWorktrees,
  }
  state.channels.set(kimakiChannelId, channel)
  return channel
}

export function listChannels(): KimakiChannel[] {
  return Array.from(state.channels.values())
}

// ── Thread / session mapping ───────────────────────────────────

export function mapThread(
  kimakiThreadId: string,
  kimakiChannelId: string,
  sessionId: string,
): KimakiThread {
  const thread: KimakiThread = {
    threadId: kimakiThreadId,
    sessionId,
    source: "kimaki",
    channelId: kimakiChannelId,
  }
  state.threads.set(kimakiThreadId, thread)
  return thread
}

export function getThread(kimakiThreadId: string): KimakiThread | undefined {
  return state.threads.get(kimakiThreadId)
}

export function getThreadsByChannel(kimakiChannelId: string): KimakiThread[] {
  return Array.from(state.threads.values()).filter(
    (t) => t.channelId === kimakiChannelId,
  )
}

// ── Agent mapping ──────────────────────────────────────────────

export function mapAgent(
  kimakiAgentName: string,
  mimocodeAgentName: string,
  role?: string,
): KimakiAgentMapping {
  const mapping: KimakiAgentMapping = {
    kimakiAgentName,
    mimocodeAgentName,
    role,
  }

  const agent: KimakiAgent = {
    name: kimakiAgentName,
  }
  state.agents.set(kimakiAgentName, agent)

  return mapping
}

export function resolveAgentMapping(
  kimakiAgentName: string,
  config: KimakiConfig,
): KimakiAgentMapping | null {
  return config.agents.find((a) => a.kimakiAgentName === kimakiAgentName) ?? null
}

export function getAgent(kimakiAgentName: string): KimakiAgent | undefined {
  return state.agents.get(kimakiAgentName)
}

export function listAgents(): KimakiAgent[] {
  return Array.from(state.agents.values())
}

// ── Message transformation ─────────────────────────────────────

/**
 * Convert a Kimaki ingress message to a MiMoCode-compatible prompt.
 * Strips Discord-specific formatting, resolves shell commands, and
 * maps agent/model preferences.
 */
export function adaptIngressToPrompt(
  input: KimakiIngressInput,
  config: KimakiConfig,
): {
  prompt: string
  agent?: string
  model?: string
  images?: KimakiFileAttachment[]
  isShellCommand: boolean
} {
  let prompt = input.prompt
  let isShellCommand = false

  // Shell command prefix routing
  if (prompt.startsWith(config.shellPrefix)) {
    prompt = prompt.slice(config.shellPrefix.length).trim()
    isShellCommand = true
  }

  // Queue suffix detection
  const queueMatch = prompt.match(/[\.\!\?]\s*queue$/i)
  if (queueMatch) {
    prompt = prompt.slice(0, queueMatch.index).trim()
  }

  // Resolve agent: prefer input > channel mapping > config default
  const agent = input.agent ?? resolveAgentForContext(input, config)

  return {
    prompt,
    agent,
    model: input.model,
    images: input.images,
    isShellCommand,
  }
}

function resolveAgentForContext(
  input: KimakiIngressInput,
  config: KimakiConfig,
): string | undefined {
  if (input.sourceThreadId) {
    const thread = state.threads.get(input.sourceThreadId)
    if (thread) {
      const channel = state.channels.get(thread.channelId)
      return channel?.agentName
    }
  }
  return config.agents[0]?.kimakiAgentName
}

/**
 * Convert a Kimaki message to a MiMoCode message structure.
 */
export function adaptMessageToMimocode(msg: KimakiMessage): {
  role: "user" | "assistant"
  content: string
  name?: string
  images?: KimakiFileAttachment[]
} {
  return {
    role: "user",
    content: msg.content,
    name: msg.authorUsername,
    images: msg.images,
  }
}

// ── Thread run state management ────────────────────────────────

export function getOrCreateRunState(
  threadId: string,
  sessionId: string,
  username: string,
  userId: string,
): KimakiThreadRunState {
  let runState = state.threadRunStates.get(threadId)
  if (!runState) {
    runState = {
      sessionId,
      sessionUsername: username,
      sessionUserId: userId,
      queueItems: [],
      sentPartIds: new Set(),
    }
    state.threadRunStates.set(threadId, runState)
  }
  return runState
}

export function dequeueMessage(threadId: string): KimakiQueuedMessage | undefined {
  const runState = state.threadRunStates.get(threadId)
  return runState?.queueItems.shift()
}

export function queueMessage(threadId: string, message: KimakiQueuedMessage): void {
  const runState = state.threadRunStates.get(threadId)
  if (runState) {
    runState.queueItems.push(message)
  }
}

// ── Event mapping ──────────────────────────────────────────────

const KIMAKI_TO_MIMOCODE_EVENTS: Record<string, string> = {
  "message_create": "chat.message",
  "message_update": "chat.message.update",
  "message_delete": "chat.message.delete",
  "thread_create": "session.create",
  "thread_update": "session.update",
  "thread_delete": "session.delete",
  "typing_start": "session.typing",
  "voice_state_update": "session.voice",
  "interaction_create": "tool.interaction",
}

export function mapKimakiEvent(kimakiEvent: string): string {
  return KIMAKI_TO_MIMOCODE_EVENTS[kimakiEvent] ?? `kimaki.${kimakiEvent}`
}

// ── Status reporting ───────────────────────────────────────────

export interface KimakiStatus {
  connected: boolean
  process: {
    running: boolean
    ready: boolean
    pid: number | null
    restartCount: number
    lastError: string | null
  }
  channels: Array<{
    channelId: string
    directory: string
    agentName?: string
    threadCount: number
  }>
  activeThreads: Array<{
    threadId: string
    sessionId: string
    channelId: string
    queueDepth: number
  }>
  agents: Array<{
    name: string
    assignedChannels: number
  }>
}

export function getStatus(): KimakiStatus {
  const processState = getKimakiProcessState()

  const channels = listChannels().map((ch) => ({
    channelId: ch.channelId,
    directory: ch.directory,
    agentName: ch.agentName,
    threadCount: getThreadsByChannel(ch.channelId).length,
  }))

  const threads = Array.from(state.threads.values())
  const activeThreads = threads.map((t) => {
    const runState = state.threadRunStates.get(t.threadId)
    return {
      threadId: t.threadId,
      sessionId: t.sessionId,
      channelId: t.channelId,
      queueDepth: runState?.queueItems.length ?? 0,
    }
  })

  const agents = listAgents().map((a) => ({
    name: a.name,
    assignedChannels: channels.filter((ch) => ch.agentName === a.name).length,
  }))

  return {
    connected: state.connected,
    process: processState,
    channels,
    activeThreads,
    agents,
  }
}

// ── Shutdown ─────────────────────────────────────────────────

export async function disconnectKimaki(): Promise<void> {
  await stopKimaki()
  state.connected = false
}

// ── Reset (for testing) ────────────────────────────────────────

export function resetAdapter(): void {
  state = {
    channels: new Map(),
    threads: new Map(),
    agents: new Map(),
    threadRunStates: new Map(),
    connected: false,
  }
}

/**
 * mimocode-powerpack — Server Plugin Entry
 *
 * A comprehensive plugin bundle for MiMoCode providing:
 * - Persistent memory (search/write, auto-capture, embeddings opt-in)
 * - Context analysis (context_breakdown tool)
 * - Agent behavior hooks (todo enforcer, comment checker, safety net)
 * - Notifications (native OS)
 * - 7 specialized subagents
 */

import type { Plugin } from "@mimo-ai/plugin"

// Tool imports
import { createContextAnalysisTool } from "./tools/context-analysis"
import { createMemorySearchTool } from "./tools/memory-search"
import { createMemoryWriteTool } from "./tools/memory-write"
import { createActorGuideTool } from "./tools/actor-guide"

// Memory imports
import { captureFromSession } from "./memory/hooks"

// Hook imports
import { createTodoEnforcerHook } from "./hooks/todo-enforcer"
import { createCommentCheckerHook } from "./hooks/comment-checker"
import { createNotifyHook } from "./hooks/notify"
import { createQualityGateHook } from "./hooks/quality-gate"
import { createToolDiscoveryHook } from "./hooks/tool-discovery"
import { createSafetyNetHook } from "./hooks/safety-net"


// === Powerpack Options ===

export interface PowerpackOptions {
  notify?: {
    enabled?: boolean
    quietHours?: { start: string; end: string }
  }
  todoEnforcer?: {
    enabled?: boolean
    maxFailures?: number
    cooldownMs?: number
  }
  commentChecker?: {
    enabled?: boolean
  }
  qualityGate?: {
    enabled?: boolean
  }
  safetyNet?: {
    enabled?: boolean
  }
  toolDiscovery?: { enabled?: boolean }
  memory?: {
    enabled?: boolean
    autoCapture?: boolean
    embeddings?: {
      enabled?: boolean
      model?: string
    }
  }
}

const PowerpackPlugin: Plugin = async (ctx, options) => {
  const config = {
    notify: { enabled: true, quietHours: { start: "22:00", end: "08:00" } },
    todoEnforcer: { enabled: false, maxFailures: 5, cooldownMs: 30000 },
    commentChecker: { enabled: true },
    qualityGate: { enabled: false },
    safetyNet: { enabled: true },
    toolDiscovery: { enabled: true },
    memory: { enabled: true, autoCapture: true, embeddings: { enabled: false, model: "onnx-community/granite-embedding-small-english-r2-ONNX" } },
    ...((options as { powerpack?: PowerpackOptions })?.powerpack ?? {}),
  }

  // Build tools map (only include enabled tools)
  const tools: Record<string, any> = {
    context_breakdown: createContextAnalysisTool(ctx),
  }
  // Actor guide: always enabled — helps agents format actor tool calls correctly
  tools.actor_guide = createActorGuideTool()
  if (config.memory.enabled) {
    tools.memory_search = createMemorySearchTool(ctx)
    tools.memory_write = createMemoryWriteTool(ctx)
  }

  // Cache hook instances at init (avoids re-creating on every message)
  const cachedCommentHook = config.commentChecker.enabled ? createCommentCheckerHook() : null
  const cachedTodoEnforcerHook = config.todoEnforcer.enabled ? createTodoEnforcerHook(config.todoEnforcer as { enabled: boolean; maxFailures: number; cooldownMs: number }) : null
  const cachedQualityGateHook = config.qualityGate.enabled ? createQualityGateHook() : null
  const cachedToolDiscoveryHook = config.toolDiscovery.enabled ? createToolDiscoveryHook() : null
  const cachedSafetyNetHook = config.safetyNet.enabled ? createSafetyNetHook() : null
  const cachedNotifyHook = config.notify.enabled ? createNotifyHook(config.notify as { enabled: boolean; quietHours?: { start: string; end: string } }) : null

  // Build hooks object
  const hooks: Record<string, any> = {}

  // Tool discovery: registered but a no-op on MiMoCode v0.1.7+ (message-format mismatch)
  if (config.toolDiscovery.enabled) {
    hooks["experimental.chat.messages.transform"] = async (input: any, output: any) => {
      try {
        if (cachedToolDiscoveryHook) await cachedToolDiscoveryHook(input, output)
      } catch (err) {
        // A throw here fails the whole LLM step in MiMoCode's run loop
        // (no timeout, no catch around the transform hook). Never escape.
        console.error("[powerpack] transform hook failed:", err instanceof Error ? err.message : err)
      }
    }
  }

  // Tool lifecycle: comment checker
  if (config.commentChecker.enabled) {
    hooks["tool.execute.after"] = async (input: any, output: any) => {
      try {
        if (cachedCommentHook && (input.tool === "edit" || input.tool === "write")) {
          await cachedCommentHook(input, output)
        }
      } catch (err) {
        console.error("[powerpack] tool.execute.after hook failed:", err instanceof Error ? err.message : err)
      }
    }
  }

  // Safety net for bash
  if (config.safetyNet.enabled) {
    hooks["tool.execute.before"] = async (input: any, output: any) => {
      try {
        if (cachedSafetyNetHook && input.tool === "bash") {
          await cachedSafetyNetHook(input, output)
        }
      } catch (err) {
        console.error("[powerpack] tool.execute.before hook failed:", err instanceof Error ? err.message : err)
      }
    }
  }

  // Session-lifecycle features. NOTE: "session.idle" is an EVENT
  // (EventSessionIdle) in MiMo-Code v0.1.7+ — hooks["session.idle"] never
  // fires. Event consumers (todo enforcer, notify) go through hooks.event;
  // lifecycle work (quality gate, memory auto-capture) goes through session.post
  // which fires when the run loop finishes with trajectory + outcome.

  // Todo enforcer: idle detection + continuation (session.idle event)
  // Quality gate: run validation checks when a session completes
  // Memory auto-capture: extract memories from completed sessions
  const needsEventHook = config.notify.enabled || config.todoEnforcer.enabled
  const needsSessionPost = config.qualityGate.enabled || (config.memory.enabled && config.memory.autoCapture)

  if (needsEventHook) {
    hooks.event = async (input: any) => {
      try {
        const event = input?.event ?? input
        const eventType = event?.type ?? event?.payload?.type ?? ""
        if (eventType === "session.idle" && cachedTodoEnforcerHook) {
          const sessionID = event?.properties?.sessionID ?? event?.payload?.properties?.sessionID ?? event?.sessionID ?? ""
          await cachedTodoEnforcerHook({ ...event, type: "session.idle", sessionID })
        }
        if (cachedNotifyHook) await cachedNotifyHook(event)
      } catch (err) {
        console.error("[powerpack] event hook failed:", err instanceof Error ? err.message : err)
      }
    }
  }

  if (needsSessionPost) {
    hooks["session.post"] = async (input: any) => {
      try {
        const sessionID = input?.sessionID ?? ""
        const projectPath = await resolveSessionDirectory(ctx, sessionID)

        // Quality gate: run validation checks against the session's project
        if (config.qualityGate.enabled && cachedQualityGateHook) {
          try {
            const gateOutput: any = { messages: [] }
            await cachedQualityGateHook({ directory: projectPath, sessionID }, gateOutput)
            const injected = gateOutput.messages?.[0]
            if (injected) {
              const text = injected.parts?.[0]?.text ?? injected.content ?? ""
              if (text) console.warn(`[powerpack] ${text}`)
            }
          } catch (err) {
            console.error("[powerpack] Quality gate failed:", err instanceof Error ? err.message : err)
          }
        }

        // Memory auto-capture from the session trajectory
        if (config.memory.enabled && config.memory.autoCapture) {
          try {
            const sessionId = sessionID || "unknown"
            const messages = (input?.trajectory ?? []).map((m: any) => ({
              role: m?.role ?? "unknown",
              content: trajectoryText(m),
            }))
            if (messages.length > 0) {
              const { getMemoryStore } = await import("./memory/store")
              const { getMemoryDbPath } = await import("./memory/types")
              const store = getMemoryStore(getMemoryDbPath(projectPath))
              captureFromSession(store, projectPath, sessionId, messages)
            }

            // Embeddings: initialize and backfill unembedded memories.
            // NEVER await init/backfill inside the hook — it runs at the end of
            // every turn, and initEmbeddings downloads the ONNX model from
            // HuggingFace. On restricted/slow networks that hangs the whole
            // session forever. Embeddings are opt-in
            // (config.memory.embeddings.enabled) and initialized fire-and-forget.
            if (config.memory.embeddings?.enabled) {
              const model = config.memory.embeddings.model || "onnx-community/granite-embedding-small-english-r2-ONNX"
              const { getMemoryStore } = await import("./memory/store")
              const { getMemoryDbPath } = await import("./memory/types")
              const embedStore = getMemoryStore(getMemoryDbPath(projectPath))
              import("./memory/embeddings")
                .then(({ initEmbeddings }) => initEmbeddings(model))
                .then((ready) => {
                  if (!ready) return
                  return import("./memory/search").then(({ backfillEmbeddings }) =>
                    backfillEmbeddings(embedStore, projectPath, model),
                  )
                })
                .catch(() => {
                  // Embeddings are optional — never let init failures surface
                })
            }
          } catch (err) {
            // Best-effort: don't break session lifecycle flow
            console.error("[powerpack] Memory auto-capture failed:", err instanceof Error ? err.message : err)
          }
        }
      } catch (err) {
        console.error("[powerpack] session.post hook failed:", err instanceof Error ? err.message : err)
      }
    }
  }

  return {
    tool: tools,
    ...hooks,
  }
}

/**
 * Resolve the project directory for a session via the SDK client.
 * Falls back to process.cwd() when the client is unavailable.
 */
async function resolveSessionDirectory(ctx: any, sessionID: string): Promise<string> {
  if (!sessionID) return process.cwd()
  try {
    const res = await ctx?.client?.session?.get?.({ path: { id: sessionID } })
    if (res?.data?.directory) return res.data.directory
  } catch {
    // fall through to cwd
  }
  return process.cwd()
}

/**
 * Extract plain text from a session.post trajectory message
 * (TrajectoryMessage: { role, parts: TrajectoryPart[] }).
 */
function trajectoryText(m: any): string {
  if (typeof m?.content === "string") return m.content
  if (Array.isArray(m?.parts)) {
    return m.parts
      .filter((p: any) => p && typeof p === "object" && p.type === "text" && typeof p.text === "string")
      .map((p: any) => p.text)
      .join("\n")
  }
  return ""
}

export default {
  id: "mimocode-powerpack",
  server: PowerpackPlugin,
}

/**
 * mimocode-powerpack — Server Plugin Entry
 *
 * A comprehensive plugin bundle for MiMoCode providing:
 * - Context management (analysis, dedup, error pruning)
 * - Agent behavior hooks (intent gate, todo enforcer, comment checker, rules injection, model fallback)
 * - Tools (loop-until-done)
 * - Notifications (native OS)
 * - Quota tracking (22+ providers + MiMo)
 * - 8 generic subagents
 */

import type { Plugin } from "@mimo-ai/plugin"

// Tool imports
import { createContextAnalysisTool } from "./tools/context-analysis"
import { createRalphLoopTool } from "./tools/ralph-loop"
import { createSkillsInstallTool } from "./tools/skills-install"
import { createSkillsSyncTool } from "./tools/skills-sync"
import { createMemorySearchTool } from "./tools/memory-search"
import { createMemoryWriteTool } from "./tools/memory-write"
import { createReviewStartTool } from "./tools/review-start"
import { createReviewAnnotateTool } from "./tools/review-annotate"
import { createReviewApproveTool } from "./tools/review-approve"
import { createTeamSendTool } from "./tools/team-send"
import { createTeamReceiveTool } from "./tools/team-receive"
import { createTeamStatusTool } from "./tools/team-status"
import { createActorGuideTool } from "./tools/actor-guide"

// Memory imports
import { captureFromSession } from "./memory/hooks"

// Hook imports
import { createDedupPruneHook } from "./hooks/dedup-prune"
import { createErrorPruneHook } from "./hooks/error-prune"
import { createTransformPipelineHook, type TransformPipelineConfig, DEFAULT_TRANSFORM_CONFIG } from "./hooks/transform-pipeline"
import { createIntentGateHook } from "./hooks/intent-gate"
import { createTodoEnforcerHook } from "./hooks/todo-enforcer"
import { createCommentCheckerHook } from "./hooks/comment-checker"
import { createRulesInjectorHook } from "./hooks/rules-injector"
import { createModelFallbackHook } from "./hooks/model-fallback"
import { createNotifyHook } from "./hooks/notify"
import { createQualityGateHook } from "./hooks/quality-gate"
import { createToolDiscoveryHook } from "./hooks/tool-discovery"
import { createSafetyNetHook } from "./hooks/safety-net"


import { QuotaService } from "./quota/quota-service"
import { tool } from "@mimo-ai/plugin"

// Kimaki imports
import { createKimakiStatusTool } from "./tools/kimaki-status"
import { createKimakiSendTool } from "./tools/kimaki-send"
import { resolveKimakiConfig, type KimakiConfig } from "./kimaki/config"
import { connectKimaki, disconnectKimaki, mapChannel, mapAgent, isKimakiConnected } from "./kimaki/adapter"

// === Powerpack Options ===

export interface PowerpackOptions {
  notify?: {
    enabled?: boolean
    quietHours?: { start: string; end: string }
  }
  quota?: {
    providers?: string[]
  }
  todoEnforcer?: {
    enabled?: boolean
    maxFailures?: number
    cooldownMs?: number
  }
  commentChecker?: {
    enabled?: boolean
  }
  rulesInjector?: {
    enabled?: boolean
  }
  modelFallback?: {
    enabled?: boolean
  }
  dedupPrune?: {
    enabled?: boolean
  }
  errorPrune?: {
    enabled?: boolean
    turnsBeforePrune?: number
  }
  intentGate?: {
    enabled?: boolean
  }
  qualityGate?: {
    enabled?: boolean
  }
  safetyNet?: {
    enabled?: boolean
  }
  toolDiscovery?: { enabled?: boolean }
  loopUntilDone?: {
    enabled?: boolean
  }
  skills?: {
    enabled?: boolean
    installDir?: string
  }
  memory?: {
    enabled?: boolean
    autoCapture?: boolean
    embeddings?: {
      enabled?: boolean
      model?: string
    }
  }
  transform?: Partial<TransformPipelineConfig>
  team?: {
    enabled?: boolean
    baseDir?: string
    maxMessageSizeBytes?: number
  }
  review?: {
    enabled?: boolean
    port?: number
  }
  kimaki?: {
    enabled?: boolean
    connection?: { baseUrl?: string }
    autoStart?: { enabled?: boolean; lockPort?: string }
    channels?: Array<{ kimakiChannelId: string; mimocodeProjectId: string; directory: string }>
    agents?: Array<{ kimakiAgentName: string; mimocodeAgentName: string; role?: string }>
    defaultVerbosity?: string
    defaultMentionMode?: boolean
    useWorktrees?: boolean
    permissionTimeoutMs?: number
    shellPrefix?: string
  }
}

const PowerpackPlugin: Plugin = async (ctx, options) => {
  const config = {
    notify: { enabled: true, quietHours: { start: "22:00", end: "08:00" } },
    quota: { providers: ["mimo", "copilot", "openai"] },
    todoEnforcer: { enabled: true, maxFailures: 5, cooldownMs: 30000 },
    commentChecker: { enabled: true },
    rulesInjector: { enabled: true },
    modelFallback: { enabled: true },
    dedupPrune: { enabled: true },
    errorPrune: { enabled: true, turnsBeforePrune: 4 },
    intentGate: { enabled: true },
    qualityGate: { enabled: false },
    safetyNet: { enabled: true },
    toolDiscovery: { enabled: true },

    loopUntilDone: { enabled: true },
    skills: { enabled: true, installDir: ".mimocode/skills" },
    memory: { enabled: true, autoCapture: true, embeddings: { enabled: true, model: "onnx-community/granite-embedding-small-english-r2-ONNX" } },
    transform: { ...DEFAULT_TRANSFORM_CONFIG } as TransformPipelineConfig,
    team: { enabled: false, baseDir: ".powerpack/team", maxMessageSizeBytes: 32 * 1024 },
    review: { enabled: false, port: 5174 },
    kimaki: {
      enabled: false,
      connection: { baseUrl: "http://127.0.0.1:31099" },
      autoStart: { enabled: true, lockPort: "31099" },
      channels: [] as Array<{ kimakiChannelId: string; mimocodeProjectId: string; directory: string }>,
      agents: [] as Array<{ kimakiAgentName: string; mimocodeAgentName: string; role?: string }>,
      defaultVerbosity: "text_and_essential_tools" as const,
      defaultMentionMode: false,
      useWorktrees: false,
      permissionTimeoutMs: 600_000,
      shellPrefix: "!",
    },
    ...((options as { powerpack?: PowerpackOptions })?.powerpack ?? {}),
  }

  // Build tools map (only include enabled tools)
  const quotaService = new QuotaService()
  const tools: Record<string, any> = {
    context_breakdown: createContextAnalysisTool(ctx),
    quota_status: tool({
      description: "Check quota/usage status for configured providers. Shows remaining quota, reset times, and usage percentages.",
      args: {
        provider: tool.schema.string().optional().describe("Specific provider to check (e.g. 'mimo', 'copilot'). If omitted, checks all configured providers."),
      },
      async execute(args) {
        const providers = args.provider ? [args.provider] : (config.quota.providers ?? ["mimo", "copilot", "openai"])
        const status = await quotaService.getAllQuotas(providers)
        if (!status || !status.providers || status.providers.length === 0) {
          return "No quota data available. Providers may not be configured or reachable."
        }
        const lines = ["## Quota Status\n"]
        for (const q of status.providers) {
          const pct = q.percentRemaining !== undefined ? `${q.percentRemaining.toFixed(1)}%` : "N/A"
          const reset = q.resetAt ? `resets ${new Date(q.resetAt * 1000).toLocaleString()}` : ""
          const err = q.error ? ` (error: ${q.error})` : ""
          lines.push(`**${q.name}**: ${pct} remaining ${reset}${err}`)
        }
        return lines.join("\n")
      },
    }),
  }
  if (config.loopUntilDone.enabled) {
    tools.ralph_loop = createRalphLoopTool(ctx)
  }
  if (config.skills.enabled) {
    tools.skills_install = createSkillsInstallTool()
    tools.skills_sync = createSkillsSyncTool()
  }
  // Actor guide: always enabled — helps agents format actor tool calls correctly
  tools.actor_guide = createActorGuideTool()
  if (config.memory.enabled) {
    tools.memory_search = createMemorySearchTool(ctx)
    tools.memory_write = createMemoryWriteTool(ctx)
  }
  if (config.review.enabled) {
    tools.review_start = createReviewStartTool(ctx)
    tools.review_annotate = createReviewAnnotateTool(ctx)
    tools.review_approve = createReviewApproveTool(ctx)
  }
  if (config.team.enabled) {
    const teamSendTool = createTeamSendTool({
      enabled: true,
      baseDir: config.team.baseDir!,
      maxMessageSizeBytes: config.team.maxMessageSizeBytes,
    })
    const teamReceiveTool = createTeamReceiveTool({
      enabled: true,
      baseDir: config.team.baseDir!,
    })
    const teamStatusTool = createTeamStatusTool({
      enabled: true,
      baseDir: config.team.baseDir!,
    })
    if (teamSendTool) tools.team_send = teamSendTool
    if (teamReceiveTool) tools.team_receive = teamReceiveTool
    if (teamStatusTool) tools.team_status = teamStatusTool
  }

  // Kimaki Discord integration
  if (config.kimaki.enabled) {
    const kimakiCfg = resolveKimakiConfig(config.kimaki as Partial<KimakiConfig>)
    const kimakiStatusTool = createKimakiStatusTool({ enabled: true, config: kimakiCfg })
    const kimakiSendTool = createKimakiSendTool({ enabled: true, config: kimakiCfg })
    if (kimakiStatusTool) tools.kimaki_status = kimakiStatusTool
    if (kimakiSendTool) tools.kimaki_send = kimakiSendTool

    // Connect to Kimaki (auto-starts if configured) and seed channel/agent mappings
    connectKimaki(kimakiCfg).then((connected) => {
      if (connected) {
        for (const ch of kimakiCfg.channels) {
          mapChannel(ch.kimakiChannelId, kimakiCfg)
        }
        for (const ag of kimakiCfg.agents) {
          mapAgent(ag.kimakiAgentName, ag.mimocodeAgentName, ag.role)
        }
      }
    }).catch((err) => console.warn("[kimaki] Connection failed:", err instanceof Error ? err.message : err))

    // Graceful shutdown: stop auto-started Kimaki process on exit
    if (kimakiCfg.autoStart?.enabled) {
      const shutdown = async () => {
        await disconnectKimaki()
      }
      process.on("exit", () => { shutdown() })
      process.on("SIGINT", async () => { await shutdown(); process.exit(0) })
      process.on("SIGTERM", async () => { await shutdown(); process.exit(0) })
    }
  }

  // Cache hook instances at init (avoids re-creating on every message)
  const cachedDedupHook = config.dedupPrune.enabled ? createDedupPruneHook() : null
  const cachedErrorHook = config.errorPrune.enabled ? createErrorPruneHook(config.errorPrune.turnsBeforePrune) : null
  const cachedTransformHook = config.transform.enabled ? createTransformPipelineHook('', config.transform as TransformPipelineConfig) : null
  const cachedIntentHook = config.intentGate.enabled ? createIntentGateHook() : null
  const cachedCommentHook = config.commentChecker.enabled ? createCommentCheckerHook() : null
  const cachedRulesHook = config.rulesInjector.enabled ? createRulesInjectorHook(ctx) : null
  const cachedModelFallbackHook = config.modelFallback.enabled ? createModelFallbackHook() : null
  const cachedTodoEnforcerHook = config.todoEnforcer.enabled ? createTodoEnforcerHook(config.todoEnforcer as { enabled: boolean; maxFailures: number; cooldownMs: number }) : null
  const cachedQualityGateHook = config.qualityGate.enabled ? createQualityGateHook() : null
  const cachedToolDiscoveryHook = config.toolDiscovery.enabled ? createToolDiscoveryHook() : null
  const cachedSafetyNetHook = config.safetyNet.enabled ? createSafetyNetHook() : null
  const cachedNotifyHook = config.notify.enabled ? createNotifyHook(config.notify as { enabled: boolean; quietHours?: { start: string; end: string } }) : null

  // Build hooks object
  const hooks: Record<string, any> = {}

  // Context management: deduplicate repeated tool calls + transform pipeline
  if (config.dedupPrune.enabled || config.errorPrune.enabled || config.transform.enabled) {
    hooks["experimental.chat.messages.transform"] = async (input: any, output: any) => {
      if (cachedToolDiscoveryHook) await cachedToolDiscoveryHook(input, output)
      if (cachedDedupHook) await cachedDedupHook(input, output)
      if (cachedErrorHook) await cachedErrorHook(input, output)
      if (cachedTransformHook) await cachedTransformHook(input, output)
    }
  }

  // Intent gate: keyword-based routing
  if (config.intentGate.enabled) {
    hooks["chat.message"] = async (input: any, output: any) => {
      if (cachedIntentHook) await cachedIntentHook(input, output)
    }
  }

  // Tool lifecycle: comment checker + skill usage tracking
  hooks["tool.execute.after"] = async (input: any, output: any) => {
    if (cachedCommentHook && (input.tool === "edit" || input.tool === "write")) {
      await cachedCommentHook(input, output)
    }
    // Skill usage tracking
    if (config.skills.enabled && input.tool === "skill") {
      try {
        const { trackSkillLoad } = await import("./skills/usage-tracker")
        const projectPath = input?.directory ?? process.cwd()
        const skillName = input?.args?.name
        if (typeof skillName === "string") {
          trackSkillLoad(projectPath, skillName)
        }
      } catch (err) {
        // Best-effort: don't break skill loading
        console.debug("[powerpack] Skill tracking failed:", err instanceof Error ? err.message : err)
      }
    }
  }

  // Rules injection: proximity-aware rule discovery + safety net for bash
  if (config.rulesInjector.enabled || config.safetyNet.enabled) {
    hooks["tool.execute.before"] = async (input: any, output: any) => {
      if (cachedRulesHook && (input.tool === "edit" || input.tool === "write")) {
        await cachedRulesHook(input, output)
      }
      if (cachedSafetyNetHook && input.tool === "bash") {
        await cachedSafetyNetHook(input, output)
      }
    }
  }

  // Model fallback: reactive error-driven switching
  if (config.modelFallback.enabled) {
    if (cachedModelFallbackHook) hooks["session.error"] = cachedModelFallbackHook
  }

  // Todo enforcer: idle detection + continuation
  if (config.todoEnforcer.enabled) {
    if (cachedTodoEnforcerHook) hooks["session.idle"] = cachedTodoEnforcerHook
  }

  // Quality gate: run validation checks before idle (independent of memory)
  if (config.qualityGate.enabled) {
    const existingIdle = hooks["session.idle"]
    hooks["session.idle"] = async (input: any, output: any) => {
      if (existingIdle) await existingIdle(input, output)
      if (cachedQualityGateHook) await cachedQualityGateHook(input, output)
    }
  }

  // Memory auto-capture: extract memories from completed sessions
  if (config.memory.enabled && config.memory.autoCapture) {
    const existingIdle = hooks["session.idle"]
    hooks["session.idle"] = async (input: any, output: any) => {
      // Chain existing hooks (todo enforcer, quality gate)
      if (existingIdle) await existingIdle(input, output)
      // Auto-capture memories from session
      try {
        const projectPath = input?.directory ?? process.cwd()
        const sessionId = input?.sessionID ?? "unknown"
        const messages = input?.messages ?? []
        if (messages.length > 0) {
          const { getMemoryStore } = await import("./memory/store")
          const { getMemoryDbPath } = await import("./memory/types")
          const store = getMemoryStore(getMemoryDbPath(projectPath))
          captureFromSession(store, projectPath, sessionId, messages)
        }

        // Embeddings: initialize and backfill unembedded memories
        if (config.memory.embeddings?.enabled) {
          const { initEmbeddings } = await import("./memory/embeddings")
          const { backfillEmbeddings } = await import("./memory/search")
          const { getMemoryStore } = await import("./memory/store")
          const { getMemoryDbPath } = await import("./memory/types")
          const store = getMemoryStore(getMemoryDbPath(projectPath))
          const model = config.memory.embeddings.model || "onnx-community/granite-embedding-small-english-r2-ONNX"
          const ready = await initEmbeddings(model)
          if (ready) {
            await backfillEmbeddings(store, projectPath, model)
          }
        }
      } catch (err) {
        // Best-effort: don't break session idle flow
        console.debug("[powerpack] Memory auto-capture failed:", err instanceof Error ? err.message : err)
      }
    }
  }

  // Notifications: OS-level alerts
  if (config.notify.enabled) {
    hooks.event = async (event: any) => {
      if (cachedNotifyHook) await cachedNotifyHook(event)
    }
  }

  return {
    tool: tools,
    ...hooks,
  }
}

export default {
  id: "mimocode-powerpack",
  server: PowerpackPlugin,
}

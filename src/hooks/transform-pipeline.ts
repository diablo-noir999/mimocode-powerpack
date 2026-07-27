/**
 * Transform Pipeline Hook
 *
 * Hooks into 'experimental.chat.messages.transform' to run the full
 * transform pipeline: cache layout classification + smart drops +
 * session facts extraction.
 *
 * Orchestrates:
 * 1. Smart drops — identify and remove low-value messages
 * 2. Session facts — extract structured facts from the conversation
 * 3. Cache layout — classify messages into cache zones (m[0]/m[1]/m[2])
 *
 * Adapted from dev/opencode-magic-context transform pipeline.
 * Scoped: no historian, no dreamer, no physical m[0]/m[1] splitting.
 */

import {
  classifyCacheZone,
  computeCacheStabilityScore,
  findCacheBoundary,
  type CacheZone,
} from "../memory/cache-layout"
import {
  findDropCandidates,
  applyDrops,
  type DropStrategyConfig,
  DEFAULT_DROP_CONFIG,
} from "../memory/smart-drops"
import {
  extractAndStoreFacts,
  getSessionFactsStore,
} from "../memory/session-facts"
import { getMemoryDbPath } from "../memory/types"
import { MIN_TOOL_OUTPUT_AGE } from "../constants"
import { readBrainContext } from "../memory/brain-loader"

// === Config ===

export interface TransformPipelineConfig {
  /** Enable the transform pipeline */
  enabled: boolean
  /** Enable smart drops */
  smartDrops: boolean
  /** Enable cache layout classification */
  cacheLayout: boolean
  /** Enable session facts extraction */
  sessionFacts: boolean
  /** Maximum drop age as percentage of context window (0-100) */
  maxDropAge: number
  /** Custom drop strategy config overrides */
  dropConfig?: Partial<DropStrategyConfig>
  /** Enable brain context loader — injects wiki/index.md on first message */
  brainLoader?: boolean
  /** Max tokens for injected brain context (default: 8000) */
  brainLoaderMaxTokens?: number
}

export const DEFAULT_TRANSFORM_CONFIG: TransformPipelineConfig = {
  enabled: true,
  smartDrops: true,
  cacheLayout: true,
  sessionFacts: true,
  maxDropAge: 50,
  brainLoader: true,
  brainLoaderMaxTokens: 8000,
}

// === Pipeline Stages ===

interface PipelineContext {
  messages: any[]
  sessionId: string
  projectPath: string
  config: TransformPipelineConfig
  stats: {
    dropsApplied: number
    factsExtracted: number
    cacheZones: Record<CacheZone, number>
    cacheStabilityScore: number
    cacheBoundary: number
    originalCount: number
    finalCount: number
    brainInjected: boolean
    brainTokenEstimate: number
  }
}

/**
 * Stage 1: Smart Drops — identify and remove low-value messages.
 */
function runSmartDrops(ctx: PipelineContext): void {
  if (!ctx.config.smartDrops) return

  const dropConfig: DropStrategyConfig = {
    ...DEFAULT_DROP_CONFIG,
    ...ctx.config.dropConfig,
    maxToolOutputAge: Math.max(
      MIN_TOOL_OUTPUT_AGE,
      Math.floor((ctx.config.maxDropAge / 100) * ctx.messages.length),
    ),
  }

  const result = findDropCandidates(ctx.messages, dropConfig)
  if (result.candidates.length > 0) {
    ctx.stats.dropsApplied = applyDrops(ctx.messages, result.candidates)
  }
}

/**
 * Stage 2: Session Facts — extract structured facts from the conversation.
 */
function runSessionFactsExtraction(ctx: PipelineContext): void {
  if (!ctx.config.sessionFacts) return
  if (!ctx.projectPath || !ctx.sessionId) return

  try {
    const dbPath = getMemoryDbPath(ctx.projectPath)
    const store = getSessionFactsStore(dbPath)
    ctx.stats.factsExtracted = extractAndStoreFacts(
      store,
      ctx.messages,
      ctx.sessionId,
      ctx.projectPath,
    )
  } catch {
    // Best-effort: facts extraction shouldn't break the pipeline
  }
}

/**
 * Stage 3: Cache Layout — classify messages into cache zones.
 */
function runCacheLayout(ctx: PipelineContext): void {
  if (!ctx.config.cacheLayout) return

  const zoneCounts: Record<CacheZone, number> = { m0: 0, m1: 0, m2: 0 }

  for (let i = 0; i < ctx.messages.length; i++) {
    const zone = classifyCacheZone(ctx.messages[i], i, ctx.messages.length)
    zoneCounts[zone.zone]++
  }

  ctx.stats.cacheZones = zoneCounts
  ctx.stats.cacheStabilityScore = computeCacheStabilityScore(ctx.messages)
  ctx.stats.cacheBoundary = findCacheBoundary(ctx.messages)
}

/**
 * Stage 4: Brain Context Loader — inject wiki/index.md context on first message.
 * DISABLED in v0.1.7+: Flat { role, content } messages crash MiMoCode's runtime
 * which expects { info: Message; parts: Part[] } format.
 */
function runBrainLoader(ctx: PipelineContext): void {
  // DISABLED: Flat message injection is incompatible with MiMo-Code v0.1.7+.
  // Brain context should be delivered via the native memory system instead.
  void ctx
}

// === Main Pipeline ===

/**
 * Run the full transform pipeline on a message array.
 * Returns stats about what was done.
 */
export function runTransformPipeline(
  messages: any[],
  sessionId: string,
  projectPath: string,
  config: TransformPipelineConfig = DEFAULT_TRANSFORM_CONFIG,
): PipelineContext["stats"] {
  if (!config.enabled || messages.length === 0) {
    return {
      dropsApplied: 0,
      factsExtracted: 0,
      cacheZones: { m0: 0, m1: 0, m2: 0 },
      cacheStabilityScore: 1,
      cacheBoundary: 0,
      originalCount: messages.length,
      finalCount: messages.length,
      brainInjected: false,
      brainTokenEstimate: 0,
    }
  }

  const ctx: PipelineContext = {
    messages,
    sessionId,
    projectPath,
    config,
    stats: {
      dropsApplied: 0,
      factsExtracted: 0,
      cacheZones: { m0: 0, m1: 0, m2: 0 },
      cacheStabilityScore: 1,
      cacheBoundary: 0,
      originalCount: messages.length,
      finalCount: messages.length,
      brainInjected: false,
      brainTokenEstimate: 0,
    },
  }

  // Run stages in order: facts first (on original messages), then drops,
  // then cache layout (classification only), then brain loader (first message only).
  runSessionFactsExtraction(ctx)
  runSmartDrops(ctx)
  runCacheLayout(ctx)
  runBrainLoader(ctx)

  ctx.stats.finalCount = messages.length
  return ctx.stats
}

/**
 * Create a transform pipeline hook for MiMoCode's plugin system.
 * Returns an async function matching the 'experimental.chat.messages.transform' signature.
 */
export function createTransformPipelineHook(
  projectPath: string,
  config: TransformPipelineConfig = DEFAULT_TRANSFORM_CONFIG,
) {
  return async (input: any, output: any): Promise<void> => {
    if (!output?.messages || !Array.isArray(output.messages)) return
    if (!config.enabled) return

    const messages = output.messages
    const sessionId = extractSessionId(messages)

    const effectiveProjectPath = input?.directory ?? input?.worktree ?? (projectPath || process.cwd())
    runTransformPipeline(messages, sessionId, effectiveProjectPath, config)
  }
}

// === Utilities ===

/**
 * Extract session ID from messages. Looks for it in message metadata.
 */
function extractSessionId(messages: any[]): string {
  for (const msg of messages) {
    if (msg.sessionID) return msg.sessionID
    if (msg.sessionId) return msg.sessionId
    if (msg.info?.sessionID) return msg.info.sessionID
    if (msg.info?.sessionId) return msg.info.sessionId
  }
  return "unknown"
}

/**
 * Create a summary of pipeline stats for logging.
 */
export function summarizePipelineStats(stats: PipelineContext["stats"]): string {
  const zones = stats.cacheZones
  return [
    `drops=${stats.dropsApplied}`,
    `facts=${stats.factsExtracted}`,
    `zones[m0=${zones.m0},m1=${zones.m1},m2=${zones.m2}]`,
    `stability=${(stats.cacheStabilityScore * 100).toFixed(0)}%`,
    `boundary=${stats.cacheBoundary}`,
    `messages=${stats.originalCount}→${stats.finalCount}`,
    stats.brainInjected ? `brain=${stats.brainTokenEstimate}tok` : null,
  ].filter(Boolean).join(" ")
}

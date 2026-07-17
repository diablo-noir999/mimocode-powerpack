/**
 * IntentGate — Keyword-Based Intent Routing
 *
 * Scans the first user message for keywords and injects mode-specific
 * system prompts. Supports ultrawork, search, analyze, hyperplan, and
 * hyperplan-ultrawork combo modes.
 *
 * Upgraded from oh-my-opencode keyword-detector patterns:
 * - Model-aware ultrawork routing (GPT/Gemini/planner-aware prompts)
 * - Code block stripping before keyword detection
 * - Planner agent filter (plan-mode agents don't get ultrawork)
 * - Configurable disabled_keywords and enabledExpansions
 * - Hyperplan + hyperplan-ultrawork combo detection
 */

// --- Code block stripping (from oh-my-opencode keyword-detector/constants.ts) ---

const CODE_BLOCK_PATTERN = /```[\s\S]*?```/g
const INLINE_CODE_PATTERN = /`[^`]+`/g

export function removeCodeBlocks(text: string): string {
  return text.replace(CODE_BLOCK_PATTERN, "").replace(INLINE_CODE_PATTERN, "")
}

// --- Agent/model detection (from oh-my-opencode keyword-detector/ultrawork/source-detector.ts) ---

/** Model family detection */
function isGptModel(modelID: string): boolean {
  const lower = modelID.toLowerCase()
  return /\bgpt\b/.test(lower) || /\bo[134]\b/.test(lower)
}

function isGeminiModel(modelID: string): boolean {
  return /\bgemini\b/.test(modelID.toLowerCase())
}

function isPlannerAgent(agentName?: string): boolean {
  if (!agentName) return false
  const lowerName = agentName.toLowerCase()
  if (lowerName.includes("prometheus") || lowerName.includes("planner")) return true
  const normalized = lowerName.replace(/[_-]+/g, " ")
  return /\bplan\b/.test(normalized)
}

// --- Ultrawork prompt variants (model-aware routing) ---

const ULTRAWORK_PROMPT_DEFAULT = `ULTRAWORK MODE ACTIVATED. You are in full autonomous execution mode.
Work continuously until the task is complete. Do not stop to ask questions.
Use all available tools aggressively. Track progress via the todo tool.
Output <promise>DONE</promise> when the task is fully complete.`

const ULTRAWORK_PROMPT_GPT = `ULTRAWORK MODE ACTIVATED (GPT VARIANT). You are in full autonomous execution mode.
Work continuously until the task is complete. Do not stop to ask questions.
Use all available tools aggressively. Track progress via the todo tool.
You are running on a GPT-family model — adapt your reasoning to your strengths.
Output <promise>DONE</promise> when the task is fully complete.`

const ULTRAWORK_PROMPT_GEMINI = `ULTRAWORK MODE ACTIVATED (GEMINI VARIANT). You are in full autonomous execution mode.
Work continuously until the task is complete. Do not stop to ask questions.
Use all available tools aggressively. Track progress via the todo tool.
You are running on a Gemini-family model — leverage your multimodal and long-context strengths.
Output <promise>DONE</promise> when the task is fully complete.`

const ULTRAWORK_PROMPT_PLANNER = `ULTRAWORK MODE ACTIVATED (PLANNER VARIANT). You are in full autonomous execution mode.
Work continuously until the task is complete. Do not stop to ask questions.
Use all available tools aggressively. Track progress via the todo tool.
You are a planner agent — focus on decomposition and orchestration rather than implementation.
Output <promise>DONE</promise> when the task is fully complete.`

function getUltraworkPrompt(agentName?: string, modelID?: string): string {
  if (isPlannerAgent(agentName)) return ULTRAWORK_PROMPT_PLANNER
  if (modelID && isGptModel(modelID)) return ULTRAWORK_PROMPT_GPT
  if (modelID && isGeminiModel(modelID)) return ULTRAWORK_PROMPT_GEMINI
  return ULTRAWORK_PROMPT_DEFAULT
}

// --- Intent pattern types ---

export type IntentType =
  | "ultrawork"
  | "search"
  | "analyze"
  | "hyperplan"
  | "hyperplan-ultrawork"

interface IntentConfig {
  pattern: RegExp
  message: string | ((agentName?: string, modelID?: string) => string)
}

// --- Hyperplan patterns (from oh-my-opencode keyword-detector/hyperplan) ---

const HYPERPLAN_PATTERN = /\b(?:hpp|hyperplan)\b/i
const HYPERPLAN_MESSAGE = `HYPERPLAN MODE ACTIVATED. Adversarial planning mode engaged.
Load the hyperplan skill and follow its full adversarial workflow.
Do not improvise — follow every round of cross-critique as specified.`

// Hyperplan-ultrawork combo: strict adjacency, both word orders
const HYPERPLAN_ULTRAWORK_PATTERN =
  /\b(?:hpp|hyperplan)\s+(?:ulw|ultrawork)\b|\b(?:ulw|ultrawork)\s+(?:hpp|hyperplan)\b/i

const HYPERPLAN_ULTRAWORK_BANNER = `<hyperplan-ultrawork-mode>
**MANDATORY**: Say "HYPERPLAN ULTRAWORK MODE ENABLED!" exactly once as your first response.
Do NOT say the standalone "ULTRAWORK MODE ENABLED!" or "HYPERPLAN MODE ENABLED!" banners.
Apply the ultrawork protocol as your execution framework. You MUST ALSO load the hyperplan
skill immediately and follow its full adversarial workflow.
</hyperplan-ultrawork-mode>`

function getHyperplanUltraworkMessage(agentName?: string, modelID?: string): string {
  return `${HYPERPLAN_ULTRAWORK_BANNER}\n\n${getUltraworkPrompt(agentName, modelID)}`
}

// --- Keyword detector registry ---

interface KeywordDetector {
  type: IntentType
  pattern: RegExp
  message: string | ((agentName?: string, modelID?: string) => string)
}

const KEYWORD_DETECTORS: KeywordDetector[] = [
  {
    type: "ultrawork",
    pattern: /\b(ultrawork|ulw)\b/i,
    message: getUltraworkPrompt,
  },
  {
    type: "search",
    pattern: /\bsearch\b.*\bmode\b/i,
    message: `SEARCH MODE ACTIVATED. You are in research-only mode.
Focus on finding information, reading files, and analyzing code.
Do not make any edits or run destructive commands.
Report findings comprehensively before suggesting next steps.`,
  },
  {
    type: "analyze",
    pattern: /\banalyze\b.*\bmode\b/i,
    message: `ANALYSIS MODE ACTIVATED. You are in deep analysis mode.
Focus on understanding the codebase, architecture, dependencies, and patterns.
Provide detailed analysis with file references and line numbers.
Do not make changes — only observe and report.`,
  },
  {
    type: "hyperplan",
    pattern: HYPERPLAN_PATTERN,
    message: HYPERPLAN_MESSAGE,
  },
  {
    type: "hyperplan-ultrawork",
    pattern: HYPERPLAN_ULTRAWORK_PATTERN,
    message: getHyperplanUltraworkMessage,
  },
]

// --- Configuration ---

export interface IntentGateConfig {
  /** Keywords to skip detection for entirely. */
  disabled_keywords?: IntentType[]
  /** If set, only these intent types are eligible for detection. */
  enabledExpansions?: IntentType[]
}

// --- Detection engine (from oh-my-opencode keyword-detector/detector.ts) ---

export interface DetectedIntent {
  type: IntentType
  message: string
}

export function detectIntents(
  text: string,
  agentName?: string,
  modelID?: string,
  disabledKeywords?: IntentType[],
  enabledExpansions?: IntentType[],
): DetectedIntent[] {
  const textWithoutCode = removeCodeBlocks(text)
  const disabled = new Set<IntentType>(disabledKeywords ?? [])

  // Intersection rule: combo requires BOTH base keywords enabled
  if (disabled.has("ultrawork") || disabled.has("hyperplan")) {
    disabled.add("hyperplan-ultrawork")
  }

  // Allowlist: if enabledExpansions is set, only those types fire
  const allowlist = enabledExpansions ? new Set<IntentType>(enabledExpansions) : null

  return KEYWORD_DETECTORS.map(({ type, pattern, message }) => ({
    matches: pattern.test(textWithoutCode),
    type,
    message: typeof message === "function" ? message(agentName, modelID) : message,
  }))
    .filter((result) => {
      if (!result.matches) return false
      if (allowlist && !allowlist.has(result.type)) return false
      if (disabled.has(result.type)) return false
      return true
    })
    .map(({ type, message }) => ({ type, message }))
}

/**
 * Suppress standalone ultrawork/hyperplan when combo is present.
 * (from oh-my-opencode keyword-detector/hook.ts suppressComboStandalones)
 */
function suppressComboStandalones(detected: DetectedIntent[]): DetectedIntent[] {
  const hasCombo = detected.some((k) => k.type === "hyperplan-ultrawork")
  if (!hasCombo) return detected
  return detected.filter((k) => k.type !== "ultrawork" && k.type !== "hyperplan")
}

/**
 * Filter out keywords whose messages are already present in the text.
 * (from oh-my-opencode keyword-detector/hook.ts filterAlreadyInjectedKeywords)
 */
function filterAlreadyInjected(detected: DetectedIntent[], text: string): DetectedIntent[] {
  return detected.filter((intent) => !text.includes(intent.message))
}

// --- Hook factory ---

export function createIntentGateHook(config?: IntentGateConfig) {
  const disabledKeywords = config?.disabled_keywords
  const enabledExpansions = config?.enabledExpansions

  return async (input: any, output: any) => {
    if (!input?.message) return

    const message = typeof input.message === "string"
      ? input.message
      : input.message?.content ?? ""

    if (!message) return

    // Extract agent/model context for model-aware routing
    const agentName: string | undefined = input.agent ?? input.agentName
    const modelID: string | undefined = input.model?.modelID ?? input.modelID

    // Planner agent filter: don't inject ultrawork into plan-mode agents
    if (isPlannerAgent(agentName)) {
      // Detect intents but strip ultrawork/hyperplan/hyperplan-ultrawork
      let detected = detectIntents(message, agentName, modelID, disabledKeywords, enabledExpansions)
      detected = detected.filter(
        (k) => k.type !== "ultrawork" && k.type !== "hyperplan" && k.type !== "hyperplan-ultrawork"
      )
      if (detected.length === 0) return
      if (output && typeof output === "object") {
        output.injectedPrompt = detected.map((d) => d.message).join("\n\n")
      }
      return
    }

    let detected = detectIntents(message, agentName, modelID, disabledKeywords, enabledExpansions)
    detected = suppressComboStandalones(detected)
    detected = filterAlreadyInjected(detected, message)

    if (detected.length === 0) return

    if (output && typeof output === "object") {
      output.injectedPrompt = detected.map((d) => d.message).join("\n\n")
    }
  }
}

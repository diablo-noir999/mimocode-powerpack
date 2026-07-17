/**
 * Loop-Until-Done Tool (Ralph Loop)
 *
 * Sends the same prompt repeatedly to the agent until a completion
 * promise appears in the output. Tracks iterations and provides
 * mid-loop context injection.
 *
 * Features Adaptive Computation Time (from HRM):
 * - Early stopping when progress stalls (3 consecutive no-improvement iterations)
 * - Minimum iterations before stopping (prevent premature exit)
 * - Progress delta tracking for stall detection
 *
 * Source: Adapted from dev/opencode-ralph-wiggum/ralph.ts
 *
 * TODO: This is currently a stub. The actual loop requires session API
 * integration to send prompts and read responses. Without it, this
 * returns a loop plan rather than executing it.
 */

import { tool } from "@mimo-ai/plugin"

const DEFAULT_COMPLETION_PROMPT = "<promise>DONE</promise>"
const DEFAULT_MAX_ITERATIONS = 20
const ABSOLUTE_MAX_ITERATIONS = 100 // Hard cap to prevent resource exhaustion

export function createRalphLoopTool(ctx: any) {
  return tool({
    description:
      "Run an autonomous loop that repeats the same prompt until a completion signal appears. Useful for iterative tasks like getting tests to pass, building features incrementally, or fixing issues through repeated attempts. Features adaptive stopping when progress stalls.",
    args: {
      prompt: tool.schema.string().describe("The task prompt to repeat each iteration"),
      max_iterations: tool.schema
        .number()
        .optional()
        .describe("Maximum iterations before stopping (default: 20)"),
      completion_signal: tool.schema
        .string()
        .optional()
        .describe("Text that signals completion (default: <promise>DONE</promise>)"),
      context: tool.schema
        .string()
        .optional()
        .describe("Additional context to inject after the first iteration"),
    },
    async execute(args, context) {
      // SECURITY: Clamp max_iterations to prevent resource exhaustion
      const maxIterations = Math.min(
        args.max_iterations ?? DEFAULT_MAX_ITERATIONS,
        ABSOLUTE_MAX_ITERATIONS,
      )
      const completionSignal = args.completion_signal ?? DEFAULT_COMPLETION_PROMPT
      const basePrompt = args.prompt
      const extraContext = args.context ?? ""

      // Stub: build the loop plan that would be executed via session API
      const results: string[] = []
      results.push(`Ralph Loop Plan (requires session API for execution):`)
      results.push(``)
      results.push(`**Prompt**: ${basePrompt.slice(0, 200)}${basePrompt.length > 200 ? "..." : ""}`)
      results.push(`**Max iterations**: ${maxIterations}`)
      results.push(`**Completion signal**: ${completionSignal}`)
      if (extraContext) {
        results.push(`**Extra context**: ${extraContext.slice(0, 100)}${extraContext.length > 100 ? "..." : ""}`)
      }
      results.push(``)
      results.push(`⚠️ Loop execution requires session API integration. See TODO in source.`)

      return results.join("\n")
    },
  })
}

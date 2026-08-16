/**
 * Comment Checker Hook
 *
 * Detects AI-generated comment anti-patterns (em dashes, filler words,
 * excessive qualifiers) and flags them for removal.
 *
 * Source: Adapted from dev/oh-my-opencode/packages/comment-checker-core/
 */

import type { HookInput, HookOutput } from "../types"

const AI_SLOP_PATTERNS: Array<{ pattern: RegExp; replacement: string; name: string }> = [
  // Em dashes and en dashes (use hyphens or commas instead)
  { pattern: /\u2014/g, replacement: " -- ", name: "em-dash" },
  { pattern: /\u2013/g, replacement: " - ", name: "en-dash" },

  // Filler words
  { pattern: /\bsimply\b/gi, replacement: "", name: "simply" },
  { pattern: /\bobviously\b/gi, replacement: "", name: "obviously" },
  { pattern: /\bclearly\b/gi, replacement: "", name: "clearly" },
  { pattern: /\bmoreover\b/gi, replacement: "", name: "moreover" },
  { pattern: /\bfurthermore\b/gi, replacement: "", name: "furthermore" },
  { pattern: /\bin addition\b/gi, replacement: "", name: "in addition" },
  { pattern: /\bhowever\b/gi, replacement: "but", name: "however" },
  { pattern: /\butilize[sd]?\b/gi, replacement: "use", name: "utilize" },
  { pattern: /\bleverage[sd]?\b/gi, replacement: "use", name: "leverage" },
  { pattern: /\bfacilitate[sd]?\b/gi, replacement: "help", name: "facilitate" },

  // Excessive qualifiers
  { pattern: /\bvery important\b/gi, replacement: "important", name: "very important" },
  { pattern: /\bextremely\b/gi, replacement: "", name: "extremely" },
  { pattern: /\bessentially\b/gi, replacement: "", name: "essentially" },

  // Stop-slop banned phrases
  { pattern: /\bhere's the thing[:\s]/gi, replacement: "", name: "here's the thing" },
  { pattern: /\bthe uncomfortable truth is\b/gi, replacement: "", name: "the uncomfortable truth is" },
  { pattern: /\bit turns out\b/gi, replacement: "", name: "it turns out" },
  { pattern: /\bthe real [a-z]+ is\b/gi, replacement: "", name: "the real X is" },
  { pattern: /\blet me be clear\b/gi, replacement: "", name: "let me be clear" },
  { pattern: /\bthe truth is,?\b/gi, replacement: "", name: "the truth is" },
  { pattern: /\bmake no mistake\b/gi, replacement: "", name: "make no mistake" },
  { pattern: /\bfull stop\.?\b/gi, replacement: "", name: "full stop" },
  { pattern: /\blet that sink in\b/gi, replacement: "", name: "let that sink in" },
  { pattern: /\bat its core\b/gi, replacement: "", name: "at its core" },
  { pattern: /\bit's worth noting\b/gi, replacement: "", name: "it's worth noting" },
  { pattern: /\bat the end of the day\b/gi, replacement: "", name: "at the end of the day" },
  { pattern: /\bwhen it comes to\b/gi, replacement: "", name: "when it comes to" },
  { pattern: /\bthe reality is\b/gi, replacement: "", name: "the reality is" },
  { pattern: /\bin a world where\b/gi, replacement: "", name: "in a world where" },
  { pattern: /\bdeep dive\b/gi, replacement: "analysis", name: "deep dive" },
  { pattern: /\bgame[- ]changer\b/gi, replacement: "significant", name: "game-changer" },
  { pattern: /\bdouble down\b/gi, replacement: "commit", name: "double down" },
  { pattern: /\btake a step back\b/gi, replacement: "reconsider", name: "take a step back" },
  { pattern: /\bcircle back\b/gi, replacement: "revisit", name: "circle back" },
  { pattern: /\bon the same page\b/gi, replacement: "aligned", name: "on the same page" },
  { pattern: /\bbasically\b/gi, replacement: "", name: "basically" },
]

// Single combined regex for fast one-pass detection (avoids 30 individual .test() calls)
const COMBINED_SLOP_DETECT = new RegExp(
  AI_SLOP_PATTERNS.map(p => `(${p.pattern.source})`).join("|"),
  "gi"
)

export function createCommentCheckerHook() {
  return async (input: HookInput, output: any) => {
    try {
      if (input.tool !== "edit") return

      // tool.execute.after output contract: { title, output, metadata }.
      // Fall back to output.content for other hook contexts.
      const target = output?.output ?? output?.content
      if (typeof target !== "string") return

      const content = target
      const issues: string[] = []

      // Phase 1: Fast one-pass detection with combined regex
      COMBINED_SLOP_DETECT.lastIndex = 0
      if (!COMBINED_SLOP_DETECT.test(content)) return

      // Phase 2: Only iterate individual patterns when we know there's a match
      for (const { pattern, name } of AI_SLOP_PATTERNS) {
        if (pattern.test(content)) {
          issues.push(name)
        }
        pattern.lastIndex = 0 // Reset regex state
      }

      if (issues.length > 0) {
        // Add a warning to the output
        const warning = `\n\n⚠️ Comment Checker: Detected AI slop patterns: ${issues.join(", ")}. Consider removing these for cleaner comments.`
        if (typeof output.output === "string") {
          output.output = content + warning
        } else if (typeof output.content === "string") {
          output.content = content + warning
        }
      }
    } catch (err) {
      console.error("[comment-checker] hook failed:", err instanceof Error ? err.message : err)
    }
  }
}

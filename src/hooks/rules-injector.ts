/**
 * Proximity-Aware Rules Injector Hook
 *
 * Walks the directory tree near the target file to discover relevant
 * rule files (AGENTS.md, CLAUDE.md, .rules, CONVENTIONS.md, etc.),
 * parses YAML frontmatter for glob/path filtering, and injects
 * matched rules before tool execution.
 *
 * Upgraded from oh-my-opencode rules-engine patterns:
 * - YAML frontmatter parsing (globs, paths, applyTo, alwaysApply)
 * - Source priority ordering (project > user > global)
 * - Content-hash dedup (don't inject same rule twice)
 * - Char budget limits (static: 12K, dynamic: 4K, post-compact: 3.5K)
 *
 * Source: Adapted from dev/oh-my-opencode/packages/rules-engine/
 */

import { createHash } from "crypto"
import { readFile, stat } from "fs/promises"
import { dirname, join, relative } from "path"
import {
  MAX_RULE_WALK_DEPTH,
  MAX_RULE_FILE_SIZE,
  CACHE_EXPIRY_MS,
  STATIC_RULE_MAX_CHARS,
  DYNAMIC_RULE_MAX_CHARS,
  POST_COMPACT_RULE_MAX_CHARS,
  STATIC_RULE_MAX_RESULT_CHARS,
  DYNAMIC_RULE_MAX_RESULT_CHARS,
  POST_COMPACT_MAX_RESULT_CHARS,
} from "../constants"

// --- Rule file discovery (from oh-my-opencode rules-engine/constants.ts) ---

const RULE_FILE_NAMES = [
  "AGENTS.md",
  "CLAUDE.md",
  ".rules",
  "CONVENTIONS.md",
  "CONTRIBUTING.md",
]

/**
 * Source priority map (lower = higher priority).
 * Project-level rules beat user-level; closer files beat distant.
 * (from oh-my-opencode rules-engine/constants.ts SOURCE_PRIORITY)
 */
const SOURCE_PRIORITY: Record<string, number> = {
  "project/AGENTS.md": 0,
  "project/CLAUDE.md": 1,
  "project/.rules": 2,
  "project/CONVENTIONS.md": 3,
  "project/CONTRIBUTING.md": 4,
  "user/AGENTS.md": 100,
  "user/CLAUDE.md": 101,
  "user/.rules": 102,
  "user/CONVENTIONS.md": 103,
  "user/CONTRIBUTING.md": 104,
}

// --- YAML frontmatter parsing (from oh-my-opencode rules-engine/parser.ts) ---

interface RuleFrontmatter {
  description?: string
  globs?: string | string[]
  paths?: string | string[]
  applyTo?: string | string[]
  alwaysApply?: boolean
}

interface ParsedRule {
  frontmatter: RuleFrontmatter
  body: string
}

function parseRuleFrontmatter(content: string): ParsedRule {
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/
  const match = content.match(frontmatterRegex)

  if (!match) {
    return { frontmatter: {}, body: content.trim() }
  }

  const yamlBlock = match[1]
  const body = match[2].trim()
  const frontmatter: RuleFrontmatter = {}

  // Minimal YAML parser — handles the subset rules-engine uses
  const lines = yamlBlock.split("\n")
  let currentKey = ""
  let currentValue: string[] = []

  for (const line of lines) {
    const keyValueMatch = line.match(/^(\w[\w-]*):\s*(.*)$/)
    if (keyValueMatch) {
      // Save previous key/value pair
      if (currentKey) {
        setFrontmatterValue(frontmatter, currentKey, currentValue)
      }
      currentKey = keyValueMatch[1]
      const rawValue = keyValueMatch[2].trim()
      currentValue = rawValue ? [rawValue] : []
    } else if (line.match(/^\s+-\s+(.+)$/) && currentKey) {
      // Array item
      const itemMatch = line.match(/^\s+-\s+(.+)$/)
      if (itemMatch) {
        currentValue.push(itemMatch[1].trim())
      }
    }
  }
  // Save last key/value
  if (currentKey) {
    setFrontmatterValue(frontmatter, currentKey, currentValue)
  }

  return { frontmatter, body }
}

function setFrontmatterValue(target: RuleFrontmatter, key: string, values: string[]): void {
  if (values.length === 0) return
  const single = values.length === 1 ? values[0] : undefined

  switch (key) {
    case "description":
      target.description = single ?? values.join(", ")
      break
    case "globs":
      target.globs = single ?? values
      break
    case "paths":
      target.paths = single ?? values
      break
    case "applyTo":
      target.applyTo = single ?? values
      break
    case "alwaysApply":
      target.alwaysApply = single === "true" || single === "True"
      break
  }
}

// --- Glob matching (simplified picomatch-style) ---

function matchesGlobs(filePath: string, globs: string | string[]): boolean {
  const patterns = Array.isArray(globs) ? globs : [globs]
  const basename = filePath.split("/").pop() ?? ""
  const normalizedPath = filePath.replace(/\\/g, "/")

  for (const pattern of patterns) {
    // Negative patterns
    if (pattern.startsWith("!")) {
      if (matchesSinglePattern(normalizedPath, basename, pattern.slice(1))) {
        return false
      }
      continue
    }
    if (matchesSinglePattern(normalizedPath, basename, pattern)) {
      return true
    }
  }
  return patterns.length === 0
}

function matchesSinglePattern(normalizedPath: string, basename: string, pattern: string): boolean {
  // Simple glob matching: * matches any chars in a segment, ** matches path segments
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "{{STAR}}")
    .replace(/\?/g, "{{Q}}")

  const regexStr = escaped
    .replace(/\{\{GLOBSTAR\}\}/g, ".*")
    .replace(/\{\{STAR\}\}/g, "[^/]*")
    .replace(/\{\{Q\}\}/g, "[^/]")

  const regex = new RegExp(`^${regexStr}$`)
  return regex.test(normalizedPath) || regex.test(basename)
}

function ruleAppliesToTarget(
  frontmatter: RuleFrontmatter,
  targetPath: string,
): boolean {
  // alwaysApply rules always match
  if (frontmatter.alwaysApply) return true

  const globs = frontmatter.globs ?? frontmatter.paths ?? frontmatter.applyTo

  // No frontmatter filters = always applies
  if (!globs) return true

  return matchesGlobs(targetPath, globs)
}

// --- Content-hash dedup (from oh-my-opencode rules-engine engine/matcher.ts) ---

function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16)
}

const injectedHashes = new Set<string>()

function deduplicateRule(body: string): boolean {
  const hash = contentHash(body)
  if (injectedHashes.has(hash)) return false
  injectedHashes.add(hash)
  return true
}

// --- Cache ---

const ruleCache = new Map<string, { rules: RuleCandidate[]; timestamp: number }>()

interface RuleCandidate {
  path: string
  content: string
  parsed: ParsedRule
  source: string
  distance: number
  isGlobal: boolean
}

// --- Main discovery function ---

async function discoverNearbyRules(
  targetPath: string,
  projectRoot: string,
  budget: { maxRuleChars: number; maxResultChars: number },
): Promise<string | null> {
  const targetDir = dirname(targetPath)

  let currentDir = targetDir
  const candidates: RuleCandidate[] = []
  let depth = 0

  while (depth < MAX_RULE_WALK_DEPTH) {
    // Check cache
    const cached = ruleCache.get(currentDir)
    if (cached && Date.now() - cached.timestamp < CACHE_EXPIRY_MS) {
      candidates.push(...cached.rules)
      break
    }

    // Check for rule files in this directory
    const cachedDir: RuleCandidate[] = []
    for (const ruleName of RULE_FILE_NAMES) {
      const rulePath = join(currentDir, ruleName)
      try {
        const fileStat = await stat(rulePath)
        if (!fileStat.isFile() || fileStat.size > MAX_RULE_FILE_SIZE) continue

        const content = await readFile(rulePath, "utf-8")
        if (content.length > MAX_RULE_FILE_SIZE) continue

        const parsed = parseRuleFrontmatter(content)
        const relPath = relative(projectRoot, rulePath)
        const isGlobal = currentDir.startsWith(projectRoot) === false
        const source = isGlobal ? `user/${ruleName}` : `project/${ruleName}`
        const distance = depth

        const candidate: RuleCandidate = {
          path: rulePath,
          content,
          parsed,
          source,
          distance,
          isGlobal,
        }

        cachedDir.push(candidate)
        candidates.push(candidate)
      } catch {
        // Skip unreadable files
      }
    }

    // Cache this directory's results
    if (cachedDir.length > 0) {
      ruleCache.set(currentDir, { rules: cachedDir, timestamp: Date.now() })
    }

    // Move up one directory
    const parent = dirname(currentDir)
    if (parent === currentDir) break
    currentDir = parent
    depth++
  }

  if (candidates.length === 0) return null

  // --- Source priority ordering (from oh-my-opencode rules-engine/ordering.ts) ---
  const sorted = candidates.sort((a, b) => {
    const pa = SOURCE_PRIORITY[a.source] ?? Number.POSITIVE_INFINITY
    const pb = SOURCE_PRIORITY[b.source] ?? Number.POSITIVE_INFINITY
    return (
      Number(a.isGlobal) - Number(b.isGlobal) ||
      a.distance - b.distance ||
      pa - pb
    )
  })

  // --- Filter by frontmatter and dedup ---
  const seenHashes = new Set<string>()
  const rules: Array<{ path: string; body: string }> = []

  let totalChars = 0
  for (const candidate of sorted) {
    // Check frontmatter glob/path filtering
    if (!ruleAppliesToTarget(candidate.parsed.frontmatter, targetPath)) {
      continue
    }

    const body = candidate.parsed.body
    if (!body) continue

    // Content-hash dedup
    const hash = contentHash(body)
    if (seenHashes.has(hash)) continue
    seenHashes.add(hash)

    // Per-rule char budget
    const truncatedBody = body.length > budget.maxRuleChars
      ? body.slice(0, budget.maxRuleChars) + "\n\n[Rule truncated]"
      : body

    // Total result budget
    if (totalChars + truncatedBody.length > budget.maxResultChars) {
      break
    }

    totalChars += truncatedBody.length
    rules.push({ path: candidate.path, body: truncatedBody })
  }

  if (rules.length === 0) return null

  return rules
    .map((r) => `Instructions from: ${r.path}\n\n${r.body}`)
    .join("\n\n---\n\n")
}

// --- Hook factory ---

export type RuleBudgetMode = "static" | "dynamic" | "post-compact"

const BUDGET_PRESETS: Record<RuleBudgetMode, { maxRuleChars: number; maxResultChars: number }> = {
  static: { maxRuleChars: STATIC_RULE_MAX_CHARS, maxResultChars: STATIC_RULE_MAX_RESULT_CHARS },
  dynamic: { maxRuleChars: DYNAMIC_RULE_MAX_CHARS, maxResultChars: DYNAMIC_RULE_MAX_RESULT_CHARS },
  "post-compact": { maxRuleChars: POST_COMPACT_RULE_MAX_CHARS, maxResultChars: POST_COMPACT_MAX_RESULT_CHARS },
}

export function createRulesInjectorHook(ctx: any) {
  return async (input: any, output: any) => {
    const filePath = input?.args?.file_path ?? input?.args?.path ?? ""
    if (!filePath) return

    const directory = ctx?.directory ?? ctx?.worktree ?? process.cwd()

    // Determine budget mode (default to static)
    const mode: RuleBudgetMode = input?.budgetMode ?? "static"
    const budget = BUDGET_PRESETS[mode]

    // Find and filter rules near the target
    const rules = await discoverNearbyRules(filePath, directory, budget)
    if (!rules) return

    // Inject rules into the system prompt or tool context
    if (output && typeof output === "object") {
      output.injectedRules = rules
    }
  }
}

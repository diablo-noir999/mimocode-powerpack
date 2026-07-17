/**
 * YAML frontmatter utilities for SKILL.md files
 *
 * Adapted from dev/openskills/src/utils/yaml.ts
 */

/**
 * Escape special regex characters in a string for safe interpolation
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Extract field from YAML frontmatter
 */
export function extractYamlField(content: string, field: string): string {
  const safeField = escapeRegex(field)
  const match = content.match(new RegExp(`^${safeField}:\\s*(.+?)$`, "m"))
  return match ? match[1].trim() : ""
}

/**
 * Validate SKILL.md has proper YAML frontmatter (opening and closing ---)
 */
export function hasValidFrontmatter(content: string): boolean {
  const trimmed = content.trim()
  return trimmed.startsWith("---") && trimmed.includes("\n---")
}

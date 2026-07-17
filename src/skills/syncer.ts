/**
 * Skill Syncer — Pull updates for installed skills
 *
 * Adapted from dev/openskills/src/commands/sync.ts (~200 LOC core logic)
 * Uses metadata to re-clone updated versions from source.
 */

import { readdirSync, existsSync, rmSync } from "fs"
import { join } from "path"
import { readSkillMetadata, type SkillSourceMetadata } from "./skill-metadata"
import { installSkill, type InstallResult } from "./installer"

export interface SyncResult {
  updated: string[]
  unchanged: string[]
  failed: Array<{ name: string; error: string }>
  notFound: string[]
}

/**
 * Find all installed skills in a directory
 */
function findInstalledSkills(installDir: string): Array<{ name: string; path: string; metadata: SkillSourceMetadata | null }> {
  const skills: Array<{ name: string; path: string; metadata: SkillSourceMetadata | null }> = []

  if (!existsSync(installDir)) return skills

  const entries = readdirSync(installDir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const skillDir = join(installDir, entry.name)
      const skillMdPath = join(skillDir, "SKILL.md")
      if (existsSync(skillMdPath)) {
        skills.push({
          name: entry.name,
          path: skillDir,
          metadata: readSkillMetadata(skillDir),
        })
      }
    }
  }

  return skills
}

/**
 * Re-install a skill from its recorded source metadata.
 * Returns true if the skill was updated (content changed), false if unchanged.
 */
function reinstallFromMetadata(
  skillDir: string,
  metadata: SkillSourceMetadata,
  installDir: string
): { result: InstallResult; updated: boolean } {
  // Remove old version
  rmSync(skillDir, { recursive: true, force: true })

  let result: InstallResult

  if (metadata.sourceType === "local" && metadata.localPath) {
    result = installSkill(metadata.localPath, { installDir, force: true })
  } else if (metadata.repoUrl) {
    // Extract owner/repo from URL for installer shorthand format
    const githubMatch = metadata.repoUrl.match(/github\.com\/([^/]+\/[^/]+)/)
    const shorthand = githubMatch ? githubMatch[1] : metadata.repoUrl
    const source = metadata.subpath
      ? `${shorthand}/${metadata.subpath}`
      : shorthand
    result = installSkill(source, { installDir, force: true })
  } else {
    return {
      result: {
        success: false,
        installed: [],
        skipped: [],
        errors: ["No source URL recorded in metadata"],
      },
      updated: false,
    }
  }

  return { result, updated: result.installed.length > 0 }
}

/**
 * Sync (update) installed skills by re-cloning from their recorded sources.
 *
 * @param installDir - Directory containing installed skills (default: .mimocode/skills)
 * @param names - Specific skill names to sync; if empty, syncs all
 */
export function syncSkills(
  installDir?: string,
  names?: string[]
): SyncResult {
  const dir = join(process.cwd(), installDir ?? ".mimocode/skills")
  const allSkills = findInstalledSkills(dir)

  const toSync = names
    ? allSkills.filter((s) => names.includes(s.name))
    : allSkills

  const result: SyncResult = { updated: [], unchanged: [], failed: [], notFound: [] }

  if (toSync.length === 0) {
    if (names && names.length > 0) {
      result.notFound = names
    }
    return result
  }

  for (const skill of toSync) {
    if (!skill.metadata) {
      // No metadata — can't sync, but skill exists
      result.unchanged.push(skill.name)
      continue
    }

    try {
      const { result: installResult, updated } = reinstallFromMetadata(
        skill.path,
        skill.metadata,
        dir
      )

      if (installResult.success && updated) {
        result.updated.push(skill.name)
      } else if (installResult.success) {
        result.unchanged.push(skill.name)
      } else {
        result.failed.push({
          name: skill.name,
          error: installResult.errors.join("; "),
        })
      }
    } catch (error) {
      result.failed.push({
        name: skill.name,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return result
}

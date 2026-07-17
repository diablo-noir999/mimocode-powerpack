/**
 * Skill Installer — Git clone + SKILL.md extraction
 *
 * Adapted from dev/openskills/src/commands/install.ts (~200 LOC core logic)
 * Stripped of interactive prompts, chalk, ora — returns structured results.
 */

import { readFileSync, readdirSync, existsSync, mkdirSync, rmSync, cpSync, statSync, mkdtempSync } from "fs"
import { join, basename, resolve, relative } from "path"
import { homedir, tmpdir } from "os"
import { execFileSync } from "child_process"
import { writeSkillMetadata, type SkillSourceMetadata } from "./skill-metadata"
import { extractYamlField, hasValidFrontmatter } from "./yaml"

export interface InstallResult {
  success: boolean
  installed: string[]
  skipped: string[]
  errors: string[]
}

export interface InstallOptions {
  installDir?: string
  force?: boolean
}

function isLocalPath(source: string): boolean {
  return (
    source.startsWith("/") ||
    source.startsWith("./") ||
    source.startsWith("../") ||
    source.startsWith("~/")
  )
}

function isGitUrl(source: string): boolean {
  return (
    source.startsWith("git@") ||
    source.startsWith("git://") ||
    source.startsWith("http://") ||
    source.startsWith("https://") ||
    source.endsWith(".git")
  )
}

function expandPath(source: string): string {
  if (source.startsWith("~/")) {
    return join(homedir(), source.slice(2))
  }
  return resolve(source)
}

function findSkillDirs(dir: string): string[] {
  const skills: string[] = []
  const entries = readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (existsSync(join(fullPath, "SKILL.md"))) {
        skills.push(fullPath)
      } else {
        skills.push(...findSkillDirs(fullPath))
      }
    }
  }
  return skills
}

function installFromLocal(
  localPath: string,
  targetDir: string,
  options: InstallOptions
): InstallResult {
  const result: InstallResult = { success: true, installed: [], skipped: [], errors: [] }

  if (!existsSync(localPath)) {
    result.errors.push(`Path does not exist: ${localPath}`)
    result.success = false
    return result
  }

  const stats = statSync(localPath)
  if (!stats.isDirectory()) {
    result.errors.push("Path must be a directory")
    result.success = false
    return result
  }

  const skillMdPath = join(localPath, "SKILL.md")
  if (existsSync(skillMdPath)) {
    const content = readFileSync(skillMdPath, "utf-8")
    if (!hasValidFrontmatter(content)) {
      result.errors.push("Invalid SKILL.md (missing YAML frontmatter)")
      result.success = false
      return result
    }

    const skillName = basename(localPath)
    const targetPath = join(targetDir, skillName)

    if (existsSync(targetPath) && !options.force) {
      result.skipped.push(skillName)
      return result
    }

    mkdirSync(targetDir, { recursive: true })
    cpSync(localPath, targetPath, { recursive: true, dereference: true })
    writeSkillMetadata(targetPath, {
      source: localPath,
      sourceType: "local",
      localPath: localPath,
      installedAt: new Date().toISOString(),
    })
    result.installed.push(skillName)
  } else {
    // Directory of skills
    const skillDirs = findSkillDirs(localPath)
    if (skillDirs.length === 0) {
      result.errors.push("No SKILL.md files found")
      result.success = false
      return result
    }

    for (const skillDir of skillDirs) {
      const content = readFileSync(join(skillDir, "SKILL.md"), "utf-8")
      if (!hasValidFrontmatter(content)) continue

      const skillName = basename(skillDir)
      const targetPath = join(targetDir, skillName)

      if (existsSync(targetPath) && !options.force) {
        result.skipped.push(skillName)
        continue
      }

      mkdirSync(targetDir, { recursive: true })
      cpSync(skillDir, targetPath, { recursive: true, dereference: true })
      writeSkillMetadata(targetPath, {
        source: localPath,
        sourceType: "local",
        localPath: skillDir,
        installedAt: new Date().toISOString(),
      })
      result.installed.push(skillName)
    }
  }

  result.success = result.errors.length === 0
  return result
}

function installFromGit(
  repoUrl: string,
  skillSubpath: string,
  targetDir: string,
  options: InstallOptions
): InstallResult {
  const result: InstallResult = { success: true, installed: [], skipped: [], errors: [] }
  const tempDir = mkdtempSync(join(tmpdir(), "mimocode-skills-"))

  try {
    execFileSync("git", ["clone", "--depth", "1", "--quiet", repoUrl, `${tempDir}/repo`], {
      stdio: "pipe",
    })
  } catch (error) {
    rmSync(tempDir, { recursive: true, force: true })
    const err = error as { stderr?: Buffer }
    result.errors.push(`Failed to clone: ${err.stderr?.toString().trim() ?? String(error)}`)
    result.success = false
    return result
  }

  const repoDir = join(tempDir, "repo")

  try {
    if (skillSubpath) {
      // Install specific skill from subpath
      const skillDir = join(repoDir, skillSubpath)
      const skillMdPath = join(skillDir, "SKILL.md")

      if (!existsSync(skillMdPath)) {
        result.errors.push(`SKILL.md not found at ${skillSubpath}`)
        result.success = false
        return result
      }

      const content = readFileSync(skillMdPath, "utf-8")
      if (!hasValidFrontmatter(content)) {
        result.errors.push("Invalid SKILL.md (missing YAML frontmatter)")
        result.success = false
        return result
      }

      const skillName = basename(skillSubpath)
      const targetPath = join(targetDir, skillName)

      if (existsSync(targetPath) && !options.force) {
        result.skipped.push(skillName)
      } else {
        mkdirSync(targetDir, { recursive: true })
        cpSync(skillDir, targetPath, { recursive: true, dereference: true })
        writeSkillMetadata(targetPath, {
          source: repoUrl,
          sourceType: "git",
          repoUrl,
          subpath: skillSubpath,
          installedAt: new Date().toISOString(),
        })
        result.installed.push(skillName)
      }
    } else {
      // Find all skills in repo
      const rootSkillPath = join(repoDir, "SKILL.md")
      const skillDirs: string[] = []

      if (existsSync(rootSkillPath)) {
        const content = readFileSync(rootSkillPath, "utf-8")
        if (hasValidFrontmatter(content)) {
          skillDirs.push(repoDir)
        }
      }

      if (skillDirs.length === 0) {
        skillDirs.push(...findSkillDirs(repoDir))
      }

      if (skillDirs.length === 0) {
        result.errors.push("No SKILL.md files found in repository")
        result.success = false
        return result
      }

      for (const skillDir of skillDirs) {
        const content = readFileSync(join(skillDir, "SKILL.md"), "utf-8")
        if (!hasValidFrontmatter(content)) continue

        const skillName = basename(skillDir)
        const targetPath = join(targetDir, skillName)

        if (existsSync(targetPath) && !options.force) {
          result.skipped.push(skillName)
          continue
        }

        mkdirSync(targetDir, { recursive: true })
        cpSync(skillDir, targetPath, { recursive: true, dereference: true })

        const subpath = relative(repoDir, skillDir)
        writeSkillMetadata(targetPath, {
          source: repoUrl,
          sourceType: "git",
          repoUrl,
          subpath: subpath || "",
          installedAt: new Date().toISOString(),
        })
        result.installed.push(skillName)
      }
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }

  result.success = result.errors.length === 0
  return result
}

/**
 * Install skills from a source (GitHub shorthand, git URL, or local path).
 *
 * @param source - "owner/repo", "owner/repo/skill-name", full git URL, or local path
 * @param options - installDir defaults to ".mimocode/skills", force overwrites existing
 */
export function installSkill(source: string, options: InstallOptions = {}): InstallResult {
  const targetDir = join(process.cwd(), options.installDir ?? ".mimocode/skills")

  if (isLocalPath(source)) {
    return installFromLocal(expandPath(source), targetDir, options)
  }

  let repoUrl: string
  let skillSubpath = ""

  if (isGitUrl(source)) {
    repoUrl = source
  } else {
    const parts = source.split("/")
    if (parts.length === 2) {
      repoUrl = `https://github.com/${source}`
    } else if (parts.length > 2) {
      repoUrl = `https://github.com/${parts[0]}/${parts[1]}`
      skillSubpath = parts.slice(2).join("/")
    } else {
      return {
        success: false,
        installed: [],
        skipped: [],
        errors: ["Invalid source format. Expected: owner/repo, owner/repo/skill-name, git URL, or local path"],
      }
    }
  }

  return installFromGit(repoUrl, skillSubpath, targetDir, options)
}

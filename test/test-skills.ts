/**
 * Test: Skills system (installer, syncer, yaml parser)
 * Run: bun run test/test-skills.ts
 */

import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs"
import { join, relative } from "node:path"

let passed = 0
let failed = 0

function assert(condition: boolean, msg: string) {
  if (condition) {
    passed++
    console.log(`  ✓ ${msg}`)
  } else {
    failed++
    console.log(`  ✗ ${msg}`)
  }
}

function assertEq(a: any, b: any, msg: string) {
  assert(a === b, `${msg} (got ${JSON.stringify(a)}, expected ${JSON.stringify(b)})`)
}

function section(name: string) {
  console.log(`\n--- ${name} ---`)
}

const TEST_DIR = "/tmp/powerpack-test-skills"
rmSync(TEST_DIR, { recursive: true, force: true })
mkdirSync(TEST_DIR, { recursive: true })

// === YAML Parser ===
section("YAML Parser")
const { extractYamlField, hasValidFrontmatter } = await import("../src/skills/yaml")

// Test: extractYamlField
{
  const content = `---
name: test-skill
description: A test skill for testing
author: test-user
version: 1.0.0
tags:
  - testing
  - example
---

# Test Skill

This is a test skill.`
  const name = extractYamlField(content, "name")
  assertEq(name, "test-skill", "extractYamlField parses name")
  
  const desc = extractYamlField(content, "description")
  assertEq(desc, "A test skill for testing", "extractYamlField parses description")
  
  const author = extractYamlField(content, "author")
  assertEq(author, "test-user", "extractYamlField parses author")
  
  const version = extractYamlField(content, "version")
  assertEq(version, "1.0.0", "extractYamlField parses version")
}

// Test: extractYamlField - missing field
{
  const content = `---
name: test-skill
---`
  const missing = extractYamlField(content, "nonexistent")
  assertEq(missing, "", "extractYamlField returns empty for missing field")
}

// Test: extractYamlField - regex metacharacters in field name
{
  const content = `---
field.name: value-with-dot
field+name: value-with-plus
field*name: value-with-star
---`

  const dotValue = extractYamlField(content, "field.name")
  assertEq(dotValue, "value-with-dot", "extractYamlField handles '.' in field name")

  const plusValue = extractYamlField(content, "field+name")
  assertEq(plusValue, "value-with-plus", "extractYamlField handles '+' in field name")

  const starValue = extractYamlField(content, "field*name")
  assertEq(starValue, "value-with-star", "extractYamlField handles '*' in field name")
}

// Test: hasValidFrontmatter
{
  const withFrontmatter = `---\nname: test\n---\n# Content`
  assert(hasValidFrontmatter(withFrontmatter), "hasValidFrontmatter returns true for valid frontmatter")

  const withoutFrontmatter = `# No Frontmatter\nJust content`
  assert(!hasValidFrontmatter(withoutFrontmatter), "hasValidFrontmatter returns false without frontmatter")

  const empty = ""
  assert(!hasValidFrontmatter(empty), "hasValidFrontmatter returns false for empty string")
}

// Test: hasValidFrontmatter — closing --- required
{
  // Valid: has both opening and closing ---
  const valid = `---\nname: test\n---`
  assert(hasValidFrontmatter(valid), "hasValidFrontmatter: valid frontmatter with closing --- returns true")

  // Invalid: no closing ---
  const noClosing = `---\nname: test`
  assert(!hasValidFrontmatter(noClosing), "hasValidFrontmatter: missing closing --- returns false")

  // Invalid: no opening --- but has ---
  const noOpening = `name: test\n---`
  assert(!hasValidFrontmatter(noOpening), "hasValidFrontmatter: missing opening --- returns false")
}

// === Skill Installer ===
section("Skill Installer")
const { installSkill } = await import("../src/skills/installer")
import { join as pathJoin } from "node:path"

// Test: install from local path
{
  const fakeRepo = join(TEST_DIR, "fake-repo")
  mkdirSync(fakeRepo, { recursive: true })
  writeFileSync(join(fakeRepo, "SKILL.md"), `---
name: fake-skill
description: A fake skill for testing
---

# Fake Skill

This is a fake skill for testing purposes.`)
  
  // installSkill resolves installDir relative to cwd, so use a relative path
  const installDirRel = relative(process.cwd(), join(TEST_DIR, "skills"))
  mkdirSync(join(TEST_DIR, "skills"), { recursive: true })
  
  const result = installSkill(fakeRepo, { installDir: installDirRel, force: false })
  assert(result.installed.length > 0, "installSkill successfully installs the skill")
  
  if (result.installed.length > 0) {
    assert(result.installed.includes("fake-repo"), "installed skill has correct name (basename)")
    const resolvedInstallDir = join(process.cwd(), installDirRel)
    const skillPath = join(resolvedInstallDir, "fake-repo", "SKILL.md")
    assert(existsSync(skillPath), "SKILL.md copied to install dir")
  }
}

// Test: install with force overwrite
{
  const fakeRepo = join(TEST_DIR, "fake-repo-force")
  mkdirSync(fakeRepo, { recursive: true })
  writeFileSync(join(fakeRepo, "SKILL.md"), `---
name: force-skill
description: A skill to test force overwrite
---

# Force Skill`)
  
  const installDirRel = relative(process.cwd(), join(TEST_DIR, "skills-force"))
  mkdirSync(join(TEST_DIR, "skills-force"), { recursive: true })
  
  // First install
  const result1 = installSkill(fakeRepo, { installDir: installDirRel, force: false })
  assert(result1.installed.length > 0, "first install succeeds")
  
  // Second install without force - should skip
  const result2 = installSkill(fakeRepo, { installDir: installDirRel, force: false })
  assert(result2.skipped.length > 0, "second install skips existing skill")
  
  // Third install with force - should overwrite
  const result3 = installSkill(fakeRepo, { installDir: installDirRel, force: true })
  assert(result3.installed.length > 0, "force install overwrites successfully")
}

// Test: install nonexistent path
{
  const result = installSkill("/nonexistent/path/to/repo", { installDir: relative(process.cwd(), join(TEST_DIR, "skills-miss")), force: false })
  assert(result.errors.length > 0, "nonexistent path returns error")
}

// Test: installSkill expands 'owner/repo' to GitHub URL
{
  // owner/repo format should be expanded to https://github.com/owner/repo
  // The clone will fail (no such repo), but the error should contain the expanded URL
  const result = installSkill("owner/repo", { installDir: relative(process.cwd(), join(TEST_DIR, "skills-gh")), force: false })
  assert(result.errors.length > 0, "'owner/repo' triggers git clone (fails on missing repo)")
  const hasUrl = result.errors.some(e => e.includes("github.com/owner/repo"))
  assert(hasUrl, `error references expanded GitHub URL (errors: ${JSON.stringify(result.errors)})`)
}

// Test: installSkill with owner/repo/skill-name subpath
{
  const result = installSkill("owner/repo/my-skill", { installDir: relative(process.cwd(), join(TEST_DIR, "skills-sub")), force: false })
  assert(result.errors.length > 0, "'owner/repo/skill-name' triggers git clone")
  const hasUrl = result.errors.some(e => e.includes("github.com/owner/repo"))
  assert(hasUrl, `subpath format expands repo URL correctly (errors: ${JSON.stringify(result.errors)})`)
}

// === Skill Metadata ===
section("Skill Metadata")
const { readSkillMetadata, writeSkillMetadata } = await import("../src/skills/skill-metadata")

// Test: write and read metadata
{
  const skillDir = join(TEST_DIR, "skill-with-meta")
  mkdirSync(skillDir, { recursive: true })
  
  writeSkillMetadata(skillDir, {
    source: "github",
    sourceType: "github",
    repoUrl: "owner/repo",
    installedAt: new Date().toISOString(),
  })
  
  const meta = readSkillMetadata(skillDir)
  assert(meta !== null, "readSkillMetadata returns metadata")
  assertEq(meta!.source, "github", "metadata has correct source")
  assertEq(meta!.sourceType, "github", "metadata has correct sourceType")
  assertEq(meta!.repoUrl, "owner/repo", "metadata has correct repoUrl")
}

// Test: read metadata from nonexistent dir
{
  const meta = readSkillMetadata("/nonexistent/path")
  assert(meta === null, "readSkillMetadata returns null for nonexistent dir")
}

// Test: write and read metadata uses correct filename
{
  const skillDir = join(TEST_DIR, "skill-meta-filename")
  mkdirSync(skillDir, { recursive: true })

  const { SKILL_METADATA_FILE } = await import("../src/skills/skill-metadata")

  writeSkillMetadata(skillDir, {
    source: "https://github.com/owner/repo",
    sourceType: "github",
    repoUrl: "owner/repo",
    installedAt: new Date().toISOString(),
  })

  // Verify the metadata file uses the expected name
  assertEq(SKILL_METADATA_FILE, ".mimocode-skill-meta.json", "metadata filename is .mimocode-skill-meta.json")
  assert(existsSync(join(skillDir, SKILL_METADATA_FILE)), "metadata file exists with correct name")

  // Read it back and verify content
  const meta = readSkillMetadata(skillDir)
  assert(meta !== null, "readSkillMetadata reads from correct filename")
  assertEq(meta!.repoUrl, "owner/repo", "metadata content correct via correct filename")
}

// Cleanup
rmSync(TEST_DIR, { recursive: true, force: true })

console.log(`\n=== Skills Tests: ${passed} passed, ${failed} failed ===`)
process.exit(failed > 0 ? 1 : 0)

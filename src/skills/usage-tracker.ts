/**
 * Skill Usage Tracker
 *
 * Tracks per-skill metrics (use_count, view_count, last_used_at, state)
 * in a sidecar .usage.json file. Inspired by Hermes' skill_usage.py.
 *
 * State machine: active → stale (30 days unused) → archived (90 days)
 * Pinned skills are exempt from auto-transitions.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs"
import { join } from "path"

interface SkillUsage {
  use_count: number
  view_count: number
  last_used_at: string | null
  last_viewed_at: string | null
  state: "active" | "stale" | "archived"
  pinned: boolean
  created_by: "user" | "agent" | "installed"
}

interface UsageStore {
  [skillName: string]: SkillUsage
}

const STALE_DAYS = 30
const ARCHIVE_DAYS = 90

function getUsagePath(projectPath: string): string {
  return join(projectPath, ".mimocode", "skills", ".usage.json")
}

const usageCache = new Map<string, { data: UsageStore; lastLoad: number }>()
const pendingWrites = new Map<string, ReturnType<typeof setTimeout>>()
const CACHE_MAX_AGE_MS = 2000
const DEBOUNCE_MS = 1000

function loadUsage(projectPath: string): UsageStore {
  const cached = usageCache.get(projectPath)
  const now = Date.now()
  if (cached && now - cached.lastLoad < CACHE_MAX_AGE_MS) {
    return cached.data
  }
  const usagePath = getUsagePath(projectPath)
  let data: UsageStore = {}
  if (existsSync(usagePath)) {
    try {
      data = JSON.parse(readFileSync(usagePath, "utf-8"))
    } catch {
      data = {}
    }
  }
  usageCache.set(projectPath, { data, lastLoad: now })
  return data
}

function saveUsage(projectPath: string, usage: UsageStore): void {
  usageCache.set(projectPath, { data: usage, lastLoad: Date.now() })
  const existing = pendingWrites.get(projectPath)
  if (existing) clearTimeout(existing)
  pendingWrites.set(projectPath, setTimeout(() => {
    pendingWrites.delete(projectPath)
    const cached = usageCache.get(projectPath)
    if (!cached) return
    const usagePath = getUsagePath(projectPath)
    const dir = join(projectPath, ".mimocode", "skills")
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(usagePath, JSON.stringify(cached.data, null, 2))
  }, DEBOUNCE_MS))
}

export function trackSkillLoad(projectPath: string, skillName: string): void {
  const usage = loadUsage(projectPath)
  const now = new Date().toISOString()

  if (!usage[skillName]) {
    usage[skillName] = {
      use_count: 0,
      view_count: 0,
      last_used_at: null,
      last_viewed_at: null,
      state: "active",
      pinned: false,
      created_by: "installed",
    }
  }

  usage[skillName].view_count++
  usage[skillName].last_viewed_at = now

  // Reactivate if it was stale/archived
  if (usage[skillName].state !== "active" && !usage[skillName].pinned) {
    usage[skillName].state = "active"
  }

  saveUsage(projectPath, usage)
}

export function trackSkillUse(projectPath: string, skillName: string): void {
  const usage = loadUsage(projectPath)
  const now = new Date().toISOString()

  if (!usage[skillName]) {
    usage[skillName] = {
      use_count: 0,
      view_count: 0,
      last_used_at: null,
      last_viewed_at: null,
      state: "active",
      pinned: false,
      created_by: "installed",
    }
  }

  usage[skillName].use_count++
  usage[skillName].last_used_at = now

  // Reactivate if it was stale/archived
  if (usage[skillName].state !== "active" && !usage[skillName].pinned) {
    usage[skillName].state = "active"
  }

  saveUsage(projectPath, usage)
}

export function transitionStates(projectPath: string): { archived: string[]; stale: string[] } {
  const usage = loadUsage(projectPath)
  const now = Date.now()
  const archived: string[] = []
  const stale: string[] = []

  for (const [name, entry] of Object.entries(usage)) {
    if (entry.pinned) continue

    const lastActivity = entry.last_used_at || entry.last_viewed_at
    if (!lastActivity) continue

    const daysSince = (now - new Date(lastActivity).getTime()) / (1000 * 60 * 60 * 24)

    if (entry.state === "active" && daysSince > STALE_DAYS) {
      entry.state = "stale"
      stale.push(name)
    } else if (entry.state === "stale" && daysSince > ARCHIVE_DAYS) {
      entry.state = "archived"
      archived.push(name)
    }
  }

  saveUsage(projectPath, usage)
  return { archived, stale }
}

export function getUsageStats(projectPath: string): UsageStore {
  return loadUsage(projectPath)
}

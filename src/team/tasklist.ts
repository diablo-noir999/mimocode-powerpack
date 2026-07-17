/**
 * Shared task list with status tracking
 * 
 * Simplified from oh-my-opencode's team-core tasklist.
 * Uses file-based persistence in .powerpack/team/ directory.
 * 
 * Pattern: shared tasklist.jsonl with atomic file locks, status tracking
 */

import { readFile, readdir, writeFile, rename, rm } from "node:fs/promises"
import { join } from "node:path"
import { ensureDir } from "./utils"

export type TaskStatus = "pending" | "claimed" | "in_progress" | "completed" | "deleted"

export interface Task {
  version: 1
  id: string
  subject: string
  description: string
  status: TaskStatus
  owner?: string
  blockedBy: string[]
  createdAt: number
  updatedAt: number
}

export interface TasklistConfig {
  baseDir: string
}

function getTasksDir(baseDir: string, teamRunId: string): string {
  return join(baseDir, "runtime", teamRunId, "tasks")
}

function getTaskFilePath(baseDir: string, teamRunId: string, taskId: string): string {
  return join(getTasksDir(baseDir, teamRunId), `${taskId}.json`)
}

function getLockPath(baseDir: string, teamRunId: string): string {
  return join(getTasksDir(baseDir, teamRunId), ".lock")
}

/**
 * Atomic write with temp file + rename
 */
async function atomicWrite(filePath: string, content: string): Promise<void> {
  const tempPath = `${filePath}.tmp.${Date.now()}`
  try {
    await writeFile(tempPath, content, "utf8")
    await rename(tempPath, filePath)
  } catch (error) {
    try {
      await rm(tempPath, { force: true })
    } catch (cleanupErr) { console.debug("[tasklist] temp file cleanup failed:", cleanupErr instanceof Error ? cleanupErr.message : cleanupErr) }
    throw error
  }
}

/**
 * Simple file-based lock
 */
async function withLock<T>(lockPath: string, fn: () => Promise<T>): Promise<T> {
  await ensureDir(join(lockPath, ".."))
  const lockFile = `${lockPath}.lock`
  const startedAt = Date.now()
  const timeout = 15000
  const retryMs = 50

  while (Date.now() - startedAt < timeout) {
    try {
      await writeFile(lockFile, `${process.pid}\n${Date.now()}\n`, { flag: "wx" })
      break
    } catch (error: any) {
      if (error.code === "EEXIST") {
        // Check if lock is stale (older than threshold) and break it
        try {
          const lockContent = await readFile(lockFile, "utf8")
          const lockTimestamp = parseInt(lockContent.split("\n")[1], 10)
          if (!isNaN(lockTimestamp) && Date.now() - lockTimestamp > 30_000) {
            console.debug("[tasklist] Breaking stale lock:", lockFile)
            await rm(lockFile, { force: true })
            continue
          }
        } catch {
          // Lock file disappeared, retry
        }
        await new Promise(resolve => setTimeout(resolve, retryMs))
        continue
      }
      throw error
    }
  }

  if (Date.now() - startedAt >= timeout) {
    throw new Error(`Timed out acquiring lock: ${lockPath}`)
  }

  try {
    return await fn()
  } finally {
    try {
      await rm(lockFile, { force: true })
    } catch (cleanupErr) { console.debug("[tasklist] lock file cleanup failed:", cleanupErr instanceof Error ? cleanupErr.message : cleanupErr) }
  }
}

/**
 * Create a new task
 */
export async function createTask(
  teamRunId: string,
  taskInput: Omit<Task, "id" | "createdAt" | "updatedAt" | "version">,
  config: TasklistConfig,
): Promise<Task> {
  const tasksDir = getTasksDir(config.baseDir, teamRunId)
  await ensureDir(tasksDir)

  return withLock(getLockPath(config.baseDir, teamRunId), async () => {
    // Get next ID
    const watermarkPath = join(tasksDir, ".highwatermark")
    let nextId = 1
    try {
      const content = await readFile(watermarkPath, "utf8")
      const parsed = parseInt(content.trim(), 10)
      if (!isNaN(parsed) && parsed >= 1) {
        nextId = parsed + 1
      }
    } catch {
      // First task
    }
    await atomicWrite(watermarkPath, String(nextId))

    const now = Date.now()
    const task: Task = {
      version: 1,
      id: String(nextId),
      createdAt: now,
      updatedAt: now,
      ...taskInput,
    }

    await atomicWrite(
      getTaskFilePath(config.baseDir, teamRunId, task.id),
      JSON.stringify(task, null, 2) + "\n",
    )

    return task
  })
}

/**
 * Get a task by ID
 */
export async function getTask(
  teamRunId: string,
  taskId: string,
  config: TasklistConfig,
): Promise<Task | null> {
  const filePath = getTaskFilePath(config.baseDir, teamRunId, taskId)
  try {
    const content = await readFile(filePath, "utf8")
    return JSON.parse(content) as Task
  } catch (error: any) {
    if (error.code === "ENOENT") {
      return null
    }
    throw error
  }
}

/**
 * List tasks with optional filters
 */
export async function listTasks(
  teamRunId: string,
  config: TasklistConfig,
  filter?: { status?: TaskStatus; owner?: string },
): Promise<Task[]> {
  const tasksDir = getTasksDir(config.baseDir, teamRunId)

  try {
    const entries = await readdir(tasksDir, { withFileTypes: true })
    const tasks: Task[] = []

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name.startsWith(".")) {
        continue
      }

      try {
        const content = await readFile(join(tasksDir, entry.name), "utf8")
        const task = JSON.parse(content) as Task

        if (filter?.status && task.status !== filter.status) continue
        if (filter?.owner && task.owner !== filter.owner) continue

        tasks.push(task)
      } catch (readErr) {
        console.debug("[tasklist] Skipping malformed task:", readErr instanceof Error ? readErr.message : readErr)
      }
    }

    return tasks.sort((a, b) => a.createdAt - b.createdAt)
  } catch (error: any) {
    if (error.code === "ENOENT") {
      return []
    }
    throw error
  }
}

/**
 * Claim a task (atomic)
 */
export async function claimTask(
  teamRunId: string,
  taskId: string,
  owner: string,
  config: TasklistConfig,
): Promise<Task> {
  const tasksDir = getTasksDir(config.baseDir, teamRunId)

  return withLock(getLockPath(config.baseDir, teamRunId), async () => {
    const task = await getTask(teamRunId, taskId, config)
    if (!task) {
      throw new Error(`task ${taskId} not found`)
    }
    if (task.status !== "pending") {
      throw new Error(`task ${taskId} is not pending (status: ${task.status})`)
    }

    const now = Date.now()
    const updatedTask: Task = {
      ...task,
      status: "claimed",
      owner,
      updatedAt: now,
    }

    await atomicWrite(
      getTaskFilePath(config.baseDir, teamRunId, taskId),
      JSON.stringify(updatedTask, null, 2) + "\n",
    )

    return updatedTask
  })
}

/**
 * Update task status
 */
export async function updateTaskStatus(
  teamRunId: string,
  taskId: string,
  status: TaskStatus,
  config: TasklistConfig,
): Promise<Task> {
  return withLock(getLockPath(config.baseDir, teamRunId), async () => {
    const task = await getTask(teamRunId, taskId, config)
    if (!task) {
      throw new Error(`task ${taskId} not found`)
    }

    const now = Date.now()
    const updatedTask: Task = {
      ...task,
      status,
      updatedAt: now,
    }

    await atomicWrite(
      getTaskFilePath(config.baseDir, teamRunId, taskId),
      JSON.stringify(updatedTask, null, 2) + "\n",
    )

    return updatedTask
  })
}

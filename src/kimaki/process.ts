/**
 * Kimaki Process Manager
 *
 * Auto-starts and manages the Kimaki CLI process when enabled in config.
 * Handles spawn, health checks, restart, and graceful shutdown.
 */

import { spawn, type ChildProcess } from "child_process"
import type { KimakiConfig } from "./config"

interface KimakiProcessState {
  process: ChildProcess | null
  pid: number | null
  ready: boolean
  starting: boolean
  restartCount: number
  lastError: string | null
}

const state: KimakiProcessState = {
  process: null,
  pid: null,
  ready: false,
  starting: false,
  restartCount: 0,
  lastError: null,
}

const MAX_RESTARTS = 3
const HEALTH_CHECK_INTERVAL_MS = 2000
const HEALTH_CHECK_TIMEOUT_MS = 30_000
const STARTUP_TIMEOUT_MS = 60_000

/**
 * Resolve the Kimaki binary path from config or environment.
 */
function resolveKimakiBinary(config: KimakiConfig): string {
  // Priority: config path > KIMAKI_BIN env > kimaki-mimocode in PATH > npx
  const envBin = process.env.KIMAKI_BIN
  if (envBin) return envBin

  // Try kimaki-mimocode first, then kimaki, then npx fallback
  try {
    const { execFileSync } = require("child_process")
    const which = process.platform === "win32" ? "where" : "which"
    const result = execFileSync(which, ["kimaki-mimocode"], { encoding: "utf8", timeout: 3000 }).trim()
    if (result) return result
  } catch (e) { console.debug("[kimaki] kimaki-mimocode not found:", e instanceof Error ? e.message : e) }

  try {
    const { execFileSync } = require("child_process")
    const which = process.platform === "win32" ? "where" : "which"
    const result = execFileSync(which, ["kimaki"], { encoding: "utf8", timeout: 3000 }).trim()
    if (result) return result
  } catch (e) { console.debug("[kimaki] kimaki not found:", e instanceof Error ? e.message : e) }

  return "npx"
}

function resolveKimakiArgs(config: KimakiConfig, resolvedBinary: string): string[] {
  const envBin = process.env.KIMAKI_BIN
  if (envBin) {
    // Custom binary — pass through args from config
    return config.autoStart?.args ?? []
  }
  // Use the already-resolved binary to decide args
  if (resolvedBinary.includes("kimaki")) {
    // Direct binary — no npx needed
    return config.autoStart?.args ?? []
  }
  // npx fallback
  return ["-y", "kimaki-mimocode@latest", ...(config.autoStart?.args ?? [])]
}

/**
 * Check if Kimaki is already running by hitting its health endpoint.
 */
async function checkHealth(config: KimakiConfig): Promise<boolean> {
  try {
    const res = await fetch(`${config.connection.baseUrl}/health`, {
      signal: AbortSignal.timeout(5000),
    })
    const body = (await res.json().catch(() => null)) as { status?: string } | null
    return res.ok && body?.status === "ok"
  } catch {
    return false
  }
}

/**
 * Wait for Kimaki to become healthy after spawn.
 */
async function waitForHealth(config: KimakiConfig): Promise<boolean> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (await checkHealth(config)) return true
    await new Promise((r) => setTimeout(r, HEALTH_CHECK_INTERVAL_MS))
  }
  return false
}

/**
 * Build environment variables for the Kimaki process.
 *
 * SECURITY NOTE: Bot tokens and connection tokens are passed via environment
 * variables, which may be visible in process listings (e.g., /proc/PID/environ)
 * on shared systems. For production deployments, consider using a secrets
 * manager (e.g., HashiCorp Vault, cloud provider secret store) and injecting
 * secrets at runtime rather than storing them in config files or env vars.
 * Environment variables are acceptable here because Kimaki runs as a local
 * development tool, not a multi-tenant service.
 */
function buildEnv(config: KimakiConfig): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }

  // Pass bot credentials via env if configured
  if (config.bot?.token) {
    env.KIMAKI_BOT_TOKEN = config.bot.token
  }
  if (config.bot?.mode) {
    env.KIMAKI_BOT_MODE = config.bot.mode
  }
  if (config.connection.token) {
    env.KIMAKI_HRANA_TOKEN = config.connection.token
  }

  // Prevent recursive mimo serve spawning — kimaki-mimocode checks this
  // to skip launching its own mimo serve when spawned by the plugin
  env.KIMAKI_MIMO_PROCESS = "1"

  // Use a separate lock port to avoid conflicts with user's kimaki
  env.KIMAKI_LOCK_PORT = config.autoStart?.lockPort ?? "31099"

  // Data directory — default to ~/.kimaki
  if (config.autoStart?.dataDir) {
    env.KIMAKI_DATA_DIR = config.autoStart.dataDir
  }

  return env
}

/**
 * Check if Kimaki is already running by looking for kimaki processes.
 *
 * SECURITY NOTE: Uses `ps aux | grep` which is inherently racy and can
 * produce false positives if the grep command itself appears in the listing.
 * The `grep -v grep` filter mitigates this but isn't foolproof on all platforms.
 * For a more reliable check, consider using /proc/<pid>/cmdline on Linux or
 * process manager APIs. The health endpoint check (checkHealth) is the
 * preferred detection method — this is a fallback.
 */
async function isKimakiProcessRunning(): Promise<boolean> {
  try {
    const { execSync } = await import("child_process")
    // SECURITY: Use -- to prevent argument injection, and quote the pattern.
    // grep -v grep filters out our own grep process.
    const output = execSync("ps aux -- | grep -i 'kimaki' | grep -v grep", {
      encoding: "utf8",
      timeout: 3000,
      stdio: ["pipe", "pipe", "pipe"],
    })
    return output.trim().length > 0
  } catch {
    return false
  }
}

/**
 * Start the Kimaki process.
 */
export async function startKimaki(config: KimakiConfig): Promise<boolean> {
  if (state.starting || state.ready) return state.ready
  if (!config.autoStart?.enabled) return false

  // Already running externally?
  if (await checkHealth(config)) {
    state.ready = true
    state.pid = null // externally managed
    return true
  }

  // Check if kimaki process is already running (maybe started by user)
  if (await isKimakiProcessRunning()) {
    state.ready = true
    state.pid = null
    return true
  }

  state.starting = true
  state.lastError = null

  try {
    const binary = resolveKimakiBinary(config)
    const args = resolveKimakiArgs(config, binary)
    const env = buildEnv(config)

    // Use detached: true so kimaki gets its own process group. This prevents
    // SIGTERM from the parent mimo process from propagating to kimaki and its
    // children (mimo serve). Kimaki manages its own lifecycle independently —
    // bin.ts handles crash recovery and restart with exponential backoff.
    const proc = spawn(binary, args, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      shell: binary === "npx" ? false : undefined,
    })

    // Unref so the parent event loop can continue without waiting for kimaki.
    // Kimaki is a long-running service that outlives the plugin initialization.
    proc.unref()
    ;(proc.stdout as unknown as { unref(): void })?.unref()
    ;(proc.stderr as unknown as { unref(): void })?.unref()

    state.process = proc
    state.pid = proc.pid ?? null

    // Drain stdout to prevent pipe buffer fill-up (output is not used)
    proc.stdout?.on("data", () => {})

    // Capture stderr for diagnostics, but cap to prevent unbounded memory growth
    const MAX_STDERR_BYTES = 64 * 1024
    let stderr = ""
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString()
      if (stderr.length > MAX_STDERR_BYTES) {
        stderr = stderr.slice(-MAX_STDERR_BYTES)
      }
    })

    proc.on("error", (err) => {
      state.lastError = err.message
      state.ready = false
      state.starting = false
      state.process = null
      state.pid = null
    })

    proc.on("exit", (code, signal) => {
      state.ready = false
      state.starting = false
      state.process = null
      state.pid = null

      // Auto-restart on unexpected exit
      if (code !== 0 && signal !== "SIGTERM" && signal !== "SIGINT") {
        state.restartCount++
        if (state.restartCount <= MAX_RESTARTS) {
          setTimeout(() => startKimaki(config), 5000)
        }
      }
    })

    // Wait for health
    const healthy = await waitForHealth(config)
    if (healthy) {
      state.ready = true
      state.starting = false
      state.restartCount = 0
      return true
    }

    // Failed to start
    state.lastError = `Health check timed out. stderr: ${stderr.slice(-500)}`
    state.starting = false
    proc.kill("SIGTERM")
    state.process = null
    state.pid = null
    return false
  } catch (err: any) {
    state.lastError = err.message
    state.starting = false
    return false
  }
}

/**
 * Stop the Kimaki process gracefully.
 */
export async function stopKimaki(): Promise<void> {
  if (state.process) {
    state.process.kill("SIGTERM")
    // Wait up to 5s for graceful shutdown
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        state.process?.kill("SIGKILL")
        resolve()
      }, 5000)
      state.process?.on("exit", () => {
        clearTimeout(timeout)
        resolve()
      })
    })
  }
  state.process = null
  state.pid = null
  state.ready = false
  state.starting = false
}

/**
 * Get current process state.
 */
export function getKimakiProcessState(): {
  running: boolean
  ready: boolean
  pid: number | null
  restartCount: number
  lastError: string | null
} {
  return {
    running: state.process !== null,
    ready: state.ready,
    pid: state.pid,
    restartCount: state.restartCount,
    lastError: state.lastError,
  }
}

/**
 * Health check endpoint for the adapter.
 */
export { checkHealth as isKimakiHealthy }

/**
 * Todo Enforcer Hook
 *
 * Detects when an agent goes idle with incomplete tasks and forces
 * continuation by injecting a prompt. Includes cooldown and backoff logic.
 *
 * Source: Adapted from dev/oh-my-opencode/packages/omo-opencode/src/hooks/todo-continuation-enforcer/
 *
 * TODO: The actual prompt injection via the session API is not yet implemented.
 * Currently this hook only tracks cooldown state. Once the session API supports
 * prompt injection, wire up the CONTINUATION_PROMPT delivery here.
 */

interface TodoEnforcerConfig {
  enabled: boolean
  maxFailures: number
  cooldownMs: number
}

interface SessionState {
  failureCount: number
  lastInjection: number
  cooldownUntil: number
}

const sessionStates = new Map<string, SessionState>()

const CONTINUATION_PROMPT = `You have incomplete tasks. Continue working on the next unfinished item.
Do not stop until all tasks are complete or you encounter a blocking issue.
Output <promise>DONE</promise> when all tasks are complete.`

const MAX_CONSECUTIVE_FAILURES = 5
const COOLDOWN_MS = 30000
const EXPONENTIAL_BACKOFF_BASE = 2

const SESSION_EVICT_AGE_MS = 3600_000; // 1 hour

function evictStaleSessions(): void {
  const now = Date.now();
  for (const [id, s] of sessionStates) {
    if (s.lastInjection > 0 && now - s.lastInjection > SESSION_EVICT_AGE_MS) {
      sessionStates.delete(id);
    }
  }
}

export function createTodoEnforcerHook(config: TodoEnforcerConfig) {
  return async (event: any) => {
    if (!config.enabled) return

    evictStaleSessions();

    const eventType = event?.type ?? event?.event?.type ?? ""
    if (eventType !== "session.idle") return

    const sessionID = event?.sessionID ?? event?.event?.sessionID ?? ""
    if (!sessionID) return

    // Get or create session state
    let state = sessionStates.get(sessionID)
    if (!state) {
      state = { failureCount: 0, lastInjection: 0, cooldownUntil: 0 }
      sessionStates.set(sessionID, state)
    }

    // Check cooldown
    const now = Date.now()
    if (now < state.cooldownUntil) return

    // TODO: Check if there are incomplete tasks via the task registry API
    // and inject CONTINUATION_PROMPT when tasks remain unfinished.
    // For now, treat all idle events as incomplete (hook is not yet wired up)
    const hasIncompleteTasks = true

    if (!hasIncompleteTasks) {
      // Reset on clean idle (no incomplete tasks detected)
      state.failureCount = 0
      return
    }

    // Check if we've hit max consecutive failures
    if (state.failureCount >= (config.maxFailures ?? MAX_CONSECUTIVE_FAILURES)) {
      // Exponential backoff
      const backoffMs = COOLDOWN_MS * Math.pow(EXPONENTIAL_BACKOFF_BASE, state.failureCount - config.maxFailures)
      state.cooldownUntil = now + Math.min(backoffMs, 300000) // Max 5 min cooldown
      return
    }

    // Inject continuation prompt
    state.failureCount++
    state.lastInjection = now

    // Set cooldown
    state.cooldownUntil = now + (config.cooldownMs ?? COOLDOWN_MS)

    // TODO: Deliver CONTINUATION_PROMPT via the session API
  }
}

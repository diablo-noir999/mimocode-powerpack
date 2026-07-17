/**
 * Reactive Model Fallback Hook
 *
 * Detects model errors (429, 500-504, quota exceeded, model not found)
 * and switches to a fallback model with cooldown tracking.
 *
 * TODO: This hook tracks error patterns and cooldown state but does not
 * yet perform the actual model switch. The session API needs a method to
 * change the active model at runtime. Once available, wire up the fallback
 * selection logic here (e.g., iterate through a configured fallback list).
 *
 * Source: Adapted from dev/oh-my-opencode/packages/omo-opencode/src/hooks/runtime-fallback/
 */

interface FallbackState {
  failedModels: Map<string, { count: number; lastFailure: number; cooldownUntil: number }>
}

const state: FallbackState = {
  failedModels: new Map(),
}

const COOLDOWN_MS = 60000 // 1 minute cooldown per failed model
const MAX_FAILURES = 3 // Skip model after 3 consecutive failures

// Error patterns that trigger fallback
const FALLBACK_PATTERNS = [
  { pattern: /rate.?limit/i, type: "rate_limit" },
  { pattern: /429/i, type: "rate_limit" },
  { pattern: /quota.?exceeded/i, type: "quota" },
  { pattern: /model.?not.?found/i, type: "not_found" },
  { pattern: /invalid.?model/i, type: "not_found" },
  { pattern: /500|502|503|504/i, type: "server_error" },
  { pattern: /context.?length.?exceeded/i, type: "context_length" },
]

const EVICT_AGE_MS = 3600_000; // 1 hour

function evictStaleModels(): void {
  const now = Date.now();
  for (const [model, entry] of state.failedModels) {
    if (now - entry.lastFailure > EVICT_AGE_MS) {
      state.failedModels.delete(model);
    }
  }
}

export function createModelFallbackHook() {
  return async (event: any) => {
    const eventType = event?.type ?? event?.event?.type ?? ""
    if (eventType !== "session.error") return

    evictStaleModels();

    const error = event?.error ?? event?.event?.error
    if (!error) return

    const errorMessage = typeof error === "string" ? error : error?.message ?? ""
    if (!errorMessage) return

    // Classify the error
    let errorType = "unknown"
    for (const { pattern, type } of FALLBACK_PATTERNS) {
      if (pattern.test(errorMessage)) {
        errorType = type
        break
      }
    }

    // Only trigger fallback for retriable errors
    if (errorType === "unknown" || errorType === "context_length") return

    // Get current model from error context
    const model = error?.model ?? error?.modelID ?? "unknown"
    const now = Date.now()

    // Check if model is in cooldown
    const failed = state.failedModels.get(model)
    if (failed) {
      if (now < failed.cooldownUntil) {
        return
      }
      failed.count++
      failed.lastFailure = now
      failed.cooldownUntil = now + COOLDOWN_MS * Math.pow(2, failed.count - 1)
    } else {
      state.failedModels.set(model, {
        count: 1,
        lastFailure: now,
        cooldownUntil: now + COOLDOWN_MS,
      })
    }

    // Error tracked silently — cooldown state updated
    // TODO: Select and apply fallback model via session API when available
  }
}

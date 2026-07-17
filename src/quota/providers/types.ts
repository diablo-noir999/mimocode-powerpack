/**
 * Provider types for quota tracking.
 *
 * Adapted from dev/opencode-quota/src/lib/entries.ts
 */

import type { CursorQuotaPlan, OpenCodeGoWindowKey } from "../lib/types.js"

export interface ProviderQuota {
  provider: string
  name: string
  percentRemaining?: number
  resetAt?: number
  unlimited?: boolean
  error?: string
}

export interface GroupedQuotaEntryMeta {
  group?: string
  label?: string
  right?: string
}

export type QuotaToastEntry =
  | (GroupedQuotaEntryMeta & {
      kind?: "percent"
      name: string
      percentRemaining: number
      resetTimeIso?: string
    })
  | (GroupedQuotaEntryMeta & {
      kind: "value"
      name: string
      value: string
      resetTimeIso?: string
    })

export function isValueEntry(
  e: QuotaToastEntry,
): e is Extract<QuotaToastEntry, { kind: "value" }> {
  return e.kind === "value"
}

export function isPercentEntry(
  e: QuotaToastEntry,
): e is Extract<QuotaToastEntry, { percentRemaining: number }> {
  return !isValueEntry(e)
}

export interface QuotaToastError {
  label: string
  message: string
}

export interface QuotaProviderPresentation {
  singleWindowDisplayName?: string
  singleWindowShowRight?: boolean
  classicStrategy?: "preserve"
}

export interface QuotaProviderResult {
  attempted: boolean
  entries: QuotaToastEntry[]
  errors: QuotaToastError[]
  presentation?: QuotaProviderPresentation
}

export interface QuotaProviderMatchContext {
  enabledProviders: string[] | "auto"
}

export interface QuotaProviderContext {
  client: {
    config: {
      providers: () => Promise<{ data?: { providers: Array<{ id: string }> } }>
      get: () => Promise<{ data?: { model?: string } }>
    }
  }
  config: {
    googleModels: string[]
    anthropicBinaryPath?: string
    alibabaCodingPlanTier: "lite" | "pro"
    cursorPlan: CursorQuotaPlan
    cursorIncludedApiUsd?: number
    cursorBillingCycleStartDay?: number
    opencodeGoWindows?: OpenCodeGoWindowKey[]
    requestTimeoutMs?: number
    requestTimeoutMsConfigured?: boolean
    onlyCurrentModel?: boolean
    currentModel?: string
    currentProviderID?: string
    enabledProviders: string[] | "auto"
  }
}

export interface QuotaProvider {
  id: string
  isAvailable: (ctx: QuotaProviderContext) => Promise<boolean>
  fetch: (ctx: QuotaProviderContext) => Promise<QuotaProviderResult>
  matchesCurrentModel?: (model: string, context?: QuotaProviderMatchContext) => boolean
}

export function notAttemptedResult(): QuotaProviderResult {
  return { attempted: false, entries: [], errors: [] }
}

export function attemptedResult(
  entries: QuotaToastEntry[],
  errors: QuotaToastError[] = [],
  presentation?: QuotaProviderPresentation,
): QuotaProviderResult {
  return {
    attempted: true,
    entries,
    errors,
    ...(presentation ? { presentation } : {}),
  }
}

export function attemptedErrorResult(label: string, message: string): QuotaProviderResult {
  return attemptedResult([], [{ label, message }])
}

export function mapNullableProviderResult<TSuccess extends { success: true }>(
  result: TSuccess | { success: false; error: string } | null,
  params: {
    errorLabel: string
    onSuccess: (result: TSuccess) => QuotaProviderResult
  },
): QuotaProviderResult {
  if (!result) {
    return notAttemptedResult()
  }

  if (!result.success) {
    return attemptedErrorResult(params.errorLabel, result.error)
  }

  return params.onSuccess(result)
}

export function groupedPercentWindowEntries(params: {
  group: string
  windows: Array<{
    window?: {
      percentRemaining: number
      resetTimeIso?: string
    }
    suffix: string
    label: string
  }>
  fallbackWhenEmpty?: boolean
}): QuotaToastEntry[] {
  const entries: QuotaToastEntry[] = []

  for (const { window, suffix, label } of params.windows) {
    if (!window) continue

    entries.push({
      name: `${params.group} ${suffix}`,
      group: params.group,
      label,
      percentRemaining: window.percentRemaining,
      resetTimeIso: window.resetTimeIso,
    })
  }

  if (entries.length === 0 && params.fallbackWhenEmpty !== false) {
    entries.push({ name: params.group, percentRemaining: 0 })
  }

  return entries
}

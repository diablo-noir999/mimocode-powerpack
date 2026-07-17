/**
 * Quota Tracking Service
 *
 * Unified quota tracking across 22+ providers.
 * Source: Adapted from dev/opencode-quota/
 */

import { getProviders } from "./providers/index"
import type { QuotaProvider } from "./providers/types"

export interface ProviderQuota {
  provider: string
  name: string
  percentRemaining?: number
  resetAt?: number
  unlimited?: boolean
  error?: string
}

interface CachedQuota extends ProviderQuota {
  fetchedAt: number
}

export interface QuotaStatus {
  providers: ProviderQuota[]
  fetchedAt: number
}

export class QuotaService {
  private cache = new Map<string, CachedQuota>()
  private cacheExpiry = 300000 // 5 minutes
  private providers: Promise<QuotaProvider[]>

  constructor() {
    this.providers = getProviders()
  }

  async getQuota(provider: string): Promise<ProviderQuota | null> {
    // Check cache
    const cached = this.cache.get(provider)
    if (cached && Date.now() - cached.fetchedAt < this.cacheExpiry) {
      return cached
    }

    // Fetch from provider
    try {
      const quota = await this.fetchProviderQuota(provider)
      if (quota) {
        this.cache.set(provider, { ...quota, fetchedAt: Date.now() } as CachedQuota)
      }
      return quota
    } catch (error) {
      return {
        provider,
        name: provider,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async getAllQuotas(providers: string[]): Promise<QuotaStatus> {
    const results = await Promise.allSettled(
      providers.map((p) => this.getQuota(p))
    )

    return {
      providers: results
        .map((r) => (r.status === "fulfilled" ? r.value : null))
        .filter(Boolean) as ProviderQuota[],
      fetchedAt: Date.now(),
    }
  }

  async getAvailableProviders(): Promise<string[]> {
    const available: string[] = []
    const ctx = this.createProviderContext()
    const providers = await this.providers

    for (const provider of providers) {
      try {
        if (await provider.isAvailable(ctx)) {
          available.push(provider.id)
        }
      } catch {
        // Skip providers that error during availability check
      }
    }

    return available
  }

  async getAllQuotasAuto(): Promise<QuotaStatus> {
    const available = await this.getAvailableProviders()
    return this.getAllQuotas(available)
  }

  private createProviderContext(): any {
    return {
      client: { config: { providers: async () => ({ data: { providers: [] } }), get: async () => ({ data: {} }) } },
      config: {
        googleModels: ["CLAUDE"],
        anthropicBinaryPath: "claude",
        alibabaCodingPlanTier: "lite" as const,
        cursorPlan: "none" as const,
        requestTimeoutMs: 5000,
        enabledProviders: [] as string[] | "auto",
      },
    }
  }

  private async fetchProviderQuota(providerId: string): Promise<ProviderQuota | null> {
    const providers = await this.providers
    const provider = providers.find((p) => p.id === providerId)
    if (!provider) {
      return null
    }

    try {
      const ctx = this.createProviderContext()
      const result = await provider.fetch(ctx)
      if (!result.attempted || result.entries.length === 0) {
        return null
      }

      // Convert first entry to ProviderQuota format
      const entry = result.entries[0]
      const percentRemaining = "percentRemaining" in entry ? entry.percentRemaining : undefined
      return {
        provider: providerId,
        name: entry.name,
        percentRemaining,
      }
    } catch (error) {
      return {
        provider: providerId,
        name: providerId,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
}

export const quotaService = new QuotaService()

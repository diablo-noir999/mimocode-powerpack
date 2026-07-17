/**
 * MiMo provider (special addition to mimocode-powerpack).
 *
 * This provider is not in opencode-quota but is added for MiMo integration.
 */

import type {
  QuotaProvider,
  QuotaProviderContext,
  QuotaProviderResult,
} from "./types.js"
import { attemptedResult, notAttemptedResult } from "./types.js"

export const mimoProvider: QuotaProvider = {
  id: "mimo",

  async isAvailable(_ctx: QuotaProviderContext): Promise<boolean> {
    return !!(
      process.env.MIMO_API_KEY ||
      process.env.MIMO_API_TOKEN
    )
  },

  async fetch(_ctx: QuotaProviderContext): Promise<QuotaProviderResult> {
    return attemptedResult([
      {
        name: "MiMo Free Tier",
        group: "MiMo",
        label: "Status:",
        percentRemaining: 100,
      },
    ])
  },

  matchesCurrentModel(model: string): boolean {
    return model.toLowerCase().startsWith("mimo/")
  },
}

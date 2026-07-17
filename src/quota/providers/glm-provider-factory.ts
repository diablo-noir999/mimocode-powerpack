/**
 * GLM-style provider factory.
 *
 * Shared provider wrapper for Z.ai and Zhipu, which have identical structure
 * with different provider IDs, auth modules, and model matching.
 */

import type { QuotaProvider, QuotaProviderContext, QuotaProviderResult } from "./types.js";
import { isCanonicalProviderAvailable } from "../lib/provider-availability.js";
import {
  attemptedResult,
  groupedPercentWindowEntries,
  mapNullableProviderResult,
} from "./result-helpers.js";

export type GlmQuotaSuccess = {
  success: true;
  label: string;
  windows: {
    fiveHour?: { percentRemaining: number; resetTimeIso?: string };
    weekly?: { percentRemaining: number; resetTimeIso?: string };
    mcp?: { percentRemaining: number; resetTimeIso?: string };
  };
};

export type GlmQuotaResult = GlmQuotaSuccess | { success: false; error: string } | null;

export interface GlmProviderConfig {
  /** Provider ID (e.g. "zai", "zhipu") */
  id: string;
  /** Display label for errors (e.g. "Z.ai", "Zhipu") */
  errorLabel: string;
  /** Function to check if provider is available */
  isAvailable: (ctx: QuotaProviderContext) => Promise<boolean>;
  /** Function to match current model */
  matchesCurrentModel: (model: string) => boolean;
  /** Function to query quota */
  fetchQuota: (ctx: QuotaProviderContext) => Promise<GlmQuotaResult>;
}

export function createGlmProvider(config: GlmProviderConfig): QuotaProvider {
  return {
    id: config.id,

    async isAvailable(ctx: QuotaProviderContext): Promise<boolean> {
      return config.isAvailable(ctx);
    },

    matchesCurrentModel(model: string): boolean {
      return config.matchesCurrentModel(model);
    },

    async fetch(ctx: QuotaProviderContext): Promise<QuotaProviderResult> {
      const result = await config.fetchQuota(ctx);

      return mapNullableProviderResult(result, {
        errorLabel: config.errorLabel,
        onSuccess: (result) =>
          attemptedResult(
            groupedPercentWindowEntries({
              group: result.label,
              windows: [
                { window: result.windows.fiveHour, suffix: "5h", label: "5h:" },
                { window: result.windows.weekly, suffix: "Weekly", label: "Weekly:" },
                { window: result.windows.mcp, suffix: "MCP", label: "MCP:" },
              ],
            }),
            [],
            {
              singleWindowDisplayName: result.label,
            },
          ),
      });
    },
  };
}

/**
 * Chutes AI provider wrapper.
 */

import type { QuotaProvider, QuotaProviderContext, QuotaProviderResult } from "./types.js";
import { queryChutesQuota, hasChutesApiKeyConfigured } from "../lib/chutes.js";
import { isCanonicalProviderAvailable } from "../lib/provider-availability.js";
import { modelProviderIncludesAny } from "../lib/provider-model-matching.js";
import { attemptedResult, mapNullableProviderResult } from "./result-helpers.js";

export const chutesProvider: QuotaProvider = {
  id: "chutes",

  async isAvailable(ctx: QuotaProviderContext): Promise<boolean> {
    const providerAvailable = await isCanonicalProviderAvailable({
      ctx,
      providerId: "chutes",
      fallbackOnError: false,
    });
    if (providerAvailable) return true;

    return await hasChutesApiKeyConfigured();
  },

  matchesCurrentModel(model: string): boolean {
    return modelProviderIncludesAny(model, ["chutes"]);
  },

  async fetch(ctx: QuotaProviderContext): Promise<QuotaProviderResult> {
    const result = await queryChutesQuota({ requestTimeoutMs: ctx.config?.requestTimeoutMs });

    return mapNullableProviderResult(result, {
      errorLabel: "Chutes",
      onSuccess: (result) =>
        attemptedResult([
          {
            name: "Chutes",
            percentRemaining: result.percentRemaining,
            resetTimeIso: result.resetTimeIso,
          },
        ]),
    });
  },
};

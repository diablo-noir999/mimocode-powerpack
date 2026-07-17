/**
 * Z.ai provider wrapper.
 *
 * Normalizes Z.ai quota into generic toast entries.
 */

import type { QuotaProvider } from "./types.js";
import { queryZaiQuota } from "../lib/zai.js";
import { isCanonicalProviderAvailable } from "../lib/provider-availability.js";
import {
  DEFAULT_ZAI_AUTH_CACHE_MAX_AGE_MS,
  resolveZaiAuthCached,
} from "../lib/zai-auth.js";
import { createGlmProvider, type GlmQuotaResult } from "./glm-provider-factory.js";

export const zaiProvider: QuotaProvider = createGlmProvider({
  id: "zai",
  errorLabel: "Z.ai",

  async isAvailable(ctx) {
    const providerAvailable = await isCanonicalProviderAvailable({
      ctx,
      providerId: "zai",
      fallbackOnError: false,
    });
    if (!providerAvailable) return false;

    const auth = await resolveZaiAuthCached({
      maxAgeMs: DEFAULT_ZAI_AUTH_CACHE_MAX_AGE_MS,
    });
    return auth.state === "configured" || auth.state === "invalid";
  },

  matchesCurrentModel(model) {
    const lower = model.toLowerCase();
    const provider = lower.split("/")[0];
    if (provider && (provider.includes("zai") || provider.includes("glm"))) {
      return true;
    }
    return lower.includes("glm");
  },

  async fetchQuota(ctx): Promise<GlmQuotaResult> {
    return queryZaiQuota({ requestTimeoutMs: ctx.config?.requestTimeoutMs }) as Promise<GlmQuotaResult>;
  },
});

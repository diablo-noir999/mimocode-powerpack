/**
 * Zhipu provider wrapper.
 *
 * Normalizes Zhipu quota into generic toast entries.
 */

import type { QuotaProvider } from "./types.js";
import { queryZhipuQuota } from "../lib/zhipu.js";
import { isCanonicalProviderAvailable } from "../lib/provider-availability.js";
import {
  DEFAULT_ZHIPU_AUTH_CACHE_MAX_AGE_MS,
  resolveZhipuAuthCached,
} from "../lib/zhipu-auth.js";
import { createGlmProvider, type GlmQuotaResult } from "./glm-provider-factory.js";

export const zhipuProvider: QuotaProvider = createGlmProvider({
  id: "zhipu",
  errorLabel: "Zhipu",

  async isAvailable(ctx) {
    const providerAvailable = await isCanonicalProviderAvailable({
      ctx,
      providerId: "zhipu",
      fallbackOnError: false,
    });
    if (!providerAvailable) return false;

    const auth = await resolveZhipuAuthCached({
      maxAgeMs: DEFAULT_ZHIPU_AUTH_CACHE_MAX_AGE_MS,
    });
    return auth.state === "configured" || auth.state === "invalid";
  },

  matchesCurrentModel(model) {
    const lower = model.toLowerCase();
    const provider = lower.split("/")[0];
    return !!provider && (provider.includes("zhipu") || provider === "glm-coding-plan");
  },

  async fetchQuota(ctx): Promise<GlmQuotaResult> {
    return queryZhipuQuota({ requestTimeoutMs: ctx.config?.requestTimeoutMs }) as Promise<GlmQuotaResult>;
  },
});

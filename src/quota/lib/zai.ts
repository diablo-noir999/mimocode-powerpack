/**
 * Z.ai quota fetcher
 *
 * Uses OpenCode's auth.json (zai-coding-plan) and queries:
 * https://api.z.ai/api/monitor/usage/quota/limit
 */

import type { ZaiResult } from "./types.js";
import { resolveZaiAuthCached } from "./zai-auth.js";
import { createGlmQuotaQuery } from "./glm-quota-factory.js";

const queryZaiQuotaInner = createGlmQuotaQuery({
  label: "Z.ai",
  quotaUrl: "https://api.z.ai/api/monitor/usage/quota/limit",
  resolveAuth: resolveZaiAuthCached,
});

export async function queryZaiQuota(options: { requestTimeoutMs?: number } = {}): Promise<ZaiResult> {
  return queryZaiQuotaInner(options);
}

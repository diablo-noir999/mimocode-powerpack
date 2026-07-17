/**
 * Zhipu quota fetcher
 *
 * Uses OpenCode's auth.json (zhipu-coding-plan) and queries:
 * https://bigmodel.cn/api/monitor/usage/quota/limit
 */

import type { ZaiResult } from "./types.js";
import { resolveZhipuAuthCached } from "./zhipu-auth.js";
import { createGlmQuotaQuery } from "./glm-quota-factory.js";

const queryZhipuQuotaInner = createGlmQuotaQuery({
  label: "Zhipu",
  quotaUrl: "https://bigmodel.cn/api/monitor/usage/quota/limit",
  resolveAuth: resolveZhipuAuthCached,
});

export async function queryZhipuQuota(options: { requestTimeoutMs?: number } = {}): Promise<ZaiResult> {
  return queryZhipuQuotaInner(options);
}

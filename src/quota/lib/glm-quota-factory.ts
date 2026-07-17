/**
 * GLM-style quota query factory.
 *
 * Shared logic for Z.ai and Zhipu quota fetchers, which query the same
 * API shape with different endpoints and labels.
 */

import { clampPercent } from "./format-utils.js";
import { sanitizeDisplaySnippet, sanitizeDisplayText } from "./display-sanitize.js";
import { fetchWithTimeout } from "./http.js";
import type { ZaiQuotaLimit, ZaiResult } from "./types.js";

export interface GlmQuotaConfig {
  /** Display label for this provider (e.g. "Z.ai", "Zhipu") */
  label: string;
  /** Full URL of the quota API endpoint */
  quotaUrl: string;
  /** Auth resolver that returns the API key */
  resolveAuth: () => Promise<
    | { state: "none" }
    | { state: "configured"; apiKey: string }
    | { state: "invalid"; error: string }
  >;
}

type GlmQuotaApiResponse = {
  code?: number;
  msg?: unknown;
  data?: {
    limits?: ZaiQuotaLimit[] | null;
    level?: string;
  };
  limits?: ZaiQuotaLimit[] | null;
  success?: boolean;
};

/**
 * Parse the limit array from the API response (handles both response shapes).
 */
function parseLimitsFromResponse(data: unknown): ZaiQuotaLimit[] | null {
  const resp = data as GlmQuotaApiResponse;

  // Zhipu uses { data: { limits: [...] } }, Z.ai uses { data: { limits: [...] } } or { limits: [...] }
  const limits = resp.data?.limits ?? resp.limits;
  return Array.isArray(limits) ? limits : null;
}

/**
 * Check if the API response indicates an error.
 */
function checkResponseError(data: unknown): { error: true; message: string } | null {
  const resp = data as GlmQuotaApiResponse;
  if (resp.success === false || (typeof resp.code === "number" && resp.code >= 400)) {
    const msg = typeof resp.msg === "string" ? sanitizeDisplayText(resp.msg) : "";
    return {
      error: true,
      message: msg || (typeof resp.code === "number" ? `API error ${resp.code}` : "API error"),
    };
  }
  return null;
}

/**
 * Parse quota limits into the window structure used by both providers.
 */
function parseWindows(limits: ZaiQuotaLimit[]): {
  fiveHour?: { percentRemaining: number; resetTimeIso?: string };
  weekly?: { percentRemaining: number; resetTimeIso?: string };
  mcp?: { percentRemaining: number; resetTimeIso?: string };
} {
  let fiveHourWindow: { percentRemaining: number; resetTimeIso?: string } | undefined;
  let weeklyWindow: { percentRemaining: number; resetTimeIso?: string } | undefined;
  let mcpWindow: { percentRemaining: number; resetTimeIso?: string } | undefined;

  for (const limit of limits) {
    const percentRemaining = clampPercent(100 - limit.percentage);
    let resetTimeIso: string | undefined;

    if (limit.nextResetTime) {
      const ms = Math.round(limit.nextResetTime);
      if (Number.isFinite(ms) && ms > 0) {
        resetTimeIso = new Date(ms).toISOString();
      }
    }

    const window = { percentRemaining, resetTimeIso };

    if (limit.type === "TOKENS_LIMIT") {
      if (limit.unit === 3) {
        // unit 3 is the 5-hour token window (Standard Lite/Pro/Max).
        fiveHourWindow = window;
      } else if (limit.unit === 6) {
        // unit 6 is the weekly token window.
        weeklyWindow = window;
      } else if (limit.unit === 4) {
        // unit 4 is daily. Do not surface it as weekly in the current UI/report shape.
        continue;
      }
    } else if (limit.type === "TIME_LIMIT") {
      // TIME_LIMIT (unit 5) is typically the Monthly MCP limit
      mcpWindow = window;
    }
  }

  return { fiveHour: fiveHourWindow, weekly: weeklyWindow, mcp: mcpWindow };
}

/**
 * Create a quota query function for a GLM-style provider.
 */
export function createGlmQuotaQuery(config: GlmQuotaConfig) {
  return async function queryGlmQuota(options: { requestTimeoutMs?: number } = {}): Promise<ZaiResult> {
    const auth = await config.resolveAuth();
    if (auth.state === "none") return null;
    if (auth.state === "invalid") {
      return { success: false, error: auth.error };
    }

    try {
      const headers: Record<string, string> = {
        Authorization: auth.apiKey,
        "User-Agent": "OpenCode-Quota-Toast/1.0",
        "Content-Type": "application/json",
      };

      const resp = await fetchWithTimeout(config.quotaUrl, { headers }, options.requestTimeoutMs);
      if (!resp.ok) {
        const text = await resp.text();
        return {
          success: false,
          error: `${config.label} API error ${resp.status}: ${sanitizeDisplaySnippet(text, 120)}`,
        };
      }

      const data = await resp.json();
      const error = checkResponseError(data);
      if (error) {
        return {
          success: false,
          error: `${config.label} ${error.message}`,
        };
      }

      const limits = parseLimitsFromResponse(data);
      if (!limits) {
        return { success: false, error: "Invalid quota data" };
      }

      const windows = parseWindows(limits);

      return {
        success: true,
        label: config.label,
        windows,
      };
    } catch (err) {
      return {
        success: false,
        error: sanitizeDisplayText(err instanceof Error ? err.message : String(err)),
      };
    }
  };
}

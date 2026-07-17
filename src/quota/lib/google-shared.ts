/**
 * Shared Google OAuth/token infrastructure.
 *
 * Extracted from google.ts, google-agy.ts, google-gemini-cli.ts to eliminate
 * duplicated OAuth refresh, concurrency, and token-cache logic.
 */

import { fetchWithTimeout } from "./http.js";
import {
  getCachedAccessToken,
  makeAccountCacheKey,
  setCachedAccessToken,
} from "./google-token-cache.js";

// =============================================================================
// Shared Constants
// =============================================================================

export const GOOGLE_TOKEN_REFRESH_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_TOKEN_TIMEOUT_MS = 8_000;
export const GOOGLE_ACCOUNTS_CONCURRENCY = 3;

// =============================================================================
// Concurrency
// =============================================================================

/**
 * Run async operations with bounded concurrency.
 */
export async function mapWithConcurrency<T, R>(params: {
  items: T[];
  concurrency: number;
  fn: (item: T, index: number) => Promise<R>;
}): Promise<R[]> {
  const n = Math.max(1, Math.trunc(params.concurrency));
  const results = new Array<R>(params.items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(n, params.items.length) }, async () => {
    while (true) {
      const idx = nextIndex++;
      if (idx >= params.items.length) return;
      results[idx] = await params.fn(params.items[idx]!, idx);
    }
  });

  await Promise.all(workers);
  return results;
}

// =============================================================================
// OAuth Token Refresh
// =============================================================================

type TokenRefreshResult =
  | { accessToken: string; expiresIn: number }
  | { error: string };

/**
 * Refresh a Google OAuth access token using the standard token endpoint.
 */
export async function refreshAccessToken(params: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  timeoutMs?: number;
  tokenUrl?: string;
}): Promise<TokenRefreshResult> {
  try {
    const response = await fetchWithTimeout(
      params.tokenUrl ?? GOOGLE_TOKEN_REFRESH_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: params.clientId,
          client_secret: params.clientSecret,
          refresh_token: params.refreshToken,
          grant_type: "refresh_token",
        }),
      },
      params.timeoutMs ?? GOOGLE_TOKEN_TIMEOUT_MS,
    );

    if (!response.ok) {
      try {
        const errorData = (await response.json()) as {
          error?: string;
          error_description?: string;
        };
        if (errorData.error === "invalid_grant") {
          return { error: "Token revoked" };
        }
        return { error: errorData.error_description || `HTTP ${response.status}` };
      } catch {
        return { error: `HTTP ${response.status}` };
      }
    }

    const data = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };

    return {
      accessToken: data.access_token,
      expiresIn: data.expires_in,
    };
  } catch (err) {
    if (err instanceof Error && err.message.includes("timeout")) {
      return { error: "Token refresh timeout" };
    }
    return { error: "Token refresh failed" };
  }
}

// =============================================================================
// Cached Token Refresh
// =============================================================================

/**
 * Refresh an access token with persistent cache support.
 * Shared pattern for all Google provider variants.
 */
export async function refreshAccessTokenWithCache(params: {
  refreshToken: string;
  projectId: string;
  email?: string;
  clientId: string;
  clientSecret: string;
  skewMs?: number;
  force?: boolean;
  timeoutMs?: number;
  tokenUrl?: string;
  /** Optional: if the account already has a valid in-memory token, use it. */
  existingAccessToken?: string;
  existingExpiresAt?: number;
}): Promise<{ accessToken: string } | { error: string }> {
  const skewMs = params.skewMs ?? 2 * 60_000;
  const key = makeAccountCacheKey({
    refreshToken: params.refreshToken,
    projectId: params.projectId,
    email: params.email,
  });

  if (!params.force) {
    const cached = await getCachedAccessToken({ key, skewMs });
    if (cached) return { accessToken: cached.accessToken };

    // Use in-memory token from account if still valid
    if (
      params.existingAccessToken &&
      typeof params.existingExpiresAt === "number" &&
      params.existingExpiresAt > Date.now() + skewMs
    ) {
      return { accessToken: params.existingAccessToken };
    }
  }

  const refreshed = await refreshAccessToken({
    refreshToken: params.refreshToken,
    clientId: params.clientId,
    clientSecret: params.clientSecret,
    timeoutMs: params.timeoutMs,
    tokenUrl: params.tokenUrl,
  });
  if ("error" in refreshed) return refreshed;

  await setCachedAccessToken({
    key,
    entry: {
      accessToken: refreshed.accessToken,
      expiresAt: Date.now() + Math.max(1, refreshed.expiresIn) * 1000,
      projectId: params.projectId,
      email: params.email,
    },
  });

  return { accessToken: refreshed.accessToken };
}

/**
 * Execute a quota API call with one automatic auth-retry.
 *
 * All three Google providers follow the same pattern:
 * 1. Make the API call
 * 2. On auth error, refresh the token and retry once
 * 3. Return the response or error
 */
export async function executeWithAuthRetry<T>(params: {
  makeRequest: (accessToken: string) => Promise<T>;
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  projectId: string;
  email?: string;
  timeoutMs?: number;
  tokenUrl?: string;
}): Promise<T> {
  const { makeRequest, ...refreshParams } = params;

  // First attempt: use cached token (if any), then refresh
  const tokenResult = await refreshAccessTokenWithCache({
    ...refreshParams,
    skewMs: 0, // Always refresh for the first attempt
  });

  if ("error" in tokenResult) {
    throw new Error(tokenResult.error);
  }

  try {
    return await makeRequest(tokenResult.accessToken);
  } catch (err) {
    // One auth retry: refresh token then retry quota call
    if (err instanceof Error && err.message.includes("auth error")) {
      const retryToken = await refreshAccessToken({
        refreshToken: refreshParams.refreshToken,
        clientId: refreshParams.clientId,
        clientSecret: refreshParams.clientSecret,
        timeoutMs: refreshParams.timeoutMs,
        tokenUrl: refreshParams.tokenUrl,
      });
      if ("error" in retryToken) {
        throw new Error(retryToken.error);
      }

      // Update cache with fresh token
      const key = makeAccountCacheKey({
        refreshToken: refreshParams.refreshToken,
        projectId: refreshParams.projectId,
        email: refreshParams.email,
      });
      await setCachedAccessToken({
        key,
        entry: {
          accessToken: retryToken.accessToken,
          expiresAt: Date.now() + Math.max(1, retryToken.expiresIn) * 1000,
          projectId: refreshParams.projectId,
          email: refreshParams.email,
        },
      });

      return await makeRequest(retryToken.accessToken);
    }
    throw err;
  }
}

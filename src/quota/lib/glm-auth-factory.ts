/**
 * GLM-style auth resolver factory.
 *
 * Shared logic for Z.ai and Zhipu auth resolvers, which follow the same
 * pattern with different auth keys, provider keys, env vars, and labels.
 */

import {
  extractProviderOptionsApiKey,
  getApiKeyCheckedPaths,
  getFirstAuthEntryValue,
  getGlobalOpencodeConfigCandidatePaths,
  resolveApiKeyFromEnvAndConfig,
} from "./api-key-resolver.js";
import { sanitizeAuthValue } from "./display-sanitize.js";
import { getAuthPaths, readAuthFileCached } from "./opencode-auth.js";
import type { AuthData, ZaiAuthData } from "./types.js";

export interface GlmAuthConfig {
  /** Provider display name (e.g. "Z.ai", "Zhipu") */
  label: string;
  /** Auth keys to look up in auth.json */
  authKeys: readonly string[];
  /** Provider keys for config file lookup */
  providerKeys: readonly string[];
  /** Allowed environment variable names */
  allowedEnvVars: readonly string[];
  /** Environment variable mappings: { name, source } */
  envVars: readonly { name: string; source: string }[];
  /** Default cache max age in milliseconds */
  defaultCacheMaxAgeMs: number;
}

export type GlmKeySource =
  | string
  | "opencode.json"
  | "opencode.jsonc"
  | "auth.json";

export type ResolvedGlmAuth =
  | { state: "none" }
  | { state: "configured"; apiKey: string }
  | { state: "invalid"; error: string };

export type GlmAuthDiagnostics =
  | {
      state: "none";
      source: null;
      checkedPaths: string[];
      authPaths: string[];
    }
  | {
      state: "configured";
      source: GlmKeySource;
      checkedPaths: string[];
      authPaths: string[];
    }
  | {
      state: "invalid";
      source: "auth.json";
      checkedPaths: string[];
      authPaths: string[];
      error: string;
    };

export { getGlobalOpencodeConfigCandidatePaths as getOpencodeConfigCandidatePaths } from "./api-key-resolver.js";

function isGlmAuthData(value: unknown): value is ZaiAuthData {
  return value !== null && typeof value === "object";
}

const sanitizeGlmAuthValue = sanitizeAuthValue;

export function createGlmAuthResolver(config: GlmAuthConfig) {
  function getAuthEntry(auth: AuthData | null | undefined): unknown {
    return getFirstAuthEntryValue(auth, config.authKeys);
  }

  function resolveAuth(auth: AuthData | null | undefined): ResolvedGlmAuth {
    const entry = getAuthEntry(auth);
    if (entry === null || entry === undefined) {
      return { state: "none" };
    }

    if (!isGlmAuthData(entry)) {
      return { state: "invalid", error: `${config.label} auth entry has invalid shape` };
    }

    if (typeof entry.type !== "string") {
      return {
        state: "invalid",
        error: `${config.label} auth entry present but type is missing or invalid`,
      };
    }

    if (entry.type !== "api") {
      return {
        state: "invalid",
        error: `Unsupported ${config.label} auth type: "${sanitizeGlmAuthValue(entry.type)}"`,
      };
    }

    const key = typeof entry.key === "string" ? entry.key.trim() : "";
    if (!key) {
      return { state: "invalid", error: `${config.label} auth entry present but key is empty` };
    }

    return { state: "configured", apiKey: key };
  }

  async function resolveAuthWithSource(params?: {
    maxAgeMs?: number;
  }): Promise<{ auth: ResolvedGlmAuth; source: GlmKeySource | null }> {
    const resolvedFromEnvOrConfig = await resolveApiKeyFromEnvAndConfig<GlmKeySource>({
      envVars: config.envVars as { name: string; source: GlmKeySource }[],
      extractFromConfig: (c) =>
        extractProviderOptionsApiKey(c, {
          providerKeys: config.providerKeys,
          allowedEnvVars: config.allowedEnvVars,
        }),
      configJsonSource: "opencode.json",
      configJsoncSource: "opencode.jsonc",
      getConfigCandidates: getGlobalOpencodeConfigCandidatePaths,
    });

    if (resolvedFromEnvOrConfig) {
      return {
        auth: { state: "configured", apiKey: resolvedFromEnvOrConfig.key },
        source: resolvedFromEnvOrConfig.source,
      };
    }

    const maxAgeMs = Math.max(0, params?.maxAgeMs ?? config.defaultCacheMaxAgeMs);
    const authData = await readAuthFileCached({ maxAgeMs });
    const auth = resolveAuth(authData);

    return {
      auth,
      source: auth.state === "none" ? null : "auth.json",
    };
  }

  async function resolveAuthCached(params?: {
    maxAgeMs?: number;
  }): Promise<ResolvedGlmAuth> {
    return (await resolveAuthWithSource(params)).auth;
  }

  async function getAuthDiagnostics(params?: {
    maxAgeMs?: number;
  }): Promise<GlmAuthDiagnostics> {
    const { auth, source } = await resolveAuthWithSource(params);
    const checkedPaths = getApiKeyCheckedPaths({
      envVarNames: [...config.allowedEnvVars],
      getConfigCandidates: getGlobalOpencodeConfigCandidatePaths,
    });
    const authPaths = getAuthPaths();

    if (auth.state === "none") {
      return {
        state: "none",
        source: null,
        checkedPaths,
        authPaths,
      };
    }

    if (auth.state === "invalid") {
      return {
        state: "invalid",
        source: "auth.json",
        checkedPaths,
        authPaths,
        error: auth.error,
      };
    }

    return {
      state: "configured",
      source: source ?? "auth.json",
      checkedPaths,
      authPaths,
    };
  }

  return {
    resolveAuth,
    resolveAuthCached,
    getAuthDiagnostics,
  };
}

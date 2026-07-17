/**
 * Provider API key config factory.
 *
 * Shared boilerplate for provider config modules (chutes-config, deepseek-auth,
 * nanogpt-config) that use `createProviderApiKeyResolver` with the same pattern.
 */

import { getAuthPaths, readAuthFile } from "./opencode-auth.js";
import {
  createProviderApiKeyResolver,
  getGlobalOpencodeConfigCandidatePaths,
} from "./api-key-resolver.js";

export interface ProviderApiKeyFactoryConfig {
  /** Provider name for type generation (e.g. "chutes", "deepseek", "nanoGpt") */
  providerName: string;
  /** Environment variable mappings: { name, source } */
  envVars: readonly { name: string; source: string }[];
  /** Allowed environment variable names */
  allowedEnvVars: readonly string[];
  /** Provider keys for config file lookup */
  providerKeys: readonly string[];
}

export interface ProviderApiKeyModule<Source extends string> {
  resolveApiKey: () => Promise<{ key: string; source: Source } | null>;
  hasApiKey: () => Promise<boolean>;
  getKeyDiagnostics: () => Promise<{
    configured: boolean;
    source: Source | null;
    checkedPaths: string[];
    authPaths: string[];
  }>;
  getOpencodeConfigCandidatePaths: typeof getGlobalOpencodeConfigCandidatePaths;
}

/**
 * Create a provider API key module with the standard resolve/has/diagnostics pattern.
 */
export function createProviderApiKeyModule<Source extends string>(
  config: ProviderApiKeyFactoryConfig,
): ProviderApiKeyModule<Source> {
  const resolver = createProviderApiKeyResolver<Source>({
    envVars: config.envVars as { name: string; source: Source }[],
    providerKeys: config.providerKeys,
    allowedEnvVars: config.allowedEnvVars,
    configJsonSource: "opencode.json" as Source,
    configJsoncSource: "opencode.jsonc" as Source,
    getConfigCandidates: getGlobalOpencodeConfigCandidatePaths,
    auth: {
      readAuth: readAuthFile,
      authSource: "auth.json" as Source,
    },
  });

  return {
    resolveApiKey: () => resolver.resolve(),
    hasApiKey: () => resolver.has(),
    getKeyDiagnostics: async () => ({
      ...(await resolver.diagnostics()),
      authPaths: getAuthPaths(),
    }),
    getOpencodeConfigCandidatePaths: getGlobalOpencodeConfigCandidatePaths,
  };
}

export { getGlobalOpencodeConfigCandidatePaths as getOpencodeConfigCandidatePaths } from "./api-key-resolver.js";

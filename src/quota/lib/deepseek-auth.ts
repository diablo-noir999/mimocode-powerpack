import { createProviderApiKeyModule } from "./provider-api-key-factory.js";

export interface DeepSeekApiKeyResult {
  key: string;
  source: DeepSeekKeySource;
}

export type DeepSeekKeySource =
  | "env:DEEPSEEK_API_KEY"
  | "opencode.json"
  | "opencode.jsonc"
  | "auth.json";

export { getGlobalOpencodeConfigCandidatePaths as getOpencodeConfigCandidatePaths } from "./api-key-resolver.js";

const deepseekModule = createProviderApiKeyModule<DeepSeekKeySource>({
  providerName: "deepseek",
  envVars: [{ name: "DEEPSEEK_API_KEY", source: "env:DEEPSEEK_API_KEY" }],
  providerKeys: ["deepseek"],
  allowedEnvVars: ["DEEPSEEK_API_KEY"],
});

export async function resolveDeepSeekApiKey(): Promise<DeepSeekApiKeyResult | null> {
  return deepseekModule.resolveApiKey();
}

export async function hasDeepSeekApiKey(): Promise<boolean> {
  return deepseekModule.hasApiKey();
}

export async function getDeepSeekKeyDiagnostics(): Promise<{
  configured: boolean;
  source: DeepSeekKeySource | null;
  checkedPaths: string[];
  authPaths: string[];
}> {
  return deepseekModule.getKeyDiagnostics();
}

import { createProviderApiKeyModule } from "./provider-api-key-factory.js";

export interface ChutesApiKeyResult {
  key: string;
  source: ChutesKeySource;
}

export type ChutesKeySource =
  | "env:CHUTES_API_KEY"
  | "opencode.json"
  | "opencode.jsonc"
  | "auth.json";

export { getGlobalOpencodeConfigCandidatePaths as getOpencodeConfigCandidatePaths } from "./api-key-resolver.js";

const chutesModule = createProviderApiKeyModule<ChutesKeySource>({
  providerName: "chutes",
  envVars: [{ name: "CHUTES_API_KEY", source: "env:CHUTES_API_KEY" }],
  providerKeys: ["chutes"],
  allowedEnvVars: ["CHUTES_API_KEY"],
});

export async function resolveChutesApiKey(): Promise<ChutesApiKeyResult | null> {
  return chutesModule.resolveApiKey();
}

export async function hasChutesApiKey(): Promise<boolean> {
  return chutesModule.hasApiKey();
}

export async function getChutesKeyDiagnostics(): Promise<{
  configured: boolean;
  source: ChutesKeySource | null;
  checkedPaths: string[];
  authPaths: string[];
}> {
  return chutesModule.getKeyDiagnostics();
}

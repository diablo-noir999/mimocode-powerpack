import { createProviderApiKeyModule } from "./provider-api-key-factory.js";

export interface NanoGptApiKeyResult {
  key: string;
  source: NanoGptKeySource;
}

export type NanoGptKeySource =
  | "env:NANOGPT_API_KEY"
  | "env:NANO_GPT_API_KEY"
  | "opencode.json"
  | "opencode.jsonc"
  | "auth.json";

export { getGlobalOpencodeConfigCandidatePaths as getOpencodeConfigCandidatePaths } from "./api-key-resolver.js";

const nanoGptModule = createProviderApiKeyModule<NanoGptKeySource>({
  providerName: "nanogpt",
  envVars: [
    { name: "NANOGPT_API_KEY", source: "env:NANOGPT_API_KEY" },
    { name: "NANO_GPT_API_KEY", source: "env:NANO_GPT_API_KEY" },
  ],
  providerKeys: ["nanogpt", "nano-gpt"],
  allowedEnvVars: ["NANOGPT_API_KEY", "NANO_GPT_API_KEY"],
});

export async function resolveNanoGptApiKey(): Promise<NanoGptApiKeyResult | null> {
  return nanoGptModule.resolveApiKey();
}

export async function hasNanoGptApiKey(): Promise<boolean> {
  return nanoGptModule.hasApiKey();
}

export async function getNanoGptKeyDiagnostics(): Promise<{
  configured: boolean;
  source: NanoGptKeySource | null;
  checkedPaths: string[];
  authPaths: string[];
}> {
  return nanoGptModule.getKeyDiagnostics();
}

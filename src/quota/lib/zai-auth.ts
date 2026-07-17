import {
  getGlobalOpencodeConfigCandidatePaths,
} from "./api-key-resolver.js";
import type { AuthData, ZaiAuthData } from "./types.js";
import {
  createGlmAuthResolver,
  type ResolvedGlmAuth,
  type GlmAuthDiagnostics,
} from "./glm-auth-factory.js";

export const DEFAULT_ZAI_AUTH_CACHE_MAX_AGE_MS = 5_000;

export type ZaiKeySource =
  | "env:ZAI_API_KEY"
  | "env:ZAI_CODING_PLAN_API_KEY"
  | "opencode.json"
  | "opencode.jsonc"
  | "auth.json";

export type ResolvedZaiAuth = ResolvedGlmAuth;
export type ZaiAuthDiagnostics = GlmAuthDiagnostics;

export { getGlobalOpencodeConfigCandidatePaths as getOpencodeConfigCandidatePaths } from "./api-key-resolver.js";

const glmAuth = createGlmAuthResolver({
  label: "Z.ai",
  authKeys: ["zai-coding-plan"],
  providerKeys: ["zai", "zai-coding-plan", "glm"],
  allowedEnvVars: ["ZAI_API_KEY", "ZAI_CODING_PLAN_API_KEY"],
  envVars: [
    { name: "ZAI_API_KEY", source: "env:ZAI_API_KEY" },
    { name: "ZAI_CODING_PLAN_API_KEY", source: "env:ZAI_CODING_PLAN_API_KEY" },
  ],
  defaultCacheMaxAgeMs: DEFAULT_ZAI_AUTH_CACHE_MAX_AGE_MS,
});

export function resolveZaiAuth(auth: AuthData | null | undefined): ResolvedZaiAuth {
  return glmAuth.resolveAuth(auth);
}

export async function resolveZaiAuthCached(params?: {
  maxAgeMs?: number;
}): Promise<ResolvedZaiAuth> {
  return glmAuth.resolveAuthCached(params);
}

export async function getZaiAuthDiagnostics(params?: {
  maxAgeMs?: number;
}): Promise<ZaiAuthDiagnostics> {
  return glmAuth.getAuthDiagnostics(params);
}

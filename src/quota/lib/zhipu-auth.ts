import {
  getGlobalOpencodeConfigCandidatePaths,
} from "./api-key-resolver.js";
import type { AuthData, ZaiAuthData } from "./types.js";
import {
  createGlmAuthResolver,
  type ResolvedGlmAuth,
  type GlmAuthDiagnostics,
} from "./glm-auth-factory.js";

export const DEFAULT_ZHIPU_AUTH_CACHE_MAX_AGE_MS = 5_000;

export type ZhipuKeySource =
  | "env:ZHIPU_API_KEY"
  | "env:ZHIPU_CODING_PLAN_API_KEY"
  | "opencode.json"
  | "opencode.jsonc"
  | "auth.json";

export type ResolvedZhipuAuth = ResolvedGlmAuth;
export type ZhipuAuthDiagnostics = GlmAuthDiagnostics;

export { getGlobalOpencodeConfigCandidatePaths as getOpencodeConfigCandidatePaths } from "./api-key-resolver.js";

const glmAuth = createGlmAuthResolver({
  label: "Zhipu",
  authKeys: ["zhipu-coding-plan", "zhipuai-coding-plan"],
  providerKeys: [
    "zhipu",
    "zhipu-coding-plan",
    "zhipuai-coding-plan",
    "glm-coding-plan",
  ],
  allowedEnvVars: ["ZHIPU_API_KEY", "ZHIPU_CODING_PLAN_API_KEY"],
  envVars: [
    { name: "ZHIPU_API_KEY", source: "env:ZHIPU_API_KEY" },
    { name: "ZHIPU_CODING_PLAN_API_KEY", source: "env:ZHIPU_CODING_PLAN_API_KEY" },
  ],
  defaultCacheMaxAgeMs: DEFAULT_ZHIPU_AUTH_CACHE_MAX_AGE_MS,
});

export function resolveZhipuAuth(auth: AuthData | null | undefined): ResolvedZhipuAuth {
  return glmAuth.resolveAuth(auth);
}

export async function resolveZhipuAuthCached(params?: {
  maxAgeMs?: number;
}): Promise<ResolvedZhipuAuth> {
  return glmAuth.resolveAuthCached(params);
}

export async function getZhipuAuthDiagnostics(params?: {
  maxAgeMs?: number;
}): Promise<ZhipuAuthDiagnostics> {
  return glmAuth.getAuthDiagnostics(params);
}

/**
 * Gemini CLI companion resolver.
 *
 * Resolves OAuth client credentials from the opencode-gemini-auth package.
 */

import {
  createCompanionResolver,
  type CompanionPresence,
  type CompanionClientCredentials,
} from "./google-companion-factory.js";

const COMPANION_PACKAGE_NAME = "opencode-gemini-auth";

const resolver = createCompanionResolver({
  packageName: COMPANION_PACKAGE_NAME,
  clientIdName: "GEMINI_CLIENT_ID",
  clientSecretName: "GEMINI_CLIENT_SECRET",
  directCandidatePaths: [
    ["src", "constants.ts"],
    ["src", "constants.js"],
    ["dist", "src", "constants.js"],
    ["dist", "index.js"],
  ],
  missingError: `Install ${COMPANION_PACKAGE_NAME} separately to enable Gemini CLI quota`,
  invalidError: `Installed ${COMPANION_PACKAGE_NAME} package is incompatible`,
  handleScopedPackages: false,
  resolutionSteps: ["js-imports", "source-constants", "package-entry"],
});

// Re-export types for backward compatibility
export type GeminiCliCompanionPresence = CompanionPresence;
export type GeminiCliConfiguredCredentials = {
  state: "configured";
  clientId: string;
  clientSecret: string;
  resolvedPath: string;
};
export type GeminiCliClientCredentials = CompanionClientCredentials;

export async function inspectGeminiCliCompanionPresence(): Promise<GeminiCliCompanionPresence> {
  return resolver.inspectPresence();
}

export async function resolveGeminiCliClientCredentials(): Promise<GeminiCliClientCredentials> {
  return resolver.resolveClientCredentials();
}

export function clearGeminiCliCompanionCacheForTests(): void {
  resolver.clearCacheForTests();
}

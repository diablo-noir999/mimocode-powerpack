/**
 * Google Antigravity companion resolver.
 *
 * Resolves OAuth client credentials from the opencode-antigravity-auth package.
 */

import {
  createCompanionResolver,
  type CompanionPresence,
  type CompanionClientCredentials,
} from "./google-companion-factory.js";

const COMPANION_PACKAGE_NAME = "opencode-antigravity-auth";

const resolver = createCompanionResolver({
  packageName: COMPANION_PACKAGE_NAME,
  clientIdName: "ANTIGRAVITY_CLIENT_ID",
  clientSecretName: "ANTIGRAVITY_CLIENT_SECRET",
  directCandidatePaths: [
    ["dist", "src", "constants.js"],
    ["src", "constants.ts"],
    ["src", "constants.js"],
    ["dist", "index.js"],
  ],
  missingError: `Install ${COMPANION_PACKAGE_NAME} separately to enable Google Antigravity quota`,
  invalidError: `Installed ${COMPANION_PACKAGE_NAME} package is incompatible`,
  handleScopedPackages: false,
  resolutionSteps: ["js-imports", "runtime-paths", "source-constants", "package-json", "package-entry"],
});

// Re-export types for backward compatibility
export type GoogleAntigravityCompanionPresence = CompanionPresence;
export type GoogleAntigravityConfiguredCredentials = {
  state: "configured";
  clientId: string;
  clientSecret: string;
  resolvedPath: string;
};
export type GoogleAntigravityClientCredentials = CompanionClientCredentials;

export async function inspectAntigravityCompanionPresence(): Promise<GoogleAntigravityCompanionPresence> {
  return resolver.inspectPresence();
}

export async function resolveAntigravityClientCredentials(): Promise<GoogleAntigravityClientCredentials> {
  return resolver.resolveClientCredentials();
}

export function clearAntigravityCompanionCacheForTests(): void {
  resolver.clearCacheForTests();
}

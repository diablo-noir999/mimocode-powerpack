/**
 * Google AGY companion resolver.
 *
 * Resolves OAuth client credentials from the @anthonyhaussman/opencode-agy-auth package.
 */

import {
  createCompanionResolver,
  type CompanionPresence,
  type CompanionClientCredentials,
} from "./google-companion-factory.js";

const COMPANION_PACKAGE_NAME = "@anthonyhaussman/opencode-agy-auth";

const resolver = createCompanionResolver({
  packageName: COMPANION_PACKAGE_NAME,
  clientIdName: "AGY_CLIENT_ID",
  clientSecretName: "AGY_CLIENT_SECRET",
  directCandidatePaths: [
    ["src", "constants.ts"],
    ["src", "constants.js"],
    ["dist", "src", "constants.js"],
    ["dist", "index.js"],
  ],
  missingError: `Install ${COMPANION_PACKAGE_NAME} separately to enable Google AGY quota`,
  invalidError: `Installed ${COMPANION_PACKAGE_NAME} package is incompatible`,
  handleScopedPackages: true,
  resolutionSteps: ["js-imports", "source-constants", "package-entry"],
});

// Re-export types for backward compatibility
export type AgyCompanionPresence = CompanionPresence;
export type AgyConfiguredCredentials = {
  state: "configured";
  clientId: string;
  clientSecret: string;
  resolvedPath: string;
};
export type AgyClientCredentials = CompanionClientCredentials;

export async function inspectAgyCompanionPresence(): Promise<AgyCompanionPresence> {
  return resolver.inspectPresence();
}

export async function resolveAgyClientCredentials(): Promise<AgyClientCredentials> {
  return resolver.resolveClientCredentials();
}

export function clearAgyCompanionCacheForTests(): void {
  resolver.clearCacheForTests();
}

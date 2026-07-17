/**
 * Google companion resolution factory.
 *
 * Extracted from google-agy-companion.ts, google-antigravity-companion.ts,
 * google-gemini-cli-companion.ts to eliminate duplicated companion resolution logic.
 *
 * Each companion file resolves OAuth client credentials from a companion auth
 * package (e.g., opencode-antigravity-auth, opencode-gemini-auth). The resolution
 * strategy is parameterized: package name, credential variable names, candidate
 * paths, and resolution flow order.
 */

import { readFile } from "fs/promises";
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { getOpencodeRuntimeDirCandidates } from "./opencode-runtime-paths.js";

const require = createRequire(import.meta.url);

// =============================================================================
// Types
// =============================================================================

export interface CompanionConfig {
  /** NPM package name (e.g. "opencode-antigravity-auth", "@anthonyhaussman/opencode-agy-auth") */
  packageName: string;
  /** Exported constant name for client ID in the companion module (e.g. "AGY_CLIENT_ID") */
  clientIdName: string;
  /** Exported constant name for client secret in the companion module (e.g. "AGY_CLIENT_SECRET") */
  clientSecretName: string;
  /** Ordered list of relative paths to try when reading source constants */
  directCandidatePaths: readonly (readonly string[])[];
  /** Error message when the companion package is not installed */
  missingError: string;
  /** Error message when the companion package is installed but incompatible */
  invalidError: string;
  /** Whether to scan scoped packages in node_modules/@scope/ directories */
  handleScopedPackages: boolean;
  /**
   * Resolution flow order. Default: ["js-imports", "source-constants", "package-entry"]
   * antigravity uses: ["js-imports", "runtime-paths", "source-constants", "package-json", "package-entry"]
   */
  resolutionSteps: readonly (
    | "js-imports"
    | "source-constants"
    | "runtime-paths"
    | "package-json"
    | "package-entry"
  )[];
}

export type CompanionPresence =
  | { state: "present"; importSpecifier: string; resolvedPath: string }
  | { state: "missing"; importSpecifier: string; error: string }
  | { state: "invalid"; importSpecifier: string; error: string; resolvedPath?: string };

export type CompanionConfiguredCredentials = {
  state: "configured";
  clientId: string;
  clientSecret: string;
  resolvedPath: string;
};

export type CompanionClientCredentials =
  | CompanionConfiguredCredentials
  | { state: "missing" | "invalid"; error: string; resolvedPath?: string };

type ResolvedCompanionState = {
  presence: CompanionPresence;
  credentials: CompanionClientCredentials;
};

type CompanionModule = Record<string, unknown>;

type CompanionResolutionContext = {
  packageFound: boolean;
};

// =============================================================================
// Error Helpers
// =============================================================================

function isModuleNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? error.code : undefined;
  if (code === "MODULE_NOT_FOUND") return true;
  const message = error instanceof Error ? error.message : "";
  return message.includes("Cannot find module");
}

function isPackagePathNotExportedError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return "code" in error && error.code === "ERR_PACKAGE_PATH_NOT_EXPORTED";
}

function isFallthroughResolutionError(error: unknown): boolean {
  return isModuleNotFoundError(error) || isPackagePathNotExportedError(error);
}

function normalizeCredential(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// =============================================================================
// Path Resolution Helpers
// =============================================================================

function getCompanionResolvePaths(): string[] {
  return [...getOpencodeRuntimeDirCandidates().cacheDirs];
}

function getRuntimePackageRoots(packageName: string, handleScopedPackages: boolean): string[] {
  const cacheDirs = getOpencodeRuntimeDirCandidates().cacheDirs;
  const packageRoots = cacheDirs.map((cacheDir) =>
    join(cacheDir, "node_modules", packageName),
  );

  for (const cacheDir of cacheDirs) {
    try {
      const packagesDir = join(cacheDir, "packages");
      if (handleScopedPackages && packageName.startsWith("@")) {
        const [scope, name] = packageName.split("/");
        const scopeDir = join(packagesDir, scope);
        const entries = readdirSync(scopeDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && entry.name.startsWith(name!)) {
            const packagePath = join(scopeDir, entry.name);
            packageRoots.push(packagePath);
            packageRoots.push(join(packagePath, "node_modules", packageName));
          }
        }
      } else {
        const entries = readdirSync(packagesDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && entry.name.startsWith(packageName)) {
            packageRoots.push(join(packagesDir, entry.name));
            packageRoots.push(join(packagesDir, entry.name, "node_modules", packageName));
          }
        }
      }
    } catch {
      // Ignore if packages dir doesn't exist
    }
  }

  return packageRoots;
}

function getPackageCredentialPaths(packageRoot: string, candidatePaths: readonly (readonly string[])[]): string[] {
  return candidatePaths.map((parts) => join(packageRoot, ...parts));
}

function getRuntimeSourceConstantPaths(packageName: string, candidatePaths: readonly (readonly string[])[], handleScopedPackages: boolean): string[] {
  return getRuntimePackageRoots(packageName, handleScopedPackages)
    .flatMap((packageRoot) => getPackageCredentialPaths(packageRoot, candidatePaths));
}

function markPackageFoundForExportBlock(error: unknown, context: CompanionResolutionContext): void {
  if (isPackagePathNotExportedError(error)) {
    context.packageFound = true;
  }
}

function resolveCompanionSpecifier(specifier: string, context: CompanionResolutionContext): string {
  try {
    return require.resolve(specifier);
  } catch (error) {
    markPackageFoundForExportBlock(error, context);
    if (!isFallthroughResolutionError(error)) {
      throw error;
    }
    try {
      return require.resolve(specifier, { paths: getCompanionResolvePaths() });
    } catch (resolvePathsError) {
      markPackageFoundForExportBlock(resolvePathsError, context);
      throw resolvePathsError;
    }
  }
}

// =============================================================================
// State Builders
// =============================================================================

function buildConfiguredState(params: {
  importSpecifier: string;
  resolvedPath: string;
  clientId: string;
  clientSecret: string;
}): ResolvedCompanionState {
  return {
    presence: {
      state: "present",
      importSpecifier: params.importSpecifier,
      resolvedPath: params.resolvedPath,
    },
    credentials: {
      state: "configured",
      clientId: params.clientId,
      clientSecret: params.clientSecret,
      resolvedPath: params.resolvedPath,
    },
  };
}

function buildInvalidState(
  importSpecifier: string,
  invalidError: string,
  resolvedPath?: string,
): ResolvedCompanionState {
  return {
    presence: {
      state: "invalid",
      importSpecifier,
      ...(resolvedPath ? { resolvedPath } : {}),
      error: invalidError,
    },
    credentials: {
      state: "invalid",
      ...(resolvedPath ? { resolvedPath } : {}),
      error: invalidError,
    },
  };
}

// =============================================================================
// Credential Parsing
// =============================================================================

function parseSourceCredentials(
  content: string,
  clientIdName: string,
  clientSecretName: string,
): { clientId: string; clientSecret: string } | null {
  const clientId =
    content
      .match(new RegExp(`(?:export\\s+const|const|var)\\s+${clientIdName}\\s*=\\s*["']([^"']+)["']`))?.[1]
      ?.trim() ?? "";
  const clientSecret =
    content
      .match(new RegExp(`(?:export\\s+const|const|var)\\s+${clientSecretName}\\s*=\\s*["']([^"']+)["']`))?.[1]
      ?.trim() ?? "";

  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

// =============================================================================
// Resolution Strategies
// =============================================================================

async function tryReadSourceConstantsPath(
  resolvedPath: string,
  sourceImportSpecifier: string,
  clientIdName: string,
  clientSecretName: string,
  invalidError: string,
): Promise<ResolvedCompanionState | null> {
  try {
    const content = await readFile(resolvedPath, "utf8");
    const credentials = parseSourceCredentials(content, clientIdName, clientSecretName);
    if (!credentials) {
      return buildInvalidState(sourceImportSpecifier, invalidError, resolvedPath);
    }
    return buildConfiguredState({
      importSpecifier: sourceImportSpecifier,
      resolvedPath,
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
    });
  } catch {
    return null;
  }
}

function createIsMissingFileError() {
  return function isMissingFileError(error: unknown): boolean {
    if (!error || typeof error !== "object") return false;
    const code = "code" in error ? error.code : undefined;
    return code === "ENOENT" || code === "ENOTDIR";
  };
}

async function tryResolveJsConstants(
  importSpecifier: string,
  context: CompanionResolutionContext,
  clientIdName: string,
  clientSecretName: string,
  invalidError: string,
): Promise<ResolvedCompanionState | null> {
  let resolvedPath: string;
  try {
    resolvedPath = resolveCompanionSpecifier(importSpecifier, context);
  } catch (error) {
    if (isFallthroughResolutionError(error)) return null;
    return buildInvalidState(importSpecifier, invalidError);
  }

  let companionModule: CompanionModule;
  try {
    companionModule = (await import(pathToFileURL(resolvedPath).href)) as CompanionModule;
  } catch {
    return buildInvalidState(importSpecifier, invalidError, resolvedPath);
  }

  const clientId = normalizeCredential(companionModule[clientIdName]);
  const clientSecret = normalizeCredential(companionModule[clientSecretName]);
  if (!clientId || !clientSecret) {
    return buildInvalidState(importSpecifier, invalidError, resolvedPath);
  }

  return buildConfiguredState({ importSpecifier, resolvedPath, clientId, clientSecret });
}

async function tryResolveSourceConstants(
  config: CompanionConfig,
  context: CompanionResolutionContext,
): Promise<ResolvedCompanionState | null> {
  const sourceImportSpecifier = `${config.packageName}/src/constants.ts`;

  let resolvedPath: string;
  try {
    resolvedPath = require.resolve(sourceImportSpecifier);
  } catch (error) {
    if (!isFallthroughResolutionError(error)) {
      return buildInvalidState(sourceImportSpecifier, config.invalidError);
    }

    // Try runtime source constant paths
    for (const candidatePath of getRuntimeSourceConstantPaths(config.packageName, config.directCandidatePaths, config.handleScopedPackages)) {
      const runtimeResolved = await tryReadSourceConstantsPath(
        candidatePath, sourceImportSpecifier, config.clientIdName, config.clientSecretName, config.invalidError,
      );
      if (runtimeResolved) return runtimeResolved;
    }

    // Try via package.json
    try {
      const packageJsonPath = resolveCompanionSpecifier(`${config.packageName}/package.json`, context);
      const packageRoot = dirname(packageJsonPath);
      for (const candidatePath of [
        join(packageRoot, "src", "constants.ts"),
        join(packageRoot, "dist", "index.js"),
      ]) {
        const packageResolved = await tryReadSourceConstantsPath(
          candidatePath, sourceImportSpecifier, config.clientIdName, config.clientSecretName, config.invalidError,
        );
        if (packageResolved) return packageResolved;
      }
      resolvedPath = join(packageRoot, "src", "constants.ts");
    } catch (packageError) {
      if (isFallthroughResolutionError(packageError)) {
        return tryResolvePackageEntry(config, context);
      }
      return buildInvalidState(sourceImportSpecifier, config.invalidError);
    }
  }

  return (
    (await tryReadSourceConstantsPath(resolvedPath, sourceImportSpecifier, config.clientIdName, config.clientSecretName, config.invalidError)) ??
    buildInvalidState(sourceImportSpecifier, config.invalidError, resolvedPath)
  );
}

async function tryResolvePackageEntry(
  config: CompanionConfig,
  context: CompanionResolutionContext,
): Promise<ResolvedCompanionState | null> {
  const sourceImportSpecifier = `${config.packageName}/src/constants.ts`;
  try {
    const packageEntryPath = resolveCompanionSpecifier(config.packageName, context);
    const result = await tryReadSourceConstantsPath(
      packageEntryPath, sourceImportSpecifier, config.clientIdName, config.clientSecretName, config.invalidError,
    );
    return result ?? buildInvalidState(config.packageName, config.invalidError, packageEntryPath);
  } catch (error) {
    return isFallthroughResolutionError(error) ? null : buildInvalidState(config.packageName, config.invalidError);
  }
}

// Antigravity-specific: reads credentials directly from resolved paths
async function tryReadCredentialsPath(
  importSpecifier: string,
  resolvedPath: string,
  clientIdName: string,
  clientSecretName: string,
  invalidError: string,
): Promise<ResolvedCompanionState | null> {
  const isMissingFileError = createIsMissingFileError();
  let content: string;
  try {
    content = await readFile(resolvedPath, "utf8");
  } catch (error) {
    return isMissingFileError(error) ? null : buildInvalidState(importSpecifier, invalidError, resolvedPath);
  }

  const credentials = parseSourceCredentials(content, clientIdName, clientSecretName);
  if (!credentials) {
    return buildInvalidState(importSpecifier, invalidError, resolvedPath);
  }

  return buildConfiguredState({
    importSpecifier,
    resolvedPath,
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
  });
}

async function tryResolveRuntimePaths(
  config: CompanionConfig,
  context: CompanionResolutionContext,
): Promise<ResolvedCompanionState | null> {
  const sourceImportSpecifier = `${config.packageName}/src/constants.ts`;
  for (const candidatePath of getRuntimeSourceConstantPaths(config.packageName, config.directCandidatePaths, config.handleScopedPackages)) {
    const resolved = await tryReadCredentialsPath(
      sourceImportSpecifier, candidatePath, config.clientIdName, config.clientSecretName, config.invalidError,
    );
    if (resolved) return resolved;
  }
  return null;
}

async function tryResolveSourceConstantsDirect(
  config: CompanionConfig,
  context: CompanionResolutionContext,
): Promise<ResolvedCompanionState | null> {
  const sourceImportSpecifier = `${config.packageName}/src/constants.ts`;
  let resolvedPath: string;
  try {
    resolvedPath = resolveCompanionSpecifier(sourceImportSpecifier, context);
  } catch (error) {
    return isFallthroughResolutionError(error)
      ? null
      : buildInvalidState(sourceImportSpecifier, config.invalidError);
  }

  return (
    (await tryReadCredentialsPath(sourceImportSpecifier, resolvedPath, config.clientIdName, config.clientSecretName, config.invalidError)) ??
    buildInvalidState(sourceImportSpecifier, config.invalidError, resolvedPath)
  );
}

async function tryResolvePackageJson(
  config: CompanionConfig,
  context: CompanionResolutionContext,
): Promise<ResolvedCompanionState | null> {
  const packageJsonSpecifier = `${config.packageName}/package.json`;
  let packageJsonPath: string;
  try {
    packageJsonPath = resolveCompanionSpecifier(packageJsonSpecifier, context);
  } catch (error) {
    return isFallthroughResolutionError(error)
      ? null
      : buildInvalidState(packageJsonSpecifier, config.invalidError);
  }

  const packageRoot = dirname(packageJsonPath);
  for (const candidatePath of getPackageCredentialPaths(packageRoot, config.directCandidatePaths)) {
    const resolved = await tryReadCredentialsPath(
      packageJsonSpecifier, candidatePath, config.clientIdName, config.clientSecretName, config.invalidError,
    );
    if (resolved) return resolved;
  }

  return buildInvalidState(packageJsonSpecifier, config.invalidError, packageJsonPath);
}

// =============================================================================
// Main Resolution Pipeline
// =============================================================================

async function resolveCompanionState(config: CompanionConfig): Promise<ResolvedCompanionState> {
  const context: CompanionResolutionContext = { packageFound: false };
  const sourceImportSpecifier = `${config.packageName}/src/constants.ts`;
  const jsImportSpecifiers = [
    `${config.packageName}/dist/src/constants.js`,
    `${config.packageName}/src/constants.js`,
  ];

  for (const step of config.resolutionSteps) {
    switch (step) {
      case "js-imports": {
        for (const importSpecifier of jsImportSpecifiers) {
          const resolved = await tryResolveJsConstants(
            importSpecifier, context, config.clientIdName, config.clientSecretName, config.invalidError,
          );
          if (resolved) return resolved;
        }
        break;
      }
      case "source-constants": {
        const resolved = await tryResolveSourceConstants(config, context);
        if (resolved) return resolved;
        break;
      }
      case "runtime-paths": {
        const resolved = await tryResolveRuntimePaths(config, context);
        if (resolved) return resolved;
        break;
      }
      case "package-json": {
        const resolved = await tryResolvePackageJson(config, context);
        if (resolved) return resolved;
        break;
      }
      case "package-entry": {
        const resolved = await tryResolvePackageEntry(config, context);
        if (resolved) return resolved;
        break;
      }
    }
  }

  if (context.packageFound) {
    return buildInvalidState(config.packageName, config.invalidError);
  }

  return {
    presence: {
      state: "missing",
      importSpecifier: sourceImportSpecifier,
      error: config.missingError,
    },
    credentials: {
      state: "missing",
      error: config.missingError,
    },
  };
}

// =============================================================================
// Factory
// =============================================================================

export interface CompanionResolver {
  inspectPresence(): Promise<CompanionPresence>;
  resolveClientCredentials(): Promise<CompanionClientCredentials>;
  clearCacheForTests(): void;
}

export function createCompanionResolver(config: CompanionConfig): CompanionResolver {
  let resolvedStatePromise: Promise<ResolvedCompanionState> | null = null;

  async function getResolvedState(): Promise<ResolvedCompanionState> {
    if (!resolvedStatePromise) {
      resolvedStatePromise = resolveCompanionState(config);
    }
    return resolvedStatePromise;
  }

  return {
    async inspectPresence(): Promise<CompanionPresence> {
      const resolved = await getResolvedState();
      return resolved.presence;
    },

    async resolveClientCredentials(): Promise<CompanionClientCredentials> {
      const resolved = await getResolvedState();
      return resolved.credentials;
    },

    clearCacheForTests(): void {
      resolvedStatePromise = null;
    },
  };
}

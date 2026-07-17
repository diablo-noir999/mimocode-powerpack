/**
 * Result helper re-exports.
 *
 * All helpers are defined in ./types.js; this file re-exports them
 * for backward compatibility with provider files that import from here.
 */

export {
  notAttemptedResult,
  attemptedResult,
  attemptedErrorResult,
  mapNullableProviderResult,
  groupedPercentWindowEntries,
} from "./types.js"

export type {
  QuotaProviderPresentation,
  QuotaProviderResult,
  QuotaToastEntry,
  QuotaToastError,
} from "./types.js"

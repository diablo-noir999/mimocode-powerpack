/**
 * Shared constants for the powerpack plugin.
 *
 * Centralizes magic numbers so that every hook, memory module, and tool
 * shares the same named values and can be tuned from one place.
 */

/** Approximate characters per token (used for rough token estimation). */
export const CHARS_PER_TOKEN_ESTIMATE = 4

/** Maximum characters kept when pruning error content. */
export const MAX_ERROR_CONTENT_LENGTH = 500

/** Maximum directory levels walked when discovering nearby rule files. */
export const MAX_RULE_WALK_DEPTH = 5

/** Maximum individual rule file size (bytes) before it is skipped. */
export const MAX_RULE_FILE_SIZE = 10240

/** Maximum combined rules size (bytes) before truncation. */
export const MAX_COMBINED_RULES_SIZE = 4096

/** Minimum tool-output age (messages from end) before it becomes droppable. */
export const MIN_TOOL_OUTPUT_AGE = 10

/** Minimum age (messages from end) for stale ctx_reduce calls to be dropped. */
export const STALE_REDUCE_MIN_AGE = 5

/** Default cache TTL in milliseconds (5 minutes). */
export const CACHE_EXPIRY_MS = 300_000

/** Timeout for git status commands in milliseconds. */
export const GIT_STATUS_TIMEOUT_MS = 5000

/** Default embedding model for vector search. */
export const DEFAULT_EMBEDDING_MODEL = "onnx-community/granite-embedding-small-english-r2-ONNX"

/** Default embedding dimension (384 for granite-embedding-small-english-r2). */
export const EMBEDDING_DIMENSIONS = 384

/** Embedding model for code indexing (768-dim, ONNX community version). */
export const CODE_EMBEDDING_MODEL = "onnx-community/granite-embedding-english-r2-ONNX"

/** Embedding dimensions for code indexing. */
export const CODE_EMBEDDING_DIMENSIONS = 768

// --- Rules engine char budgets (from oh-my-opencode rules-engine) ---

/** Max chars for a single static rule before truncation. */
export const STATIC_RULE_MAX_CHARS = 12_000

/** Max chars for a single dynamic (per-file-matched) rule before truncation. */
export const DYNAMIC_RULE_MAX_CHARS = 4_000

/** Max chars for a single rule after compaction. */
export const POST_COMPACT_RULE_MAX_CHARS = 3_500

/** Max total chars for all static rules combined. */
export const STATIC_RULE_MAX_RESULT_CHARS = 40_000

/** Max total chars for all dynamic rules combined. */
export const DYNAMIC_RULE_MAX_RESULT_CHARS = 10_000

/** Max total chars for all rules after compaction. */
export const POST_COMPACT_MAX_RESULT_CHARS = 4_000

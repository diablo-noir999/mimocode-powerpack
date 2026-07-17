/**
 * Memory types — adapted from dev/opencode-magic-context memory types.
 * Simplified 5-category taxonomy for powerpack use.
 */

export type MemoryCategory =
  | "PROJECT_RULES"
  | "ARCHITECTURE"
  | "CONSTRAINTS"
  | "CONFIG_VALUES"
  | "NAMING"
  | "LESSONS_LEARNED"
  | "BUG_FIXES"
  | "USER_PREFERENCES";

export type MemoryStatus = "active" | "permanent" | "archived";
export type MemoryScope = "project" | "global";
export type MemorySourceType = "auto_capture" | "manual" | "session_promote";

/** Relative path from project root to the memory database file */
export const MEMORY_DB_RELATIVE_PATH = ".mimocode/memory.db";

/** Build the full path to the memory database for a given project */
export function getMemoryDbPath(projectPath: string): string {
  return `${projectPath}/${MEMORY_DB_RELATIVE_PATH}`;
}

export interface Memory {
  id: number;
  projectPath: string;
  category: MemoryCategory;
  content: string;
  normalizedHash: string;
  importance: number;
  scope: MemoryScope;
  sourceSessionId: string | null;
  sourceType: MemorySourceType;
  seenCount: number;
  retrievalCount: number;
  createdAt: number;
  updatedAt: number;
  lastSeenAt: number;
  lastRetrievedAt: number | null;
  status: MemoryStatus;
  expiresAt: number | null;
}

export interface MemoryInput {
  projectPath: string;
  category: MemoryCategory;
  content: string;
  importance?: number;
  sourceSessionId?: string;
  sourceType?: MemorySourceType;
  expiresAt?: number | null;
}

export interface SearchResult {
  memory: Memory;
  score: number;
  matchType: "fts" | "semantic" | "combined";
}

export const MEMORY_CATEGORIES: MemoryCategory[] = [
  "PROJECT_RULES",
  "ARCHITECTURE",
  "CONSTRAINTS",
  "CONFIG_VALUES",
  "NAMING",
  "LESSONS_LEARNED",
  "BUG_FIXES",
  "USER_PREFERENCES",
];

export const CATEGORY_DEFAULT_TTL: Partial<Record<MemoryCategory, number>> = {
  BUG_FIXES: 90 * 24 * 60 * 60 * 1000, // 90 days
  LESSONS_LEARNED: 60 * 24 * 60 * 60 * 1000, // 60 days
};

export const MEMORY_CATEGORY_ORDER_SQL = `CASE category ${MEMORY_CATEGORIES.map(
  (cat, i) => `WHEN '${cat}' THEN ${i}`,
).join(" ")} ELSE 99 END`;

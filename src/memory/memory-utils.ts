/**
 * Shared utilities for memory module.
 *
 * Row-to-Memory conversion shared between store and search.
 */

import type { Memory } from "./types";

export function rowToMemory(row: any): Memory {
  return {
    id: row.id,
    projectPath: row.project_path,
    category: row.category,
    content: row.content,
    normalizedHash: row.normalized_hash,
    importance: row.importance,
    scope: row.scope,
    sourceSessionId: row.source_session_id,
    sourceType: row.source_type,
    seenCount: row.seen_count,
    retrievalCount: row.retrieval_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSeenAt: row.last_seen_at,
    lastRetrievedAt: row.last_retrieved_at,
    status: row.status,
    expiresAt: row.expires_at,
  };
}

/**
 * Test: Memory System (store, search, hooks, decay, utils, message-utils)
 * Run: bun run test/test-memory.ts
 */

import { MemoryStore, computeNormalizedHash } from "../src/memory/store"
import { captureMemory, captureFromSession } from "../src/memory/hooks"
import { searchFTS, searchTFIDF, sanitizeFtsQuery, applyFeedbackWeight } from "../src/memory/search"
import { tier, shouldArchive, computeBudgetPressure, TIER_COST } from "../src/memory/decay"
import { rowToMemory } from "../src/memory/memory-utils"
import { isRecord, getToolName, getToolInput } from "../src/memory/message-utils"
import { getMemoryDbPath } from "../src/memory/types"
import type { MemoryCategory } from "../src/memory/types"
import { mkdirSync, rmSync } from "node:fs"

const TEST_DB_DIR = "/tmp/powerpack-test-memory"
const TEST_DB = `${TEST_DB_DIR}/test.db`

let passed = 0
let failed = 0

function assert(condition: boolean, msg: string) {
  if (condition) {
    passed++
    console.log(`  ✓ ${msg}`)
  } else {
    failed++
    console.log(`  ✗ ${msg}`)
  }
}

function assertEq(a: any, b: any, msg: string) {
  assert(a === b, `${msg} (got ${a}, expected ${b})`)
}

function section(name: string) {
  console.log(`\n--- ${name} ---`)
}

// Setup
mkdirSync(TEST_DB_DIR, { recursive: true })
rmSync(TEST_DB, { force: true })

section("MemoryStore CRUD")
const store = new MemoryStore(TEST_DB)

// Insert
const mem1 = store.insert({
  projectPath: "/test/project",
  category: "ARCHITECTURE",
  content: "The system uses a plugin architecture with hooks for extensibility",
  importance: 75,
  sourceType: "manual",
})
assert(mem1.id > 0, "insert returns memory with id")
assertEq(mem1.category, "ARCHITECTURE", "insert preserves category")
assertEq(mem1.content, "The system uses a plugin architecture with hooks for extensibility", "insert preserves content")
assertEq(mem1.importance, 75, "insert preserves importance")
assertEq(mem1.status, "active", "insert sets status to active")
assert(mem1.normalizedHash.length > 0, "insert computes normalized hash")

// Insert second memory
const mem2 = store.insert({
  projectPath: "/test/project",
  category: "BUG_FIXES",
  content: "Fixed a bug where the context analysis tool crashed on empty sessions",
  importance: 50,
})
assert(mem2.id > 0, "second insert works")
assertEq(mem2.category, "BUG_FIXES", "second memory category correct")

// GetById
const fetched = store.getById(mem1.id)
assert(fetched !== null, "getById returns memory")
assertEq(fetched!.id, mem1.id, "getById returns correct id")
assertEq(fetched!.category, "ARCHITECTURE", "getById returns correct category")

// GetById - nonexistent
const missing = store.getById(99999)
assert(missing === null, "getById returns null for missing id")

// GetByHash - same content should be found
const byHash = store.getByHash("/test/project", "ARCHITECTURE", "The system uses a plugin architecture with hooks for extensibility")
assert(byHash !== null, "getByHash finds existing content")
assertEq(byHash!.id, mem1.id, "getByHash returns correct memory")

// GetByHash - different content
const byHashMiss = store.getByHash("/test/project", "ARCHITECTURE", "completely different content")
assert(byHashMiss === null, "getByHash returns null for different content")

// GetByProject
const projectMems = store.getByProject("/test/project")
assert(projectMems.length === 2, `getByProject returns all memories (got ${projectMems.length})`)

// Count
const count = store.count("/test/project")
assertEq(count, 2, "count returns correct number")

// UpdateSeen
store.updateSeen(mem1.id)
const afterSeen = store.getById(mem1.id)
assert(afterSeen!.seenCount === 2, `updateSeen increments seen_count (got ${afterSeen!.seenCount})`)

// UpdateRetrieval
store.updateRetrieval(mem1.id)
const afterRetrieved = store.getById(mem1.id)
assert(afterRetrieved!.retrievalCount === 1, "updateRetrieval increments retrieval_count")

// UpdateStatus
store.updateStatus(mem1.id, "archived")
const afterArchive = store.getById(mem1.id)
assertEq(afterArchive!.status, "archived", "updateStatus changes status")

// Archive helper
store.updateStatus(mem2.id, "active") // reset
store.archive(mem2.id)
const afterArchiveHelper = store.getById(mem2.id)
assertEq(afterArchiveHelper!.status, "archived", "archive() sets status to archived")

// Delete
store.delete(mem1.id)
const afterDelete = store.getById(mem1.id)
assert(afterDelete === null, "delete removes memory")

// GetAll
const allMems = store.getAll("/test/project")
assertEq(allMems.length, 1, "getAll returns remaining memories")

section("MemoryStore Dedup")
// Insert same content twice - should detect dedup via hash
const dedup1 = store.insert({
  projectPath: "/test/dedup",
  category: "CONFIG_VALUES",
  content: "The API key should be stored in environment variables not in code",
  importance: 60,
})
const dedup2 = store.getByHash("/test/dedup", "CONFIG_VALUES", "The API key should be stored in environment variables not in code")
assert(dedup2 !== null, "dedup: getByHash finds first insert")
assertEq(dedup2!.id, dedup1.id, "dedup: same id returned")

section("MemoryStore Expiry")
const expMem = store.insert({
  projectPath: "/test/expiry",
  category: "BUG_FIXES",
  content: "This memory should expire after 90 days according to TTL config",
  importance: 50,
  expiresAt: Date.now() - 1000, // already expired
})
const expiredFetched = store.getByProject("/test/expiry")
assert(expiredFetched.length === 0, "expired memories not returned by getByProject")

// Prune expired — the expired memory above should be archived
const pruned = store.pruneExpired()
assert(pruned >= 1, `pruneExpired archives at least 1 expired memory (got ${pruned})`)

section("Memory Hooks - captureMemory")
const hookStore = new MemoryStore(`${TEST_DB_DIR}/hooks.db`)
const hookResult = captureMemory(hookStore, "/test/hooks", "This is a technical memory about the architecture pattern used in our system")
assert(hookResult.success, "captureMemory returns success")
assert(hookResult.memoryId! > 0, "captureMemory returns memory id")

// Dedup via captureMemory
const hookDup = captureMemory(hookStore, "/test/hooks", "This is a technical memory about the architecture pattern used in our system")
assert(hookDup.success, "captureMemory dedup returns success")
assertEq(hookDup.duplicate, true, "captureMemory detects duplicate")
assertEq(hookDup.memoryId, hookResult.memoryId, "captureMemory returns same id for duplicate")

// Auto-category detection
const autoCat = captureMemory(hookStore, "/test/hooks", "Discovered that the cache invalidation bug was caused by a race condition in the async handler")
assert(autoCat.success, "auto-category capture works")
const autoMem = hookStore.getById(autoCat.memoryId!)
assertEq(autoMem!.category, "BUG_FIXES", "auto-category detects BUG_FIXES from keywords")

// Too short content
const shortResult = captureMemory(hookStore, "/test/hooks", "short")
assert(!shortResult.success, "captureMemory rejects too-short content")

// Too long content
const longContent = "x".repeat(3000)
const longResult = captureMemory(hookStore, "/test/hooks", longContent)
assert(!longResult.success, "captureMemory rejects too-long content")

section("Memory Hooks - captureFromSession")
const sessionStore = new MemoryStore(`${TEST_DB_DIR}/session.db`)
const messages = [
  { role: "user", content: "How do we handle authentication in the API?" },
  { role: "assistant", content: "The system uses JWT tokens for authentication. The tokens are generated on login and verified on each request using middleware." },
  { role: "user", content: "What about refresh tokens?" },
  { role: "assistant", content: "Refresh tokens are stored in httpOnly cookies and rotated on each use. The old refresh token is invalidated when a new one is issued." },
]
const captured = captureFromSession(sessionStore, "/test/session", "test-session-1", messages)
assert(captured > 0, `captureFromSession captures memories (got ${captured})`)

const sessionMems = sessionStore.getAll("/test/session")
assert(sessionMems.length > 0, "captureFromSession stores memories")

section("Memory Search - FTS")
const searchStore = new MemoryStore(`${TEST_DB_DIR}/search.db`)
// Insert test data
const searchMems = [
  { category: "ARCHITECTURE" as MemoryCategory, content: "The plugin system uses a hook-based architecture for extensibility", importance: 80 },
  { category: "BUG_FIXES" as MemoryCategory, content: "Fixed memory leak in the WebSocket connection handler", importance: 60 },
  { category: "CONFIG_VALUES" as MemoryCategory, content: "Set MAX_RETRIES=3 for API calls with exponential backoff", importance: 50 },
  { category: "LESSONS_LEARNED" as MemoryCategory, content: "Discovered that Bun's SQLite FTS5 is faster than Node.js better-sqlite3", importance: 70 },
  { category: "PROJECT_RULES" as MemoryCategory, content: "Always use TypeScript strict mode in all new modules", importance: 90 },
]

for (const m of searchMems) {
  searchStore.insert({ projectPath: "/test/search", ...m })
}

// FTS search
const ftsResults = searchFTS(searchStore, "/test/search", "plugin architecture")
assert(ftsResults.length > 0, `FTS search finds results (got ${ftsResults.length})`)
assert(ftsResults[0].matchType === "fts", "FTS results have correct matchType")
assert(ftsResults[0].score > 0, "FTS scores are positive")

// FTS search - no results
const ftsNoResults = searchFTS(searchStore, "/test/search", "xyznonexistent")
assertEq(ftsNoResults.length, 0, "FTS returns empty for no matches")

// FTS query sanitization
const sanitized = sanitizeFtsQuery("hello world! (test)")
assert(sanitized.includes('"hello"'), "sanitizeFtsQuery wraps tokens in quotes")
assert(sanitized.includes('"world!"'), "sanitizeFtsQuery preserves special chars in quoted tokens")

// TF-IDF search
const tfidfResults = searchTFIDF(searchStore, "/test/search", "plugin system extensibility")
assert(tfidfResults.length > 0, `TF-IDF search finds results (got ${tfidfResults.length})`)
assert(tfidfResults[0].matchType === "semantic", "TF-IDF results have semantic matchType")

// TF-IDF search - no results
const tfidfNoResults = searchTFIDF(searchStore, "/test/search", "xyznonexistent")
assertEq(tfidfNoResults.length, 0, "TF-IDF returns empty for no matches")

section("Decay Math")
// Tier function
const t1 = tier(1, 50, 1.0)
assertEq(t1, 1, "tier(1, 50, 1.0) = 1 (newest)")

const t2 = tier(100, 50, 1.0)
assert(t2 >= 3, `tier(100, 50, 1.0) >= 3 (got ${t2})`)

// High importance should stay in higher tier longer
const highImp = tier(50, 90, 1.0)
const lowImp = tier(50, 10, 1.0)
assert(highImp <= lowImp, `high importance stays in higher tier (high:${highImp} <= low:${lowImp})`)

// ShouldArchive
const archive1 = shouldArchive(1, 50, 1.0)
assert(!archive1, "shouldArchive(1, 50, 1.0) = false (newest not archived)")

const archive100 = shouldArchive(200, 10, 1.0)
assert(archive100, "shouldArchive(200, 10, 1.0) = true (very old, low importance)")

// ComputeBudgetPressure
const pressure = computeBudgetPressure(
  [{ index: 1, importance: 50 }, { index: 2, importance: 50 }, { index: 3, importance: 50 }],
  1000,
)
assert(pressure > 0, `computeBudgetPressure returns positive (got ${pressure})`)
assert(pressure < 1, `computeBudgetPressure < 1 for reasonable budget (got ${pressure})`)

// TIER_COST has 6 entries (index 0 unused)
assertEq(TIER_COST.length, 6, "TIER_COST has 6 entries")
assertEq(TIER_COST[0], 0, "TIER_COST[0] = 0 (unused)")

section("MemoryStore getAll")
const allStore = new MemoryStore(`${TEST_DB_DIR}/all.db`)
for (let i = 0; i < 5; i++) {
  allStore.insert({
    projectPath: "/test/all",
    category: ["ARCHITECTURE", "BUG_FIXES", "CONFIG_VALUES"][i % 3] as MemoryCategory,
    content: `Memory item ${i} about the system architecture and design patterns used`,
    importance: 50 + i * 10,
  })
}
const allResults = allStore.getAll("/test/all")
assertEq(allResults.length, 5, "getAll returns all memories")

section("memory-utils: rowToMemory")
{
  const row = {
    id: 42,
    project_path: "/test/row",
    category: "ARCHITECTURE",
    content: "Test row conversion content",
    normalized_hash: "abc123",
    importance: 80,
    scope: "project",
    source_session_id: "sess-1",
    source_type: "manual",
    seen_count: 5,
    retrieval_count: 3,
    created_at: 1000000,
    updated_at: 2000000,
    last_seen_at: 1500000,
    last_retrieved_at: 1800000,
    status: "active",
    expires_at: 9999999,
  }
  const mem = rowToMemory(row)
  assertEq(mem.id, 42, "rowToMemory maps id")
  assertEq(mem.projectPath, "/test/row", "rowToMemory maps project_path")
  assertEq(mem.category, "ARCHITECTURE", "rowToMemory maps category")
  assertEq(mem.content, "Test row conversion content", "rowToMemory maps content")
  assertEq(mem.normalizedHash, "abc123", "rowToMemory maps normalized_hash")
  assertEq(mem.importance, 80, "rowToMemory maps importance")
  assertEq(mem.scope, "project", "rowToMemory maps scope")
  assertEq(mem.sourceSessionId, "sess-1", "rowToMemory maps source_session_id")
  assertEq(mem.sourceType, "manual", "rowToMemory maps source_type")
  assertEq(mem.seenCount, 5, "rowToMemory maps seen_count")
  assertEq(mem.retrievalCount, 3, "rowToMemory maps retrieval_count")
  assertEq(mem.createdAt, 1000000, "rowToMemory maps created_at")
  assertEq(mem.updatedAt, 2000000, "rowToMemory maps updated_at")
  assertEq(mem.lastSeenAt, 1500000, "rowToMemory maps last_seen_at")
  assertEq(mem.lastRetrievedAt, 1800000, "rowToMemory maps last_retrieved_at")
  assertEq(mem.status, "active", "rowToMemory maps status")
  assertEq(mem.expiresAt, 9999999, "rowToMemory maps expires_at")

  // Handle null optional fields
  const rowWithNulls = {
    ...row,
    source_session_id: null,
    expires_at: null,
    last_retrieved_at: null,
  }
  const memNulls = rowToMemory(rowWithNulls)
  assert(memNulls.sourceSessionId === null, "rowToMemory handles null source_session_id")
  assert(memNulls.expiresAt === null, "rowToMemory handles null expires_at")
  assert(memNulls.lastRetrievedAt === null, "rowToMemory handles null last_retrieved_at")
}

section("message-utils: isRecord")
{
  assert(isRecord({ key: "value" }), "isRecord returns true for plain object")
  assert(isRecord({}), "isRecord returns true for empty object")
  assert(!isRecord(null), "isRecord returns false for null")
  assert(!isRecord(undefined), "isRecord returns false for undefined")
  assert(!isRecord("string"), "isRecord returns false for string")
  assert(!isRecord(42), "isRecord returns false for number")
  assert(!isRecord([1, 2, 3]), "isRecord returns false for array")
  assert(!isRecord(true), "isRecord returns false for boolean")
}

section("message-utils: getToolName")
{
  // Direct message.name
  const msg1 = { name: "read", content: "file content" }
  assertEq(getToolName(msg1), "read", "getToolName extracts from message.name")

  // Direct message.tool
  const msg2 = { tool: "write", content: "file content" }
  assertEq(getToolName(msg2), "write", "getToolName extracts from message.tool")

  // From parts array with toolName
  const msg3 = {
    parts: [
      { toolName: "bash", state: {} },
    ],
  }
  assertEq(getToolName(msg3), "bash", "getToolName extracts from parts[].toolName")

  // From parts array with tool
  const msg4 = {
    parts: [
      { tool: "edit", state: {} },
    ],
  }
  assertEq(getToolName(msg4), "edit", "getToolName extracts from parts[].tool")

  // From parts array with name
  const msg5 = {
    parts: [
      { name: "grep", state: {} },
    ],
  }
  assertEq(getToolName(msg5), "grep", "getToolName extracts from parts[].name")

  // No tool info
  const msg6 = { content: "just text" }
  assertEq(getToolName(msg6), null, "getToolName returns null for message without tool")

  // Empty parts array
  const msg7 = { parts: [] }
  assertEq(getToolName(msg7), null, "getToolName returns null for empty parts")

  // Parts with non-record items
  const msg8 = { parts: ["string", 42, null] }
  assertEq(getToolName(msg8), null, "getToolName returns null for non-record parts")
}

section("message-utils: getToolInput")
{
  // From message.arguments
  const msg1 = { arguments: { path: "/tmp/test", content: "hello" } }
  const input1 = getToolInput(msg1)
  assert(input1 !== null, "getToolInput extracts from message.arguments")
  assertEq(input1!.path, "/tmp/test", "getToolInput arguments path correct")
  assertEq(input1!.content, "hello", "getToolInput arguments content correct")

  // From message.input
  const msg2 = { input: { file: "main.ts" } }
  const input2 = getToolInput(msg2)
  assert(input2 !== null, "getToolInput extracts from message.input")
  assertEq(input2!.file, "main.ts", "getToolInput input field correct")

  // From parts with state.input
  const msg3 = {
    parts: [
      { state: { input: { query: "search term" } } },
    ],
  }
  const input3 = getToolInput(msg3)
  assert(input3 !== null, "getToolInput extracts from parts[].state.input")
  assertEq(input3!.query, "search term", "getToolInput parts state.input correct")

  // From parts with args
  const msg4 = {
    parts: [
      { args: { flag: true } },
    ],
  }
  const input4 = getToolInput(msg4)
  assert(input4 !== null, "getToolInput extracts from parts[].args")
  assertEq(input4!.flag, true, "getToolInput parts args correct")

  // From parts with input
  const msg5 = {
    parts: [
      { input: { url: "https://example.com" } },
    ],
  }
  const input5 = getToolInput(msg5)
  assert(input5 !== null, "getToolInput extracts from parts[].input")
  assertEq(input5!.url, "https://example.com", "getToolInput parts input correct")

  // No tool input
  const msg6 = { content: "just text" }
  assertEq(getToolInput(msg6), null, "getToolInput returns null for message without input")

  // Non-record arguments
  const msg7 = { arguments: "not an object" }
  assertEq(getToolInput(msg7), null, "getToolInput returns null for non-record arguments")

  // Empty parts
  const msg8 = { parts: [] }
  assertEq(getToolInput(msg8), null, "getToolInput returns null for empty parts")
}

section("types: getMemoryDbPath")
{
  const dbPath = getMemoryDbPath("/home/user/project")
  assertEq(dbPath, "/home/user/project/.mimocode/memory.db", "getMemoryDbPath builds correct path")

  const dbPath2 = getMemoryDbPath(".")
  assertEq(dbPath2, "./.mimocode/memory.db", "getMemoryDbPath works with relative path")
}

section("MemoryStore: getDb()")
{
  const dbStore = new MemoryStore(`${TEST_DB_DIR}/getdb-test.db`)
  const db = dbStore.getDb()
  assert(db !== null, "getDb returns a database instance")
  assert(typeof db.prepare === "function", "getDb result has prepare method")
  assert(typeof db.exec === "function", "getDb result has exec method")

  // Use the raw db to verify data written by the store
  dbStore.insert({
    projectPath: "/test/getdb",
    category: "CONFIG_VALUES",
    content: "Database connection pool size should be set to 10 for production",
    importance: 60,
  })
  const rawRow = db.prepare("SELECT * FROM memories WHERE project_path = ?").get("/test/getdb") as any
  assert(rawRow !== undefined, "getDb raw query can read data written by store")
  assertEq(rawRow.category, "CONFIG_VALUES", "getDb raw query returns correct category")
}

section("MemoryStore: insertBatch")
{
  const batchStore = new MemoryStore(`${TEST_DB_DIR}/batch-test.db`)
  const entries = [
    { category: "ARCHITECTURE" as MemoryCategory, content: "Batch entry one about the system architecture and design patterns used" },
    { category: "BUG_FIXES" as MemoryCategory, content: "Batch entry two about a critical bug fix for the authentication module" },
    { category: "CONFIG_VALUES" as MemoryCategory, content: "Batch entry three with important configuration settings for production deployment" },
  ]
  const count = batchStore.insertBatch("/test/batch", "batch-session-1", entries)
  assertEq(count, 3, "insertBatch returns correct count")

  const batchMems = batchStore.getByProject("/test/batch")
  assertEq(batchMems.length, 3, "insertBatch inserts all entries")

  // Verify sourceType is session_promote
  assertEq(batchMems[0].sourceType, "session_promote", "insertBatch sets sourceType to session_promote")
  assertEq(batchMems[0].sourceSessionId, "batch-session-1", "insertBatch sets sourceSessionId correctly")
  assertEq(batchMems[0].importance, 50, "insertBatch uses default importance of 50")

  // Empty batch
  const emptyCount = batchStore.insertBatch("/test/batch", "batch-session-2", [])
  assertEq(emptyCount, 0, "insertBatch handles empty entries array")
}

section("MemoryStore: updateSeenBatch")
{
  const batchSeenStore = new MemoryStore(`${TEST_DB_DIR}/batch-seen-test.db`)
  const m1 = batchSeenStore.insert({
    projectPath: "/test/batchseen",
    category: "ARCHITECTURE",
    content: "Batch seen test memory one about the core module design and patterns",
    importance: 60,
  })
  const m2 = batchSeenStore.insert({
    projectPath: "/test/batchseen",
    category: "BUG_FIXES",
    content: "Batch seen test memory two about a regression in the parser module",
    importance: 70,
  })

  batchSeenStore.updateSeenBatch([m1.id, m2.id])

  const afterBatch1 = batchSeenStore.getById(m1.id)
  const afterBatch2 = batchSeenStore.getById(m2.id)
  assertEq(afterBatch1!.seenCount, 2, "updateSeenBatch increments seen_count for first memory")
  assertEq(afterBatch2!.seenCount, 2, "updateSeenBatch increments seen_count for second memory")

  // Batch update again
  batchSeenStore.updateSeenBatch([m1.id])
  const afterBatch2nd = batchSeenStore.getById(m1.id)
  assertEq(afterBatch2nd!.seenCount, 3, "updateSeenBatch increments again on second call")

  // Empty batch
  batchSeenStore.updateSeenBatch([])
  const noChange = batchSeenStore.getById(m2.id)
  assertEq(noChange!.seenCount, 2, "updateSeenBatch with empty array is no-op")
}

section("MemoryStore: getByHashBatch")
{
  const hashBatchStore = new MemoryStore(`${TEST_DB_DIR}/hashbatch-test.db`)
  hashBatchStore.insert({
    projectPath: "/test/hashbatch",
    category: "ARCHITECTURE",
    content: "Hash batch test entry one about event-driven architecture patterns",
    importance: 50,
  })
  hashBatchStore.insert({
    projectPath: "/test/hashbatch",
    category: "BUG_FIXES",
    content: "Hash batch test entry two about a critical security vulnerability fix",
    importance: 60,
  })

  const hash1 = computeNormalizedHash("Hash batch test entry one about event-driven architecture patterns")
  const hash2 = computeNormalizedHash("Hash batch test entry two about a critical security vulnerability fix")
  const hash3 = computeNormalizedHash("This content does not exist in the database")

  const existing = hashBatchStore.getByHashBatch(
    "/test/hashbatch",
    ["ARCHITECTURE", "BUG_FIXES", "ARCHITECTURE"],
    [hash1, hash2, hash3],
  )
  assertEq(existing.length, 2, "getByHashBatch finds existing hashes")
  assert(existing.includes(hash1), "getByHashBatch includes hash1")
  assert(existing.includes(hash2), "getByHashBatch includes hash2")
  assert(!existing.includes(hash3), "getByHashBatch excludes non-existent hash")
}

section("Typed Memory Payloads")
{
  const payloadStore = new MemoryStore(`${TEST_DB_DIR}/payload-test.db`)

  // QA payload
  const qaMem = payloadStore.insert({
    projectPath: "/test/payload",
    category: "LESSONS_LEARNED",
    content: "Q: How do we handle auth? A: JWT tokens with refresh rotation",
    payloadType: "qa",
    payload: { type: "qa", question: "How do we handle auth?", answer: "JWT tokens with refresh rotation", context: "API middleware", feedbackScore: 0.8 },
  })
  assertEq(qaMem.payloadType, "qa", "QA payload type stored correctly")
  assert(qaMem.payload !== null, "QA payload parsed correctly")
  assertEq((qaMem.payload as any).question, "How do we handle auth?", "QA payload question preserved")
  assertEq((qaMem.payload as any).feedbackScore, 0.8, "QA payload feedbackScore preserved")

  // Trace payload
  const traceMem = payloadStore.insert({
    projectPath: "/test/payload",
    category: "BUG_FIXES",
    content: "Token validation failed in middleware/auth.ts",
    payloadType: "trace",
    payload: { type: "trace", originFunction: "validateToken", status: "error", errorMessage: "Token expired" },
  })
  assertEq(traceMem.payloadType, "trace", "Trace payload type stored correctly")
  assertEq((traceMem.payload as any).status, "error", "Trace payload status preserved")
  assertEq((traceMem.payload as any).errorMessage, "Token expired", "Trace payload errorMessage preserved")

  // Feedback payload
  const feedbackMem = payloadStore.insert({
    projectPath: "/test/payload",
    category: "USER_PREFERENCES",
    content: "User prefers dark theme for IDE",
    payloadType: "feedback",
    payload: { type: "feedback", targetId: qaMem.id, score: 0.9, text: "Very helpful!" },
  })
  assertEq(feedbackMem.payloadType, "feedback", "Feedback payload type stored correctly")
  assertEq((feedbackMem.payload as any).score, 0.9, "Feedback payload score preserved")
  assertEq((feedbackMem.payload as any).targetId, qaMem.id, "Feedback payload targetId preserved")

  // Skill run payload
  const skillMem = payloadStore.insert({
    projectPath: "/test/payload",
    category: "ARCHITECTURE",
    content: "Ran the verify skill on the auth module",
    payloadType: "skill_run",
    payload: { type: "skill_run", skillName: "verify", taskText: "Check auth module", resultSummary: "All checks passed", successScore: 1.0, latencyMs: 1500 },
  })
  assertEq(skillMem.payloadType, "skill_run", "Skill run payload type stored correctly")
  assertEq((skillMem.payload as any).skillName, "verify", "Skill run payload skillName preserved")
  assertEq((skillMem.payload as any).latencyMs, 1500, "Skill run payload latencyMs preserved")

  // Retrieve and verify payload survives round-trip
  const retrieved = payloadStore.getById(qaMem.id)
  assert(retrieved !== null, "getById returns memory with payload")
  assertEq(retrieved!.payloadType, "qa", "getById preserves payloadType")
  assert((retrieved!.payload as any).question === "How do we handle auth?", "getById preserves payload content")

  // Memory without payload
  const plainMem = payloadStore.insert({
    projectPath: "/test/payload",
    category: "CONFIG_VALUES",
    content: "Standard memory without typed payload",
  })
  assertEq(plainMem.payloadType, null, "Plain memory has null payloadType")
  assertEq(plainMem.payload, null, "Plain memory has null payload")

  // Insert without payload fields works (backward compatible)
  const legacyMem = payloadStore.insert({
    projectPath: "/test/payload",
    category: "CONSTRAINTS",
    content: "Legacy memory inserted without payload fields",
  })
  assertEq(legacyMem.payloadType, null, "Legacy insert has null payloadType")
}

section("Feedback-Weighted Retrieval")
{
  // applyFeedbackWeight boosts positive feedback, reduces negative
  const positiveResult: SearchResult = {
    memory: {
      id: 1, projectPath: "/test", category: "LESSONS_LEARNED", content: "Positive memory",
      normalizedHash: "abc", importance: 50, scope: "project", sourceSessionId: null,
      sourceType: "manual", seenCount: 1, retrievalCount: 0, createdAt: 0, updatedAt: 0,
      lastSeenAt: 0, lastRetrievedAt: null, status: "active", expiresAt: null,
      payloadType: "feedback",
      payload: { type: "feedback", targetId: 1, score: 1.0 },
    },
    score: 1.0,
    matchType: "fts",
  }
  const weighted = applyFeedbackWeight([positiveResult])
  assert(weighted[0].score > 1.0, `Positive feedback boosts score (got ${weighted[0].score})`)

  const negativeResult: SearchResult = {
    memory: {
      id: 2, projectPath: "/test", category: "LESSONS_LEARNED", content: "Negative memory",
      normalizedHash: "def", importance: 50, scope: "project", sourceSessionId: null,
      sourceType: "manual", seenCount: 1, retrievalCount: 0, createdAt: 0, updatedAt: 0,
      lastSeenAt: 0, lastRetrievedAt: null, status: "active", expiresAt: null,
      payloadType: "feedback",
      payload: { type: "feedback", targetId: 2, score: -1.0 },
    },
    score: 1.0,
    matchType: "fts",
  }
  const weightedNeg = applyFeedbackWeight([negativeResult])
  assert(weightedNeg[0].score < 1.0, `Negative feedback reduces score (got ${weightedNeg[0].score})`)

  const plainResult: SearchResult = {
    memory: {
      id: 3, projectPath: "/test", category: "CONFIG_VALUES", content: "Plain memory",
      normalizedHash: "ghi", importance: 50, scope: "project", sourceSessionId: null,
      sourceType: "manual", seenCount: 1, retrievalCount: 0, createdAt: 0, updatedAt: 0,
      lastSeenAt: 0, lastRetrievedAt: null, status: "active", expiresAt: null,
      payloadType: null,
      payload: null,
    },
    score: 1.0,
    matchType: "fts",
  }
  const weightedPlain = applyFeedbackWeight([plainResult])
  assertEq(weightedPlain[0].score, 1.0, "No feedback = no score change")
}

section("memory-utils: rowToMemory with payload")
{
  const row = {
    id: 50,
    project_path: "/test/payload-row",
    category: "LESSONS_LEARNED",
    content: "Test row with payload",
    normalized_hash: "pay123",
    importance: 70,
    scope: "project",
    source_session_id: null,
    source_type: "manual",
    seen_count: 1,
    retrieval_count: 0,
    created_at: 3000000,
    updated_at: 4000000,
    last_seen_at: 3500000,
    last_retrieved_at: null,
    status: "active",
    expires_at: null,
    payload_type: "qa",
    payload: JSON.stringify({ type: "qa", question: "Test?", answer: "Yes" }),
  }
  const mem = rowToMemory(row)
  assertEq(mem.payloadType, "qa", "rowToMemory maps payload_type")
  assert(mem.payload !== null, "rowToMemory parses payload JSON")
  assertEq((mem.payload as any).question, "Test?", "rowToMemory parses payload content")

  // Null payload fields
  const rowNull = { ...row, payload_type: null, payload: null }
  const memNull = rowToMemory(rowNull)
  assertEq(memNull.payloadType, null, "rowToMemory handles null payload_type")
  assertEq(memNull.payload, null, "rowToMemory handles null payload")

  // Invalid JSON payload
  const rowBad = { ...row, payload_type: "qa", payload: "not-json" }
  const memBad = rowToMemory(rowBad)
  assertEq(memBad.payloadType, null, "rowToMemory handles invalid payload JSON gracefully")
  assertEq(memBad.payload, null, "rowToMemory returns null for invalid payload JSON")
}

// Cleanup
rmSync(TEST_DB_DIR, { recursive: true, force: true })

console.log(`\n=== Memory Tests: ${passed} passed, ${failed} failed ===`)
process.exit(failed > 0 ? 1 : 0)

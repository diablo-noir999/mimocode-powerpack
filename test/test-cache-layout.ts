/**
 * Test: Cache Layout (m0/m1/m2 zone classification)
 * Covers: classifyCacheZone, classifyCacheBustSeverity, computeCacheStabilityScore, findCacheBoundary
 * Run: bun run test/test-cache-layout.ts
 */

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
  assert(a === b, `${msg} (got ${JSON.stringify(a)}, expected ${JSON.stringify(b)})`)
}

function section(name: string) {
  console.log(`\n--- ${name} ---`)
}

const {
  classifyCacheZone,
  classifyCacheBustSeverity,
  computeCacheStabilityScore,
  findCacheBoundary,
} = await import("../src/memory/cache-layout")

// ============================================================
// === classifyCacheZone ===
// ============================================================
section("classifyCacheZone")

// Test: system messages are m0
{
  const r = classifyCacheZone({ role: "system", content: "You are a helpful assistant" }, 0, 10)
  assertEq(r.zone, "m0", "system message -> m0")
  assertEq(r.reason, "system-message", "reason is system-message")
}

// Test: current message (last) is m2
{
  const r = classifyCacheZone({ role: "user", content: "hello" }, 9, 10)
  assertEq(r.zone, "m2", "last message -> m2")
  assertEq(r.reason, "current-message", "reason is current-message")
}

// Test: tool messages are m2
{
  const r = classifyCacheZone({ role: "tool", content: "file content" }, 5, 10)
  assertEq(r.zone, "m2", "tool message -> m2")
  assertEq(r.reason, "tool-result", "reason is tool-result")
}

// Test: tool-result messages are m2
{
  const r = classifyCacheZone({ role: "tool-result", content: "result" }, 5, 10)
  assertEq(r.zone, "m2", "tool-result message -> m2")
}

// Test: recent user message within window is m1
{
  const r = classifyCacheZone({ role: "user", content: "hello" }, 7, 10, 10)
  assertEq(r.zone, "m1", "recent user message -> m1")
}

// Test: older user message outside window is m0
{
  const r = classifyCacheZone({ role: "user", content: "hello" }, 0, 20, 10)
  assertEq(r.zone, "m0", "old user message -> m0 (stable history)")
  assertEq(r.reason, "stable-history", "reason is stable-history")
}

// Test: recent assistant message within window is m1
{
  const r = classifyCacheZone({ role: "assistant", content: "hi" }, 8, 10, 10)
  assertEq(r.zone, "m1", "recent assistant message -> m1")
}

// Test: older assistant message outside window is m0
{
  const r = classifyCacheZone({ role: "assistant", content: "hi" }, 0, 20, 10)
  assertEq(r.zone, "m0", "old assistant message -> m0 (stable history)")
}

// Test: custom recentWindow
{
  const r = classifyCacheZone({ role: "user", content: "hello" }, 5, 10, 3)
  assertEq(r.zone, "m0", "message outside custom window -> m0")
}

// Test: default recentWindow is 10
{
  // Message at index 8 in a 10-message conversation: distanceFromEnd = 1
  const r = classifyCacheZone({ role: "user", content: "hello" }, 8, 10)
  assertEq(r.zone, "m1", "default window=10, distance 1 -> m1")
}

// Test: unknown role falls through to m1 or m0 based on position
{
  const r = classifyCacheZone({ role: "unknown", content: "something" }, 5, 10, 10)
  // distanceFromEnd = 4, within window of 10 -> m1
  assertEq(r.zone, "m1", "unknown role in recent window -> m1")
}

// ============================================================
// === classifyCacheBustSeverity ===
// ============================================================
section("classifyCacheBustSeverity")

// Test: m0 change busts everything
{
  const r = classifyCacheBustSeverity("m0")
  assertEq(r.severity, "high", "m0 change -> high severity")
  assertEq(r.bustsZones.length, 3, "m0 busts all 3 zones")
  assert(r.bustsZones.includes("m0"), "m0 busts m0")
  assert(r.bustsZones.includes("m1"), "m0 busts m1")
  assert(r.bustsZones.includes("m2"), "m0 busts m2")
}

// Test: m1 change busts m1 and m2
{
  const r = classifyCacheBustSeverity("m1")
  assertEq(r.severity, "medium", "m1 change -> medium severity")
  assertEq(r.bustsZones.length, 2, "m1 busts 2 zones")
  assert(r.bustsZones.includes("m1"), "m1 busts m1")
  assert(r.bustsZones.includes("m2"), "m1 busts m2")
  assert(!r.bustsZones.includes("m0"), "m1 does not bust m0")
}

// Test: m2 change busts only m2
{
  const r = classifyCacheBustSeverity("m2")
  assertEq(r.severity, "low", "m2 change -> low severity")
  assertEq(r.bustsZones.length, 1, "m2 busts 1 zone")
  assert(r.bustsZones.includes("m2"), "m2 busts m2")
}

// ============================================================
// === computeCacheStabilityScore ===
// ============================================================
section("computeCacheStabilityScore")

// Test: empty messages -> score 1
{
  const score = computeCacheStabilityScore([])
  assertEq(score, 1, "empty messages -> score 1")
}

// Test: all system messages -> high stability
{
  const msgs = Array.from({ length: 10 }, () => ({ role: "system" }))
  const score = computeCacheStabilityScore(msgs)
  assert(score > 0.8, `all system messages -> high stability (got ${score})`)
}

// Test: all tool results -> lower stability
{
  const msgs = Array.from({ length: 10 }, () => ({ role: "tool" }))
  const score = computeCacheStabilityScore(msgs)
  assert(score < 0.5, `all tool results -> lower stability (got ${score})`)
}

// Test: mixed content -> moderate stability
{
  const msgs = [
    { role: "system" },
    { role: "system" },
    { role: "user" },
    { role: "assistant" },
    { role: "tool" },
    { role: "user" },
    { role: "assistant" },
  ]
  const score = computeCacheStabilityScore(msgs)
  assert(score > 0 && score <= 1, `mixed content score in (0,1] (got ${score})`)
}

// Test: score is always between 0 and 1
{
  const msgs = Array.from({ length: 20 }, (_, i) => ({
    role: ["system", "user", "assistant", "tool"][i % 4],
  }))
  const score = computeCacheStabilityScore(msgs)
  assert(score >= 0 && score <= 1, `score in [0,1] (got ${score})`)
}

// ============================================================
// === findCacheBoundary ===
// ============================================================
section("findCacheBoundary")

// Test: all system messages -> boundary at end
{
  const msgs = Array.from({ length: 5 }, () => ({ role: "system" }))
  const boundary = findCacheBoundary(msgs)
  // Last message is current-message (m2), so boundary is at index 4
  assertEq(boundary, 4, "all system -> boundary before last (current) message")
}

// Test: first non-system message is boundary
{
  const msgs = [
    { role: "system" },
    { role: "system" },
    { role: "user" },
    { role: "assistant" },
  ]
  const boundary = findCacheBoundary(msgs)
  assertEq(boundary, 2, "boundary at first non-system message")
}

// Test: empty messages -> boundary at 0
{
  const boundary = findCacheBoundary([])
  assertEq(boundary, 0, "empty messages -> boundary 0")
}

// Test: tool messages break boundary
{
  const msgs = [
    { role: "system" },
    { role: "tool" },
    { role: "user" },
  ]
  const boundary = findCacheBoundary(msgs)
  assertEq(boundary, 1, "tool message is first non-m0 -> boundary at 1")
}

// ============================================================
// === Summary ===
// ============================================================
console.log(`\n=== Cache Layout Tests: ${passed} passed, ${failed} failed ===`)
process.exit(failed > 0 ? 1 : 0)

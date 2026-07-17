/**
 * Test: Smart Context Pruning (smart-drops)
 * Covers: findDropCandidates, applyDrops, DEFAULT_DROP_CONFIG
 * Run: bun run test/test-smart-drops.ts
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

const { findDropCandidates, applyDrops, DEFAULT_DROP_CONFIG } = await import("../src/memory/smart-drops")

// ============================================================
// === findDropCandidates ===
// ============================================================
section("findDropCandidates - empty input")

// Test: empty messages -> no candidates
{
  const r = findDropCandidates([])
  assertEq(r.candidates.length, 0, "empty messages -> no candidates")
  assertEq(r.totalEstimatedTokens, 0, "empty messages -> 0 tokens")
}

// Test: single user message -> no candidates
{
  const r = findDropCandidates([{ role: "user", content: "hello" }])
  assertEq(r.candidates.length, 0, "single user message -> no candidates")
}

section("findDropCandidates - spent tool outputs")

// Test: old tool outputs are candidates
{
  const msgs = [
    { role: "user", content: "do something" },
    { role: "assistant", content: "ok" },
    { role: "tool", content: "x".repeat(500) },
    ...Array.from({ length: 60 }, () => ({ role: "user", content: "msg" })),
  ]
  const r = findDropCandidates(msgs, { ...DEFAULT_DROP_CONFIG, maxToolOutputAge: 5, minTokenSavings: 0 })
  const spent = r.candidates.filter(c => c.category === "spent-tool-output")
  assert(spent.length > 0, `old tool output detected (got ${spent.length})`)
}

// Test: recent tool outputs are NOT candidates
{
  const msgs = [
    { role: "user", content: "do something" },
    { role: "tool", content: "result" },
    { role: "user", content: "next" },
  ]
  const r = findDropCandidates(msgs, { ...DEFAULT_DROP_CONFIG, maxToolOutputAge: 50, minTokenSavings: 0 })
  const spent = r.candidates.filter(c => c.category === "spent-tool-output")
  assertEq(spent.length, 0, "recent tool output NOT dropped")
}

section("findDropCandidates - superseded edits")

// Test: earlier edit to same file is superseded
{
  const msgs = [
    { role: "user", content: "edit file" },
    { role: "tool", name: "edit", arguments: { file_path: "/src/main.ts" }, content: "edited" },
    { role: "user", content: "edit again" },
    { role: "tool", name: "edit", arguments: { file_path: "/src/main.ts" }, content: "edited again" },
  ]
  const r = findDropCandidates(msgs, { ...DEFAULT_DROP_CONFIG, detectSupersededEdits: true, minTokenSavings: 0 })
  const superseded = r.candidates.filter(c => c.category === "superseded-edit")
  assert(superseded.length > 0, "earlier edit superseded")
  assertEq(superseded[0].index, 1, "superseded edit is at index 1 (the first edit)")
}

// Test: edits to different files are NOT superseded
{
  const msgs = [
    { role: "user", content: "edit files" },
    { role: "tool", name: "edit", arguments: { file_path: "/src/a.ts" }, content: "edited a" },
    { role: "user", content: "edit another" },
    { role: "tool", name: "edit", arguments: { file_path: "/src/b.ts" }, content: "edited b" },
  ]
  const r = findDropCandidates(msgs, { ...DEFAULT_DROP_CONFIG, detectSupersededEdits: true, minTokenSavings: 0 })
  const superseded = r.candidates.filter(c => c.category === "superseded-edit")
  assertEq(superseded.length, 0, "different files NOT superseded")
}

// Test: detectSupersededEdits: false disables detection
{
  const msgs = [
    { role: "user", content: "edit" },
    { role: "tool", name: "edit", arguments: { file_path: "/src/main.ts" }, content: "edited" },
    { role: "user", content: "edit again" },
    { role: "tool", name: "edit", arguments: { file_path: "/src/main.ts" }, content: "edited again" },
  ]
  const r = findDropCandidates(msgs, { ...DEFAULT_DROP_CONFIG, detectSupersededEdits: false, minTokenSavings: 0 })
  const superseded = r.candidates.filter(c => c.category === "superseded-edit")
  assertEq(superseded.length, 0, "detectSupersededEdits: false disables detection")
}

section("findDropCandidates - low-value messages")

// Test: empty assistant message is low-value
{
  const msgs = [
    { role: "user", content: "hello" },
    { role: "assistant", content: "" },
  ]
  const r = findDropCandidates(msgs, { ...DEFAULT_DROP_CONFIG, dropLowValue: true, minTokenSavings: 0 })
  const lowValue = r.candidates.filter(c => c.category === "low-value-message")
  assert(lowValue.length > 0, "empty assistant message detected as low-value")
}

// Test: user messages are never low-value (they anchor turns)
{
  const msgs = [
    { role: "user", content: "" },
  ]
  const r = findDropCandidates(msgs, { ...DEFAULT_DROP_CONFIG, dropLowValue: true, minTokenSavings: 0 })
  const lowValue = r.candidates.filter(c => c.category === "low-value-message")
  assertEq(lowValue.length, 0, "empty user message NOT dropped")
}

// Test: dropped placeholder is detected
{
  const msgs = [
    { role: "user", content: "hello" },
    { role: "assistant", content: "[dropped]" },
  ]
  const r = findDropCandidates(msgs, { ...DEFAULT_DROP_CONFIG, dropLowValue: true, minTokenSavings: 0 })
  const placeholders = r.candidates.filter(c => c.category === "dropped-placeholder")
  assert(placeholders.length > 0, "dropped placeholder detected")
}

section("findDropCandidates - stale reduce calls")

// Test: old ctx_reduce call is candidate
{
  const msgs = [
    { role: "tool", name: "ctx_reduce", content: "reduced" },
    ...Array.from({ length: 10 }, (_, i) => ({ role: "user", content: `msg ${i}` })),
  ]
  const r = findDropCandidates(msgs, { ...DEFAULT_DROP_CONFIG, dropStaleReduceCalls: true, minTokenSavings: 0 })
  const stale = r.candidates.filter(c => c.category === "stale-reduce-call")
  assert(stale.length > 0, "old ctx_reduce call detected")
}

// Test: recent ctx_reduce call is NOT candidate
{
  const msgs = [
    { role: "user", content: "msg" },
    { role: "tool", name: "ctx_reduce", content: "reduced" },
    { role: "user", content: "next" },
  ]
  const r = findDropCandidates(msgs, { ...DEFAULT_DROP_CONFIG, dropStaleReduceCalls: true, minTokenSavings: 0 })
  const stale = r.candidates.filter(c => c.category === "stale-reduce-call")
  assertEq(stale.length, 0, "recent ctx_reduce NOT dropped")
}

section("findDropCandidates - config toggles")

// Test: dropLowValue: false disables low-value detection
{
  const msgs = [
    { role: "user", content: "hello" },
    { role: "assistant", content: "" },
  ]
  const r = findDropCandidates(msgs, { ...DEFAULT_DROP_CONFIG, dropLowValue: false, minTokenSavings: 0 })
  const lowValue = r.candidates.filter(c => c.category === "low-value-message" || c.category === "dropped-placeholder")
  assertEq(lowValue.length, 0, "dropLowValue: false disables detection")
}

// Test: dropStaleReduceCalls: false disables detection
{
  const msgs = [
    { role: "tool", name: "ctx_reduce", content: "reduced" },
    ...Array.from({ length: 10 }, (_, i) => ({ role: "user", content: `msg ${i}` })),
  ]
  const r = findDropCandidates(msgs, { ...DEFAULT_DROP_CONFIG, dropStaleReduceCalls: false, minTokenSavings: 0 })
  const stale = r.candidates.filter(c => c.category === "stale-reduce-call")
  assertEq(stale.length, 0, "dropStaleReduceCalls: false disables detection")
}

// ============================================================
// === applyDrops ===
// ============================================================
section("applyDrops")

// Test: applies drops correctly
{
  const msgs = [
    { role: "user", content: "hello" },
    { role: "assistant", content: "response" },
    { role: "tool", content: "result" },
  ]
  const applied = applyDrops(msgs, [
    { index: 2, category: "spent-tool-output", reason: "old", estimatedTokens: 100 },
  ])
  assertEq(applied, 1, "applyDrops returns count of applied drops")
  assert(msgs[2].content.includes("spent-tool-output"), "tool message replaced with placeholder")
  assert(!msgs[2].content.includes("result"), "original content removed")
}

// Test: user messages are never dropped
{
  const msgs = [
    { role: "user", content: "hello" },
    { role: "assistant", content: "response" },
  ]
  const applied = applyDrops(msgs, [
    { index: 0, category: "low-value-message", reason: "empty", estimatedTokens: 0 },
  ])
  assertEq(applied, 0, "user message not dropped")
  assertEq(msgs[0].content, "hello", "user message content preserved")
}

// Test: out-of-bounds index is skipped
{
  const msgs = [{ role: "assistant", content: "hi" }]
  const applied = applyDrops(msgs, [
    { index: 99, category: "low-value-message", reason: "missing", estimatedTokens: 0 },
  ])
  assertEq(applied, 0, "out-of-bounds index skipped")
}

// Test: multiple drops
{
  const msgs = [
    { role: "user", content: "hello" },
    { role: "assistant", content: "a" },
    { role: "tool", content: "b" },
    { role: "assistant", content: "c" },
  ]
  const applied = applyDrops(msgs, [
    { index: 1, category: "superseded-edit", reason: "old edit", estimatedTokens: 50 },
    { index: 2, category: "spent-tool-output", reason: "old tool", estimatedTokens: 100 },
  ])
  assertEq(applied, 2, "multiple drops applied")
  assert(msgs[1].content.includes("superseded-edit"), "first drop applied")
  assert(msgs[2].content.includes("spent-tool-output"), "second drop applied")
}

// ============================================================
// === Summary ===
// ============================================================
console.log(`\n=== Smart Drops Tests: ${passed} passed, ${failed} failed ===`)
process.exit(failed > 0 ? 1 : 0)

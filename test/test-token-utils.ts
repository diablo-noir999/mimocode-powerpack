/**
 * Test: Token Estimation Utilities
 * Covers: estimateTextTokens, estimateMessageTokens
 * Run: bun run test/test-token-utils.ts
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

const { estimateTextTokens, estimateMessageTokens } = await import("../src/memory/token-utils")

// ============================================================
// === estimateTextTokens ===
// ============================================================
section("estimateTextTokens")

// Test: empty string
{
  const r = estimateTextTokens("")
  assertEq(r, 0, "empty string -> 0 tokens")
}

// Test: single character
{
  const r = estimateTextTokens("a")
  assertEq(r, 1, "1 char -> 1 token (ceil(1/4) = 1)")
}

// Test: exactly 4 characters
{
  const r = estimateTextTokens("abcd")
  assertEq(r, 1, "4 chars -> 1 token")
}

// Test: 5 characters
{
  const r = estimateTextTokens("abcde")
  assertEq(r, 2, "5 chars -> 2 tokens (ceil(5/4) = 2)")
}

// Test: 8 characters
{
  const r = estimateTextTokens("abcdefgh")
  assertEq(r, 2, "8 chars -> 2 tokens")
}

// Test: longer text
{
  const r = estimateTextTokens("hello world this is a test")
  // 26 chars / 4 = 6.5 -> ceil = 7
  assertEq(r, 7, "26 chars -> 7 tokens")
}

// Test: whitespace counts as characters
{
  const r = estimateTextTokens("    ")
  assertEq(r, 1, "4 spaces -> 1 token")
}

// Test: newlines count
{
  const r = estimateTextTokens("\n\n\n\n")
  assertEq(r, 1, "4 newlines -> 1 token")
}

// ============================================================
// === estimateMessageTokens ===
// ============================================================
section("estimateMessageTokens")

// Test: string content
{
  const r = estimateMessageTokens({ role: "user", content: "hello world" })
  // 11 chars / 4 = 2.75 -> ceil = 3
  assertEq(r, 3, "string content estimates correctly")
}

// Test: empty string content
{
  const r = estimateMessageTokens({ role: "user", content: "" })
  assertEq(r, 0, "empty string content -> 0")
}

// Test: parts with text
{
  const r = estimateMessageTokens({
    role: "assistant",
    parts: [{ type: "text", text: "hello" }],
  })
  // 5 chars / 4 = 1.25 -> ceil = 2
  assertEq(r, 2, "parts with text estimates correctly")
}

// Test: parts with thinking
{
  const r = estimateMessageTokens({
    role: "assistant",
    parts: [{ type: "text", text: "response", thinking: "reasoning here" }],
  })
  // text: 8/4=2, thinking: 14/4=3.5->4, total=6
  assertEq(r, 6, "parts with thinking counts both")
}

// Test: parts with state.output
{
  const r = estimateMessageTokens({
    role: "tool",
    parts: [{ type: "tool-result", state: { output: "result data" } }],
  })
  // 11 chars / 4 = 2.75 -> ceil = 3
  assertEq(r, 3, "parts with state.output estimates correctly")
}

// Test: parts with content string
{
  const r = estimateMessageTokens({
    role: "assistant",
    parts: [{ type: "text", content: "some content" }],
  })
  // 12 chars / 4 = 3
  assertEq(r, 3, "parts with content string estimates correctly")
}

// Test: no content, no parts -> 0
{
  const r = estimateMessageTokens({ role: "user" })
  assertEq(r, 0, "no content or parts -> 0")
}

// Test: non-string content -> 0
{
  const r = estimateMessageTokens({ role: "user", content: 42 })
  assertEq(r, 0, "non-string content -> 0")
}

// Test: multiple parts accumulate
{
  const r = estimateMessageTokens({
    role: "assistant",
    parts: [
      { type: "text", text: "hello" },
      { type: "text", text: "world" },
    ],
  })
  // 5 + 5 = 10 chars, but each part ceil'd independently: 2+2=4
  assertEq(r, 4, "multiple parts accumulate tokens (each part ceil'd independently)")
}

// Test: non-record parts are skipped
{
  const r = estimateMessageTokens({
    role: "assistant",
    parts: ["string", 42, null],
  })
  assertEq(r, 0, "non-record parts skipped")
}

// ============================================================
// === Summary ===
// ============================================================
console.log(`\n=== Token Utils Tests: ${passed} passed, ${failed} failed ===`)
process.exit(failed > 0 ? 1 : 0)

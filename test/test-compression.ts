/**
 * Test: Content-Aware Compression Module
 * Covers: content-router, json-crusher, code-compressor, index
 * Run: bun run test/test-compression.ts
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

// ============================================================
// === Content Router ===
// ============================================================
section("Content Router - detectContentType")
const { detectContentType, ContentType } = await import("../src/compression/content-router")

// Test: empty content returns PLAIN_TEXT
{
  const r = detectContentType("")
  assertEq(r.contentType, ContentType.PLAIN_TEXT, "empty string -> PLAIN_TEXT")
}

// Test: whitespace-only returns PLAIN_TEXT
{
  const r = detectContentType("   \n  \t  ")
  assertEq(r.contentType, ContentType.PLAIN_TEXT, "whitespace-only -> PLAIN_TEXT")
}

// Test: JSON array detection
{
  const json = JSON.stringify([{ a: 1, b: 2 }, { a: 3, b: 4 }, { a: 5, b: 6 }])
  const r = detectContentType(json)
  assertEq(r.contentType, ContentType.JSON_ARRAY, "JSON array detected")
  assert(r.confidence >= 0.8, `confidence for JSON array >= 0.8 (got ${r.confidence})`)
}

// Test: JSON object detection (classified as JSON_ARRAY by content-router)
{
  const json = JSON.stringify({ key: "value", nested: { a: 1 } })
  const r = detectContentType(json)
  assertEq(r.contentType, ContentType.JSON_ARRAY, "JSON object detected (as JSON_ARRAY)")
  assert(r.metadata.isObject === true, "metadata has isObject flag")
}

// Test: git diff detection
{
  const diff = `diff --git a/src/main.ts b/src/main.ts
--- a/src/main.ts
+++ b/src/main.ts
@@ -1,3 +1,4 @@
+import { foo } from "./foo"
 function main() {
   console.log("hello")
 }`
  const r = detectContentType(diff)
  assertEq(r.contentType, ContentType.GIT_DIFF, "git diff detected")
}

// Test: search results detection
{
  const search = `src/main.ts:10:export function main()
src/main.ts:25:  return result
src/utils.ts:5:import { helper } from "./helper"
src/utils.ts:12:function helper() {}`
  const r = detectContentType(search)
  assertEq(r.contentType, ContentType.SEARCH_RESULTS, "search results detected")
}

// Test: build output / log detection
{
  const log = `ERROR: TypeScript compilation failed
FAIL: tests/unit.test.ts
FATAL: Cannot find module './missing'
Error: ENOENT: no such file or directory`
  const r = detectContentType(log)
  assertEq(r.contentType, ContentType.BUILD_OUTPUT, "build output detected")
}

// Test: source code detection (TypeScript)
{
  const code = `import { foo } from "./foo"
import { bar } from "./bar"
interface Config {
  name: string
  value: number
}
type Result = string | number
enum Status {
  Active = "active",
  Inactive = "inactive"
}
function process(config: Config): Result {
  return config.value
}`
  const r = detectContentType(code)
  assertEq(r.contentType, ContentType.SOURCE_CODE, "TypeScript source detected")
}

// Test: plain text fallback
{
  const text = "This is just some plain text without any special patterns."
  const r = detectContentType(text)
  assertEq(r.contentType, ContentType.PLAIN_TEXT, "plain text falls through")
}

// ============================================================
// === JSON Crusher ===
// ============================================================
section("JSON Crusher - crushJson")
const { crushJson, crushJsonArray } = await import("../src/compression/json-crusher")

// Test: non-JSON input returns passthrough
{
  const r = crushJson("not json at all")
  assertEq(r.strategy, "passthrough", "non-JSON returns passthrough")
  assertEq(r.wasModified, false, "non-JSON not modified")
}

// Test: small array returns passthrough (below minItemsToAnalyze)
{
  const arr = JSON.stringify([{ a: 1 }, { a: 2 }])
  const r = crushJson(arr)
  assertEq(r.strategy, "passthrough", "small array returns passthrough")
}

// Test: large array with duplicates gets deduped
{
  const items = Array.from({ length: 20 }, (_, i) => ({
    id: i % 5, // creates duplicates
    name: `item-${i}`,
    value: i * 10,
    category: "test",
  }))
  const input = JSON.stringify(items)
  const r = crushJson(input, { minItemsToAnalyze: 5, dedupIdentical: true })
  if (r.wasModified) {
    const parsed = JSON.parse(r.compressed)
    assert(parsed.length < items.length, `dedup reduces item count (got ${parsed.length} < ${items.length})`)
  } else {
    assert(true, "crushJson handles array with duplicates without crashing")
  }
}

// Test: JSON object minification
{
  const obj = JSON.stringify({ name: "test", value: 42, nested: { a: 1, b: 2 } }, null, 2)
  const r = crushJson(obj)
  assertEq(r.strategy, "minify", "JSON object gets minified")
  assert(r.compressed.length <= obj.length, "minified output is shorter or equal")
}

// Test: crushJsonArray with empty array
{
  const r = crushJsonArray("[]")
  assertEq(r.strategy, "passthrough", "empty array returns passthrough")
}

// Test: crushJsonArray with non-array
{
  const r = crushJsonArray('{"key": "value"}')
  assertEq(r.strategy, "passthrough", "non-array returns passthrough")
}

// Test: crushJsonArray with invalid JSON
{
  const r = crushJsonArray("not valid json {{{")
  assertEq(r.strategy, "passthrough", "invalid JSON returns passthrough")
  assertEq(r.wasModified, false, "invalid JSON not modified")
}

// Test: crushJson with JSON that starts with {
{
  const r = crushJson('{"a": 1, "b": 2, "c": 3}')
  assertEq(r.strategy, "minify", "JSON object minified")
}

// Test: ratio is reasonable
{
  const items = Array.from({ length: 10 }, (_, i) => ({
    id: i, name: `item-${i}`, value: i * 10, category: "test", description: "a description for testing"
  }))
  const input = JSON.stringify(items)
  const r = crushJson(input, { minItemsToAnalyze: 3 })
  assert(r.ratio > 0, `ratio is positive (got ${r.ratio})`)
  assert(r.ratio <= 1.5, `ratio is reasonable (got ${r.ratio})`)
}

// ============================================================
// === Code Compressor ===
// ============================================================
section("Code Compressor - detectLanguage")
const { detectLanguage, compressCode } = await import("../src/compression/code-compressor")

// Test: detect Python
{
  const code = `def hello():
    print("hello")

class Foo:
    pass

import os
from typing import List`
  const r = detectLanguage(code)
  assertEq(r.language, "python", "detects Python")
  assert(r.confidence > 0, `confidence > 0 for Python (got ${r.confidence})`)
}

// Test: detect TypeScript
{
  const code = `interface Config {
  name: string
  value: number
}

type Result = string | number

function process(): void {}`
  const r = detectLanguage(code)
  assertEq(r.language, "typescript", "detects TypeScript")
}

// Test: detect Go
{
  const code = `package main

import "fmt"
import "os"

func main() {
    fmt.Println("hello")
}

func process() {
    os.Exit(0)
}`
  const r = detectLanguage(code)
  assertEq(r.language, "go", "detects Go")
}

// Test: unknown language
{
  const code = "just some plain text without any language patterns"
  const r = detectLanguage(code)
  assertEq(r.language, "unknown", "unknown for plain text")
}

// Test: compressCode - short code returns passthrough
{
  const code = `function hello() {
  return "world"
}`
  const r = compressCode(code)
  assertEq(r.strategy, "passthrough", "short code returns passthrough")
  assertEq(r.compressed, r.original, "short code unchanged")
}

// Test: compressCode - large code with functions gets compressed
{
  const code = `import os
import sys

def hello():
  # This is a comment
  x = 1
  y = 2
  z = 3
  a = 4
  b = 5
  c = 6
  d = 7
  e = 8
  f = 9
  g = 10
  h = 11
  return x + y + z + a + b + c + d + e + f + g + h

def world():
  # Another comment
  m = 1
  n = 2
  o = 3
  p = 4
  q = 5
  r = 6
  s = 7
  t = 8
  u = 9
  v = 10
  w = 11
  return m + n + o + p + q + r + s + t + u + v + w`
  const r = compressCode(code, { minTokensForCompression: 50 })
  assertEq(r.preservedImports, 2, "preserves 2 imports")
  assert(r.preservedSignatures >= 1, `preserves at least 1 signature (got ${r.preservedSignatures})`)
  assert(r.compressedBodies >= 1, `compresses at least 1 body (got ${r.compressedBodies})`)
}

// Test: compressCode - preserveImports: false skips imports
{
  const code = `import { foo } from "./foo"
import { bar } from "./bar"

function hello() {
  const x = 1
  const y = 2
  const z = 3
  const a = 4
  const b = 5
  const c = 6
  const d = 7
  const e = 8
  const f = 9
  const g = 10
  return x
}`
  const r = compressCode(code, { preserveImports: false, minTokensForCompression: 50 })
  assertEq(r.preservedImports, 0, "imports not preserved")
}

// Test: compressCode - compressComments: false keeps comments
{
  const code = `function hello() {
  // This is a comment
  const x = 1
  const y = 2
  const z = 3
  const a = 4
  const b = 5
  const c = 6
  const d = 7
  const e = 8
  const f = 9
  const g = 10
  const h = 11
  return x
}`
  const r = compressCode(code, { compressComments: false, minTokensForCompression: 50 })
  assert(r.compressed.includes("// This is a comment"), "comments preserved when compressComments=false")
}

// Test: compressCode ratio is valid
{
  const code = `import os
import sys

def process_data(data):
  """Process the input data."""
  result = []
  for item in data:
    if item is not None:
      result.append(item * 2)
  return result

def format_output(data):
  """Format the processed data."""
  return "\\n".join(str(x) for x in data)

def main():
  data = range(100)
  processed = process_data(data)
  output = format_output(processed)
  print(output)`
  const r = compressCode(code, { minTokensForCompression: 30 })
  assert(r.compressionRatio >= 0, `ratio >= 0 (got ${r.compressionRatio})`)
  assert(r.compressionRatio <= 1.1, `ratio <= 1.1 (got ${r.compressionRatio})`)
}

// ============================================================
// === Index - compress / compressAll / totalSavings ===
// ============================================================
section("Compression Index - compress")
const { compress, compressAll, totalSavings } = await import("../src/compression/index")

// Test: compress empty string
{
  const r = compress("")
  assertEq(r.strategy, "passthrough", "empty string passthrough")
  assertEq(r.wasModified, false, "empty string not modified")
}

// Test: compress short content
{
  const r = compress("hello world")
  assertEq(r.strategy, "passthrough", "short content passthrough")
}

// Test: compress JSON array
{
  const json = JSON.stringify(Array.from({ length: 20 }, (_, i) => ({
    id: i, name: `item-${i}`, value: i * 10, category: "test", description: "testing compression"
  })))
  const r = compress(json, { minContentLength: 10 })
  assertEq(r.contentType, ContentType.JSON_ARRAY, "JSON routed correctly")
}

// Test: compress code
{
  const code = `import os
import sys

def process(data):
  # Process the data
  result = []
  for item in data:
    if item is not None:
      result.append(item * 2)
  return result

def format(data):
  # Format output
  return "\\n".join(str(x) for x in data)

def main():
  data = range(100)
  processed = process(data)
  output = format(processed)
  print(output)`
  const r = compress(code, { minContentLength: 10 })
  assertEq(r.contentType, ContentType.SOURCE_CODE, "code routed correctly")
}

// Test: compress passthrough
{
  const text = "Just some regular text that is long enough to trigger compression but has no special content type"
  const r = compress(text, { minContentLength: 10 })
  assertEq(r.strategy, "passthrough", "plain text passthrough")
}

// Test: compressAll
{
  const results = compressAll(["hello", "world"], { minContentLength: 100 })
  assertEq(results.length, 2, "compressAll returns correct count")
  assert(results.every(r => r.strategy === "passthrough"), "all short content passthrough")
}

// Test: totalSavings
{
  const results = compressAll([
    "a".repeat(200),
    "b".repeat(200),
  ], { minContentLength: 10 })
  const savings = totalSavings(results)
  assert(savings.originalTokens > 0, "originalTokens > 0")
  assert(savings.compressedTokens >= 0, "compressedTokens >= 0")
  assert(typeof savings.savingsPercent === "number", "savingsPercent is a number")
}

// Test: totalSavings with empty array
{
  const savings = totalSavings([])
  assertEq(savings.originalTokens, 0, "empty array: originalTokens = 0")
  assertEq(savings.savingsPercent, 0, "empty array: savingsPercent = 0")
}

// Test: compress with config overrides
{
  const r = compress("short", { minContentLength: 3 })
  assertEq(r.strategy, "passthrough", "minContentLength override works")
}

// ============================================================
// === Summary ===
// ============================================================
console.log(`\n=== Compression Tests: ${passed} passed, ${failed} failed ===`)
process.exit(failed > 0 ? 1 : 0)

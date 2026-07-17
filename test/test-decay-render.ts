/**
 * Test: Decay Render (tier-decay rendering)
 * Covers: renderDecayedCompartments, renderCompartmentAtTier, extractM0Block
 * Run: bun run test/test-decay-render.ts
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
  renderDecayedCompartments,
  renderCompartmentAtTier,
  extractM0Block,
  DEFAULT_HISTORY_BUDGET_TOKENS,
  TIER_COST,
} = await import("../src/memory/decay-render")

// ============================================================
// === renderDecayedCompartments ===
// ============================================================
section("renderDecayedCompartments")

// Test: empty compartments -> empty string
{
  const r = renderDecayedCompartments({ compartments: [] })
  assertEq(r, "", "empty compartments -> empty string")
}

// Test: single compartment renders
{
  const r = renderDecayedCompartments({
    compartments: [{
      startMessage: 0,
      endMessage: 5,
      title: "Test Compartment",
      content: "This is the content",
    }],
  })
  assert(r.includes("<compartment"), "output contains compartment tag")
  assert(r.includes("Test Compartment"), "output contains title")
  assert(r.includes("This is the content"), "output contains content")
}

// Test: multiple compartments render
{
  const r = renderDecayedCompartments({
    compartments: [
      { startMessage: 0, endMessage: 5, title: "First", content: "Content 1" },
      { startMessage: 6, endMessage: 10, title: "Second", content: "Content 2" },
    ],
  })
  assert(r.includes("First"), "first compartment present")
  assert(r.includes("Second"), "second compartment present")
}

// Test: tiered compartments use tier-specific content
{
  const r = renderDecayedCompartments({
    compartments: [{
      startMessage: 0,
      endMessage: 10,
      title: "Tiered",
      content: "Full content here",
      p1: "P1 summary",
      p2: "P2 summary",
      p3: "P3 summary",
      p4: "P4 summary",
    }],
  })
  // Depending on computed tier, one of the p-levels should be used
  assert(r.includes("compartment"), "tiered compartment renders")
}

// Test: default budget is 60000
{
  assertEq(DEFAULT_HISTORY_BUDGET_TOKENS, 60000, "default budget is 60000")
}

// Test: budget enforcement - large content gets trimmed
{
  const largeContent = "x".repeat(100000) // ~25000 tokens
  const r = renderDecayedCompartments({
    compartments: [
      { startMessage: 0, endMessage: 5, title: "A", content: largeContent },
      { startMessage: 6, endMessage: 10, title: "B", content: largeContent },
      { startMessage: 11, endMessage: 15, title: "C", content: largeContent },
    ],
    historyBudgetTokens: 1000, // very small budget
  })
  // The budget guard should demote compartments to fit
  assert(r.length < largeContent.length * 3, "budget enforcement reduces output")
}

// ============================================================
// === renderCompartmentAtTier ===
// ============================================================
section("renderCompartmentAtTier")

// Test: renders at specified tier
{
  const c = {
    startMessage: 0,
    endMessage: 5,
    title: "Test",
    content: "Full content",
    p1: "Tier 1 summary",
    p2: "Tier 2 summary",
  }
  const r = renderCompartmentAtTier(c, 1)
  assert(r.includes("Tier 1 summary"), "tier 1 uses p1 content")
}

// Test: tier 2 uses p2
{
  const c = {
    startMessage: 0,
    endMessage: 5,
    title: "Test",
    content: "Full content",
    p1: "Tier 1 summary",
    p2: "Tier 2 summary",
  }
  const r = renderCompartmentAtTier(c, 2)
  assert(r.includes("Tier 2 summary"), "tier 2 uses p2 content")
}

// Test: tier 5 returns empty (archived)
{
  const c = {
    startMessage: 0,
    endMessage: 5,
    title: "Test",
    content: "Full content",
  }
  const r = renderCompartmentAtTier(c, 5)
  assertEq(r, "", "tier 5 returns empty string (archived)")
}

// Test: fallback to denser tier when requested tier is null
{
  const c = {
    startMessage: 0,
    endMessage: 5,
    title: "Test",
    content: "Full content",
    p1: "P1 available",
    p2: null,
    p3: null,
    p4: null,
  }
  const r = renderCompartmentAtTier(c, 3)
  // tier 3 is null, falls back to p2 (null), then p1 -> uses p1
  assert(r.includes("P1 available"), "falls back to denser tier")
}

// Test: non-tiered compartment uses legacy truncation
{
  const c = {
    startMessage: 0,
    endMessage: 5,
    title: "Legacy",
    content: "x".repeat(2000),
  }
  const r = renderCompartmentAtTier(c, 2)
  assert(r.length < 2000, "tier 2 legacy truncates content")
  assert(r.includes("..."), "truncation adds ellipsis")
}

// Test: non-tiered compartment at tier 1 shows full content
{
  const c = {
    startMessage: 0,
    endMessage: 5,
    title: "Full",
    content: "Complete content here",
  }
  const r = renderCompartmentAtTier(c, 1)
  assert(r.includes("Complete content here"), "tier 1 shows full content")
}

// Test: non-tiered compartment at tier 4 returns self-closing tag
{
  const c = {
    startMessage: 0,
    endMessage: 5,
    title: "Empty",
    content: "Some content",
  }
  const r = renderCompartmentAtTier(c, 4)
  assert(r.includes("/>"), "tier 4 non-tiered returns self-closing tag")
}

// ============================================================
// === extractM0Block ===
// ============================================================
section("extractM0Block")

// Test: extracts block by tag
{
  const m0 = `Some preamble
<rules>
These are the rules
They are important
</rules>
Some postamble`
  const r = extractM0Block(m0, "rules")
  assert(r !== null, "extractM0Block finds the block")
  assert(r!.includes("<rules>"), "extracted block includes opening tag")
  assert(r!.includes("</rules>"), "extracted block includes closing tag")
  assert(r!.includes("These are the rules"), "extracted block includes content")
}

// Test: missing tag returns null
{
  const m0 = "Just some text without any tags"
  const r = extractM0Block(m0, "rules")
  assertEq(r, null, "missing tag returns null")
}

// Test: multiple blocks returns first match
{
  const m0 = `<rules>first</rules>\n<rules>second</rules>`
  const r = extractM0Block(m0, "rules")
  assert(r!.includes("first"), "returns first match")
  assert(!r!.includes("second"), "does not include second match")
}

// Test: empty tag content
{
  const m0 = "<rules></rules>"
  const r = extractM0Block(m0, "rules")
  assert(r !== null, "empty block found")
  assertEq(r!, "<rules></rules>", "empty block returned as-is")
}

// ============================================================
// === TIER_COST ===
// ============================================================
section("TIER_COST")

// Test: TIER_COST has 6 entries
{
  assertEq(TIER_COST.length, 6, "TIER_COST has 6 entries")
}

// Test: TIER_COST[0] is 0 (unused)
{
  assertEq(TIER_COST[0], 0, "TIER_COST[0] = 0")
}

// Test: costs decrease from tier 1 to tier 5
{
  for (let i = 1; i < TIER_COST.length - 1; i++) {
    assert(TIER_COST[i] >= TIER_COST[i + 1], `TIER_COST[${i}] >= TIER_COST[${i + 1}]`)
  }
}

// ============================================================
// === Summary ===
// ============================================================
console.log(`\n=== Decay Render Tests: ${passed} passed, ${failed} failed ===`)
process.exit(failed > 0 ? 1 : 0)

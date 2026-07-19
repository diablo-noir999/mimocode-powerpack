/**
 * Test: Quota service, Review system, Kimaki, tools
 * Run: bun run test/test-compat-quota.ts
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

// === Quota Service ===
section("Quota Service")
const { QuotaService } = await import("../src/quota/quota-service")

const quota = new QuotaService()

// Test: getAllQuotas with mimo provider
{
  const result = await quota.getAllQuotas(["mimo"])
  assert(result !== null, "getAllQuotas returns result")
  assert(result.providers !== undefined, "result has providers array")
  assert(result.providers.length > 0, "result has at least one provider")

  const mimo = result.providers.find((p: any) => p.name === "mimo")
  if (mimo) {
    assert(mimo.percentRemaining !== undefined || mimo.error !== undefined, "mimo provider has percentRemaining or error")
  }
}

// Test: getAllQuotas with multiple providers
{
  const result = await quota.getAllQuotas(["mimo", "copilot"])
  assert(result.providers.length >= 1, "returns multiple providers")
}

// Test: getAllQuotas with nonexistent provider
{
  const result = await quota.getAllQuotas(["nonexistent-provider-xyz"])
  assert(result !== null, "nonexistent provider doesn't crash")
}

// Test: individual provider check
{
  const result = await quota.getQuota("mimo")
  // May return null if provider not available, or a ProviderQuota object
  assert(result === null || (typeof result === "object" && result !== null),
    "getQuota returns null or ProviderQuota object")
}

// === Review System ===
section("Review Server")
const { createReviewSession, getReviewSession, getSessionAnnotations, parsePatch } = await import("../src/review/server")

// Test: createReviewSession
{
  const session = createReviewSession("/tmp/test-workspace", "diff --git a/test.ts\n--- a/test.ts\n+++ b/test.ts\n@@ -1 +1 @@\n-old\n+new", "HEAD")
  assert(session !== null, "createReviewSession returns session")
  assert(typeof session.id === "string", "session has id")
  assert(session.rawPatch.length > 0, "session has rawPatch")
  assert(session.annotations.length === 0, "session starts with empty annotations")
}

// Test: getReviewSession
{
  const session = createReviewSession("/tmp/test", "patch content", "HEAD")
  const retrieved = getReviewSession(session.id)
  assert(retrieved !== null, "getReviewSession returns session by id")
  assert(retrieved!.id === session.id, "retrieved session has correct id")
}

// Test: getSessionAnnotations
{
  const session = createReviewSession("/tmp/test", "patch content", "HEAD")
  const annotations = getSessionAnnotations(session.id)
  assert(Array.isArray(annotations), "getSessionAnnotations returns array")
  assert(annotations.length === 0, "new session has no annotations")
}

// Test: parsePatch
{
  const patch = "diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n@@ -1,2 +1,3 @@\n line1\n+new line\n line2"
  const files = parsePatch(patch)
  assert(Array.isArray(files), "parsePatch returns array")
  assert(files.length === 1, "parsePatch parses one file")
  assert(files[0].path === "file.ts", "parsed file has correct path")
}

// Test: Review session ID validation — valid format
{
  // getReviewSession first checks in-memory map, then falls through to loadSession
  // which validates with regex /^review-\d+-[a-z0-9]+$/
  const validId = "review-1234567890-abc123"
  const result = getReviewSession(validId)
  // Should not crash — returns null because no session exists, but ID format is valid
  assert(result === null || typeof result === "object", "valid session ID format does not crash getReviewSession")
}

// Test: Review session ID validation — path traversal rejected
{
  const maliciousId = "../etc/passwd"
  const result = getReviewSession(maliciousId)
  assertEq(result, null, "path traversal session ID '../etc/passwd' is rejected")
}

// Test: Review session ID validation — special characters rejected
{
  const specialCharsId = "review-123<script>alert(1)</script>"
  const result = getReviewSession(specialCharsId)
  assertEq(result, null, "session ID with special chars is rejected")
}

// Test: Review session ID validation — empty and edge cases
{
  assertEq(getReviewSession(""), null, "empty session ID is rejected")
  assertEq(getReviewSession("review-abc-def"), null, "session ID with non-numeric timestamp is rejected")
  assertEq(getReviewSession("review-123-ABC"), null, "session ID with uppercase is rejected")
}

// Test: Review server security headers
{
  const { startReviewServer } = await import("../src/review/server")
  const testHtml = "<!DOCTYPE html><html><body>Test</body></html>"
  const server = await startReviewServer({
    port: 0, // random available port
    htmlContent: testHtml,
  })

  try {
    const resp = await fetch(`${server.url}/`)
    const contentType = resp.headers.get("content-type")
    assert(contentType?.includes("text/html"), "HTML response has text/html content type")

    const xcto = resp.headers.get("x-content-type-options")
    assertEq(xcto, "nosniff", "X-Content-Type-Options: nosniff header present")

    const xfo = resp.headers.get("x-frame-options")
    assertEq(xfo, "DENY", "X-Frame-Options: DENY header present")

    const csp = resp.headers.get("content-security-policy")
    assert(csp !== null && csp.length > 0, "Content-Security-Policy header present")
    assert(csp!.includes("default-src"), "CSP contains default-src directive")

    const rp = resp.headers.get("referrer-policy")
    assertEq(rp, "no-referrer", "Referrer-Policy: no-referrer header present")

    const body = await resp.text()
    assert(body.includes("Test"), "HTML body content is served correctly")
  } finally {
    server.stop()
  }
}

// === Kimaki ===
section("Kimaki Adapter")
const { resolveKimakiConfig } = await import("../src/kimaki/config")

// Test: resolveKimakiConfig
{
  const config = resolveKimakiConfig({
    enabled: true,
    connection: { baseUrl: "http://127.0.0.1:31099" },
    autoStart: { enabled: false },
    channels: [],
    agents: [],
    defaultVerbosity: "text_and_essential_tools",
    defaultMentionMode: false,
    useWorktrees: false,
    permissionTimeoutMs: 600000,
    shellPrefix: "!",
  })
  assert(config !== null, "resolveKimakiConfig returns config")
  assertEq(config.connection.baseUrl, "http://127.0.0.1:31099", "config has correct baseUrl")
}

// Test: resolveKimakiConfig shallow-copy — independent arrays
{
  const sharedChannels = [{ channel: "#test", project: "/tmp/test" }]
  const sharedAgents = [{ kimaki: "agent1", mimo: "agent2" }]

  const config1 = resolveKimakiConfig({
    channels: sharedChannels,
    agents: sharedAgents,
  } as any)
  const config2 = resolveKimakiConfig({
    channels: sharedChannels,
    agents: sharedAgents,
  } as any)

  // channels and agents should be different array references (not shared)
  assert(config1.channels !== config2.channels, "two calls return different channels array references")
  assert(config1.agents !== config2.agents, "two calls return different agents array references")

  // Mutating one should not affect the other
  config1.channels.push({ channel: "#mutated", project: "/tmp/mutated" } as any)
  assertEq(config2.channels.length, 1, "mutating config1.channels does not affect config2.channels")

  // connection should also be a new object (spread-copy)
  assert(config1.connection !== config2.connection, "connection objects are independent copies")
  assertEq(config1.connection.baseUrl, "http://127.0.0.1:31099", "connection baseUrl preserved in copy")
}

// Test: resolveKimakiConfig with no input returns defaults with fresh arrays
{
  const config = resolveKimakiConfig()
  assert(Array.isArray(config.channels), "default config has channels array")
  assert(Array.isArray(config.agents), "default config has agents array")
  assertEq(config.channels.length, 0, "default channels is empty")
  assertEq(config.agents.length, 0, "default agents is empty")
  assertEq(config.enabled, false, "default config is disabled")
}

// Test: KimakiStatusTool creation
const { createKimakiStatusTool } = await import("../src/tools/kimaki-status")
{
  const tool = createKimakiStatusTool({
    enabled: true,
    config: {
      enabled: true,
      connection: { baseUrl: "http://127.0.0.1:31099" },
      autoStart: { enabled: false },
      channels: [],
      agents: [],
      defaultVerbosity: "text_and_essential_tools",
      defaultMentionMode: false,
      useWorktrees: false,
      permissionTimeoutMs: 600000,
      shellPrefix: "!",
    },
  })
  assert(tool !== null, "kimaki-status tool creates successfully")
}

// Test: KimakiSendTool creation
const { createKimakiSendTool } = await import("../src/tools/kimaki-send")
{
  const tool = createKimakiSendTool({
    enabled: true,
    config: {
      enabled: true,
      connection: { baseUrl: "http://127.0.0.1:31099" },
      autoStart: { enabled: false },
      channels: [],
      agents: [],
      defaultVerbosity: "text_and_essential_tools",
      defaultMentionMode: false,
      useWorktrees: false,
      permissionTimeoutMs: 600000,
      shellPrefix: "!",
    },
  })
  assert(tool !== null, "kimaki-send tool creates successfully")
}

// === Quota Service Caching ===
section("Quota Service Caching")
{
  const cacheQuota = new QuotaService()
  const internalCache = (cacheQuota as any).cache as Map<string, any>

  // First call fetches fresh data — cache should be empty before
  const before = internalCache.get("mimo")
  assert(!before || Date.now() - before.fetchedAt >= 300000, "cache starts empty or expired for mimo")

  const first = await cacheQuota.getQuota("mimo")
  const cachedAfterFirst = internalCache.get("mimo")
  assert(cachedAfterFirst !== undefined, "first call populates cache")
  assert(cachedAfterFirst.fetchedAt > 0, "cached entry has fetchedAt timestamp")

  // Second call within TTL returns cached data (same fetchedAt)
  const second = await cacheQuota.getQuota("mimo")
  const cachedAfterSecond = internalCache.get("mimo")
  assertEq(cachedAfterSecond.fetchedAt, cachedAfterFirst.fetchedAt, "second call within TTL returns cached fetchedAt")

  // Call after TTL expires fetches fresh data
  // Simulate expiry by setting fetchedAt to the distant past
  const staleEntry = internalCache.get("mimo")
  if (staleEntry) {
    staleEntry.fetchedAt = Date.now() - 600000 // 10 minutes ago, beyond 5-min TTL
    internalCache.set("mimo", staleEntry)
  }
  await cacheQuota.getQuota("mimo")
  const cachedAfterExpiry = internalCache.get("mimo")
  assert(cachedAfterExpiry !== undefined, "cache entry exists after expiry refresh")
  assert(
    !staleEntry || cachedAfterExpiry.fetchedAt > staleEntry.fetchedAt,
    "call after TTL expiry fetches fresh data (new fetchedAt)"
  )
}

// === Ralph Loop Tool ===
section("Ralph Loop Tool")
const { createRalphLoopTool } = await import("../src/tools/ralph-loop")
{
  const tool = createRalphLoopTool({})
  assert(tool !== null, "ralph-loop tool creates successfully")
  assert(typeof tool.execute === "function", "ralph-loop has execute method")
}

// Test: ralph-loop max_iterations clamp to 100
{
  const tool = createRalphLoopTool({})
  const result = await tool.execute({ prompt: "test task", max_iterations: 200 }, {})
  assert(typeof result === "string", "ralph-loop execute returns string")
  // The output should show Max iterations: 100 (clamped from 200)
  assert(result.includes("Max iterations**: 100"), "max_iterations > 100 is clamped to 100 in output")
}

// Test: ralph-loop default max_iterations (20)
{
  const tool = createRalphLoopTool({})
  const result = await tool.execute({ prompt: "test task" }, {})
  assert(result.includes("Max iterations**: 20"), "default max_iterations is 20")
}

console.log(`\n=== Compat/Quota/Review Tests: ${passed} passed, ${failed} failed ===`)
process.exit(failed > 0 ? 1 : 0)

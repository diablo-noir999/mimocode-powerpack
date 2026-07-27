/**
 * Test: Hooks + Utility Modules
 * Covers: dedup-prune, error-prune, intent-gate, comment-checker, rules-injector,
 *         model-fallback, transform-pipeline, notify,
 *         todo-enforcer, memory-utils, message-utils, team/utils
 * Run: bun run test/test-hooks.ts
 */

import type { HookInput, HookOutput } from '../src/types'

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

function assertDeepEq(a: any, b: any, msg: string) {
  assert(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)}, expected ${JSON.stringify(b)})`)
}

function assertMatch(a: string, pattern: RegExp, msg: string) {
  assert(pattern.test(a), `${msg} (got ${JSON.stringify(a)}, pattern ${pattern})`)
}

function section(name: string) {
  console.log(`\n--- ${name} ---`)
}

// === Dedup Prune Hook ===
section("Dedup Prune Hook")
const { createDedupPruneHook } = await import("../src/hooks/dedup-prune")
const dedupHook = createDedupPruneHook()

// Helper: create a minimal WithParts-format user message
function wpUser(text: string): any {
  return { info: { role: "user", id: `u-${Math.random()}`, sessionID: "s", time: { created: 0 }, agent: "a", model: {} }, parts: [{ type: "text" as const, text }] }
}

// Helper: create a minimal WithParts-format assistant message with optional tool parts
function wpAsst(text: string, tools?: any[]): any {
  const parts: any[] = [{ type: "text" as const, text }]
  if (tools) parts.push(...tools)
  return { info: { role: "assistant", id: `a-${Math.random()}`, sessionID: "s", time: { created: 0 }, model: {} }, parts }
}

// Minimal completed tool part for dedup tests
function completedTool(callID: string, tool: string, input: any, output: string): any {
  return { type: "tool" as const, callID, tool, state: { status: "completed" as const, input, output, title: tool, metadata: {}, time: { start: 0, end: 1 } } }
}

// Test: removes duplicate tool calls
{
  const input = {
    messages: [
      wpUser("hello"),
      wpAsst("hi", [completedTool("c1", "read", { file_path: "/a" }, "file a")]),
      wpUser("again"),
      wpAsst("ok", [completedTool("c2", "read", { file_path: "/a" }, "file a again")]),
    ],
  }
  const output = { messages: structuredClone(input.messages) }
  await dedupHook(input, output)
  // The dedup hook should clear the older duplicate's output
  const olderParts = output.messages[1].parts
  const prunedTool = olderParts.find((p: any) => p.type === "tool" && p.state?.output === "[Duplicate tool output pruned]")
  assert(prunedTool !== undefined, "dedup clears the older duplicate's tool output")
  assertEq(output.messages.length, input.messages.length, "dedup preserves message count")
}

// Test: no duplicates = no change
{
  const input = {
    messages: [
      wpUser("hello"),
      wpAsst("hi", [completedTool("c1", "read", { file_path: "/a" }, "file a")]),
    ],
  }
  const output = { messages: structuredClone(input.messages) }
  await dedupHook(input, output)
  assertEq(output.messages.length, 2, "dedup: no change when no duplicates")
}

// Test: three-way duplicate only prunes the oldest pair
{
  const input = {
    messages: [
      wpAsst("first", [completedTool("c1", "read", { file_path: "/x" }, "x1")]),
      wpAsst("second", [completedTool("c2", "read", { file_path: "/x" }, "x2")]),
      wpAsst("third", [completedTool("c3", "read", { file_path: "/x" }, "x3")]),
    ],
  }
  const output = { messages: structuredClone(input.messages) }
  await dedupHook(input, output)
  const prunedCount = output.messages.filter((m: any) =>
    m.parts?.some((p: any) => p.type === "tool" && p.state?.output === "[Duplicate tool output pruned]")
  ).length
  assert(prunedCount >= 1, `dedup prunes duplicates from 3-way repeat (got ${prunedCount} pruned)`)
}

// === Error Prune Hook ===
section("Error Prune Hook")
const { createErrorPruneHook } = await import("../src/hooks/error-prune")
const errorHook = createErrorPruneHook(4)

// Helper: minimal error tool part
function errorTool(callID: string, tool: string, input: any, error: string): any {
  return { type: "tool" as const, callID, tool, state: { status: "error" as const, input, error, time: { start: 0, end: 1 } } }
}
// Helper: minimal completed tool part (non-error)
function okTool(callID: string, tool: string, input: any, output: string): any {
  return { type: "tool" as const, callID, tool, state: { status: "completed" as const, input, output, title: tool, metadata: {}, time: { start: 0, end: 1 } } }
}

// Test: prunes errored tool inputs after threshold
{
  const errorHook = createErrorPruneHook(2) // prune after 2 turns
  const input = {
    messages: [
      wpUser("hello"),                                                          // idx 0
      wpAsst("trying", [errorTool("c1", "bash", { command: "bad" }, "Error: command failed")]),  // idx 1 — 3 turns ago → prune
      wpUser("step 2"),                                                         // idx 2
      wpAsst("retry", [errorTool("c2", "bash", { command: "bad2" }, "Error: failed again")]),    // idx 3 — 2 turns ago → prune
      wpUser("step 3"),                                                         // idx 4
      wpAsst("one more", [errorTool("c3", "bash", { command: "bad3" }, "Error: still failing")]), // idx 5 — 1 turn ago → no prune
      wpUser("current"),                                                        // idx 6
      wpAsst("done", [okTool("c4", "bash", { command: "good" }, "success")]),   // idx 7
    ],
  }
  const output = { messages: structuredClone(input.messages) }
  await errorHook(input, output)

  // idx 1: should be pruned (input cleared, error message augmented)
  const msg1 = output.messages[1]
  const part1 = msg1.parts.find((p: any) => p.type === "tool")
  assert(part1 !== undefined && typeof part1.state.input === "object" && Object.keys(part1.state.input).length === 0, "error-prune clears input on old errors")
  assert(part1.state.error.includes("[Input content pruned after"), "error-prune adds note to error message")

  // idx 3: should also be pruned
  const msg3 = output.messages[3]
  const part3 = msg3.parts.find((p: any) => p.type === "tool")
  assert(part3 !== undefined && Object.keys(part3.state.input).length === 0, "error-prune clears input on 2nd old error")
  assert(part3.state.error.includes("[Input content pruned after"), "error-prune adds note to 2nd error")

  // idx 5: should NOT be pruned (only 1 turn ago < threshold 2)
  const msg5 = output.messages[5]
  const part5 = msg5.parts.find((p: any) => p.type === "tool")
  assert(part5 !== undefined && Object.keys(part5.state.input).length > 0, "error-prune does NOT prune recent errors")
}

// Test: error-prune does NOT touch non-error messages (WithParts format)
{
  const errorHook = createErrorPruneHook(2)
  const input = {
    messages: [
      wpUser("hello"),
      wpAsst("working", [okTool("c1", "bash", { command: "good" }, "success")]),
      wpUser("step 2"),
      wpAsst("done", [okTool("c2", "bash", { command: "good2" }, "success2")]),
    ],
  }
  const output = { messages: structuredClone(input.messages) }
  await errorHook(input, output)
  // Verify the completed tool parts still have their original input (not cleared)
  const part1 = output.messages[1].parts.find((p: any) => p.type === "tool")
  assert(part1 !== undefined && Object.keys(part1.state.input).length > 0, "error-prune does NOT touch completed tool inputs")
  assertEq(part1.state.output, "success", "error-prune does NOT touch completed tool outputs")
}

// === Intent Gate Hook ===
section("Intent Gate Hook")
const { createIntentGateHook } = await import("../src/hooks/intent-gate")
const intentHook = createIntentGateHook()

// Test: ultrawork keyword triggers injection
{
  const input: HookInput & { message: string } = { message: "ultrawork mode please" }
  const output: any = {}
  await intentHook(input, output)
  assert(typeof output.injectedPrompt === "string" && output.injectedPrompt.length > 0,
    "intent-gate sets injectedPrompt when keyword matches")
}

// Test: normal message passes through
{
  const input: HookInput & { message: string } = { message: "please help me fix this bug" }
  const output: any = {}
  await intentHook(input, output)
  assert(output.injectedPrompt === undefined, "intent-gate does not inject prompt for normal messages")
}

// Test: empty message does not crash
{
  const input: HookInput & { message: string } = { message: "" }
  const output: any = {}
  await intentHook(input, output)
  assert(output.injectedPrompt === undefined, "intent-gate handles empty message without crashing")
}

// === Comment Checker Hook ===
section("Comment Checker Hook")
const { createCommentCheckerHook } = await import("../src/hooks/comment-checker")
const commentChecker = createCommentCheckerHook()

// Test: detects AI slop comments on edit tools
{
  const input: HookInput = { tool: "edit" } as any
  const output: HookOutput = {
    content: '// This is simply the best approach\n// We clearly need to leverage this module\n// Obviously it handles the request'
  }
  await commentChecker(input, output)
  assert(output.content!.includes("Comment Checker"), "comment-checker adds warning for AI slop patterns")
  assert(output.content!.includes("Detected AI slop"), "comment-checker identifies slop in output")
}

// Test: comment-checker warns about slop words but preserves original content
{
  const input: HookInput = { tool: "edit" } as any
  const output: HookOutput = {
    content: '// This is simply great\n// Furthermore, we leverage it'
  }
  await commentChecker(input, output)
  assert(output.content!.includes("Comment Checker"), "comment-checker adds warning for slop words")
  assert(output.content!.includes("simply"), "comment-checker preserves original content (warning-only, no stripping)")
  assert(output.content!.includes("Furthermore"), "comment-checker preserves original content (warning-only, no stripping)")
}

// Test: passes through non-edit tools
{
  const input: HookInput = { tool: "bash" } as any
  const output: HookOutput = { content: 'some output' }
  const originalContent = output.content
  await commentChecker(input, output)
  assertEq(output.content, originalContent, "comment-checker leaves non-edit output unchanged")
}

// Test: clean comments pass through
{
  const input: HookInput = { tool: "edit" } as any
  const output: HookOutput = {
    content: '// Parse the input string\n// Return the result object'
  }
  await commentChecker(input, output)
  assertEq(output.content, '// Parse the input string\n// Return the result object',
    "comment-checker leaves clean comments unchanged")
}

// Test: no content in output does not crash
{
  const input: HookInput = { tool: "edit" } as any
  const output: HookOutput = {}
  await commentChecker(input, output)
  assert(output.content === undefined, "comment-checker handles missing content gracefully")
}

// === Rules Injector Hook ===
section("Rules Injector Hook")
const { createRulesInjectorHook } = await import("../src/hooks/rules-injector")
const mockCtx = { projectPath: "/home/ir192m2/Documents/LLMs/mimocode-powerpack" }
const rulesInjector = createRulesInjectorHook(mockCtx)

// Test: runs without crashing on edit tool
{
  const input: HookInput = { tool: "edit", args: { file_path: "/home/ir192m2/Documents/LLMs/mimocode-powerpack/src/server.ts" } } as any
  const output: any = {}
  await rulesInjector(input, output)
  assert(typeof output === "object", "rules-injector returns without crashing")
}

// Test: non-edit tools pass through
{
  const input: HookInput = { tool: "bash" } as any
  const output: any = {}
  await rulesInjector(input, output)
  assert(output.injectedRules === undefined, "rules-injector does not inject rules for non-edit tools")
}

// === Model Fallback Hook ===
section("Model Fallback Hook")
const { createModelFallbackHook } = await import("../src/hooks/model-fallback")

// Test: handles session error and returns void
{
  const modelFallback = createModelFallbackHook()
  const input: HookInput & { type: string; error: any } = {
    type: "session.error",
    error: { message: "Rate limit exceeded", model: "mimo-v2.5-pro" },
  } as any
  const inputCopy = { ...input }
  const result = await modelFallback(input)
  assert(result === undefined, "model-fallback returns undefined (void)")
  assertEq(JSON.stringify(input), JSON.stringify(inputCopy), "model-fallback does not mutate input")
}

// Test: non-error event type is ignored
{
  const modelFallback = createModelFallbackHook()
  const input: HookInput & { type: string } = { type: "session.idle" } as any
  const inputCopy = { ...input }
  const result = await modelFallback(input)
  assert(result === undefined, "model-fallback ignores non-error events")
  assertEq(JSON.stringify(input), JSON.stringify(inputCopy), "model-fallback does not mutate non-error input")
}

// Test: multiple error events do not crash
{
  const modelFallback = createModelFallbackHook()
  const events = [
    { type: "session.error", error: { message: "err1", model: "m1" } },
    { type: "session.error", error: { message: "err2", model: "m2" } },
    { type: "session.error", error: { message: "err3", model: "m3" } },
  ]
  for (const event of events) {
    const result = await modelFallback(event as any)
    assert(result === undefined, `model-fallback handles repeated error event without crashing`)
  }
}

// === Transform Pipeline Hook ===
section("Transform Pipeline Hook")
const { createTransformPipelineHook, DEFAULT_TRANSFORM_CONFIG } = await import("../src/hooks/transform-pipeline")
const transformHook = createTransformPipelineHook("/home/ir192m2/Documents/LLMs/mimocode-powerpack", DEFAULT_TRANSFORM_CONFIG)

// Test: transform pipeline runs on messages
{
  const input: HookInput & { messages: any[] } = {
    messages: [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there again" },
    ],
  }
  const output: HookOutput & { messages: any[] } = { messages: [...input.messages] }
  await transformHook(input, output)
  assert(Array.isArray(output.messages), "transform-pipeline preserves messages as array")
  assertEq(output.messages.length, input.messages.length, "transform-pipeline preserves message count")
}

// Test: transform pipeline handles empty messages
{
  const input: HookInput & { messages: any[] } = { messages: [] }
  const output: HookOutput & { messages: any[] } = { messages: [] }
  await transformHook(input, output)
  assertEq(output.messages.length, 0, "transform-pipeline handles empty messages array")
}

// === Notify Hook ===
section("Notify Hook")
const { createNotifyHook } = await import("../src/hooks/notify")
const notifyHook = createNotifyHook({ enabled: true, quietHours: { start: "22:00", end: "08:00" } })

// Test: handles notification event and returns void
{
  const event = { type: "session.completed", title: "Test", message: "Test notification" }
  const eventCopy = { ...event }
  const result = await notifyHook(event)
  assert(result === undefined, "notify hook returns undefined (void)")
  assertEq(JSON.stringify(event), JSON.stringify(eventCopy), "notify hook does not mutate input event")
}

// Test: unknown event types are silently ignored
{
  const unknownEvent = { type: "unknown.event.type", title: "Test", message: "Should be ignored" }
  const result = await notifyHook(unknownEvent)
  assert(result === undefined, "notify hook silently ignores unrecognized event types")
}

// Test: handles different event types without throwing
{
  const events = [
    { type: "session.error", error: { message: "Something went wrong" } },
    { type: "permission.asked", tool: "bash", description: "Run command" },
    { type: "session.completed", lastMessage: "Task finished" },
    { type: "question.asked", question: "What should I do?" },
  ]
  for (const evt of events) {
    const result = await notifyHook(evt)
    assert(result === undefined, `notify hook handles '${evt.type}' without throwing`)
  }
}

// Test: notify hook with quiet hours config does not crash
{
  const nightHook = createNotifyHook({ enabled: true, quietHours: { start: "09:00", end: "17:00" } })
  const result = await nightHook({ type: "session.completed", lastMessage: "msg" })
  assert(result === undefined, "notify hook with quiet hours config runs without crashing")
}

// Test: session.error includes error message in body
{
  const errorHook = createNotifyHook({ enabled: true })
  const event = { type: "session.error", error: { message: "Rate limit exceeded" } }
  const result = await errorHook(event)
  assert(result === undefined, "notify hook handles session.error with error message")
}

// Test: question.asked includes question in body
{
  const questionHook = createNotifyHook({ enabled: true })
  const event = { type: "question.asked", question: "Should I proceed?" }
  const result = await questionHook(event)
  assert(result === undefined, "notify hook handles question.asked with question text")
}

// Test: sessionID is included in notification
{
  const sessionHook = createNotifyHook({ enabled: true })
  const event = { type: "session.completed", sessionID: "ses_abc123def456", lastMessage: "Done" }
  const result = await sessionHook(event)
  assert(result === undefined, "notify hook handles event with sessionID")
}

// Test: disabled hook does nothing
{
  const disabledHook = createNotifyHook({ enabled: false })
  const result = await disabledHook({ type: "session.completed", lastMessage: "msg" })
  assert(result === undefined, "disabled notify hook is a no-op")
}

// Test: showMessage=false suppresses message content
{
  const noMsgHook = createNotifyHook({ enabled: true, showMessage: false })
  const result = await noMsgHook({ type: "session.completed", lastMessage: "secret content" })
  assert(result === undefined, "notify hook with showMessage=false runs without crashing")
}

// === Todo Enforcer Hook ===
section("Todo Enforcer Hook")
const { createTodoEnforcerHook } = await import("../src/hooks/todo-enforcer")

// Test: handles idle session
{
  const todoEnforcer = createTodoEnforcerHook({ enabled: true, maxFailures: 5, cooldownMs: 30000 })
  const input = { type: "session.idle", sessionID: "test-session", context: "no tasks here" }
  const result = await todoEnforcer(input)
  assert(result === undefined, "todo-enforcer returns undefined on idle session")
}

// Test: disabled enforcer is a no-op
{
  const todoEnforcer = createTodoEnforcerHook({ enabled: false, maxFailures: 5, cooldownMs: 30000 })
  const input = { type: "session.idle", sessionID: "test-session", context: "test" }
  const result = await todoEnforcer(input)
  assert(result === undefined, "todo-enforcer returns undefined when disabled")
}

// Test: unknown event type does not crash
{
  const todoEnforcer = createTodoEnforcerHook({ enabled: true, maxFailures: 5, cooldownMs: 30000 })
  const result = await todoEnforcer({ type: "unknown.event" })
  assert(result === undefined, "todo-enforcer handles unknown event type without crashing")
}

// ============================================================
// === Memory Utils ===
// ============================================================
section("Memory Utils")
const { rowToMemory } = await import("../src/memory/memory-utils")

// Test: converts a SQL row object to a Memory type
{
  const row = {
    id: 1,
    project_path: "/home/user/project",
    category: "PROJECT_RULES",
    content: "Always use TypeScript",
    normalized_hash: "abc123",
    importance: 0.8,
    scope: "project",
    source_session_id: "ses_abc",
    source_type: "manual",
    seen_count: 5,
    retrieval_count: 2,
    created_at: 1700000000000,
    updated_at: 1700000000000,
    last_seen_at: 1700000000000,
    last_retrieved_at: 1700000000000,
    status: "active",
    expires_at: null,
  }
  const memory = rowToMemory(row)
  assertEq(memory.id, 1, "rowToMemory maps id correctly")
  assertEq(memory.projectPath, "/home/user/project", "rowToMemory maps project_path to projectPath")
  assertEq(memory.category, "PROJECT_RULES", "rowToMemory maps category")
  assertEq(memory.content, "Always use TypeScript", "rowToMemory maps content")
  assertEq(memory.normalizedHash, "abc123", "rowToMemory maps normalized_hash to normalizedHash")
  assertEq(memory.importance, 0.8, "rowToMemory maps importance")
  assertEq(memory.scope, "project", "rowToMemory maps scope")
  assertEq(memory.sourceSessionId, "ses_abc", "rowToMemory maps source_session_id to sourceSessionId")
  assertEq(memory.sourceType, "manual", "rowToMemory maps source_type to sourceType")
  assertEq(memory.seenCount, 5, "rowToMemory maps seen_count to seenCount")
  assertEq(memory.retrievalCount, 2, "rowToMemory maps retrieval_count to retrievalCount")
  assertEq(memory.createdAt, 1700000000000, "rowToMemory maps created_at to createdAt")
  assertEq(memory.updatedAt, 1700000000000, "rowToMemory maps updated_at to updatedAt")
  assertEq(memory.lastSeenAt, 1700000000000, "rowToMemory maps last_seen_at to lastSeenAt")
  assertEq(memory.lastRetrievedAt, 1700000000000, "rowToMemory maps last_retrieved_at to lastRetrievedAt")
  assertEq(memory.status, "active", "rowToMemory maps status")
  assertEq(memory.expiresAt, null, "rowToMemory maps null expires_at to null expiresAt")
}

// Test: handles null optional fields gracefully
{
  const row = {
    id: 2,
    project_path: "/home/user/project",
    category: "LESSONS_LEARNED",
    content: "Keep it simple",
    normalized_hash: "def456",
    importance: 0.5,
    scope: "global",
    source_session_id: null,
    source_type: "auto_capture",
    seen_count: 1,
    retrieval_count: 0,
    created_at: 1700000000000,
    updated_at: 1700000000000,
    last_seen_at: 1700000000000,
    last_retrieved_at: null,
    status: "active",
    expires_at: null,
  }
  const memory = rowToMemory(row)
  assertEq(memory.sourceSessionId, null, "rowToMemory handles null source_session_id")
  assertEq(memory.lastRetrievedAt, null, "rowToMemory handles null last_retrieved_at")
  assertEq(memory.expiresAt, null, "rowToMemory handles null expires_at")
}

// ============================================================
// === Message Utils ===
// ============================================================
section("Message Utils")
const { isRecord, getToolName, getToolInput } = await import("../src/memory/message-utils")

// --- isRecord ---
// Test: returns true for plain objects
{
  assert(isRecord({}) === true, "isRecord returns true for empty object")
  assert(isRecord({ a: 1 }) === true, "isRecord returns true for non-empty object")
}

// Test: returns false for primitives and null
{
  assert(isRecord(null) === false, "isRecord returns false for null")
  assert(isRecord(undefined) === false, "isRecord returns false for undefined")
  assert(isRecord(42) === false, "isRecord returns false for number")
  assert(isRecord("hello") === false, "isRecord returns false for string")
  assert(isRecord(true) === false, "isRecord returns false for boolean")
}

// Test: returns false for arrays
{
  assert(isRecord([]) === false, "isRecord returns false for empty array")
  assert(isRecord([1, 2, 3]) === false, "isRecord returns false for non-empty array")
}

// --- getToolName ---
// Test: extracts name from message with name field
{
  const msg = { name: "read" }
  assertEq(getToolName(msg), "read", "getToolName extracts name from message.name")
}

// Test: extracts name from message with tool field
{
  const msg = { tool: "bash" }
  assertEq(getToolName(msg), "bash", "getToolName extracts name from message.tool")
}

// Test: extracts name from parts array
{
  const msg = { parts: [{ tool: "edit" }] }
  assertEq(getToolName(msg), "edit", "getToolName extracts name from parts[].tool")
}

// Test: extracts name from parts with toolName
{
  const msg = { parts: [{ toolName: "write" }] }
  assertEq(getToolName(msg), "write", "getToolName extracts name from parts[].toolName")
}

// Test: extracts name from parts with name
{
  const msg = { parts: [{ name: "glob" }] }
  assertEq(getToolName(msg), "glob", "getToolName extracts name from parts[].name")
}

// Test: returns null when no tool name found
{
  const msg = { content: "hello" }
  assertEq(getToolName(msg), null, "getToolName returns null for message with no tool info")
}

// Test: returns null for empty parts array
{
  const msg = { parts: [] }
  assertEq(getToolName(msg), null, "getToolName returns null for empty parts array")
}

// --- getToolInput ---
// Test: extracts arguments from message.arguments
{
  const msg = { arguments: { command: "ls -la" } }
  const input = getToolInput(msg)
  assert(input !== null && input.command === "ls -la", "getToolInput extracts from message.arguments")
}

// Test: extracts input from message.input
{
  const msg = { input: { file_path: "/tmp/test" } }
  const input = getToolInput(msg)
  assert(input !== null && input.file_path === "/tmp/test", "getToolInput extracts from message.input")
}

// Test: extracts args from parts[].args
{
  const msg = { parts: [{ args: { content: "hello" } }] }
  const input = getToolInput(msg)
  assert(input !== null && input.content === "hello", "getToolInput extracts from parts[].args")
}

// Test: extracts input from parts[].input
{
  const msg = { parts: [{ input: { query: "search" } }] }
  const input = getToolInput(msg)
  assert(input !== null && input.query === "search", "getToolInput extracts from parts[].input")
}

// Test: extracts input from parts[].state.input
{
  const msg = { parts: [{ state: { input: { data: "test" } } }] }
  const input = getToolInput(msg)
  assert(input !== null && input.data === "test", "getToolInput extracts from parts[].state.input")
}

// Test: returns null when no input found
{
  const msg = { content: "hello" }
  assertEq(getToolInput(msg), null, "getToolInput returns null for message with no input")
}

// ============================================================
// === Team Utils ===
// ============================================================
section("Team Utils")
const { ensureDir } = await import("../src/team/utils")
const { mkdtemp, rm, stat } = await import("node:fs/promises")
const { join } = await import("node:path")
const { tmpdir } = await import("node:os")

// Test: creates directory if it doesn't exist
{
  const tmpBase = await mkdtemp(join(tmpdir(), "team-utils-test-"))
  const targetDir = join(tmpBase, "new-dir", "nested")
  await ensureDir(targetDir)
  const st = await stat(targetDir)
  assert(st.isDirectory(), "ensureDir creates nested directory that didn't exist")
  await rm(tmpBase, { recursive: true, force: true })
}

// Test: doesn't throw if directory already exists
{
  const tmpBase = await mkdtemp(join(tmpdir(), "team-utils-test-"))
  await ensureDir(tmpBase)
  await ensureDir(tmpBase) // second call should not throw
  const st = await stat(tmpBase)
  assert(st.isDirectory(), "ensureDir does not throw when directory already exists")
  await rm(tmpBase, { recursive: true, force: true })
}

// Test: creates deep nested directories
{
  const tmpBase = await mkdtemp(join(tmpdir(), "team-utils-test-"))
  const deepPath = join(tmpBase, "a", "b", "c", "d", "e")
  await ensureDir(deepPath)
  const st = await stat(deepPath)
  assert(st.isDirectory(), "ensureDir creates deeply nested directories")
  await rm(tmpBase, { recursive: true, force: true })
}

// Test: directory has correct permissions (0o700)
{
  const tmpBase = await mkdtemp(join(tmpdir(), "team-utils-test-"))
  const targetDir = join(tmpBase, "perm-test")
  await ensureDir(targetDir)
  const { mode } = await stat(targetDir)
  // Check that the owner has read+write+execute (bits 0o700)
  const permBits = (mode & 0o777)
  assertEq(permBits, 0o700, `ensureDir creates directory with 0o700 permissions (got ${permBits.toString(8)})`)
  await rm(tmpBase, { recursive: true, force: true })
}

// === Tool Discovery Hook ===
section("Tool Discovery Hook")
const { createToolDiscoveryHook } = await import("../src/hooks/tool-discovery")
const discoveryHook = createToolDiscoveryHook()

// Test: disabled — flat message injection removed for MiMo-Code v0.1.7+ compat
{
  const input = { messages: [{ role: "user", content: "hello" }] }
  const output = { messages: [{ role: "user", content: "hello" }] }
  await discoveryHook(input, output)
  assert(output.messages.length === 1 && output.messages[0].role === "user", "tool-discovery is no-op (disabled)")
}

// Test: does not inject on existing conversation
{
  const input = { messages: [
    { role: "user", content: "hello" },
    { role: "assistant", content: "hi" },
    { role: "user", content: "help" },
  ] }
  const output = { messages: [...input.messages] }
  await discoveryHook(input, output)
  assert(output.messages[0].role === "user", "tool-discovery does not inject on existing conversation")
}

// Test: does not double-inject
{
  const input = { messages: [
    { role: "system", content: "## Powerpack Tools Available\nstuff" },
    { role: "user", content: "hello" },
  ] }
  const output = { messages: [...input.messages] }
  await discoveryHook(input, output)
  const systemCount = output.messages.filter((m: any) => m.role === "system" && m.content?.includes("Powerpack Tools Available")).length
  assertEq(systemCount, 1, "tool-discovery does not double-inject")
}

// Test: handles missing messages array gracefully
{
  const input = {}
  const output = { messages: undefined }
  await discoveryHook(input, output)
  assert(true, "tool-discovery handles missing messages gracefully")
}

// Test: handles empty messages array
{
  const input = { messages: [] }
  const output = { messages: [] }
  await discoveryHook(input, output)
  assert(true, "tool-discovery handles empty messages array")
}

// ============================================================
// === Summary ===
// ============================================================
console.log(`\n=== Hook & Utility Tests: ${passed} passed, ${failed} failed ===`)
process.exit(failed > 0 ? 1 : 0)

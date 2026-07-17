/**
 * Test: Team coordination (mailbox, tasklist)
 * Run: bun run test/test-team.ts
 */

import { mkdirSync, rmSync, mkdtempSync } from "node:fs"
import { join } from "node:path"

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

const TEST_DIR = "/tmp/powerpack-test-team"
rmSync(TEST_DIR, { recursive: true, force: true })
mkdirSync(TEST_DIR, { recursive: true })

// === Utils ===
section("Team Utils - ensureDir")
const { ensureDir } = await import("../src/team/utils")

// Test: ensureDir creates a directory
{
  const dir = join(TEST_DIR, "utils-test")
  await ensureDir(dir)
  const { statSync } = await import("node:fs")
  assert(statSync(dir).isDirectory(), "ensureDir creates directory")
  rmSync(dir, { recursive: true, force: true })
}

// Test: ensureDir is idempotent (doesn't throw on second call)
{
  const dir = join(TEST_DIR, "utils-idempotent")
  await ensureDir(dir)
  await ensureDir(dir) // should not throw
  const { statSync } = await import("node:fs")
  assert(statSync(dir).isDirectory(), "ensureDir is idempotent (second call succeeds)")
  rmSync(dir, { recursive: true, force: true })
}

// Test: ensureDir creates nested directories
{
  const dir = join(TEST_DIR, "utils-nested", "a", "b", "c")
  await ensureDir(dir)
  const { statSync } = await import("node:fs")
  assert(statSync(dir).isDirectory(), "ensureDir creates nested directories")
  rmSync(join(TEST_DIR, "utils-nested"), { recursive: true, force: true })
}

// === Mailbox ===
section("Mailbox - sendMessage")
const { sendMessage, listUnreadMessages, ackMessages, buildEnvelope } = await import("../src/team/mailbox")

const mailboxConfig = { baseDir: TEST_DIR, maxMessageSizeBytes: 1024 }

// Test: send and receive message
{
  const msg = {
    version: 1 as const,
    messageId: "msg-001",
    from: "agent-a",
    to: "agent-b",
    body: "Hello from agent A",
    kind: "message" as const,
    timestamp: Date.now(),
  }
  const result = await sendMessage(msg, "team-run-1", mailboxConfig)
  assert(result.messageId === "msg-001", "sendMessage returns messageId")
  assert(result.deliveredTo !== undefined, "sendMessage returns deliveredTo")
}

// Test: receive messages
{
  const messages = await listUnreadMessages("team-run-1", "agent-b", mailboxConfig)
  assert(messages.length > 0, `listUnreadMessages returns messages (got ${messages.length})`)
  assertEq(messages[0].body, "Hello from agent A", "received message has correct body")
  assertEq(messages[0].from, "agent-a", "received message has correct sender")
}

// Test: ackMessages clears inbox
{
  const messagesBefore = await listUnreadMessages("team-run-1", "agent-b", mailboxConfig)
  const ids = messagesBefore.map(m => m.messageId)
  await ackMessages("team-run-1", "agent-b", ids, mailboxConfig)
  const messagesAfter = await listUnreadMessages("team-run-1", "agent-b", mailboxConfig)
  assertEq(messagesAfter.length, 0, "ackMessages clears inbox after ack")
}

// Test: broadcast message
{
  const msg = {
    version: 1 as const,
    messageId: "msg-broadcast",
    from: "lead",
    to: "*",
    body: "Broadcast to all",
    kind: "announcement" as const,
    timestamp: Date.now(),
  }
  const result = await sendMessage(msg, "team-run-1", mailboxConfig)
  assert(result.deliveredTo !== undefined, "broadcast returns deliveredTo")
}

// Test: message too large
{
  const msg = {
    version: 1 as const,
    messageId: "msg-large",
    from: "agent-a",
    to: "agent-b",
    body: "x".repeat(2000), // exceeds 1024 limit
    kind: "message" as const,
    timestamp: Date.now(),
  }
  try {
    await sendMessage(msg, "team-run-1", mailboxConfig)
    assert(false, "large message should throw")
  } catch (e: any) {
    assert(e.message.includes("payload exceeds"), `large message throws size error: ${e.message}`)
  }
}

// Test: listUnreadMessages returns array
{
  const msgs = await listUnreadMessages("team-run-1", "agent-b", mailboxConfig)
  assert(Array.isArray(msgs), "listUnreadMessages returns array")
}

// Test: sendMessage rejects agentName with '..' (path traversal)
{
  const msg = {
    version: 1 as const,
    messageId: "msg-traversal-dotdot",
    from: "agent-a",
    to: "../etc/passwd",
    body: "Malicious",
    kind: "message" as const,
    timestamp: Date.now(),
  }
  try {
    await sendMessage(msg, "team-run-1", mailboxConfig)
    assert(false, "sendMessage with '..' in agentName should throw")
  } catch (e: any) {
    assert(e.message.includes("path traversal"), `rejects '..' in agentName: ${e.message}`)
  }
}

// Test: sendMessage rejects agentName with '/' (path traversal)
{
  const msg = {
    version: 1 as const,
    messageId: "msg-traversal-slash",
    from: "agent-a",
    to: "agent-b/../../secret",
    body: "Malicious",
    kind: "message" as const,
    timestamp: Date.now(),
  }
  try {
    await sendMessage(msg, "team-run-1", mailboxConfig)
    assert(false, "sendMessage with '/' in agentName should throw")
  } catch (e: any) {
    assert(e.message.includes("path traversal"), `rejects '/' in agentName: ${e.message}`)
  }
}

// Test: sendMessage rejects agentName with '\' (path traversal)
{
  const msg = {
    version: 1 as const,
    messageId: "msg-traversal-backslash",
    from: "agent-a",
    to: "agent-b\\..\\windows",
    body: "Malicious",
    kind: "message" as const,
    timestamp: Date.now(),
  }
  try {
    await sendMessage(msg, "team-run-1", mailboxConfig)
    assert(false, "sendMessage with '\\' in agentName should throw")
  } catch (e: any) {
    assert(e.message.includes("path traversal"), `rejects '\\' in agentName: ${e.message}`)
  }
}

// Test: sendMessage rejects teamRunId with '..' (path traversal)
{
  const msg = {
    version: 1 as const,
    messageId: "msg-traversal-team",
    from: "agent-a",
    to: "agent-b",
    body: "Malicious",
    kind: "message" as const,
    timestamp: Date.now(),
  }
  try {
    await sendMessage(msg, "../sneaky-team", mailboxConfig)
    assert(false, "sendMessage with '..' in teamRunId should throw")
  } catch (e: any) {
    assert(e.message.includes("path traversal"), `rejects '..' in teamRunId: ${e.message}`)
  }
}

// === Tasklist ===
section("Tasklist")
const { createTask, getTask, listTasks, claimTask, updateTaskStatus } = await import("../src/team/tasklist")

const tasklistConfig = { baseDir: TEST_DIR }
const teamRunId = "team-run-1"

// Test: create task
{
  const task = await createTask(teamRunId, { subject: "Implement feature X", owner: "agent-a", status: "pending", blockedBy: [], description: "" }, tasklistConfig)
  assert(task.id !== undefined, "create returns task with id")
  assertEq(task.subject, "Implement feature X", "create preserves subject")
  assertEq(task.owner, "agent-a", "create preserves owner")
  assertEq(task.status, "pending", "create sets status to pending")
}

// Test: get task
{
  const tasks = await listTasks(teamRunId, tasklistConfig)
  assert(tasks.length > 0, `list returns tasks (got ${tasks.length})`)
  const first = tasks[0]
  const fetched = await getTask(teamRunId, first.id, tasklistConfig)
  assert(fetched !== null, "get returns task")
  assertEq(fetched!.subject, first.subject, "get returns correct task")
}

// Test: claim task
{
  const tasks = await listTasks(teamRunId, tasklistConfig, { status: "pending" })
  const task = tasks[0]
  await claimTask(teamRunId, task.id, "agent-b", tasklistConfig)
  const updated = await getTask(teamRunId, task.id, tasklistConfig)
  assertEq(updated!.status, "claimed", "claim sets status to claimed")
  assertEq(updated!.owner, "agent-b", "claim sets owner")
}

// Test: update task status
{
  const tasks = await listTasks(teamRunId, tasklistConfig)
  const task = tasks[0]
  await updateTaskStatus(teamRunId, task.id, "in_progress", tasklistConfig)
  const updated = await getTask(teamRunId, task.id, tasklistConfig)
  assertEq(updated!.status, "in_progress", "update changes status")
}

// Test: complete task
{
  const tasks = await listTasks(teamRunId, tasklistConfig)
  const task = tasks[0]
  await updateTaskStatus(teamRunId, task.id, "completed", tasklistConfig)
  const updated = await getTask(teamRunId, task.id, tasklistConfig)
  assertEq(updated!.status, "completed", "complete sets status to completed")
}

// Test: create multiple tasks
{
  await createTask(teamRunId, { subject: "Task 2", owner: "agent-a", status: "pending", blockedBy: [], description: "" }, tasklistConfig)
  await createTask(teamRunId, { subject: "Task 3", owner: "agent-b", status: "pending", blockedBy: [], description: "" }, tasklistConfig)
  const all = await listTasks(teamRunId, tasklistConfig)
  assert(all.length >= 3, `list returns all tasks (got ${all.length})`)
}

// Test: list with status filter
{
  const pendingTasks = await listTasks(teamRunId, tasklistConfig, { status: "pending" })
  const completedTasks = await listTasks(teamRunId, tasklistConfig, { status: "completed" })
  assert(pendingTasks.length >= 2, `pending filter returns at least 2 tasks (got ${pendingTasks.length})`)
  assert(completedTasks.length >= 1, `completed filter returns at least 1 task (got ${completedTasks.length})`)
}

// Test: withLock contention - concurrent claims on the same pending task
{
  // Create a fresh pending task for this contention test
  const contentionTask = await createTask(
    "team-run-contention",
    { subject: "Contention task", owner: "agent-a", status: "pending", blockedBy: [], description: "" },
    tasklistConfig,
  )

  // Fire two concurrent claims on the same pending task
  const results = await Promise.allSettled([
    claimTask("team-run-contention", contentionTask.id, "agent-x", tasklistConfig),
    claimTask("team-run-contention", contentionTask.id, "agent-y", tasklistConfig),
  ])

  const succeeded = results.filter(r => r.status === "fulfilled")
  const rejected = results.filter(r => r.status === "rejected")

  // Exactly one claim should succeed; the other should fail because the task
  // is no longer pending after the first claim acquires the lock.
  assertEq(succeeded.length, 1, "contention: exactly one concurrent claim succeeds")
  assertEq(rejected.length, 1, "contention: the other concurrent claim fails")

  // Verify the task was claimed by one of the two agents
  const final = await getTask("team-run-contention", contentionTask.id, tasklistConfig)
  assertEq(final!.status, "claimed", "contention: task ends up claimed")
  assert(
    final!.owner === "agent-x" || final!.owner === "agent-y",
    `contention: owner is one of the claimants (got ${final!.owner})`,
  )
}

// Cleanup
rmSync(TEST_DIR, { recursive: true, force: true })

console.log(`\n=== Team Tests: ${passed} passed, ${failed} failed ===`)
process.exit(failed > 0 ? 1 : 0)

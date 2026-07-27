/**
 * Test: Knowledge Graph
 * Run: bun run test/test-knowledge-graph.ts
 */

import { KnowledgeGraph } from "../src/memory/knowledge-graph"
import { Database } from "bun:sqlite"
import { mkdirSync, rmSync } from "node:fs"

const TEST_DB_DIR = "/tmp/powerpack-test-kg"
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

const db = new Database(TEST_DB)
db.exec("PRAGMA journal_mode=WAL")
db.exec("PRAGMA foreign_keys=ON")
const kg = new KnowledgeGraph(db)

section("KnowledgeGraph: addNode")
const concept = kg.addNode("/test/project", "concept", "auth", "Authentication system handles user login and session management")
assert(concept.id > 0, "addNode returns node with id")
assertEq(concept.nodeType, "concept", "addNode preserves nodeType")
assertEq(concept.name, "auth", "addNode preserves name")
assertEq(concept.content, "Authentication system handles user login and session management", "addNode preserves content")

const file1 = kg.addNode("/test/project", "file", "auth.ts", "Main authentication module")
const file2 = kg.addNode("/test/project", "file", "middleware.ts", "Express middleware including auth check")
const func1 = kg.addNode("/test/project", "function", "validateToken", "JWT token validation logic")
const bug = kg.addNode("/test/project", "bug", "token-expiry", "Token expiry check uses wrong field", { severity: "high" })
const person = kg.addNode("/test/project", "person", "alice", "Senior backend engineer")

assert(file1.id > 0, "addNode file works")
assert(func1.id > 0, "addNode function works")
assert(bug.id > 0, "addNode bug works")
assert(person.id > 0, "addNode person works")
assert(bug.metadata !== null, "addNode preserves metadata")
assertEq(bug.metadata!.severity, "high", "addNode metadata parsed correctly")

// Upsert behavior
const upserted = kg.addNode("/test/project", "concept", "auth", "Updated auth system description")
assertEq(upserted.content, "Updated auth system description", "addNode upserts existing node content")

section("KnowledgeGraph: addEdge")
const edge1 = kg.addEdge("/test/project", file1.id, func1.id, "calls", 0.9)
assert(edge1.id > 0, "addEdge returns edge with id")
assertEq(edge1.relation, "calls", "addEdge preserves relation")
assertEq(edge1.weight, 0.9, "addEdge preserves weight")

const edge2 = kg.addEdge("/test/project", func1.id, concept.id, "found_in", 1.0)
const edge3 = kg.addEdge("/test/project", file1.id, file2.id, "imports", 1.0)
const edge4 = kg.addEdge("/test/project", bug.id, func1.id, "fixes", 0.8)
const edge5 = kg.addEdge("/test/project", file1.id, person.id, "decided_by", 0.5)

assert(edge2.id > 0, "addEdge works for multiple edges")
assert(edge4.id > 0, "addEdge fixes relation works")

section("KnowledgeGraph: getNode")
const fetched = kg.getNode(file1.id)
assert(fetched !== null, "getNode returns node")
assertEq(fetched!.name, "auth.ts", "getNode returns correct node")

const missing = kg.getNode(99999)
assert(missing === null, "getNode returns null for missing id")

section("KnowledgeGraph: getNeighbors")
const neighbors = kg.getNeighbors(concept.id, 1)
assert(neighbors.length >= 1, `getNeighbors returns adjacent nodes (got ${neighbors.length})`)
const neighborNames = neighbors.map(n => n.name)
assert(neighborNames.includes("validateToken"), "getNeighbors includes function connected to concept")

const deepNeighbors = kg.getNeighbors(concept.id, 2)
assert(deepNeighbors.length >= 1, `getNeighbors with depth=2 finds transitive neighbors (got ${deepNeighbors.length})`)
const deepNames = deepNeighbors.map(n => n.name)
assert(deepNames.includes("auth.ts"), "getNeighbors depth=2 includes file via function")

// Filter by relation type — "fixes" connects bug→func1, so from func1 find bug
const fixedNeighbors = kg.getNeighbors(func1.id, 1, ["fixes"])
const fixedNames = fixedNeighbors.map(n => n.name)
assert(fixedNames.includes("token-expiry"), "getNeighbors with relation filter finds bug via fixes")

section("KnowledgeGraph: getConnections")
const connections = kg.getConnections(file1.id)
assert(connections.length >= 3, `getConnections returns all edges for node (got ${connections.length})`)

section("KnowledgeGraph: searchNodes")
const searchResults = kg.searchNodes("/test/project", "auth")
assert(searchResults.length > 0, `searchNodes finds results for "auth" (got ${searchResults.length})`)
const authNode = searchResults.find(n => n.name === "auth")
assert(authNode !== undefined, "searchNodes finds auth node by name")

const noResults = kg.searchNodes("/test/project", "xyznonexistent")
assertEq(noResults.length, 0, "searchNodes returns empty for no matches")

section("KnowledgeGraph: findRelated")
const related = kg.findRelated("/test/project", "auth")
assert(related.length > 0, `findRelated finds nodes by name substring (got ${related.length})`)

const typedRelated = kg.findRelated("/test/project", "auth", "concept")
assert(typedRelated.length > 0, "findRelated with type filter works")
assert(typedRelated.every(n => n.nodeType === "concept"), "findRelated respects type filter")

section("KnowledgeGraph: updateEdgeWeight")
kg.updateEdgeWeight(edge1.id, 0.3)
// Re-fetch via connections
const updatedConns = kg.getConnections(file1.id)
const updatedEdge = updatedConns.find(e => e.id === edge1.id)
assert(updatedEdge !== undefined, "updateEdgeWeight updates correctly")
assertEq(updatedEdge!.weight, 0.3, "updateEdgeWeight weight changed")

section("KnowledgeGraph: getSubgraph")
const subgraph = kg.getSubgraph("/test/project", [file1.id, func1.id, concept.id])
assertEq(subgraph.nodes.length, 3, "getSubgraph returns correct nodes")
assert(subgraph.edges.length >= 2, `getSubgraph returns edges between nodes (got ${subgraph.edges.length})`)

section("KnowledgeGraph: deleteNode")
const delNode = kg.addNode("/test/project", "tool", "eslint", "Code linter")
kg.addEdge("/test/project", file1.id, delNode.id, "depends_on", 1.0)
const delNodeId = delNode.id
kg.deleteNode(delNodeId)
assert(kg.getNode(delNodeId) === null, "deleteNode removes node")
const delConns = kg.getConnections(delNodeId)
assertEq(delConns.length, 0, "deleteNode cascades to edges")

section("KnowledgeGraph: getStats")
const stats = kg.getStats("/test/project")
assert(stats.totalNodes > 0, `getStats returns node count (got ${stats.totalNodes})`)
assert(stats.totalEdges > 0, `getStats returns edge count (got ${stats.totalEdges})`)
assert(stats.nodesByType["concept"] >= 1, "getStats counts concept nodes")
assert(stats.nodesByType["file"] >= 1, "getStats counts file nodes")
assert(stats.edgesByRelation["calls"] >= 1, "getStats counts calls edges")

// Cleanup
db.close()
rmSync(TEST_DB_DIR, { recursive: true, force: true })

console.log(`\n=== Knowledge Graph Tests: ${passed} passed, ${failed} failed ===`)
process.exit(failed > 0 ? 1 : 0)

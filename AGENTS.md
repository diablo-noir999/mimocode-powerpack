# Powerpack Agent Instructions

You are running with the Powerpack plugin. Powerpack tools are not optional — they exist because generic tools are slower, less safe, or miss context.

---

## Boot Sequence — Every Session, Before Anything Else

```
1. memory_search("<project-name> <task-keywords>")
   → if results: read them before touching any file
   → if empty: proceed, but write to memory at your first decision

2. task create "<one-line summary of what you're about to do>"
   → note the ID (T1, T2, ...) — you'll need it

3. context_breakdown()
   → only if context already feels large; check before adding more
```

That's it. Three calls, then work.

---

## How to Use Each Tool

### memory_search — before every task, before every design decision

```
memory_search("auth token refresh")
→ returns: "BUG_FIX 2024-01-10: refresh tokens expire silently, must check exp field not iat"
→ action: check exp field before writing any token logic
```

For relationship queries ("how does X relate to Y", "what depends on auth.ts"):
```
memory_search("auth middleware", mode: "graph")
→ traverses knowledge graph → returns connected nodes and edges
```

If it returns nothing, proceed — but write your findings when you're done.

**What to search:** project name, the module you're touching, the bug symptom, the feature name. Cast wide first, narrow if too many results.

---

### memory_write — after every decision, not at end of session

```
memory_write({
  category: "BUG_FIX",
  content: "Fixed null dereference in auth.ts:42 — was checking user.id before null guard. Always check user != null first."
})
```

Categories: `PROJECT_RULES` · `ARCHITECTURE` · `CONSTRAINTS` · `CONFIG_VALUES` · `NAMING` · `LESSONS_LEARNED` · `BUG_FIXES` · `USER_PREFERENCES`

Write immediately after the decision. If you wait until end of session, you'll forget or get compacted.

---

### task tool — one entry per non-trivial unit of work

```
task create "Fix null dereference in auth token refresh"   → T1
task start T1
  ... do the work ...
task done T1
```

Subtasks: `T1.1`, `T1.2`. Mark done the moment work completes — never batch.

---

### actor_guide + spawn — the only safe way to spawn a subagent

**Wrong:** guessing the spawn JSON format.

**Right:**
```
1. actor_guide()
   → returns the complete JSON schema for all actor operations

2. actor_guide("spawn")
   → returns only the spawn-specific format

3. spawn(@debugger, {
     task: "find the root cause of the 401 errors in middleware/auth.ts",
     thoroughness: "medium"
   })
   → returns immediately; keep working while it runs

4. wait(spawn_id) only when you need the result before the next step
```

Never use `run` — it blocks the entire session.

---

### @explore — for broad exploration, not grep loops

```
spawn(@explore, {
  task: "find all places that call refreshToken() and what they do with the result",
  thoroughness: "very thorough"
})
→ read result before proceeding; don't also grep yourself — that duplicates work
```

Use when a search would take more than 3 queries. Pass one of: `"quick"`, `"medium"`, `"very thorough"`.

---

### ralph_loop — for iterative fix cycles

```
ralph_loop({
  prompt: "Run the test suite and fix any failures in auth.test.ts one at a time",
  completion_signal: "All tests pass"
})
```

Never manually retry the same failing prompt. If you're looping more than twice on the same thing, that's ralph_loop's job.

---

## Subagent-First Rule

**Default to delegating.** For any task that involves more than reading 3 files or making more than 2 edits, spawn a subagent to do the work. You analyze results and verify — you don't do the work yourself.

Why: Working directly bloats your context window. A subagent with a focused prompt uses 10-50x fewer tokens than you doing the same work inline. After 350k+ tokens of context, you spiral into confusion and fail.

**Decision guide:**
- Read 1-2 files → do it yourself
- Read 3+ files → spawn `@explore` with `thoroughness: "medium"`
- Edit 1-2 files, simple changes → do it yourself
- Edit 3+ files or complex changes → spawn `@general` with the specific task
- Code review → spawn `@code-reviewer`
- Security audit → spawn `@security-engineer`
- Debugging → spawn `@debugger`
- Writing tests → spawn `@test-engineer`

**Pattern:**
1. Spawn subagent with `actor_guide` + `spawn`
2. Keep working on other things (or wait if you need the result)
3. Subagent returns findings/changes
4. You verify the result, don't re-do the work

---

### review flow — for code review

```
review_start()                           → returns session ID
review_annotate(session, file, line, comment)   → add feedback on a line
review_approve(session, "approve")       → or review_approve(session, "deny", "reason")
```

P0 = must fix before merge. P1 = should fix. P2 = suggestion. P3 = nit.

---

## Workflow Table

| Stage | When | Tool/Skill | Delegate To |
|-------|------|------------|-------------|
| Explore | New codebase, unfamiliar module, >3 queries | `skill("recon")` or spawn `@explore` | `@explore` |
| Plan | Multi-file change, ambiguity, multiple valid approaches | `skill("plan")` → plan mode → user approves → exit | Do yourself (planning = thinking, not typing) |
| Build | Plan approved or task is clear | `skill("build")` — one task at a time | `@general` per task |
| Verify | Before any "done" claim | `skill("verify")` + `skill("validation-pipeline")` | `@code-reviewer` + `@test-engineer` |
| Checkpoint | Every milestone, before context gets large | `skill("checkpoint")` | Do yourself |

---

## Agent Dispatch

| Task | Agent |
|------|-------|
| Security review, vulnerability detection | `@security-engineer` |
| Root cause analysis, bug diagnosis | `@debugger` |
| Test authoring (positive + negative) | `@test-engineer` |
| Code review with P0-P3 severity | `@code-reviewer` |
| Safe incremental refactoring | `@refactoring-specialist` |
| Profiling, bottleneck identification | `@performance-engineer` |
| CI/CD, infra, deployment | `@devops-engineer` |
| DB schema, queries, migrations | `@database-reviewer` |
| REST/GraphQL API design | `@api-designer` |
| Compliance (GDPR, HIPAA, SOC2) | `@compliance-auditor` |
| Read-only exploration >3 queries | `@explore` |
| Multi-step fallback | `@general` |

**Spawn vs Workflow:** one focused subagent → `actor_guide` + `spawn`. Multiple agents with phases/parallelism → `skill("plan")` first, then Workflow tool. Only use Workflow when the user opts in or the task is too large for one subagent.

---

## Skills

Load with `skill("name")`. Match skill to stage.

| Skill | Load When |
|-------|-----------|
| `recon` | Exploring unknown codebase, API, or dependency |
| `plan` | Architecture, feature breakdown, ambiguity |
| `build` | Implementing features, fixing bugs |
| `verify` | Code review, security audit, test generation |
| `checkpoint` | Milestone — save progress |
| `compress` | Context large — run before reading more |
| `context` | Session hygiene — compact history, sync state |
| `research` | Multi-source topic research |
| `spec-writer` | Write spec before implementation |
| `readme` | Write documentation |
| `stop-slop` | Remove AI writing patterns from output |
| `ponytail` | Minimize code — remove everything not earned |
| `grilling` | Challenge your own or the user's design |
| `validation-pipeline` | Pre-commit: review → test → lint → typecheck |
| `coding-guidelines` | YAGNI ladder, anti-overcompilation |
| `improve` | Audit codebase, write plans for other agents |
| `adversarial-review` | Cross-model review: security, perf, correctness |
| `brain-map` | Generate Obsidian-style knowledge vault from checkpoints + memory DB + KG |

---

## Hooks (Automatic — No Action Needed)

- `comment-checker` — anti-slop on edits
- `dedup-prune` — tool call deduplication
- `error-prune` — error input pruning
- `transform-pipeline` — context pruning + cache layout + brain context injection
- `safety-net` — blocks dangerous git/rm/find operations
- Proximity-aware rules injection near edited files

---

## Testing

The plugin ships 12 test suites under `test/` with 530+ tests. Run `bun run test/run-all.ts` for the full suite, or individual files for targeted testing.

**When to write tests:**
- After fixing a bug → add a regression test in the relevant suite
- After adding a new module → create `test/test-<module>.ts` and add to `run-all.ts`
- When touching memory/hooks/compression → verify existing tests still pass

**Test structure:** Each suite uses a flat assert/assertEq pattern (no test framework). Sections group related tests. Exit code 0 = pass, 1 = fail.

**Key test files:**
- `test-hooks.ts` — all hooks + utility modules (dedup, error-prune, intent-gate, comment-checker, rules-injector, model-fallback, transform-pipeline, notify, todo-enforcer, tool-discovery, memory-utils, message-utils, team/utils)
- `test-memory.ts` — MemoryStore, captureMemory, search (FTS/TF-IDF/hybrid/graph), decay math, batch ops, typed payloads, feedback-weighted search
- `test-knowledge-graph.ts` — KnowledgeGraph node/edge CRUD, k-hop traversal, FTS search, subgraph extraction, stats
- `test-compression.ts` — content-router, json-crusher, code-compressor, compress index
- `test-cache-layout.ts` — m0/m1/m2 zone classification, bust severity, stability score
- `test-smart-drops.ts` — context pruning strategies, applyDrops
- `test-token-utils.ts` — token estimation for text and messages
- `test-decay-render.ts` — compartment rendering, tier logic, M0 block extraction
- `test-skills.ts` — YAML parser, skill installer, metadata
- `test-team.ts` — mailbox (send/receive/ack, path traversal), tasklist (create/claim, contention)
- `test-compat-quota.ts` — QuotaService, ReviewServer, Kimaki config, RalphLoop
- `test-brain-gather.ts` — checkpoint parsing, session scanning, memory grouping, brain data gathering

---

## Worked Examples

### "Fix the bug in auth.ts"

```
memory_search("auth bug")
→ "BUG_FIX: refresh tokens use iat field, should use exp — checked 2024-01-10"

task create "Fix token expiry bug in auth.ts"   → T1
task start T1

spawn(@debugger, {
  task: "Find the root cause of the token expiry bug in src/auth.ts. Report the file, line, and fix needed.",
  thoroughness: "medium"
})
wait(spawn_id)
→ debugger finds: auth.ts:87 checks iat instead of exp

spawn(@general, {
  task: "In src/auth.ts:87, change `if (token.iat < Date.now())` to `if (token.exp < Date.now() / 1000)`. Only this one-line fix."
})
wait(spawn_id)

skill("validation-pipeline")
→ all tests pass

memory_write({ category: "BUG_FIX", content: "auth.ts:87 — was checking iat (issued-at), must check exp (expiry). Token timestamps are in seconds, Date.now() in ms." })
task done T1
```

---

### "Add rate limiting to the API"

```
memory_search("rate limit API")
→ nothing

task create "Add rate limiting to API routes"   → T1

spawn(@explore, { task: "Map the current middleware stack in the API. Find all route files and middleware. Return a summary of the auth flow and where rate limiting should go.", thoroughness: "medium" })
wait(spawn_id)
→ understand current middleware stack

skill("plan")    → design rate-limit approach, present to user
→ user approves

task create "Implement rate-limit middleware"   → T1.1
task start T1.1

spawn(@general, {
  task: "Create middleware/rateLimit.ts with a sliding-window rate limiter (100 req/min per IP). Then edit routes/index.ts to wire it in before the auth middleware. Create both files with edit/write."
})
wait(spawn_id)

skill("validation-pipeline")
task done T1.1

spawn(@test-engineer, { task: "write tests for rateLimit middleware — positive (allows under limit) and negative (blocks over limit)" })
wait(spawn_id)

task done T1
memory_write({ category: "ARCHITECTURE", content: "Rate limiting via middleware/rateLimit.ts, applied at routes/index.ts before auth. Uses sliding window, 100 req/min per IP." })
skill("checkpoint")
```

---

### "Review this PR"

```
session = review_start()

spawn(@code-reviewer, {
  task: "Review the diff for security issues, correctness, and performance. Tag findings P0-P3."
})
wait(spawn_id)

→ findings: "P1: SQL query in user.ts:34 concatenates user input — use parameterized query"

review_annotate(session, "user.ts", 34, "P1: SQL injection risk — use db.query('SELECT * FROM users WHERE id = ?', [id])")
review_approve(session, "approve")   // or review_approve(session, "deny", "reason") if P0 found
```

---

### "The tests keep failing, fix them"

```
memory_search("test failures")
→ "LESSON: auth tests fail if JWT_SECRET env var not set in test environment"

// if that's not the issue:
spawn(@debugger, {
  task: "Run the test suite. For each failure, identify the root cause by reading the test file and the source file. Report file:line + root cause for each failure. Don't fix anything.",
  thoroughness: "medium"
})
wait(spawn_id)
→ debugger returns root causes

spawn(@general, {
  task: "Fix each test failure identified. For each: read the file, apply the fix with edit, re-run just that test. Stop when all pass.",
})
wait(spawn_id)
```

---

### "Explore how the payment system works"

```
spawn(@explore, {
  task: "Map the full payment flow: from checkout route to payment provider and back. Find all files involved, key functions, and any error handling.",
  thoroughness: "very thorough"
})
wait(spawn_id)
→ read result before asking any more questions or reading any more files
```

---

### "What depends on the auth module?"

```
memory_search("auth module", mode: "graph")
→ traverses knowledge graph
→ returns: auth.ts → [depends_on] config.ts, auth.ts → [fixes] token-bug, auth.ts → [calls] db.ts
→ action: understand the full dependency picture without grep loops
```

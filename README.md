# mimocode-powerpack

A comprehensive plugin bundle for [MiMoCode](https://mimo.xiaomi.com/mimocode/start) — context management, memory with semantic search, knowledge graph, brain map, embeddings, notifications, quota tracking, code review, team coordination, autonomous loops, skill management, Kimaki Discord integration, an Ultracode mode, and 14 specialized subagents.

## What's Included

### Ultracode Mode

A Tab-switchable build mode (`#21c5c2`) that merges the default MiMoCode system prompt with aggressive powerpack tool-usage instructions. Tab to "ultracode" to get an agent that always uses `memory_search`, `edit`, specialized subagents, and skill loading by default.

Deployed to `~/.config/mimocode/modes/ultracode.md`. The mode file contains the full Build mode prompt plus powerpack directives — no separate hook injection needed.

### Agent Instructions (AGENTS.md)

The plugin ships a comprehensive AGENTS.md with:
- **Boot sequence** — 3-step startup: `memory_search` → `task create` → `context_breakdown`
- **Tool usage guides** — step-by-step workflows for every plugin tool (`memory_search`, `memory_write`, `actor_guide`, `ralph_loop`, `review_*`)
- **Worked examples** — concrete end-to-end examples for bug fixes, features, code reviews, security audits, and refactors
- **Dispatch tables** — which agent/skill/tool to use for each situation
- **Durable workflows** — the agent always knows to use `memory_search`, `actor_guide`, `spawn`, `task`, and `skill()` via the persistent mode prompt and AGENTS.md

### Context Management
- **Context Analysis** — `context_breakdown` tool with per-category and per-tool token breakdown
- **Tool Deduplication** — automatically deduplicates identical tool calls via WithParts format (assistant message parts[])
- **Error Purging** — prunes errored tool inputs after configurable turns via WithParts format
- **Transform Pipeline** — smart context pruning, cache layout optimization, session facts extraction

### Memory & Search
- **Memory Store** — SQLite-backed persistent memory with 8-category taxonomy
- **Tiered Decay** — automatic memory expiration based on importance and age
- **BM25 + Vector Search** — hybrid full-text + semantic search with Granite embeddings (384-dim, local ONNX inference)
- **Knowledge Graph** — lightweight SQLite graph (kg_nodes + kg_edges) with typed concepts, files, functions, decisions; supports k-hop traversal, FTS search, subgraph extraction, and feedback-weighted edges
- **Typed Memory Payloads** — structured entries (QA, Trace, Feedback, SkillRun) alongside plain text memories, inspired by cognee's discriminated union pattern
- **Feedback-Weighted Retrieval** — search results boosted/reduced by feedback scores (configurable influence factor)
- **Graph Search Mode** — new `mode: "graph"` in searchMemories traverses the knowledge graph for related concepts and returns connected memories
- **Brain Map** — Obsidian-style knowledge vault at `.mimocode/context/` with raw/wiki/output structure, generated from session checkpoints + memory DB + knowledge graph via `skill("brain-map")`
- **Session Cache** — in-memory LRU cache (100 entries) for fast recall of recent Q&A turns and trace steps
- **Codebase Semantic Search** — indexes source files via `CodeIndexer` with tree-sitter AST chunking, stores embeddings for cosine similarity search
- **Auto-Capture** — extracts structured facts (TOOL_CALL, FILE_CHANGE, DECISION, ERROR_PATTERN, CONFIG_CHANGE) from completed sessions
- **Historian/Dreamer/Sidekick** — compartment-based history compression (P1-P4 tiers), overnight memory consolidation (11 task types), and memory retrieval augmentation
- **Repo Profile Cache** — git-SHA-keyed project profile that caches repository metadata, invalidated on any commit

#### Embedding Model

Uses `onnx-community/granite-embedding-small-english-r2-ONNX` (47M params, 384 dims, 8192 token context) via local ONNX inference — no API keys required.

#### Code Search Example

```typescript
import { getCodeIndexer } from "./memory/code-index"

const indexer = getCodeIndexer("/path/to/memory.db")

// Index the project (tree-sitter AST chunking + embedding)
await indexer.indexProject("/path/to/project")
// => { indexed: 120, chunks: 845, errors: 2 }

// Semantic search
const results = await indexer.search(
  "how does authentication middleware work",
  "/path/to/project",
  10
)
// => [{ chunk: { filePath: "src/auth.ts", startLine: 42, content: "..." }, score: 0.87 }, ...]
```

### Hooks & Agent Behavior
- **IntentGate** — keyword-based intent routing (ultrawork, search, analyze) with model-aware routing and code block stripping
- **Todo Enforcer** — keeps idle agents working on incomplete tasks
- **Comment Checker** — catches AI slop in comments (em dashes, filler words)
- **Rules Injection** — proximity-aware rule discovery near edited files with YAML frontmatter, source priority, and char budgets
- **Model Fallback** — reactive model switching on errors with cooldowns
- **Tool Discovery** — temporarily disabled for MiMoCode v0.1.7+ (system-level hints need re-implementation via `system.transform` hook)
- **Safety Net** — semantic destructive-command blocking (analyzes git, rm, find commands for dangerous intent)

### Tools
- **Loop-Until-Done** — autonomous loop that repeats until task completion
- **Memory Search/Write** — persistent knowledge base with deduplication
- **Context Breakdown** — token usage analysis
- **Quota Status** — check API quota usage across 25+ providers
- **Actor Guide** — JSON format reference for spawning subagents (includes common mistakes, troubleshooting, correct subagent types)
- **Skills Install/Sync** — manage skills from GitHub repos
- **Content-Aware Compression** — JSON array compression (SmartCrusher pattern) and AST-aware code compression with content-type routing

### Skill Management
- **17 Built-in Skills** — adversarial-review, brain-map, build, checkpoint, coding-guidelines, compress, context, grilling, improve, plan, ponytail, readme, recon, research, spec-writer, stop-slop, validation-pipeline, verify
- **Skill Usage Tracking** — tracks per-skill metrics (use count, view count, last used, state transitions)
- **Proximity Rules Engine** — discovers and injects relevant AGENTS.md/CLAUDE.md files near edited code

### Team Coordination
- **Agent Mailbox** — file-based inter-agent messaging with path traversal protection
- **Shared Task List** — coordinated task tracking with status transitions and stale lock detection
- **Team Status** — view team state and agent availability

### Notifications
- **Native OS Notifications** — session complete/error/permission/question alerts with message content
- **Event-Specific Formatting** — icons and truncated message display
- **Quiet Hours** — configurable do-not-disturb periods
- **Security** — escaped strings for osascript/PowerShell to prevent injection

### Code Review
- **Diff Viewer** — browser-based side-by-side diff review
- **Annotations** — add comments and request changes
- **Git Integration** — approve/deny with optional file staging
- **Security Headers** — CSP, X-Frame-Options, rate limiting, session ID validation

### Kimaki Discord Integration
- **Auto-Start** — kimaki-mimocode spawns automatically when mimo starts
- **Adapter Layer** — bridge Kimaki's Discord orchestration to MiMoCode
- **Channel/Thread Mapping** — Discord channels to projects, threads to sessions
- **Status & Send Tools** — monitor and interact with Kimaki from MiMoCode

### Subagents (14 total, 11 user-facing)
- **auto-mode** — smart router that picks the right agent + auto-injects skills
- code-reviewer, debugger, refactoring-specialist, test-engineer
- security-engineer, devops-engineer, performance-engineer
- database-reviewer, api-designer, compliance-auditor
- historian, dreamer, sidekick (internal memory subagents, spawned by plugin)

### Testing

12 test suites with 530+ tests covering hooks, memory, knowledge graph, brain gathering, skills, team coordination, compression, cache layout, smart drops, token estimation, and decay rendering.

```bash
# Run all tests
bun run test/run-all.ts

# Run individual suites
bun run test/test-hooks.ts
bun run test/test-memory.ts
bun run test/test-knowledge-graph.ts
bun run test/test-brain-gather.ts
bun run test/test-compression.ts
bun run test/test-cache-layout.ts
bun run test/test-smart-drops.ts
bun run test/test-token-utils.ts
bun run test/test-decay-render.ts
bun run test/test-skills.ts
bun run test/test-team.ts
bun run test/test-compat-quota.ts
```

| Suite | Module | Tests |
|-------|--------|-------|
| hooks | dedup-prune, error-prune, intent-gate, comment-checker, rules-injector, model-fallback, transform-pipeline, notify, todo-enforcer, tool-discovery, memory-utils, message-utils, team/utils | ~109 |
| memory | MemoryStore CRUD, dedup, expiry, captureMemory, captureFromSession, FTS/TF-IDF search, decay math, batch operations, typed payloads, feedback-weighted search | ~138 |
| knowledge-graph | Node/edge CRUD, k-hop traversal, FTS search, subgraph extraction, stats, cascade delete | ~42 |
| compression | Content router, JSON crusher, code compressor, compress index | ~52 |
| cache-layout | classifyCacheZone, bust severity, stability score, boundary detection | ~37 |
| decay-render | renderDecayedCompartments, renderCompartmentAtTier, extractM0Block | ~32 |
| smart-drops | findDropCandidates, applyDrops, all drop strategies | ~25 |
| skills | YAML parser, skill installer, skill metadata | ~34 |
| team | Mailbox (send/receive/ack/broadcast, path traversal protection), tasklist (create/claim/update, contention) | ~34 |
| token-utils | estimateTextTokens, estimateMessageTokens | ~18 |
| compat-quota | QuotaService, ReviewServer, Kimaki config, RalphLoop | ~57 |
| brain-gather | checkpoint parsing, session scanning, memory grouping, brain data gathering | ~40 |

## Installation

```bash
# 1. Install the plugin
# Add to your ~/.config/mimocode/mimocode.jsonc:
{
  "plugin": [
    ["/path/to/mimocode-powerpack", {
      "powerpack": {
        "notify": { "enabled": true, "quietHours": { "start": "22:00", "end": "08:00" } },
        "todoEnforcer": { "enabled": true, "maxFailures": 5, "cooldownMs": 30000 },
        "commentChecker": { "enabled": true },
        "rulesInjector": { "enabled": true },
        "modelFallback": { "enabled": true },
        "dedupPrune": { "enabled": true },
        "errorPrune": { "enabled": true, "turnsBeforePrune": 4 },
        "intentGate": { "enabled": true },
        "safetyNet": { "enabled": true },
        "toolDiscovery": { "enabled": true },
        "loopUntilDone": { "enabled": true },
        "skills": { "enabled": true, "installDir": ".mimocode/skills" },
        "memory": {
          "enabled": true,
          "autoCapture": true,
          "embeddings": { "enabled": true, "model": "onnx-community/granite-embedding-small-english-r2-ONNX" }
        },
        "transform": { "enabled": true, "smartDrops": true, "cacheLayout": true, "sessionFacts": true, "brainLoader": true, "brainLoaderMaxTokens": 8000 },
        "team": { "enabled": false },
        "review": { "enabled": false, "port": 5174 },
        "kimaki": { "enabled": false },
        "quota": { "providers": ["mimo", "copilot", "openai"] }
      }
    }]
  ]
}

# 2. Deploy agents, modes, skills, and rules
./scripts/install.sh --global    # to ~/.config/mimocode/
./scripts/install.sh --local     # to .mimocode/ (project-local)

# 3. Restart MiMoCode
```

The install script deploys:
- **Agents** (14) to `~/.config/mimocode/agents/`
- **Modes** (1) to `~/.config/mimocode/modes/` — Tab-switchable Ultracode
- **Skills** (18) to `~/.config/mimocode/skills/`
- **Rules** to `~/.config/mimocode/AGENTS.md`

## Configuration

All options in the `powerpack` config section:

| Option | Default | Description |
|--------|---------|-------------|
| `notify.enabled` | `true` | OS notifications |
| `notify.quietHours` | `22:00-08:00` | Do-not-disturb window |
| `todoEnforcer.enabled` | `true` | Idle session detection |
| `todoEnforcer.maxFailures` | `5` | Max idle cycles before stop |
| `commentChecker.enabled` | `true` | AI slop detection on edits |
| `rulesInjector.enabled` | `true` | Proximity-aware rule injection |
| `modelFallback.enabled` | `true` | Reactive model switching |
| `dedupPrune.enabled` | `true` | Tool call deduplication |
| `errorPrune.enabled` | `true` | Error input pruning |
| `errorPrune.turnsBeforePrune` | `4` | Turns before pruning errors |
| `intentGate.enabled` | `true` | Keyword intent routing |
| `safetyNet.enabled` | `true` | Semantic destructive-command blocking |
| `toolDiscovery.enabled` | `true` | No-op in v0.1.7+ (system context injection unavailable) |
| `loopUntilDone.enabled` | `true` | Autonomous loop tool |
| `skills.enabled` | `true` | Skill management |
| `memory.enabled` | `true` | Memory store + search |
| `memory.autoCapture` | `true` | Auto-extract session facts |
| `memory.embeddings.enabled` | `true` | Granite ONNX embeddings |
| `transform.enabled` | `true` | Context transform pipeline |
| `team.enabled` | `false` | Team coordination tools |
| `review.enabled` | `false` | Browser review UI |
| `kimaki.enabled` | `false` | Discord integration |
| `quota.providers` | `["mimo","copilot","openai"]` | Quota tracking providers |

## License

MIT

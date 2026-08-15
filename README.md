# mimocode-powerpack

A plugin bundle for [MiMoCode](https://mimo.xiaomi.com/mimocode/start) — persistent memory with semantic search, context management, agent-behavior hooks, notifications, compression, skills, and 7 specialized subagents.

## What's Included

### Ultracode Mode

A Tab-switchable build mode (`#21c5c2`) that merges the default MiMoCode system prompt with aggressive powerpack tool-usage instructions. Tab to "ultracode" to get an agent that always uses `memory_search`, `context_breakdown`, specialized subagents, and skill loading by default.

Deployed to `~/.config/mimocode/modes/ultracode.md`.

### Agent Instructions (AGENTS.md)

The plugin ships a comprehensive AGENTS.md with:
- **Boot sequence** — `memory_search` → `context_breakdown`
- **Tool usage guides** — step-by-step workflows for every plugin tool (`memory_search`, `memory_write`, `actor_guide`, `context_breakdown`)
- **Worked examples** — concrete end-to-end examples for bug fixes, features, and refactors
- **Dispatch tables** — which agent/skill/tool to use for each situation

### Memory & Search

- **Memory Store** — SQLite-backed persistent memory (`bun:sqlite`, WAL) with an 8-category taxonomy: `PROJECT_RULES`, `ARCHITECTURE`, `CONSTRAINTS`, `CONFIG_VALUES`, `NAMING`, `LESSONS_LEARNED`, `BUG_FIXES`, `USER_PREFERENCES`
- **Hybrid Search** — FTS5 (BM25) + TF-IDF + vector semantic search with fallbacks; `graph` mode traverses the knowledge graph
- **Typed Memory Payloads** — structured entries (qa, trace, feedback, skill_run) alongside plain-text memories
- **Tiered Decay** — automatic memory expiration based on importance and age (per-category TTLs)
- **Knowledge Graph** — lightweight SQLite graph (kg_nodes + kg_edges) with k-hop traversal, FTS search, subgraph extraction
- **Feedback-Weighted Retrieval** — search results boosted/reduced by feedback scores (configurable influence factor)
- **Auto-Capture** — extracts structured facts (TOOL_CALL, FILE_CHANGE, DECISION, ERROR_PATTERN, CONFIG_CHANGE) from completed sessions
- **Session Facts + Cache** — per-session fact extraction and an in-memory LRU cache
- **Code Index** — tree-sitter AST chunking + embeddings for codebase semantic search
- **Brain Map** — Obsidian-style knowledge vault at `.mimocode/context/` (raw/wiki/output) via `skill("brain-map")`
- **Schema Migration** — legacy DBs are migrated in place (missing columns added via `ALTER TABLE`)

#### Embedding Model

Uses `onnx-community/granite-embedding-small-english-r2-ONNX` (47M params, 384 dims, 8192 token context) via local ONNX inference — no API keys required. Opt-in via `memory.embeddings.enabled` (default `false`); when enabled, the model downloads from HuggingFace and initializes fire-and-forget at session end, then unembedded memories are backfilled in the background — a turn is never blocked by model download. Until embeddings are ready, search silently falls back to FTS.

### Context Management

- **Context Analysis** — `context_breakdown` tool with per-category and per-tool token usage charts
- **Tool Deduplication** — prunes duplicate tool calls from context (WithParts format)
- **Error Purging** — prunes errored tool inputs after a configurable number of turns
- **Transform Pipeline** — smart context drops, cache-layout optimization (m0/m1/m2 zones), session-fact extraction

### Hooks & Agent Behavior

- **Safety Net** — blocks dangerous git/rm/find commands (cancels the tool call before execution)
- **Todo Enforcer** — stops idle agents stuck on incomplete tasks
- **Comment Checker** — flags AI-slop patterns in tool output
- **Notify** — native OS notifications with configurable quiet hours
- **Quality Gate** — session-level checks (off by default)
- **Tool Discovery** — registered but a no-op on MiMoCode v0.1.7+ (message-format mismatch)

### Compression

Content-type routed compression: regex-detected JSON array compression (SmartCrusher pattern) and AST-aware code compression with min-savings thresholds.

### Subagents (7)

- **debugger** — scientific-method root cause analysis
- **code-reviewer** — read-only review, security-first, P0-P3 + confidence anchoring
- **refactoring-specialist** — safe incremental refactoring with test gates
- **security-engineer** — full security engineering with whitelisted tooling
- **test-engineer** — TDD, positive + negative tests
- **historian** — compartment-based history compression (P1-P4 tiers)
- **dreamer** — scheduled memory consolidation (verify/curate/classify)

Installed to `~/.config/mimocode/agents/`.

### Skills (18)

adversarial-review, brain-map, build, checkpoint, coding-guidelines, compress, context, grilling, improve, plan, ponytail, readme, recon, research, spec-writer, stop-slop, validation-pipeline, verify — plus embedded `loop-until-done` and `proximity-rules` (bundled in `src/skills/`).

## Installation

```bash
# Install (deploys agents, modes, skills, rules AND registers the plugin
# entry in ~/.config/mimocode/mimocode.jsonc — no manual editing)
./scripts/install.sh --global    # to ~/.config/mimocode/
./scripts/install.sh --local     # to .mimocode/ (project-local)

# Uninstall (removes powerpack files + config entry; never touches user files)
./scripts/uninstall.sh --global
./scripts/uninstall.sh --local

# Test against a scratch dir without touching your real config
POWERPACK_TARGET=/tmp/pp-test ./scripts/install.sh --global
```

Both scripts are idempotent and preserve all other config (providers, MCP servers, other plugins). Uninstall also removes legacy agents that older powerpack versions installed. Requires `bun` or `node` for the config edit (`scripts/jsonc-edit.mjs`).

If you prefer to configure manually, add this to the `plugin` array of `~/.config/mimocode/mimocode.jsonc` (options below mirror the plugin defaults):

```jsonc
["/path/to/mimocode-powerpack", {
  "powerpack": {
    "notify": { "enabled": true, "quietHours": { "start": "22:00", "end": "08:00" } },
    "todoEnforcer": { "enabled": false, "maxFailures": 5, "cooldownMs": 30000 },
    "commentChecker": { "enabled": true },
    "dedupPrune": { "enabled": true },
    "errorPrune": { "enabled": true, "turnsBeforePrune": 4 },
    "qualityGate": { "enabled": false },
    "safetyNet": { "enabled": true },
    "toolDiscovery": { "enabled": true },
    "memory": {
      "enabled": true,
      "autoCapture": true,
      "embeddings": { "enabled": false, "model": "onnx-community/granite-embedding-small-english-r2-ONNX" }
    },
    "transform": { "enabled": true, "smartDrops": true, "cacheLayout": true, "sessionFacts": true }
  }
}]
```

The install script deploys:
- **Agents** (7) to `~/.config/mimocode/agents/`
- **Modes** (1) to `~/.config/mimocode/modes/` — Tab-switchable Ultracode
- **Skills** (18) to `~/.config/mimocode/skills/`
- **Rules** to `~/.config/mimocode/AGENTS.md`

## Configuration

All options live in the `powerpack` section of the plugin entry:

| Option | Default | Description |
|--------|---------|-------------|
| `notify.enabled` | `true` | OS notifications |
| `notify.quietHours` | `22:00-08:00` | Do-not-disturb window |
| `todoEnforcer.enabled` | `false` | Idle session detection |
| `todoEnforcer.maxFailures` | `5` | Max idle cycles before stop |
| `todoEnforcer.cooldownMs` | `30000` | Cooldown between idle checks |
| `commentChecker.enabled` | `true` | AI slop detection on tool output |
| `dedupPrune.enabled` | `true` | Tool call deduplication |
| `errorPrune.enabled` | `true` | Error input pruning |
| `errorPrune.turnsBeforePrune` | `4` | Turns before pruning errors |
| `qualityGate.enabled` | `false` | Session-level checks |
| `safetyNet.enabled` | `true` | Destructive-command blocking |
| `toolDiscovery.enabled` | `true` | No-op on v0.1.7+ (message-format mismatch) |
| `memory.enabled` | `true` | Memory store + search tools |
| `memory.autoCapture` | `true` | Auto-extract session facts |
| `memory.embeddings.enabled` | `false` | Opt-in: Granite ONNX embeddings (downloads model from HuggingFace on first init; keep off on restricted/slow networks) |
| `memory.embeddings.model` | `granite-embedding-small-english-r2-ONNX` | Embedding model id |
| `transform.enabled` | `true` | Context transform pipeline |
| `transform.smartDrops` | `true` | Context pruning strategies |
| `transform.cacheLayout` | `true` | m0/m1/m2 cache zones |
| `transform.sessionFacts` | `true` | Session fact extraction |

## Development

```bash
bun install                      # install deps
bun run typecheck                # tsc --noEmit
bun run build                    # bundle to dist/
bun run test/run-all.ts          # full test suite (10 suites)

# Individual suites
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
```

| Suite | Covers |
|-------|--------|
| hooks | dedup-prune, error-prune, comment-checker, transform-pipeline, notify, todo-enforcer, safety-net, tool-discovery, memory-utils, message-utils, server plugin wiring |
| memory | MemoryStore CRUD, dedup, decay, capture, FTS/TF-IDF/hybrid/graph search, typed payloads, feedback weighting, legacy schema migration |
| knowledge-graph | Node/edge CRUD, k-hop traversal, FTS search, subgraph extraction, stats |
| compression | Content router, JSON crusher, code compressor |
| cache-layout | m0/m1/m2 zones, bust severity, stability |
| smart-drops | Pruning strategies, applyDrops |
| token-utils | Token estimation for text and messages |
| decay-render | Compartment rendering, tier logic |
| skills | YAML parser, skill installer, metadata |
| brain-gather | Checkpoint parsing, session scanning, memory grouping |

## Project Layout

```
src/
├── server.ts            # Plugin entry — tools + hooks registration
├── tui.ts               # TUI entry (api.command handlers)
├── agents/              # 7 subagent definitions (.md)
├── memory/              # store, search, embeddings, knowledge-graph, decay,
│                        # session-facts, cache-layout, smart-drops, code-index, ...
├── hooks/               # 9 hooks (dedup, error-prune, transform, safety-net, ...)
├── tools/               # context-analysis, memory-search, memory-write, actor-guide
├── skills/              # installer, syncer, yaml, metadata, usage tracking
└── compression/         # content-router, json-crusher, code-compressor
modes/ultracode.md       # Ultracode primary mode
skills/                  # 18 user-facing skills
scripts/                 # install.sh, uninstall.sh, jsonc-edit.mjs
test/                    # 10 test suites
```

## License

MIT

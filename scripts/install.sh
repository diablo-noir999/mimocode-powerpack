#!/bin/bash
# mimocode-powerpack installer
# Deploys agents, modes, skills, and rules to MiMoCode's discovery paths,
# then registers the plugin in mimocode.jsonc (global mode).
#
# Usage:
#   ./scripts/install.sh           # Global: ~/.config/mimocode/
#   ./scripts/install.sh --global  # Same as above
#   ./scripts/install.sh --local   # Project-local: .mimocode/ (no config write)
#
# Environment:
#   POWERPACK_TARGET=<dir>  Override the global config dir (for testing).

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_DIR="$(dirname "$SCRIPT_DIR")"

# --- Mode selection ---------------------------------------------------------

MODE="global"
case "$1" in
  --local|-l) MODE="local" ;;
  --global|-g|"") MODE="global" ;;
  *) echo "Unknown option: $1 (use --global or --local)" >&2; exit 2 ;;
esac

if [ "$MODE" = "global" ]; then
  TARGET="${POWERPACK_TARGET:-$HOME/.config/mimocode}"
  echo "Installing globally: $TARGET/"
else
  TARGET=".mimocode"
  echo "Installing project-locally: $TARGET/"
fi

# --- Deploy agents, modes, skills, rules ------------------------------------

mkdir -p "$TARGET/agents" "$TARGET/modes" "$TARGET/skills"

echo ""
echo "=== Agents ==="
for agent in "$PLUGIN_DIR/src/agents/"*.md; do
  [ ! -f "$agent" ] && continue
  name=$(basename "$agent")
  cp "$agent" "$TARGET/agents/$name"
  echo "  ✓ $name"
done

echo ""
echo "=== Modes ==="
for mode in "$PLUGIN_DIR/modes/"*.md; do
  [ ! -f "$mode" ] && continue
  name=$(basename "$mode")
  cp "$mode" "$TARGET/modes/$name"
  echo "  ✓ $name"
done

echo ""
echo "=== Skills ==="
count=0
for skill_dir in "$PLUGIN_DIR/skills/"*/; do
  [ -d "$skill_dir" ] || continue
  [ -L "$skill_dir" ] && continue           # skip symlinks
  [ ! -f "$skill_dir/SKILL.md" ] && continue
  skill_name=$(basename "$skill_dir")
  mkdir -p "$TARGET/skills/$skill_name"
  cp "$skill_dir/SKILL.md" "$TARGET/skills/$skill_name/"
  if [ -d "$skill_dir/references" ]; then
    cp -r "$skill_dir/references" "$TARGET/skills/$skill_name/"
  fi
  echo "  ✓ $skill_name"
  count=$((count + 1))
done
[ "$count" -eq 0 ] && echo "  (no skills found)"

echo ""
echo "=== Rules ==="
if [ -f "$PLUGIN_DIR/AGENTS.md" ]; then
  cp "$PLUGIN_DIR/AGENTS.md" "$TARGET/AGENTS.md"
  echo "  ✓ AGENTS.md"
else
  echo "  (no AGENTS.md in plugin)"
fi

# --- Project-local extra: .mimocode/AGENTS.md --------------------------------

if [ "$MODE" = "local" ]; then
  mkdir -p "$TARGET"
  if [ -f "$PLUGIN_DIR/AGENTS.md" ]; then
    cp "$PLUGIN_DIR/AGENTS.md" "$TARGET/AGENTS.md"
    echo "  ✓ $TARGET/AGENTS.md (project-level)"
  fi
  echo ""
  echo "Project-local mode — plugin registration happens in your global config:"
  echo "  run: $0 --global"
fi

# --- Global mode: register the plugin in mimocode.jsonc ----------------------

if [ "$MODE" = "global" ]; then
  # Prefer mimocode.jsonc, fall back to mimocode.json
  CONFIG_FILE="$TARGET/mimocode.jsonc"
  if [ ! -f "$CONFIG_FILE" ] && [ -f "$TARGET/mimocode.json" ]; then
    CONFIG_FILE="$TARGET/mimocode.json"
  fi

  # Plugin options mirror PowerpackOptions defaults (src/server.ts)
  OPTIONS='{"notify":{"enabled":true,"quietHours":{"start":"22:00","end":"08:00"}},"todoEnforcer":{"enabled":false,"maxFailures":5,"cooldownMs":30000},"commentChecker":{"enabled":true},"dedupPrune":{"enabled":true},"errorPrune":{"enabled":true,"turnsBeforePrune":4},"qualityGate":{"enabled":false},"safetyNet":{"enabled":true},"toolDiscovery":{"enabled":true},"memory":{"enabled":true,"autoCapture":true,"embeddings":{"enabled":true,"model":"onnx-community/granite-embedding-small-english-r2-ONNX"}},"transform":{"enabled":true,"smartDrops":true,"cacheLayout":true,"sessionFacts":true}}'

  JSONC_EDIT=""
  if command -v bun >/dev/null 2>&1; then
    JSONC_EDIT="bun $SCRIPT_DIR/jsonc-edit.mjs"
  elif command -v node >/dev/null 2>&1; then
    JSONC_EDIT="node $SCRIPT_DIR/jsonc-edit.mjs"
  else
    echo "Error: bun or node is required to edit $CONFIG_FILE" >&2
    exit 1
  fi

  echo ""
  echo "=== Config ==="
  $JSONC_EDIT add "$CONFIG_FILE" "$PLUGIN_DIR" "$OPTIONS"
  echo ""
  echo "  Plugin options written:"
  echo "$OPTIONS" | bun -e 'console.log(JSON.stringify(JSON.parse(await Bun.stdin.text()), null, 2).replace(/^/gm, "    "))' 2>/dev/null || echo "$OPTIONS"
fi

echo ""
echo "Done! Restart MiMoCode to pick up the new agents, modes, and skills."
echo "  Agents: $TARGET/agents/"
echo "  Modes:  $TARGET/modes/"
echo "  Skills: $TARGET/skills/"
echo "  Rules:  $TARGET/AGENTS.md"
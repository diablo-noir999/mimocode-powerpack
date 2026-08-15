#!/bin/bash
# mimocode-powerpack uninstaller
# Removes powerpack-deployed agents, modes, skills, and rules, then removes
# the plugin entry from mimocode.jsonc (global mode). User-owned files in the
# same directories are never touched — only basenames that match powerpack
# source files are deleted.
#
# Usage:
#   ./scripts/uninstall.sh           # Global: ~/.config/mimocode/
#   ./scripts/uninstall.sh --global  # Same as above
#   ./scripts/uninstall.sh --local   # Project-local: .mimocode/ (no config edit)
#
# Environment:
#   POWERPACK_TARGET=<dir>  Override the global config dir (for testing).

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_DIR="$(dirname "$SCRIPT_DIR")"

MODE="global"
case "$1" in
  --local|-l) MODE="local" ;;
  --global|-g|"") MODE="global" ;;
  *) echo "Unknown option: $1 (use --global or --local)" >&2; exit 2 ;;
esac

if [ "$MODE" = "global" ]; then
  TARGET="${POWERPACK_TARGET:-$HOME/.config/mimocode}"
  echo "Uninstalling from global: $TARGET/"
else
  TARGET=".mimocode"
  echo "Uninstalling project-local: $TARGET/"
fi

# Sanity guard: never rm against "/" or an empty target
case "$TARGET" in
  ""|/|//) echo "Error: refusing to uninstall from '$TARGET'" >&2; exit 2 ;;
esac

if [ ! -d "$TARGET" ]; then
  echo "  Target $TARGET does not exist — nothing to remove."
  exit 0
fi

# --- Collect the exact set of files powerpack installs -----------------------

rm_one() { # rm_one <file>
  if [ -f "$1" ]; then
    rm -f "$1"
    echo "  removed $1"
  fi
}

# Agents that powerpack shipped in older versions but which no longer exist in
# the repo (deleted from src/agents/). They are still powerpack artifacts, so a
# full uninstall must remove them too.
LEGACY_AGENTS="api-designer auto-mode compliance-auditor database-reviewer devops-engineer performance-engineer sidekick"

echo ""
echo "=== Agents ==="
for agent in "$PLUGIN_DIR/src/agents/"*.md; do
  [ ! -f "$agent" ] && continue
  rm_one "$TARGET/agents/$(basename "$agent")"
done
for legacy in $LEGACY_AGENTS; do
  rm_one "$TARGET/agents/$legacy.md"
done

echo ""
echo "=== Modes ==="
for mode in "$PLUGIN_DIR/modes/"*.md; do
  [ ! -f "$mode" ] && continue
  rm_one "$TARGET/modes/$(basename "$mode")"
done

echo ""
echo "=== Skills ==="
for skill_dir in "$PLUGIN_DIR/skills/"*/; do
  [ -d "$skill_dir" ] || continue
  [ -L "$skill_dir" ] && continue
  [ ! -f "$skill_dir/SKILL.md" ] && continue
  skill_name=$(basename "$skill_dir")
  rm_one "$TARGET/skills/$skill_name/SKILL.md"
  if [ -d "$skill_dir/references" ]; then
    for ref in "$skill_dir/references/"*; do
      [ -e "$ref" ] && rm_one "$TARGET/skills/$skill_name/references/$(basename "$ref")"
    done
    rmdir "$TARGET/skills/$skill_name/references" 2>/dev/null || true
  fi
  rmdir "$TARGET/skills/$skill_name" 2>/dev/null || true
done

echo ""
echo "=== Rules ==="
rm_one "$TARGET/AGENTS.md"

# Tidy empty powerpack-owned directories (leave user files alone)
rmdir "$TARGET/agents" 2>/dev/null || true
rmdir "$TARGET/modes" 2>/dev/null || true
rmdir "$TARGET/skills" 2>/dev/null || true

# --- Global mode: remove the plugin entry from config ------------------------

if [ "$MODE" = "global" ]; then
  CONFIG_FILE="$TARGET/mimocode.jsonc"
  if [ ! -f "$CONFIG_FILE" ] && [ -f "$TARGET/mimocode.json" ]; then
    CONFIG_FILE="$TARGET/mimocode.json"
  fi

  if [ -f "$CONFIG_FILE" ]; then
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
    $JSONC_EDIT remove "$CONFIG_FILE" "$PLUGIN_DIR"
  fi
fi

echo ""
echo "Done! Powerpack files have been removed from $TARGET."
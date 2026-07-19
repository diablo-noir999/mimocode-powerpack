#!/bin/bash
# mimocode-powerpack installer
# Deploys agents, skills, and rules to MiMoCode's discovery paths.
#
# Usage:
#   ./scripts/install.sh          # Install to ~/.config/mimocode/
#   ./scripts/install.sh --local  # Install to .mimocode/ (project-local)
#   ./scripts/install.sh --global # Install to ~/.config/mimocode/ (global)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_DIR="$(dirname "$SCRIPT_DIR")"

# Determine install target
if [ "$1" = "--local" ] || [ "$1" = "-l" ]; then
  TARGET=".mimocode"
  echo "Installing to project-local: .mimocode/"
elif [ "$1" = "--global" ] || [ "$1" = "-g" ] || [ "$1" = "" ]; then
  TARGET="$HOME/.config/mimocode"
  echo "Installing to global: $TARGET/"
fi

# Create directories
mkdir -p "$TARGET/agents"
mkdir -p "$TARGET/skills"
mkdir -p "$TARGET/modes"

# Install agents
echo ""
echo "=== Installing agents ==="
for agent in "$PLUGIN_DIR/src/agents/"*.md; do
  name=$(basename "$agent")
  cp "$agent" "$TARGET/agents/$name"
  echo "  ✓ $name"
done

# Install modes (Tab-switchable primary agents)
echo ""
echo "=== Installing modes ==="
for mode in "$PLUGIN_DIR/modes/"*.md; do
  [ ! -f "$mode" ] && continue
  name=$(basename "$mode")
  cp "$mode" "$TARGET/modes/$name"
  echo "  ✓ $name"
done

# Install skills (skip the 'skills' symlink)
echo ""
echo "=== Installing skills ==="
for skill_dir in "$PLUGIN_DIR/skills/"*/; do
  skill_name=$(basename "$skill_dir")
  # Skip symlinks
  [ -L "$skill_dir" ] && continue
  # Skip if no SKILL.md
  [ ! -f "$skill_dir/SKILL.md" ] && continue
  mkdir -p "$TARGET/skills/$skill_name"
  cp "$skill_dir/SKILL.md" "$TARGET/skills/$skill_name/"
  # Copy references directory if it exists
  if [ -d "$skill_dir/references" ]; then
    cp -r "$skill_dir/references" "$TARGET/skills/$skill_name/"
  fi
  echo "  ✓ $skill_name"
done

# Install rules (AGENTS.md)
echo ""
echo "=== Installing rules ==="
if [ -f "$PLUGIN_DIR/AGENTS.md" ]; then
  cp "$PLUGIN_DIR/AGENTS.md" "$TARGET/AGENTS.md"
  echo "  ✓ AGENTS.md (global agent instructions)"
fi

# Install project-level AGENTS.md if in project-local mode
if [ "$TARGET" = ".mimocode" ] && [ -f "$PLUGIN_DIR/AGENTS.md" ]; then
  cp "$PLUGIN_DIR/AGENTS.md" ".mimocode/AGENTS.md"
  echo "  ✓ .mimocode/AGENTS.md (project-level)"
fi

# Install config
echo ""
echo "=== Config ==="
CONFIG_FILE="$TARGET/mimocode.jsonc"
if [ "$TARGET" = "$HOME/.config/mimocode" ]; then
  if [ ! -f "$CONFIG_FILE" ]; then
    cat > "$CONFIG_FILE" << 'ENDCONFIG'
{
  "$schema": "https://mimo.xiaomi.com/mimocode/config.json",
  "plugin": []
}
ENDCONFIG
    echo "  Created $CONFIG_FILE"
  fi

  # Check if our plugin is already in config
  if grep -q "mimocode-powerpack" "$CONFIG_FILE" 2>/dev/null; then
    echo "  Plugin already configured in $CONFIG_FILE"
  else
    echo ""
    echo "  ⚠ Add this to the \"plugin\" array in $CONFIG_FILE:"
    echo ""
    echo '    ["'"$PLUGIN_DIR"'", {'
    echo '      "powerpack": {'
    echo '        "notify": { "enabled": true, "quietHours": { "start": "22:00", "end": "08:00" } },'
    echo '        "todoEnforcer": { "enabled": true, "maxFailures": 5, "cooldownMs": 30000 },'
    echo '        "commentChecker": { "enabled": true },'
    echo '        "rulesInjector": { "enabled": true },'
    echo '        "modelFallback": { "enabled": true },'
    echo '        "dedupPrune": { "enabled": true },'
    echo '        "errorPrune": { "enabled": true, "turnsBeforePrune": 4 },'
    echo '        "intentGate": { "enabled": true },'
    echo '        "safetyNet": { "enabled": true },'
    echo '        "qualityGate": { "enabled": false },'
    echo '        "toolDiscovery": { "enabled": true },'
    echo '        "loopUntilDone": { "enabled": true },'
    echo '        "skills": { "enabled": true, "installDir": ".mimocode/skills" },'
    echo '        "memory": {'
    echo '          "enabled": true,'
    echo '          "autoCapture": true,'
    echo '          "embeddings": { "enabled": true, "model": "onnx-community/granite-embedding-small-english-r2-ONNX" }'
    echo '        },'
    echo '        "transform": { "enabled": true, "smartDrops": true, "cacheLayout": true, "sessionFacts": true },'
    echo '        "team": { "enabled": false },'
    echo '        "review": { "enabled": false, "port": 5174 },'
    echo '        "kimaki": { "enabled": false },'
    echo '        "quota": { "providers": ["mimo", "copilot", "openai"] }'
    echo '      }'
    echo '    }]'
    echo ""
  fi
elif [ "$TARGET" = ".mimocode" ]; then
  echo "  Project-local mode — add plugin to your global ~/.config/mimocode/mimocode.jsonc"
fi

echo ""
echo "✅ Done! Restart MiMoCode to pick up the new agents, modes, and skills."
echo "   Agents: $TARGET/agents/"
echo "   Modes:  $TARGET/modes/"
echo "   Skills: $TARGET/skills/"
echo "   Rules:  $TARGET/AGENTS.md"

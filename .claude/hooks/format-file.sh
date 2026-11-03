#!/usr/bin/env bash
# PostToolUse: format/lint-fix the file Claude just edited, in the checkout that owns it. Never blocks.
source "$(dirname "$0")/common.sh"
file="$(json_field tool_input.file_path)"
case "$file" in
  *.ts|*.tsx|*.js|*.mjs|*.json|*.css) ;;
  *) exit 0 ;;
esac
cd "$(checkout_root "$(dirname "$file")")" && pnpm exec biome check --write --no-errors-on-unmatched "$file" >/dev/null 2>&1 || true

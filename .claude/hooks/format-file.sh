#!/usr/bin/env bash
# PostToolUse: format/lint-fix the file Claude just edited. Never blocks.
file="$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).tool_input?.file_path??"")}catch{}})')"
case "$file" in
  *.ts|*.tsx|*.js|*.mjs|*.json|*.css) ;;
  *) exit 0 ;;
esac
cd "$CLAUDE_PROJECT_DIR" && pnpm exec biome check --write --no-errors-on-unmatched "$file" >/dev/null 2>&1 || true

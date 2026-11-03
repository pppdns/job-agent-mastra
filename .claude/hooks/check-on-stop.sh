#!/usr/bin/env bash
# Stop: run `pnpm check`; on failure, block once and hand the errors back to Claude.
input="$(cat)"
active="$(printf '%s' "$input" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).stop_hook_active??false))}catch{process.stdout.write("false")}})')"
[[ "$active" == "true" ]] && exit 0
cd "$CLAUDE_PROJECT_DIR" || exit 0
[[ -f package.json ]] || exit 0
if ! output="$(pnpm -s check 2>&1)"; then
  printf 'pnpm check failed — fix before finishing:\n%s\n' "$(printf '%s' "$output" | tail -40)" >&2
  exit 2
fi
exit 0

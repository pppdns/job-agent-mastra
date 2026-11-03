# Sourced by the hooks. Reads the hook's JSON input once into HOOK_INPUT.
# Desktop worktree sessions run hooks from the main checkout ($CLAUDE_PROJECT_DIR), so the
# checkout Claude is actually working in is derived from the input's `cwd` (or an edited file).
HOOK_INPUT="$(cat)"

# Prints a dotted field of the hook input, e.g. `json_field tool_input.file_path`; empty if absent.
json_field() {
  printf '%s' "$HOOK_INPUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const v=process.argv[1].split(".").reduce((o,k)=>o?.[k],JSON.parse(s));if(v!=null)process.stdout.write(String(v))}catch{}})' "$1"
}

# Git toplevel of the given directory (default: the session's cwd), else $CLAUDE_PROJECT_DIR.
checkout_root() {
  git -C "${1:-$(json_field cwd)}" rev-parse --show-toplevel 2>/dev/null || printf '%s' "$CLAUDE_PROJECT_DIR"
}

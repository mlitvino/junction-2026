#!/bin/bash
# PreToolUse guard for Bash commands (best-effort, layer 3 of 3).
# Exit 2 blocks the command; exit 0 lets it through. Exit 1 would NOT block.

if ! command -v jq >/dev/null 2>&1; then
  echo "guard.sh: jq is not installed, blocking Bash until it is (sudo apt-get install jq)" >&2
  exit 2
fi

cmd=$(jq -r '.tool_input.command // empty')

# .env.example is a committed template without secrets: ignore it before checking.
check=${cmd//.env.example/}

if echo "$check" | grep -qE 'rm\s+-[a-zA-Z]*r[a-zA-Z]*f?\s+(/|~|\$HOME)(\s|$)|\.env|mkfs|dd\s+if='; then
  echo "Blocked by guard.sh: destructive command or access to .env files" >&2
  exit 2
fi

exit 0

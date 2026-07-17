#!/bin/zsh
cd "$(dirname "$0")"
NODE_BIN="$(command -v node)"
if [[ -z "$NODE_BIN" ]]; then
  osascript -e 'display alert "Node.js is required" message "Install Node.js 20 or newer from nodejs.org, then open this launcher again."'
  exit 1
fi
if curl -fsS "http://127.0.0.1:4173/api/version" >/dev/null 2>&1; then
  open "http://127.0.0.1:4173"
  exit 0
fi
(sleep 1; open "http://127.0.0.1:4173") &
exec "$NODE_BIN" --watch --watch-preserve-output server.mjs

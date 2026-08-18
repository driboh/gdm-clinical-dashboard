#!/bin/bash

# Finder launcher for the local GDM Clinical Dashboard.
# The project directory is resolved from this file's own location so the
# launcher continues to work if the entire GDM Project folder is moved.

set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

clear 2>/dev/null || true
echo "=============================================="
echo "          GDM Clinical Dashboard"
echo "=============================================="
echo

# Finder launches with a minimal PATH. Include standard Mac locations and
# Codex's bundled runtime as a fallback for this Mac.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/Users/DRiboh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Users/DRiboh/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback:$PATH"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js was not found. Please install Node.js, then double-click this file again."
  echo
  read -r -p "Press Return to close Terminal..."
  exit 1
fi

if [ ! -x "node_modules/.bin/next" ]; then
  echo "Preparing the application for first use..."
  if command -v npm >/dev/null 2>&1; then
    npm install
  elif command -v pnpm >/dev/null 2>&1; then
    pnpm install
  else
    echo "A package manager was not found. Please install Node.js, then try again."
    echo
    read -r -p "Press Return to close Terminal..."
    exit 1
  fi
fi

echo "Starting the GDM application..."
echo "The browser will open automatically when it is ready."
echo
echo "When you are finished, return to this window and press Control+C to stop the GDM application."
echo

# Open the browser only after the local server begins responding.
(
  for attempt in $(seq 1 90); do
    if curl --silent --fail --output /dev/null "http://localhost:3000"; then
      open "http://localhost:3000"
      exit 0
    fi
    sleep 1
  done
) &

exec "node_modules/.bin/next" dev

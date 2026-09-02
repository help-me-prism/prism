#!/bin/sh
set -eu
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'Prism requires Node.js 22.12 or newer.'
  printf '%s\n' 'Install the current LTS release from https://nodejs.org and run this file again.'
  printf '%s' 'Press Return to close...'
  read -r _answer
  exit 1
fi

node scripts/check-runtime.mjs

if [ ! -d node_modules ]; then
  printf '%s\n' 'Installing Prism dependencies...'
  npm ci
fi

npm start

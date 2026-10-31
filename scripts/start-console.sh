#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == --help ]]; then
  echo 'Usage: ./scripts/start-console.sh [--production]'
  echo 'Starts native Linux Party Console with browser setup and hot reload by default.'
  exit 0
fi
if [[ $# -gt 1 || ($# -eq 1 && "$1" != --production) ]]; then
  echo 'Usage: ./scripts/start-console.sh [--production]' >&2
  exit 1
fi
if [[ "$(uname -s)" != Linux ]]; then
  echo 'This launcher requires Linux. On Windows use scripts/start-console.ps1.' >&2
  exit 1
fi
if [[ $EUID -eq 0 ]]; then
  echo 'Run this launcher as your normal user, without sudo.' >&2
  exit 1
fi
for command in node npm git tar flock; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Missing prerequisite: $command. Install Node 26.12.1+, npm, Git, tar and util-linux (flock)." >&2
    exit 1
  fi
done
node -e 'const [major,minor,patch]=process.versions.node.split(".").map(Number); if(major<26||(major===26&&(minor<12||(minor===12&&patch<1)))){console.error("Node 26.12.1+ is required.");process.exit(1)} if(!["x64","arm64"].includes(process.arch)){console.error("A 64-bit x64 or arm64 Linux installation is required.");process.exit(1)}'
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"
mkdir -p .build
# Keep the descriptor open across exec; Linux releases this lock on exit.
exec 9>.build/native-console.lock
if ! flock -n 9; then
  echo 'Party Console is already starting or running from this checkout. Stop it with Ctrl+C before restarting.' >&2
  exit 1
fi
exec node tools/hosting/native.mts "$@"

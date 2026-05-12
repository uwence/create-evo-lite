#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
    printf 'Usage: %s <pretooluse|posttooluse|precompact|sessionstart>\n' "$0" >&2
    exit 1
fi

hook="$1"
hooks_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
repo_root="$(cd "$hooks_dir/../.." && pwd -P)"

docker_repo_root="$(cygpath -m "$repo_root")"

exec env MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' docker run --rm --init -i \
    -e HOME=/data \
    -v mcp-context-mode-data:/data \
    -v "$docker_repo_root:/workspace" \
    -w /workspace \
    mcp-context-mode:local \
    hook vscode-copilot "$hook"

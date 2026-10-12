#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

REMOVE_IMAGE=false
REMOVE_WORKTREE=false

show_usage() {
	cat <<EOF
Usage: $0 [--image] [--worktree]

Stop the main-branch compare frontend (port 3100). The NLIP stack on :3000 is left running.

Options:
  --image      Also remove the frontend-baseline image
  --worktree   Also delete .worktrees/main
  --help       Show this help message
EOF
}

for arg in "$@"; do
	case "$arg" in
	--image) REMOVE_IMAGE=true ;;
	--worktree) REMOVE_WORKTREE=true ;;
	--help | -h)
		show_usage
		exit 0
		;;
	*)
		show_usage
		exit 1
		;;
	esac
done

COMPOSE=(
	docker compose --project-directory .
	-f infra/docker/docker-compose.yaml
	-f infra/docker/docker-compose.compare.yaml
	--profile compare
)

echo "[INFO] Stopping baseline (main) frontend"
if [ "$REMOVE_IMAGE" = true ]; then
	"${COMPOSE[@]}" rm -sf frontend-baseline >/dev/null 2>&1 || true
	docker image rm -f "$(docker compose --project-directory . -f infra/docker/docker-compose.yaml -f infra/docker/docker-compose.compare.yaml --profile compare images -q frontend-baseline 2>/dev/null || true)" >/dev/null 2>&1 || true
else
	"${COMPOSE[@]}" stop frontend-baseline >/dev/null 2>&1 || true
	"${COMPOSE[@]}" rm -f frontend-baseline >/dev/null 2>&1 || true
fi

if [ "$REMOVE_WORKTREE" = true ]; then
	worktree="${ILLINOIS_CHAT_BASELINE_ROOT:-$REPO_ROOT/.worktrees/main}"
	if [ -e "$worktree" ]; then
		echo "[INFO] Removing worktree $worktree"
		git -C "$REPO_ROOT" worktree remove --force "$worktree" || rm -rf "$worktree"
	fi
fi

echo "[SUCCESS] Baseline frontend stopped. NLIP UI remains at http://localhost:3000"

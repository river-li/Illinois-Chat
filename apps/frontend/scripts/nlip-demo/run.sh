#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
# Paths are relative to this checkout so the same script works on a laptop.
demo_venv="${NLIP_DEMO_VENV:-$PWD/scripts/nlip-demo/.venv}"
demo_cache="${NLIP_DEMO_CACHE:-${TMPDIR:-/tmp}/illinois-nlip-demo-cache}"
if command -v uv >/dev/null 2>&1; then
	uv venv --allow-existing "$demo_venv" --cache-dir "$demo_cache"
	uv pip install --python "$demo_venv/bin/python" --cache-dir "$demo_cache" -r scripts/nlip-demo/requirements.txt
else
	python3 -m venv "$demo_venv"
	"$demo_venv/bin/python" -m pip install --cache-dir "$demo_cache" -r scripts/nlip-demo/requirements.txt
fi
NLIP_DEMO_PYTHON="$demo_venv/bin/python" npx vitest run src/server/nlip/__tests__/demo.integration.test.ts

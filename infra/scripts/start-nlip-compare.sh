#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

NLIP_PORT="${FRONTEND_PORT:-3000}"
BASELINE_PORT="${BASELINE_FRONTEND_PORT:-3100}"
BASELINE_REF="${BASELINE_REF:-origin/main}"
WORKTREE="${ILLINOIS_CHAT_BASELINE_ROOT:-$REPO_ROOT/.worktrees/main}"
SKIP_STACK=false
REBUILD_NLIP=false

COMPOSE_BASE=(docker compose --project-directory . -f infra/docker/docker-compose.yaml)
COMPOSE_COMPARE=(
	docker compose --project-directory .
	-f infra/docker/docker-compose.yaml
	-f infra/docker/docker-compose.compare.yaml
	--profile compare
)

show_usage() {
	cat <<EOF
Usage: $0 [--skip-stack] [--rebuild-nlip] [--baseline-ref=REF] [--baseline-port=PORT]

Start a side-by-side demo:
  NLIP branch  (this checkout)  http://localhost:${NLIP_PORT}
  main branch  (git worktree)   http://localhost:${BASELINE_PORT}

Both UIs share Keycloak, Postgres, MinIO, and documents. That is intentional:
the demo is the same chatbot with vs without NLIP, not two isolated clusters.
A second full Docker stack is not started — it typically OOM-kills Docker Desktop.

Options:
  --skip-stack         Do not start/rebuild the NLIP stack; only add :${BASELINE_PORT}
  --rebuild-nlip       Also rebuild the NLIP frontend before starting baseline
  --baseline-ref=REF   Git ref for the no-NLIP UI (default: origin/main)
  --baseline-port=PORT Host port for main (default: ${BASELINE_PORT})
  --help               Show this help message
EOF
}

for arg in "$@"; do
	case "$arg" in
	--skip-stack) SKIP_STACK=true ;;
	--rebuild-nlip) REBUILD_NLIP=true ;;
	--baseline-ref=*) BASELINE_REF="${arg#*=}" ;;
	--baseline-port=*) BASELINE_PORT="${arg#*=}" ;;
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

log() { echo "[INFO] $1"; }
success() { echo "[SUCCESS] $1"; }
warn() { echo "[WARNING] $1"; }

if [ ! -f .env ]; then
	echo "[ERROR] Missing .env in the repo root. Copy .env.template or run infra/scripts/start-all.sh --no-sim first."
	exit 1
fi

set -a
# shellcheck disable=SC1091
. ./.env
set +a

export BASELINE_FRONTEND_PORT="$BASELINE_PORT"

ensure_worktree() {
	mkdir -p "$(dirname "$WORKTREE")"
	if [ -d "$WORKTREE/.git" ] || [ -f "$WORKTREE/.git" ]; then
		log "Updating baseline worktree at $WORKTREE ($BASELINE_REF)"
		git -C "$REPO_ROOT" fetch origin main --quiet || git -C "$REPO_ROOT" fetch origin --quiet
		git -C "$WORKTREE" fetch origin --quiet || true
		git -C "$WORKTREE" checkout --detach "$BASELINE_REF"
		return
	fi
	if [ -e "$WORKTREE" ]; then
		echo "[ERROR] $WORKTREE exists but is not a git worktree"
		exit 1
	fi
	log "Creating git worktree for $BASELINE_REF at $WORKTREE"
	git -C "$REPO_ROOT" fetch origin main --quiet || git -C "$REPO_ROOT" fetch origin --quiet
	git -C "$REPO_ROOT" worktree add --detach "$WORKTREE" "$BASELINE_REF"
}

frontend_src() {
	local path="$WORKTREE/apps/frontend"
	if [ ! -f "$path/Dockerfile" ]; then
		echo "[ERROR] Baseline frontend Dockerfile not found at $path"
		exit 1
	fi
	echo "$path"
}

nlip_frontend_up() {
	curl -sf -o /dev/null --max-time 3 "http://localhost:${NLIP_PORT}" 2>/dev/null
}

ensure_nlip_stack() {
	if [ "$SKIP_STACK" = true ]; then
		if ! nlip_frontend_up; then
			echo "[ERROR] --skip-stack was set but http://localhost:${NLIP_PORT} is not responding"
			exit 1
		fi
		return
	fi
	if [ "$REBUILD_NLIP" = true ] || ! nlip_frontend_up; then
		if [ "$REBUILD_NLIP" = true ]; then
			log "Rebuilding NLIP frontend, then starting the shared stack"
			"${COMPOSE_BASE[@]}" up -d --build frontend
		fi
		log "Ensuring the shared NLIP Docker stack is up (--no-sim)"
		bash "$SCRIPT_DIR/start-all.sh" --no-sim
	else
		log "NLIP stack already responding on :${NLIP_PORT}"
		"${COMPOSE_BASE[@]}" up -d
	fi
	# Crawlee is not needed for the NLIP vs main chat demo and is a large RAM
	# consumer on Apple Silicon. Leave the container defined; just stop it.
	log "Stopping crawlee to free RAM for the baseline frontend"
	"${COMPOSE_BASE[@]}" stop crawlee >/dev/null 2>&1 || true
}

# Running Keycloak imported the realm before 3100 was added. Patch the live
# client so OIDC login from the baseline UI is accepted.
allow_baseline_oidc() {
	log "Allowing Keycloak redirects from http://localhost:${BASELINE_PORT}"
	if ! "${COMPOSE_BASE[@]}" exec -T \
		-e KC_PASS="${KEYCLOAK_ADMIN_PASSWORD:?KEYCLOAK_ADMIN_PASSWORD is required}" \
		-e BASELINE_PORT="$BASELINE_PORT" \
		keycloak bash -s >/dev/null <<'EOS'
set -euo pipefail
kcadm=/opt/keycloak/bin/kcadm.sh
"$kcadm" config credentials --server http://localhost:8080 --realm master \
  --user "${KEYCLOAK_ADMIN:-admin}" --password "$KC_PASS" >/dev/null
cid="$("$kcadm" get clients -r illinois_chat_realm -q clientId=illinois_chat --fields id | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -n 1)"
if [ -z "$cid" ]; then
  echo "illinois_chat client not found" >&2
  exit 1
fi
"$kcadm" update "clients/$cid" -r illinois_chat_realm \
  -s "redirectUris=[\"http://localhost:3000/\",\"http://localhost:3000/*\",\"http://localhost:3001/\",\"http://localhost:3001/*\",\"http://localhost:${BASELINE_PORT}/\",\"http://localhost:${BASELINE_PORT}/*\",\"http://127.0.0.1:3000/\",\"http://127.0.0.1:3000/*\",\"http://127.0.0.1:3001/\",\"http://127.0.0.1:3001/*\",\"http://127.0.0.1:${BASELINE_PORT}/\",\"http://127.0.0.1:${BASELINE_PORT}/*\"]" \
  -s "webOrigins=[\"+\",\"http://localhost:3001\",\"http://localhost:${BASELINE_PORT}\",\"http://127.0.0.1:3000\",\"http://127.0.0.1:3001\",\"http://127.0.0.1:${BASELINE_PORT}\"]"
EOS
	then
		warn "Could not update Keycloak client redirects. Log in on :${NLIP_PORT} still works; :${BASELINE_PORT} may fail until you add that origin in the Keycloak admin console."
	else
		success "Keycloak accepts http://localhost:${BASELINE_PORT}"
	fi
}

start_baseline() {
	local src
	src="$(frontend_src)"
	export ILLINOIS_CHAT_BASELINE_FRONTEND="$src"
	log "Building main-branch frontend from $src (first build takes several minutes)"
	"${COMPOSE_COMPARE[@]}" up -d --build frontend-baseline
}

wait_for_baseline() {
	local elapsed=0
	local timeout=180
	log "Waiting for baseline frontend on :${BASELINE_PORT}"
	until curl -sf -o /dev/null --max-time 3 "http://localhost:${BASELINE_PORT}"; do
		if [ "$elapsed" -ge "$timeout" ]; then
			"${COMPOSE_COMPARE[@]}" logs --tail 80 frontend-baseline || true
			echo "[ERROR] Baseline frontend did not respond on :${BASELINE_PORT} within ${timeout}s"
			exit 1
		fi
		sleep 3
		elapsed=$((elapsed + 3))
	done
	success "Baseline frontend is up"
}

ensure_worktree
ensure_nlip_stack
allow_baseline_oidc
start_baseline
wait_for_baseline

cat <<EOF

[SUCCESS] Side-by-side demo is ready. Same account, same projects, two UIs:

  NLIP (this branch)     http://localhost:${NLIP_PORT}
  Baseline (main)        http://localhost:${BASELINE_PORT}

Demo checklist (open both, sign in with the same user):
  1. Open /course_slides/tools
       NLIP: "NLIP Agents" panel (lab + weather)
       main: no NLIP section
  2. Open /course_slides/chat, enable Agent Mode
       NLIP: can call ask_nlip_* tools
       main: RAG / search_documents only
  3. GET /api/nlip/lab_ta
       NLIP: inbound project RAG
       main: 404

Stop only the main UI:
  bash infra/scripts/stop-nlip-compare.sh

EOF

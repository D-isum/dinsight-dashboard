#!/bin/bash
# Database Reset Script for the Dinsight Dashboard.
#
# Wipes every row + restarts every ID sequence from 1, then re-runs the
# admin seed migrations so you can sign back in as admin@disum.com.
#
# Two execution modes, auto-detected:
#
#   1. Docker compose deployment (the VM, prod) — execs /app/reset-db
#      inside the running api container. No Go toolchain needed on the
#      host; just docker.
#
#   2. Source build (developer machine without docker) — locates the
#      backend repo at $DINSIGHT_API_PATH (default: ../Dinsight_API_Enhanced
#      sibling to this repo) and builds + runs ./cmd/reset-db. Requires Go.

set -euo pipefail

# Resolve the repo root from this script's own location so cwd doesn't
# matter. Symlinks resolved via cd + pwd.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "🔄 D'insight Database Reset Script"
echo "=================================="
echo ""
echo "⚠️  WARNING: This will delete ALL data in the database!"
echo "This includes:"
echo "  - All uploaded files and processing results"
echo "  - All dinsight data and coordinates"
echo "  - All monitoring data and anomaly classifications"
echo "  - All user data and active sessions (except default admin)"
echo "  - All organization and machine data"
echo ""

read -r -p "Are you sure you want to continue? (yes/no): "
echo

if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
    echo "Operation cancelled."
    exit 0
fi

# --- Mode 1: docker compose deployment ---
# Look for a compose.yml in deploy/vm-test (the canonical VM layout).
# If the api service is running, exec the reset-db binary inside it.
COMPOSE_DIR="$REPO_ROOT/deploy/vm-test"
if [[ -f "$COMPOSE_DIR/compose.yml" ]]; then
    if (cd "$COMPOSE_DIR" && docker compose ps --status running --services 2>/dev/null | grep -q '^api$'); then
        echo "🐳 docker compose deployment detected — exec'ing /app/reset-db inside the api container..."
        cd "$COMPOSE_DIR"
        docker compose exec api /app/reset-db
        exit $?
    fi
fi

# --- Mode 2: source build (developer machine) ---
# Default to the sibling layout: <parent>/Dinsight_API_Enhanced + <parent>/dinsight-dashboard.
# Override via DINSIGHT_API_PATH if your checkout differs.
BE_PATH="${DINSIGHT_API_PATH:-$REPO_ROOT/../Dinsight_API_Enhanced}"
if [[ ! -d "$BE_PATH" ]]; then
    echo "❌ Backend repo not found at $BE_PATH"
    echo "   Either:"
    echo "     - bring up the docker compose stack (deploy/vm-test) first, OR"
    echo "     - set DINSIGHT_API_PATH=/path/to/Dinsight_API_Enhanced and re-run."
    exit 1
fi

cd "$BE_PATH"
echo "🏗️  Building reset utility..."
mkdir -p dist
go build -o ./dist/reset-db ./cmd/reset-db

echo "🗑️  Resetting database..."
# The Go binary prints its own ✅ summary on success, including the
# admin credentials. Wrapper just propagates the exit code so callers
# can chain it (`./scripts/reset-db.sh && ./dist/api-server`).
./dist/reset-db
status=$?
rm -f ./dist/reset-db
exit $status

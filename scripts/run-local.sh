#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/mac-common.sh"
cd "$PULSEWATCH_ROOT"
case "${1:-check}" in
  check)
    echo "Architecture: $(uname -m)"
    missing=0
    if pulsewatch_java21; then java -version; else missing=1; fi
    if pulsewatch_maven; then "$PULSEWATCH_MVN" -version; else missing=1; fi
    if command -v node >/dev/null 2>&1; then node -v; npm -v; else missing=1; fi
    if command -v docker >/dev/null 2>&1; then
      docker --version
      docker compose version
      if ! docker info >/dev/null 2>&1; then
        echo 'Docker engine is not reachable. Open Docker Desktop and wait until it is running.' >&2
        missing=1
      fi
    else
      echo 'Docker CLI is missing. Run: bash scripts/setup-mac.sh' >&2
      missing=1
    fi
    exit "$missing"
    ;;
  backend)
    pulsewatch_java21
    pulsewatch_maven
    pulsewatch_env
    docker info >/dev/null
    docker compose up -d --wait
    exec "$PULSEWATCH_MVN" -f backend/pom.xml spring-boot:run
    ;;
  frontend)
    pulsewatch_env
    cd frontend
    if [[ ! -d node_modules ]]; then npm ci; fi
    exec npm run dev
    ;;
  verify)
    pulsewatch_java21
    pulsewatch_maven
    pulsewatch_env
    docker info >/dev/null
    docker compose up -d --wait
    export PULSEWATCH_TEST_DB_URL="$DB_URL"
    export PULSEWATCH_TEST_DB_USER="$DB_USERNAME"
    export PULSEWATCH_TEST_DB_PASSWORD="$DB_PASSWORD"
    "$PULSEWATCH_MVN" -f backend/pom.xml verify
    cd frontend
    if [[ ! -d node_modules ]]; then npm ci; fi
    npm test
    npm run typecheck
    npm run build
    npm run check:build
    ;;
  smoke)
    # Both application terminals must already be running.
    exec python3 scripts/smoke-local.py
    ;;
  *) echo 'Usage: bash scripts/run-local.sh {check|backend|frontend|verify|smoke}' >&2; exit 2 ;;
esac

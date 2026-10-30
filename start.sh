#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
[ -z "${JAVA_HOME:-}" ] || export PATH="$JAVA_HOME/bin:$PATH"
[ -f backend/target/myhouse-1.0.0.jar ] || ./build.sh
export MYHOUSE_DATA_DIR="$PWD/data"
export SERVER_PORT="${SERVER_PORT:-8765}"
export MYHOUSE_BIND_ADDRESS="${MYHOUSE_BIND_ADDRESS:-127.0.0.1}"
(sleep 2; command -v xdg-open >/dev/null && xdg-open http://127.0.0.1:8765 >/dev/null 2>&1 || true) &
exec java -jar backend/target/myhouse-1.0.0.jar

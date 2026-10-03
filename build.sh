#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
[ -z "${JAVA_HOME:-}" ] || export PATH="$JAVA_HOME/bin:$PATH"
(cd frontend && { [ -d node_modules ] || pnpm install; } && pnpm build)
(cd backend && mvn clean package)

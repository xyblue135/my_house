#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
export JAVA_HOME="/d/4environment/Java/jdk-21.0.7"
export PATH="$JAVA_HOME/bin:$PATH"
(cd frontend && { [ -d node_modules ] || pnpm install; } && pnpm build)
(cd backend && mvn clean package)

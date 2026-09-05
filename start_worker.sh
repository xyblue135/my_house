#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
export JAVA_HOME="/d/4environment/Java/jdk-21.0.7"
export PATH="$JAVA_HOME/bin:$PATH"
[ -f backend/target/itemnest-1.0.0.jar ] || ./build.sh
export ITEMNEST_DATA_DIR="$PWD/data"
export ITEMNEST_RABBITMQ_ENABLED=true
export ITEMNEST_RABBITMQ_WORKER_ENABLED=true
exec java -jar backend/target/itemnest-1.0.0.jar --spring.main.web-application-type=none

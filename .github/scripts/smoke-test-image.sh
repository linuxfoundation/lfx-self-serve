#!/usr/bin/env bash
# Copyright The Linux Foundation and each contributor to LFX.
# SPDX-License-Identifier: MIT

# Runs the just-built runtime image standalone (no upstream config) and
# confirms /livez responds before the workflow ships it. Every env var
# server.ts reads has a hardcoded fallback, so this catches container-level
# regressions (missing pm2 binary, missing dist-docs/pdf-templates, broken
# CMD) without needing real secrets.

set -euo pipefail

IMAGE="$1"
CONTAINER_NAME="smoke-test-$$"

cleanup() {
  docker logs "$CONTAINER_NAME" || true
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run -d --name "$CONTAINER_NAME" -p 4000:4000 "$IMAGE"

for _ in $(seq 1 30); do
  if curl -sf http://localhost:4000/livez >/dev/null; then
    echo "livez responded"
    exit 0
  fi
  sleep 1
done

echo "::error::/livez did not respond within 30s"
exit 1

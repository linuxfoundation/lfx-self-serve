#!/usr/bin/env bash
# Copyright The Linux Foundation and each contributor to LFX.
# SPDX-License-Identifier: MIT

# Polls a running container's /livez until it responds or times out. The
# caller (a workflow step) is responsible for starting and tearing down the
# container; this script only verifies it comes up.

set -euo pipefail

URL="${1:-http://localhost:4000/livez}"

for _ in $(seq 1 30); do
  if curl -sf "$URL" >/dev/null; then
    echo "livez responded"
    exit 0
  fi
  sleep 1
done

echo "::error::$URL did not respond within 30s"
exit 1

#!/usr/bin/env bash
# Copyright The Linux Foundation and each contributor to LFX.
# SPDX-License-Identifier: MIT
#
# Guard hook: warns when editing protected infrastructure files.
# Used by Claude Code PreToolUse hook on Edit and Write operations.
# Exit code 0 = allow (with warning message printed to stderr).

set -euo pipefail

# Read tool input from stdin (JSON with file_path field)
INPUT=$(cat)

# Extract file_path from the JSON input
FILE_PATH=$(echo "$INPUT" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"file_path"[[:space:]]*:[[:space:]]*"//;s/"$//' || true)

# If no file_path found, allow the operation
if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Normalize: strip leading ./ if present
FILE_PATH="${FILE_PATH#./}"

# Also handle absolute paths by stripping the repo root
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo "")
if [ -n "$REPO_ROOT" ] && [[ "$FILE_PATH" == "$REPO_ROOT"/* ]]; then
  FILE_PATH="${FILE_PATH#$REPO_ROOT/}"
fi

# Helper: warn about a protected file (allows the edit to proceed)
warn() {
  local reason="$1"
  echo "" >&2
  echo "⚠ WARNING: This file is part of the project's core infrastructure." >&2
  echo "File: $FILE_PATH" >&2
  echo "Reason: $reason" >&2
  echo "Ensure this change is intentional and reviewed by a code owner." >&2
  echo "" >&2
  exit 0
}

# ── Server Infrastructure ──────────────────────────────────────
case "$FILE_PATH" in
  apps/lfx-one/src/server/server.ts)
    warn "Server bootstrap file — changes affect the entire application startup." ;;
  apps/lfx-one/src/server/server-logger.ts)
    warn "Logger configuration — changes affect all application logging." ;;
  apps/lfx-one/src/server/services/logger.service.ts)
    warn "Logger singleton service — changes affect all application logging." ;;
  apps/lfx-one/src/server/services/microservice-proxy.service.ts)
    warn "API proxy service — changes affect all backend API communication." ;;
  apps/lfx-one/src/server/services/nats.service.ts)
    warn "NATS messaging service — changes affect inter-service communication." ;;
  apps/lfx-one/src/server/services/snowflake.service.ts)
    warn "Snowflake database service — changes affect data warehouse access." ;;
  apps/lfx-one/src/server/services/supabase.service.ts)
    warn "Supabase service — changes affect user profile data management." ;;
  apps/lfx-one/src/server/services/ai.service.ts)
    warn "AI integration service — changes affect AI-powered features." ;;
  apps/lfx-one/src/server/services/project.service.ts)
    warn "Project service — core business logic for project management." ;;
  apps/lfx-one/src/server/services/etag.service.ts)
    warn "ETag caching service — changes affect HTTP caching behavior." ;;
  apps/lfx-one/src/server/helpers/error-serializer.ts)
    warn "Error serializer — changes affect error logging across the application." ;;
esac

# ── Middleware ──────────────────────────────────────────────────
if [[ "$FILE_PATH" == apps/lfx-one/src/server/middleware/* ]]; then
  warn "Middleware files — changes affect request processing for all routes."
fi

# ── Frontend App Configuration ─────────────────────────────────
case "$FILE_PATH" in
  apps/lfx-one/src/app/app.routes.ts)
    warn "Main app routing — changes affect navigation for the entire application." ;;
esac

# ── Build & Config Files ──────────────────────────────────────
if [[ "$FILE_PATH" == .husky/* ]]; then
  warn "Git hooks — changes affect pre-commit validation for all contributors."
fi

case "$FILE_PATH" in
  eslint.config.*|apps/lfx-one/eslint.config.*)
    warn "ESLint configuration — changes affect code quality rules for the project." ;;
  .prettierrc*|apps/lfx-one/.prettierrc*)
    warn "Prettier configuration — changes affect code formatting standards." ;;
  turbo.json)
    warn "Turborepo config — changes affect monorepo build pipeline." ;;
  angular.json)
    warn "Angular CLI config — changes affect build, serve, and test configuration." ;;
  CLAUDE.md)
    warn "Project instructions — changes affect AI assistant behavior for all users." ;;
  check-headers.sh)
    warn "License header check script — changes affect compliance validation." ;;
esac

# ── Package Files ──────────────────────────────────────────────
if [[ "$FILE_PATH" == package.json ]] || [[ "$FILE_PATH" == */package.json ]]; then
  warn "Package manifest — changes affect dependencies and scripts for the project."
fi
if [[ "$FILE_PATH" == yarn.lock ]]; then
  warn "Lock file — changes affect resolved dependency versions for all contributors."
fi

# If none of the protected patterns matched, allow the operation
exit 0

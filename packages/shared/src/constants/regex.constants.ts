// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Matches any UUID-shaped string (8-4-4-4-12 hex groups). Does NOT enforce
 * the v4 version/variant bits — it is intentionally permissive so callers
 * can recognize any canonical UUID produced by project-service / other LFX
 * microservices, not only v4. Use this to distinguish a project-service UUID
 * from a Salesforce-style ID before handing the value to downstream lookups.
 */
export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

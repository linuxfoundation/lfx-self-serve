// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Filter-grammar safety allowlist for usernames — accepts every char OIDC username/nickname claims actually use AND excludes the query-service separators `:` and `,`. Not a strict OIDC-claim format check. */
const FILTER_SAFE_USERNAME = /^[A-Za-z0-9._+\-@|]+$/;

/** Filter-grammar safety allowlist for path-segment identifiers — covers UUIDs and Salesforce IDs as a superset (`[A-Za-z0-9_-]`) AND excludes the query-service separators `:` and `,`. Not a strict UUID/SF-ID format check. */
const FILTER_SAFE_IDENTIFIER = /^[A-Za-z0-9_-]+$/;

/** True when the value can be safely interpolated into a `writers.username:<value>` / `auditors.username:<value>` query-service filter without altering the filter shape. */
export function isFilterSafeUsername(value: string): boolean {
  return value.length > 0 && value.length <= 256 && FILTER_SAFE_USERNAME.test(value);
}

/** True when the value can be safely interpolated into a `uid:<value>` / `sfid:<value>` query-service filter without altering the filter shape. Note: this is a SAFETY check, not a strict UUID/SF-ID format validator. */
export function isFilterSafeIdentifier(value: string): boolean {
  return value.length > 0 && value.length <= 64 && FILTER_SAFE_IDENTIFIER.test(value);
}

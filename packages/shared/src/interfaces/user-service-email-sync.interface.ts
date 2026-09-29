// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * NOTE: Property names in these interfaces intentionally use PascalCase to match the upstream
 * v1 user-service contract (Salesforce-backed). This deviates from the project's camelCase
 * convention; the casing must be preserved so the payload serializes correctly.
 * @source API Gateway PATCH /user-service/v1/me/emails endpoint (upsert by lowercased address)
 * @see https://api-gw.dev.platform.linuxfoundation.org/user-service/swagger.json (OpenAPI spec)
 */

/**
 * A single email upsert entry for PATCH /user-service/v1/me/emails
 * @description v1 validates the merged final set to contain exactly one primary, so sync
 * payloads for secondary addresses must never carry IsPrimary.
 */
export interface UserServiceEmailSyncEntry {
  /** The email address to upsert */
  EmailAddress: string;
  /** Whether the address is verified (v2 OTP verification is the mailbox proof) */
  IsVerified: boolean;
  /** Whether the address is active */
  Active: boolean;
}

/**
 * Request body for PATCH /user-service/v1/me/emails
 * @description Upserts each entry on the authenticated user's record, keyed by address
 */
export interface UserServiceEmailSyncRequest {
  /** Email entries to upsert */
  Emails: UserServiceEmailSyncEntry[];
}

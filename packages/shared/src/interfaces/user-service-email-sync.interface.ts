// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// PascalCase matches the upstream v1 user-service contract (Salesforce-backed) — do not camelCase or the payload mis-serializes.
// @see https://api-gw.dev.platform.linuxfoundation.org/user-service/swagger.json — PATCH /user-service/v1/me/emails (upserts by lowercased address)

/** Upsert entry for PATCH /user-service/v1/me/emails — omit IsPrimary on secondary-address syncs (v1 empirically requires exactly one primary in the merged set). */
export interface UserServiceEmailSyncEntry {
  /** The email address to upsert */
  EmailAddress: string;
  /** Whether the address is verified (v2 OTP verification is the mailbox proof) */
  IsVerified: boolean;
  /** Whether the address is active */
  Active: boolean;
}

/** Request body for PATCH /user-service/v1/me/emails — upserts each entry on the authenticated user's record, keyed by address. */
export interface UserServiceEmailSyncRequest {
  /** Email entries to upsert */
  Emails: UserServiceEmailSyncEntry[];
}

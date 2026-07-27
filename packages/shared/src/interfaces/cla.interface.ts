// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// UI-facing shapes for the read-only "My CLAs" view (Me lens → Profile tab).
// Normalized by the LFX One server from upstream EasyCLA signature records.
// See specs/001-easycla-ss-integration-fable/m1-my-cla/data-model.md.

export type ClaKind = 'ICLA' | 'ECLA';

/**
 * Derived agreement status (research R6):
 * - `valid`      — signed and approved, not invalidated/revoked.
 * - `superseded` — an ICLA whose signed document version is older than the CLA
 *                  group's current major version (only when the version is exposed upstream).
 * - `inactive`   — signed but no longer approved (invalidated / criteria removed).
 */
export type ClaStatus = 'valid' | 'superseded' | 'inactive';

/** A single signed CLA shown in the My CLAs list. */
export interface MyClaAgreement {
  /** EasyCLA signatureID — also the key for the PDF-URL endpoint. */
  id: string;
  kind: ClaKind;
  /** CLA group / project name the agreement was signed against. */
  projectName: string;
  /** Employer company name — present for ECLA only. */
  companyName?: string;
  /** ISO date the agreement was signed. */
  signedOn: string;
  status: ClaStatus;
  /** Signed document version, when exposed upstream (display only). */
  documentVersion?: string;
  /** True only for ICLA — ECLAs have no signed PDF and never offer download. */
  pdfAvailable: boolean;
}

/** Identity-resolution summary — counts and flags only, never raw EasyCLA IDs. */
export interface MyClasIdentitySummary {
  /** Number of EasyCLA user records matched to the session identity. */
  matchedUserIds: number;
  /** True when resolution found no records ⇒ show "history may be incomplete" hint. */
  unmatched: boolean;
  /** False ⇒ show "Don't see your CLAs? Link your GitHub account" CTA. */
  githubLinked: boolean;
}

/** Response for `GET /api/me/clas`. */
export interface MyClasResponse {
  /** Agreements sorted by `signedOn` descending. */
  agreements: MyClaAgreement[];
  identity: MyClasIdentitySummary;
}

/** Response for `GET /api/me/clas/:signatureId/pdf-url`. */
export interface PdfUrlResponse {
  /** Short-lived presigned S3 URL (~15 min TTL). */
  url: string;
  expiresInSeconds: number;
}

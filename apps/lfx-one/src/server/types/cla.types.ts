// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Raw shapes returned by the upstream EasyCLA "My CLAs" endpoints
// (via lfx-gateway /cla-service/v4). Server-only — the client sees the
// normalized @lfx-one/shared MyCla* interfaces.
//
// Field names mirror the EasyCLA swagger models (camelCase JSON):
//   swagger/common/my-cla-list.yaml, my-cla.yaml, my-cla-pdf.yaml (cla-backend-go)
// Only the fields M1 consumes are typed; the upstream payload carries more.

/** A single agreement from `GET /v4/my-clas` (`#/definitions/my-cla`). */
export interface EasyClaMyCla {
  signatureID: string;
  /** ICLA (downloadable PDF) or ECLA (employee acknowledgement, no PDF). */
  claType: 'icla' | 'ecla';
  claGroupID?: string;
  /** CLA Group display name — omitted when the record could not be resolved. */
  claGroupName?: string;
  /**
   * Salesforce project display name the CLA Group belongs to (a foundation-level CLA
   * Group resolves to its foundation) — omitted when it could not be resolved.
   */
  projectName?: string;
  /** Project (or foundation) logo URL — omitted when there is none or it could not be resolved. */
  projectLogo?: string;
  /** Employer company name — ECLA only. */
  companyName?: string;
  /** Employer signing-entity name — ECLA only. */
  signingEntityName?: string;
  userID?: string;
  signedOn?: string;
  /** Always true — unsigned records are not returned. */
  signed?: boolean;
  /** False when the signature was invalidated. */
  approved?: boolean;
  /**
   * Computed validity against the *current* CCLA approval lists (upstream).
   * ICLA: signed and approved. ECLA: signed, approved, employer not sanctioned,
   * employer still holds an approved CCLA, and the user still matches the CCLA
   * approval lists. This is authoritative — SS does not recompute it.
   */
  valid?: boolean;
  status: 'valid' | 'needs_attention' | 'invalidated' | 'unknown';
  statusReason?: 'not_on_approval_list' | 'unknown';
  documentMajorVersion?: number;
  documentMinorVersion?: number;
  /** True when the record is a signed ICLA eligible for PDF retrieval. */
  pdfAvailable?: boolean;
}

/** Response for `GET /v4/my-clas` (`#/definitions/my-cla-list`). */
export interface EasyClaMyClaList {
  /** The LF username the list was resolved for, omitted when none was provided. */
  lfUsername?: string;
  /** EasyCLA user record IDs (UUIDs) matched from the provided identity. */
  userIds?: string[];
  /**
   * Identity params not searched because they could not be verified as belonging
   * to the authenticated user, formatted "<parameter>:<value>". Telemetry for
   * identity-mapping gaps (e.g. pre-LFID GitHub signers).
   */
  skippedIdentities?: string[];
  resultCount?: number;
  /** CLA records, sorted by signedOn descending. */
  clas?: EasyClaMyCla[];
}

/** Response for `GET /v4/my-clas/{signatureID}/pdf` (`#/definitions/my-cla-pdf`). */
export interface EasyClaMyClaPdf {
  signatureID?: string;
  /** Presigned S3 download URL for the signed PDF. */
  url?: string;
  /** Seconds the download URL remains valid. */
  expiresInSeconds?: number;
}

/** An organization on a search result (`#/definitions/cla-search-org`). */
export interface EasyClaSearchOrg {
  name?: string;
  source?: string;
  url?: string;
}

/** One CLA Group matching the search term (`#/definitions/cla-search-result`). */
export interface EasyClaSearchResult {
  /** Note the spelling: upstream capitalizes ID, the SS-facing option does not. */
  claGroupID?: string;
  claGroupName?: string;
  projectName?: string;
  projectSFID?: string;
  foundationSFID?: string;
  projectExternalID?: string;
  iclaEnabled?: boolean;
  cclaEnabled?: boolean;
  /** Why it matched: claGroup / project / organization / repository. */
  matchTypes?: string[];
  organizations?: EasyClaSearchOrg[];
  matchedRepositoryName?: string;
  matchedRepositoryURL?: string;
}

/** Response for `GET /v4/cla-group/search` (`#/definitions/cla-search-list`). */
export interface EasyClaSearchList {
  searchTerm?: string;
  resultCount?: number;
  /** True when more groups matched than the limit and the set was capped. */
  truncated?: boolean;
  results?: EasyClaSearchResult[];
}

/**
 * Response for `POST /v4/my-clas/signing-identity` — the association the CLA service
 * confirmed against the caller's own token and recorded (#1252).
 */
export interface EasyClaSigningIdentity {
  /** The EasyCLA record the confirmed account belongs to. Replaces the first-match guess. */
  userId?: string;
  /**
   * The account actually recorded, as a number. Echoed so the caller can check that what
   * was recorded is what was chosen — a confirmed-ownership answer does not establish that,
   * because the contributor's other linked accounts would pass an ownership check too.
   */
  githubId?: number;
  githubUsername?: string;
  /** Which resolution path was taken. Observability only. */
  outcome?: string;
}

/**
 * Session-derived identity keys, resolved per request and never client-supplied.
 * Passed as query params to `GET /v4/my-clas`, which re-verifies each key belongs
 * to the authenticated user before searching (the SS server sources the keys from
 * the trusted session; EasyCLA remains the ownership-verification boundary).
 */
export interface ResolvedClaIdentity {
  lfUsername: string | null;
  emails: string[];
  githubIds: string[];
  /**
   * GitHub usernames (from Auth0 profileData.nickname) — validate via user-service
   * for pre-LFID signers whose numeric githubId has no EasyCLA LFID record.
   */
  githubUsernames: string[];
  /** True when the session has at least one linked GitHub identity. */
  githubLinked: boolean;
}

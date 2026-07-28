// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Raw shapes returned by the upstream EasyCLA service (via lfx-gateway /cla-service).
// Server-only — the client sees the normalized @lfx-one/shared MyCla* interfaces.
//
// Field names mirror the EasyCLA swagger models (camelCase JSON):
//   swagger/common/signature.yaml, signatures.yaml (cla-backend-go)
//   swagger/cla.v2.yaml #/definitions/signed_document
// Only the fields M1 consumes are typed; the upstream payload carries many more.

/** A single signature record from `GET /v4/signatures/user/{userID}`. */
export interface EasyClaSignature {
  signatureID: string;
  /** Signature class — the authoritative ICLA/ECLA/CCLA discriminator. */
  claType?: 'icla' | 'ecla' | 'ccla';
  /** `cla` or `ccla` — kept as a fallback discriminator alongside claType. */
  signatureType?: string;
  /** `user` or `company`. */
  signatureReferenceType?: string;
  signatureSigned?: boolean;
  signatureApproved?: boolean;
  signedOn?: string;
  /** CLA Group ID (not a display name). */
  projectID?: string;
  /** CLA Group display name, when resolvable upstream (GET /v4/signatures/user). */
  projectName?: string;
  /** Company name — populated on ECLA/CCLA records. */
  companyName?: string;
  signingEntityName?: string;
  /** Signed document major version — input to superseded detection (research R6). */
  signatureDocumentMajorVersion?: string;
  signatureDocumentMinorVersion?: string;
  userGHID?: string;
  userLFID?: string;
}

/** Response wrapper for `GET /v4/signatures/user/{userID}` (paginated). */
export interface EasyClaUserSignatures {
  projectID?: string;
  resultCount?: number;
  totalCount?: number;
  /** Pagination cursor — pass back as `nextKey` until empty/absent. */
  lastKeyScanned?: string;
  signatures?: EasyClaSignature[];
}

/** Response for `GET /v4/signatures/{signatureID}/signed-document`. */
export interface EasyClaSignedDocument {
  signature_id?: string;
  /** Presigned S3 URL for the signed PDF (~15 min TTL). */
  signed_cla_url?: string;
}

/** A single user record from `GET /v3/users/username/{userName}` and (later) `GET /v4/users/by-identity`. */
export interface EasyClaUser {
  userID: string;
  lfUsername?: string;
  lfEmail?: string;
  userEmails?: string[];
  githubID?: string;
  githubUsername?: string;
}

/**
 * Session-derived identity, resolved per request and never client-supplied.
 * All upstream signature/PDF queries iterate only over `easyclaUserIds`
 * (the server is the authorization boundary — research R3).
 */
export interface ResolvedClaIdentity {
  lfUsername: string | null;
  emails: string[];
  githubIds: string[];
  easyclaUserIds: string[];
  /** True when the session has at least one linked GitHub identity. */
  githubLinked: boolean;
}

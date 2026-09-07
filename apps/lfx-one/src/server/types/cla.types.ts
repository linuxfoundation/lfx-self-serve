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
  /**
   * Salesforce project id the CLA Group maps to — omitted on a foundation-level group
   * and when the mapping is unresolved.
   */
  projectSFID?: string;
  /** Salesforce foundation id — omitted when unresolved. */
  foundationSFID?: string;
  /**
   * True when the resolved user is a CLA manager of the employer's CCLA for this CLA Group.
   * Upstream declares it always-present and always false on ICLA rows; optional here so an
   * older producer that omits it reads as not-a-manager.
   */
  claManager?: boolean;
  /** Employer company name — ECLA only. */
  companyName?: string;
  /** Employer signing-entity name — ECLA only. */
  signingEntityName?: string;
  userID?: string;
  signedOn?: string;
  /**
   * Platform this agreement was signed via (`github` / `gitlab` / `gerrit`).
   * `gerrit` is also LF SSO / email. Omitted when the signature record has no identity.
   */
  signedVia?: 'github' | 'gitlab' | 'gerrit';
  /** Username or email the agreement was signed as. Omitted with `signedVia` when unknown. */
  signedAs?: string;
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
  status: 'valid' | 'needs_attention' | 'revoked' | 'invalidated' | 'unknown';
  statusReason?: 'not_on_approval_list' | 'unknown';
  /**
   * Stored `date_invalidated`. Omitted when the producer sent none (rows
   * invalidated before the field existed, or never invalidated). Independent of
   * `status`: a sanctioned ECLA is `revoked` and can still carry this date,
   * because EasyCLA copies it before the sanctions override.
   */
  invalidatedAt?: string;
  /**
   * Employer's stored `sanctioned_date` (first live detection, then stable).
   * Present only when `status` is `revoked` and a stored date exists.
   */
  flaggedAt?: string;
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
 * Response for `POST /v4/self-serve/prepare-sign` (`#/definitions/prepare-sign`) — the signing
 * session the CLA service opened, plus the Console address it wants the contributor sent to.
 *
 * There is no `githubId` here on purpose: the verified account arrives inside `identity`, as
 * one `"<type>:<value>"` key among several. Declaring a flat field would invent a shape the
 * producer does not emit and hide the parse that recovers it.
 */
export interface EasyClaPrepareSign {
  /** The EasyCLA record the verified identity resolved to. */
  userId?: string;
  /** Absolute Contributor Console decision-screen URL, composed upstream. */
  signUrl?: string;
  /** Identity keys the service verified as the caller's, formatted `"<type>:<value>"`. */
  identity?: string[];
  /** Identity keys the service did not apply. Present only on the 200. */
  skippedIdentities?: string[];
  /** True when the record was created rather than matched. Observability only. */
  userCreated?: boolean;
  githubUsername?: string;
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

/** One manager from `GET /v4/my-clas/{signatureID}/cla-managers` (`#/definitions/my-cla-manager`). */
export interface EasyClaMyClaManager {
  lfUsername?: string;
  name?: string;
  email?: string;
}

/** Response for `GET /v4/my-clas/{signatureID}/cla-managers` (`#/definitions/my-cla-manager-list`). */
export interface EasyClaMyClaManagerList {
  signatureID?: string;
  claGroupID?: string;
  claGroupName?: string;
  projectName?: string;
  companyID?: string;
  companyName?: string;
  managers?: EasyClaMyClaManager[];
  resultCount?: number;
}

/** Body for `POST /v4/my-clas/{signatureID}/cla-manager-requests` (`#/definitions/my-cla-manager-request`). */
export interface EasyClaMyClaManagerRequest {
  requestType: 'approval' | 'removal' | 'contact';
  recipients: string[];
  /** Required and non-blank for `contact`; the producer rejects an empty one. */
  message?: string;
}

/** Response for the same POST (`#/definitions/my-cla-manager-request-result`). */
export interface EasyClaMyClaManagerRequestResult {
  requestID?: string;
  signatureID?: string;
  requestType?: 'approval' | 'removal' | 'contact';
  status?: 'sent' | 'recorded';
  recipients?: string[];
}

/** The GitHub account the CLA service verified, recovered from its identity keys. */
export interface RecordedGithubIdentity {
  /** Decimal digits, as the picker's options carry it. */
  githubId: string;
  githubUsername?: string;
}

// ---------------------------------------------------------------------------
// Organization Lens EasyCLA — `GET /v4/company/external/{companySFID}/cla-groups`
// (easycla#5188). Server-only, like everything above: only the mapped
// OrgClaGroup crosses into @lfx-one/shared. That boundary is not stylistic —
// this payload carries the CCLA managers by name, and this surface renders only
// how many there are. A type shared with the client is a type someone forwards.
// ---------------------------------------------------------------------------

/** One Salesforce project a CLA Group covers (`#/definitions/company-cla-group-project`). */
export interface EasyClaCompanyClaGroupProject {
  projectSFID?: string;
  projectName?: string;
}

/**
 * One CLA manager on the CCLA signature ACL (`#/definitions/company-cla-group-manager`).
 *
 * Typed so the count can be trusted against the array when they disagree — not so the
 * entries can be forwarded. Nothing in this file's consumers may map one of these onto a
 * shared interface; the managers surface is its own feature with its own authorization
 * argument.
 */
export interface EasyClaCompanyClaGroupManager {
  userID?: string;
  lfUsername?: string;
}

/**
 * One CCLA of one signing entity under one CLA group (`#/definitions/company-cla-group`).
 *
 * The grain is (signing entity x CLA group), not CLA group: one organization can hold
 * agreements for the same group under several company records sharing its external SFID,
 * so `claGroupID` alone does not identify an entry. `signatureID` does.
 *
 * Every field is optional here though upstream declares them present, because a producer
 * that drops one should degrade a single card rather than fail the page.
 */
export interface EasyClaCompanyClaGroup {
  companyID?: string;
  companySFID?: string;
  companyName?: string;
  /** The signing entity's name; upstream falls back to the company name when it has none. */
  signingEntityName?: string;
  claGroupID?: string;
  claGroupName?: string;
  foundationSFID?: string;
  foundationName?: string;
  /** Sorted by `projectName` upstream. */
  projects?: EasyClaCompanyClaGroupProject[];
  /**
   * Always true in practice: the list is derived from signed + approved CCLA signatures,
   * so an unsigned group is not returned at all. Typed because the sanctions override
   * reads better against an explicit flag than against its absence.
   */
  signed?: boolean;
  signedOn?: string;
  signatureID?: string;
  /** Stored sanctions flag of the *signing entity*, not of the parent organization. */
  sanctioned?: boolean;
  /**
   * Employee acknowledgements (ECLAs) under this CCLA — people covered.
   *
   * Deliberately not mapped onto the list row. This is not the count the CLA Group card
   * previews: that slot is the approval *criteria* count, the rules that decide who may be
   * covered, which this endpoint does not return in any form. The two are routinely
   * confused because the surface being replaced labels its rules section as though it
   * listed contributors. Substituting this here would put a real number under a label
   * naming a different quantity.
   */
  approvedContributorsCount?: number;
  /**
   * Approval criteria on the CCLA — rules granting coverage, summed across all six lists
   * (email, email domain, GitHub username, GitHub org, GitLab username, GitLab group).
   * This is the count the card previews, and it is unrelated to `approvedContributorsCount`
   * above: one domain rule can cover a whole company.
   *
   * Optional because absence is meaningful. Upstream declares it `x-omitempty: false`, so a
   * deployment carrying the field always sends it — including `0`. Absent therefore means the
   * environment predates the producer change, which is a different fact from an agreement that
   * approves nobody, and the two must not collapse.
   */
  approvalCriteriaCount?: number;
  claManagersCount?: number;
  /** Sorted by `lfUsername` upstream. Counted, never forwarded. */
  claManagers?: EasyClaCompanyClaGroupManager[];
  /** Upstream-computed: signed with zero CLA managers. Taken as given, never re-derived. */
  needsClaManager?: boolean;
  autoCreateECLA?: boolean;
}

/**
 * Response for `GET /v4/company/external/{companySFID}/cla-groups`
 * (`#/definitions/company-cla-groups`).
 *
 * An unknown company and a company with no CCLAs both return 200 with an empty `list` —
 * the endpoint never creates a company record as a side effect of being asked about one.
 * There is no 404 on this path.
 */
export interface EasyClaCompanyClaGroupList {
  companySFID?: string;
  resultCount?: number;
  /** Sorted by `signingEntityName` then `claGroupName` upstream. */
  list?: EasyClaCompanyClaGroup[];
}

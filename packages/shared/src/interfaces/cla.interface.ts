// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// UI-facing shapes for the read-only "CLAs" view (Me lens → Profile tab).
// Normalized by the LFX One server from upstream EasyCLA signature records.
// See specs/001-easycla-ss-integration-fable/m1-my-cla/data-model.md.

export type ClaKind = 'ICLA' | 'ECLA';

/**
 * Agreement status shown in the UI:
 * - `valid`           — currently valid per EasyCLA's computed `valid` flag.
 * - `needs_attention` — approved, but no longer covered (ECLA only; ICLA never produces this).
 * - `invalidated`     — the stored signature-approval flag is false or absent. Shown to the
 *                       contributor as **Revoked**: self-invalidation was withdrawn, so this
 *                       is now always a system revocation. The token keeps the producer's
 *                       spelling; `claStatusLabel` owns the copy.
 * - `unknown`         — coverage could not be evaluated (ECLA only; ICLA never produces this).
 *                       Rendered as plain-text "—", not a fourth named pill.
 * - `superseded`      — reserved: an older document version than the CLA group's current.
 *                       Not produced today (the my-clas endpoint does not expose the
 *                       current version); kept for forward compatibility. Do not render it.
 */
export type ClaStatus = 'valid' | 'needs_attention' | 'invalidated' | 'unknown' | 'superseded';

export type ClaStatusReason = 'not_on_approval_list' | 'unknown';

/** A single signed CLA shown in the CLAs list. */
export interface MyClaAgreement {
  /** EasyCLA signatureID — also the key for the PDF-URL endpoint. */
  id: string;
  kind: ClaKind;
  /**
   * CLA group name the agreement was signed against (the endpoint's `claGroupName`,
   * falling back to the CLA group UUID). This is NOT the Salesforce project name —
   * see `projectName`. Rendered as the subtext of the Project cell when a
   * `projectName` is present, and as the primary line when it is not.
   */
  claGroupName: string;
  /**
   * Salesforce project display name the CLA Group belongs to (a foundation-level CLA
   * Group resolves to its foundation). Undefined when upstream could not resolve it —
   * the Project cell then falls back to `claGroupName`. Rendered as the bold primary line.
   */
  projectName?: string;
  /** Project (or foundation) logo URL, when upstream resolved one. Undefined ⇒ show the fallback icon. */
  projectLogo?: string;
  /** Employer company name — present for ECLA only. */
  companyName?: string;
  /** ISO date the agreement was signed. */
  signedOn: string;
  status: ClaStatus;
  statusReason?: ClaStatusReason;
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

/** View state for the CLAs tab: the last response (or null), plus load/error flags. */
export interface MyClasState {
  data: MyClasResponse | null;
  error: boolean;
  loaded: boolean;
}

/** Response for `GET /api/me/clas/:signatureId/pdf-url`. */
export interface PdfUrlResponse {
  /** Short-lived presigned S3 URL (~15 min TTL). */
  url: string;
  expiresInSeconds: number;
}

/** Why a CLA Group matched the search term (#1250 `cla-search-result.matchTypes`). */
export type ClaGroupMatchType = 'claGroup' | 'project' | 'organization' | 'repository';

/** Where a CLA Group's repositories are hosted. */
export type ClaGroupOrgSource = 'github' | 'gitlab' | 'gerrit';

/**
 * A repository-hosting organization linked to a CLA Group: a GitHub organization, a GitLab
 * group, or a Gerrit instance.
 *
 * Provenance for display only. An empty `organizations` list does not mean "not on GitHub" —
 * it means nothing is linked or nothing resolved, so no control flow may be derived from it.
 */
export interface ClaGroupOrg {
  /** Organization, group, or Gerrit instance name. */
  name: string;
  source: ClaGroupOrgSource;
  /** Omitted when the source record carries none. */
  url?: string;
}

/**
 * A CLA Group the contributor can choose to sign against (Sign CLA hand-off, #1251).
 *
 * The hand-off needs `claGroupId` and nothing else; every other field is here so the picker
 * can show which group this is and why it matched. Consumers MUST ignore unknown fields
 * rather than validate exhaustively, so the search can keep enriching this without touching
 * the hand-off.
 *
 * Both display names are optional because the producer omits each independently: `projectName`
 * when the group maps to several projects with no foundation marker, `claGroupName` when the
 * group record could not be resolved. A result with neither is still selectable.
 */
export interface ClaGroupOption {
  /** Must be a real CLA Group UUID: the Contributor Console fetches the project by it. */
  claGroupId: string;
  /** Primary line in the picker. */
  projectName?: string;
  /** Secondary line — the CLA group within the project, when it differs from the project name. */
  claGroupName?: string;
  /** Sorted, may be empty. */
  matchTypes: ClaGroupMatchType[];
  /** All linked organizations, sorted by source then name upstream. May be empty. */
  organizations: ClaGroupOrg[];
  /** Full repository name the term resolved to — set only when `matchTypes` includes `repository`. */
  matchedRepositoryName?: string;
  matchedRepositoryURL?: string;
}

/**
 * Response for `GET /api/me/clas/sign-options?q=` — mirrors the producer's `cla-search-list`
 * (#1250) rather than inventing a third shape.
 *
 * Not a bare array: `truncated` describes the result *set*, so it cannot ride inside one of
 * the results. The hand-off still consumes only the selected option's `claGroupId`.
 */
export interface ClaGroupSearchResponse {
  /** Echo of the term actually searched (trimmed). */
  searchTerm: string;
  /** Count of `results`, at most the producer's limit. */
  resultCount: number;
  /** True when more groups matched than the limit — ask the contributor to refine the term. */
  truncated: boolean;
  /** Best match first, deduplicated by CLA Group upstream. */
  results: ClaGroupOption[];
}

/**
 * One GitHub account the contributor has already linked, offered in the picker (#1252).
 *
 * Presentation only, and deliberately so: the CLA service re-derives the attested set from
 * the caller's own token and refuses anything outside it, so a stale or over-broad list here
 * can only produce a refusal downstream — never an incorrect association.
 */
export interface GithubAccountOption {
  /** Immutable GitHub account number. Handles get renamed and reclaimed; this does not. */
  githubId: string;
  /** Display handle. Never matched on. */
  githubUsername: string;
  avatarUrl?: string;
}

/** Response for `GET /api/me/clas/github-accounts`. */
export interface GithubAccountOptions {
  accounts: GithubAccountOption[];
}

/** Request body for `POST /api/me/clas/signing-identity`. */
export interface SigningIdentityRequest {
  /**
   * The account the contributor picked. The server matches it against the accounts Auth0
   * reports as linked to this session and refuses one that is not among them, which is what
   * establishes the account as the contributor's — see `bindSigningIdentity`.
   *
   * The handle is deliberately not accepted alongside it. The server takes that from the
   * matched account, so a caller cannot pair a number it owns with a handle it does not.
   */
  githubId: string;
}

/**
 * Response for `POST /api/me/clas/signing-identity` — the association the service confirmed
 * and recorded, plus the record identifier the hand-off consumes in place of resolving one
 * for itself.
 */
export interface SigningIdentityResponse {
  claUserId: string;
  /** The account actually recorded, so the caller can check it against what was chosen. */
  githubId: string;
  githubUsername?: string;
  /**
   * Absolute URL back to the CLAs view. Absolute because the last hop is a server-side redirect.
   *
   * Returned from the binding rather than fetched separately so that the hand-off URL
   * cannot be assembled before the association is confirmed — the parts to build it with
   * simply do not exist until then. Ordering here is a correctness property, not a
   * convenience: a URL built from an identifier obtained beforehand could carry a record
   * the binding then refuses.
   */
  redirectUrl: string;
}

/**
 * Why the CLA service refused to record an association. Each maps to a different outcome for
 * the contributor, and collapsing them loses information they need — a record that names
 * nobody needs a human to reunite it with its owner, whereas a record already holding another
 * account is the contributor's own to sort out.
 */
export type SigningIdentityRefusal =
  | 'identity_unavailable'
  | 'identity_mismatch'
  | 'record_conflict'
  | 'record_unclaimed'
  | 'duplicate_github_id'
  | 'lf_record_already_bound'
  | 'recorded_mismatch';

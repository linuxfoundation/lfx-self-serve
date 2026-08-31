// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { CLA_MANAGER_REQUEST_TYPES } from '../constants/cla.constants';
import type { TagSeverity } from './components.interface';

// UI-facing shapes for the read-only "CLAs" view (Me lens → Profile tab).
// Normalized by the LFX One server from upstream EasyCLA signature records.
// See specs/001-easycla-ss-integration-fable/m1-my-cla/data-model.md.

export type ClaKind = 'ICLA' | 'ECLA';

/**
 * Agreement status shown in the UI:
 * - `valid`           — currently valid per EasyCLA's computed `valid` flag.
 * - `needs_attention` — approved, but no longer covered (ECLA only; ICLA never produces this).
 * - `revoked`         — the employer is flagged by sanctions screening. System-set, ECLA only,
 *                       and read-only: the producer already forces `valid` and `claManager`
 *                       false on these rows.
 * - `invalidated`     — the stored signature-approval flag is false or absent. This is a
 *                       different state from `revoked` and must never share its label: a CLA
 *                       manager removing someone from an approved list, a project manager
 *                       invalidating an ICLA from PCC, and a deleted CLA group all land here,
 *                       and none of them is a sanctions case.
 * - `unknown`         — coverage could not be evaluated (ECLA only; ICLA never produces this).
 *                       Rendered as plain-text "—", not a named pill.
 * - `superseded`      — reserved: an older document version than the CLA group's current.
 *                       Not produced today (the my-clas endpoint does not expose the
 *                       current version); kept for forward compatibility. If a row arrives
 *                       with this status, the UI renders a labeled "Superseded" pill.
 */
export type ClaStatus = 'valid' | 'needs_attention' | 'revoked' | 'invalidated' | 'unknown' | 'superseded';

export type ClaStatusReason = 'not_on_approval_list' | 'unknown';

/**
 * Platform the producer says this agreement was signed via (#1573).
 * `gerrit` is also the LF SSO / email-identified case — there is no separate `email` token.
 */
export type ClaSignedVia = 'github' | 'gitlab' | 'gerrit';

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
  /**
   * Salesforce project id the CLA Group maps to (producer `projectSFID`). Omitted on a
   * foundation-level group and when the mapping is unresolved. With `foundationSfid` this
   * builds `/foundation/{foundationSfid}/project/{projectSfid}/cla`.
   */
  projectSfid?: string;
  /**
   * Salesforce foundation id (producer `foundationSFID`). A foundation-level group uses
   * `/foundation/{foundationSfid}/cla`. Omitted when unresolved.
   */
  foundationSfid?: string;
  /**
   * CLA group UUID the agreement was signed against (producer `claGroupID`).
   * Omitted when upstream sent none. Used to gate the CCLA Console item (#1575);
   * display still uses `claGroupName`.
   */
  claGroupId?: string;
  /**
   * Whether the signed-in user is a CLA manager of the employer's CCLA for this CLA
   * group (producer `claManager`), always false on ICLA. This is the producer's own
   * manager resolution — do not re-derive it from the cla-managers endpoint (#1575).
   */
  claManager?: boolean;
  /** Employer company name — present for ECLA only. */
  companyName?: string;
  /** ISO date the agreement was signed. */
  signedOn: string;
  /**
   * Platform this agreement was signed via, when the producer sent one.
   * Omitted when the signature record has no identity, or when the token is not
   * a known `ClaSignedVia` value.
   */
  signedVia?: ClaSignedVia;
  /**
   * Username or email the agreement was signed as, when the producer sent one.
   * Empty-after-trim is treated as omitted.
   */
  signedAs?: string;
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

/** Picker row: a search result with display fields precomputed so the template calls nothing. */
export interface ClaGroupOptionView extends ClaGroupOption {
  primaryName: string;
  secondaryName: string | null;
  matchTypeLabels: string[];
  orgViews: ClaGroupOrgView[];
  expanded: boolean;
}

/** One linked org on a picker row, with source label and icon precomputed. */
export interface ClaGroupOrgView {
  name: string;
  source: ClaGroupOrgSource;
  sourceLabel: string;
  sourceIcon: string;
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

/** Picker row: the linked account plus the label the template binds. */
export interface GithubAccountChoice extends GithubAccountOption {
  /** `githubUsername`, or a numbered fallback when the handle is blank. */
  label: string;
}

/**
 * What the GitHub account step closes with, beyond `null` for a dismissal (#1917).
 *
 * The two outcomes are kept apart because dismissing the empty state and asking to link an
 * account both leave the picker with no account chosen, and only one of them should move the
 * contributor off the page they started from.
 */
export type GithubAccountSelectResult = { githubId: string } | { linkAccounts: true };

/** Response for `GET /api/me/clas/github-accounts`. */
export interface GithubAccountOptions {
  accounts: GithubAccountOption[];
}

/** Request body for `POST /api/me/clas/prepare-sign`. */
export interface PrepareSignRequest {
  /**
   * The account the contributor picked. The server matches it against the accounts Auth0
   * reports as linked to this session and refuses one that is not among them.
   *
   * The handle is deliberately not accepted alongside it. The server takes that from the
   * matched account, so a caller cannot pair a number it owns with a handle it does not —
   * which matters because the CLA backend uses the handle as a GitHub lookup key.
   */
  githubId: string;
  /** The CLA Group the contributor confirmed in the picker. Required by the CLA backend. */
  claGroupId: string;
}

/**
 * Response for `POST /api/me/clas/prepare-sign` — the signing session the CLA backend
 * prepared, and the Console address it wants the contributor sent to.
 */
export interface PrepareSignResponse {
  /** The EasyCLA record the verified identity resolved to (used or created upstream). */
  userId: string;
  /**
   * Where to send the contributor. Returned by the CLA backend rather than assembled here:
   * it owns the signing session this address belongs to, so composing a second address from
   * its parts would ignore whatever that session carries.
   */
  signUrl: string;
  /**
   * The GitHub account the CLA backend verified, read from its identity keys. Compared
   * against the chosen account before the hand-off: ownership verification passes for every
   * account the contributor holds, so it cannot notice this layer having sent the wrong one.
   */
  githubId: string;
  /** Display and logs only. Never matched on — handles get renamed and reclaimed. */
  githubUsername?: string;
  /** Identity keys the CLA backend ignored. May be empty. */
  skippedIdentities: string[];
}

/** Copy/API mode for the shared Contact CLA Manager modal (#1372 / #1574). */
export type ClaManagerRequestMode = 'approval' | 'removal' | 'contact';

/**
 * Producer `requestType`, derived from `CLA_MANAGER_REQUEST_TYPES`. Kept separate from
 * `ClaManagerRequestMode` even though the two currently coincide: one is the modal's copy
 * set, the other is the wire contract, and a future copy mode must not silently become a
 * request type the producer never promised to accept.
 */
export type ClaManagerRequestType = (typeof CLA_MANAGER_REQUEST_TYPES)[number];

/** One CLA manager from the CCLA signature ACL covering an ECLA. */
export interface ClaManager {
  /** LF username — the recipient key for a contact request. */
  lfUsername: string;
  /** Display name, omitted when unknown. */
  name?: string;
  /** Email, omitted when the user record carries none. */
  email?: string;
}

/** Response for `GET /api/me/clas/:signatureId/cla-managers`. */
export interface ClaManagerList {
  signatureId: string;
  /** Empty when no CLA manager is currently reachable. */
  managers: ClaManager[];
  resultCount: number;
}

/** Browser body for `POST /api/me/clas/:signatureId/cla-manager-requests`. */
export interface ClaManagerRequest {
  requestType: ClaManagerRequestType;
  /** LF usernames of the checked managers. Must be non-empty. */
  recipients: string[];
  /**
   * Note included in the notification email, capped at `CLA_MANAGER_MESSAGE_MAX_LENGTH`.
   * Optional for approval and removal; required and non-blank for contact, which asks for
   * no change and so carries nothing else for the manager to read.
   */
  message?: string;
}

/** Receipt for an approval, removal, or contact request. */
export interface ClaManagerRequestResult {
  requestId: string;
  signatureId: string;
  requestType: ClaManagerRequestType;
  /**
   * `sent` — email dispatched to at least one selected manager with a resolvable address.
   * `recorded` — audit event written but no email sent.
   */
  status: 'sent' | 'recorded';
  recipients: string[];
}

/** Dialog data for the shared Contact CLA Manager modal. */
export interface ContactClaManagerDialogData {
  signatureId: string;
  projectName: string;
  mode: ClaManagerRequestMode;
}

/** Title and hint factory for one Contact CLA Manager copy mode. */
export interface ClaManagerModalCopy {
  title: string;
  hint: (project: string) => string;
}

/** Manager row in the modal, with the display label precomputed. */
export interface ClaManagerView extends ClaManager {
  label: string;
}

/** Precomputed status cell for one CLAs table row. */
export interface ClaRowStatus {
  /** True for `unknown`, which renders as a plain-text em dash rather than a fourth named pill. */
  plainText: boolean;
  label: string;
  severity: TagSeverity;
  icon: string;
  /** Explanatory sentence beneath the pill; absent on every row that has nothing to explain. */
  note?: string;
}

/**
 * One kebab item on a CLAs row. Structural subset of PrimeNG `MenuItem` so `@lfx-one/shared`
 * does not take a PrimeNG runtime dependency. Command handlers stay on the PrimeNG object
 * the component builds; they are not part of this wire shape.
 */
export interface ClaRowMenuItem {
  label?: string;
  icon?: string;
  disabled?: boolean;
  escape?: boolean;
}

/**
 * One CLAs table row, fully resolved before the template sees it. The template binds these
 * fields and calls nothing.
 */
export interface ClaRow {
  id: string;
  agreement: MyClaAgreement;
  status: ClaRowStatus;
  /** Second line under the signed date; absent when the producer sent no identity. */
  signedAsLine?: string;
  menuItems: ClaRowMenuItem[];
  /** False ⇒ render no ⋮ trigger at all, rather than one that opens an empty menu. */
  hasActions: boolean;
}

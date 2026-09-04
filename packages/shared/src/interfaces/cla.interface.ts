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
  /**
   * RFC3339 instant the agreement was signed. A bare `YYYY-MM-DD` is accepted
   * and rendered as that UTC calendar day. Empty string when the producer sent
   * no date (`cla.service` normalizes the absent field).
   */
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
  /**
   * Producer `invalidatedAt` — stored invalidation instant. Omitted when the
   * producer sent none (legacy rows, or any non-invalidated status). Empty after
   * trim is treated as omitted. The status note is `{Label} · {date}` only when
   * this parses; a wrong date is worse than none.
   */
  invalidatedAt?: string;
  /**
   * Producer `flaggedAt` — employer's stored sanctioned_date. Omitted when the
   * producer sent none. Empty after trim is treated as omitted. Feeds the
   * Revoked date note the same way `invalidatedAt` feeds Invalidated.
   */
  flaggedAt?: string;
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
 * A source being **present** here is evidence, and `claSignRoute` reads it to decide which
 * identity the sign step offers. A source being **absent** is not evidence of anything: an
 * empty list means nothing is linked or nothing resolved, not "not on GitHub". CLA Groups in
 * that state are searchable by name and signable today, so a rule shaped "no GitHub
 * organization ⇒ not GitHub" would misroute them. Read presence only.
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
 * The hand-off needs `claGroupId`, `organizations` to pick the GitHub / Gerrit / GitLab route,
 * plus `iclaEnabled` / `cclaEnabled` on the Gerrit route, where they decide the contract type and
 * whether the contributor is asked for it (#2066). Every other field is here so the picker can
 * show which group this is and why it matched. Consumers MUST ignore unknown fields rather than
 * validate exhaustively, so the search can keep enriching this without touching the hand-off —
 * but those three are not that kind of field. When both enablement flags are absent, that reads
 * as both disabled and resolves to `none`, so a mapper that drops them makes every Gerrit
 * hand-off fail with "Could not start signing" rather than degrading the display. That is the
 * intended failure: #2066 was a wrong agreement signed silently, and stopping is the safer end.
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
  /** Whether the group accepts an individual (ICLA) agreement — used for Gerrit contract-type routing (#2066). */
  iclaEnabled?: boolean;
  /** Whether the group accepts a corporate (CCLA) agreement — used for Gerrit contract-type routing (#2066). */
  cclaEnabled?: boolean;
  /** Full repository name the term resolved to — set only when `matchTypes` includes `repository`. */
  matchedRepositoryName?: string;
  matchedRepositoryURL?: string;
}

/**
 * The contract types a CLA group offers, resolved to a definite answer per type.
 *
 * `ClaGroupOption` leaves both flags optional because the producer omits them for a group whose
 * record it could not resolve. Anything reading them to decide something has to settle that
 * first, so this is the settled form: absent has already been read as disabled.
 */
export interface ClaGroupEnablement {
  iclaEnabled: boolean;
  cclaEnabled: boolean;
}

/**
 * Response for `GET /api/me/clas/sign-options?q=` — mirrors the producer's `cla-search-list`
 * (#1250) rather than inventing a third shape.
 *
 * Not a bare array: `truncated` describes the result *set*, so it cannot ride inside one of
 * the results. What the hand-off consumes from the selected option is described on
 * `ClaGroupOption` — it is no longer `claGroupId` alone, since the Gerrit route also reads the
 * enablement flags.
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
 * What the Sign a CLA group picker is given so it can tag groups the contributor already
 * holds (#1914). The list is the one already loaded on the CLAs tab — the picker does not
 * fetch it again.
 */
export interface ClaGroupSelectDialogData {
  agreements: MyClaAgreement[];
}

/** What a tagged picker row shows: the inline tag, and the sentence behind it. */
export interface AlreadySignedNote {
  /** Inline tag, naming the identity that signed it. */
  chip: string;
  /**
   * Fuller sentence: which kind, and whose employer on an ECLA. It closes by offering another
   * identity only on a route that has one to offer — never on a GitLab-only or Gerrit-only group.
   */
  tooltip: string;
}

/**
 * Which identity a card in the sign-identity step offers.
 *
 * A GitHub card carries both keys because the producer records whichever it had: it derives the
 * signed identity as the handle when there is one and the account number when there is not, so a
 * card that compared only the handle would miss every agreement recorded against the number.
 */
export type SignIdentityRef = { platform: 'github'; username?: string; githubId: string } | { platform: 'gerrit' };

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
  /**
   * Display handle, and never an identity key on its own. It has two consumers beyond display:
   * it rides alongside `githubId` on prepare-sign, where the producer resolves the pair against
   * each other, and it is compared against the handle an existing agreement recorded so the
   * identity step can gray the account that already signed. Renames and reclaims make it
   * unreliable for both, which is why `githubId` is what actually addresses the account.
   */
  githubUsername: string;
  avatarUrl?: string;
}

/** Picker row: the linked account plus the label the template binds. */
export interface GithubAccountChoice extends GithubAccountOption {
  /** `githubUsername`, or a numbered fallback when the handle is blank. */
  label: string;
  /**
   * Why this account cannot sign the chosen CLA group, when it already has (#1914). Present
   * ⇒ the card is grayed out and carries this as its tooltip.
   */
  alreadySignedTooltip?: string;
}

/**
 * Which identities the sign step offers, decided by the selected CLA Group's linked
 * organizations (#2002). Also the copy set the step is framed with, since a contributor
 * being asked for a Gerrit identity must not be told the group is linked to GitHub.
 *
 * `github-or-gerrit` is not derivable from the two lists the step receives: a mixed group
 * whose contributor has no linked GitHub account arrives with an empty account list, which
 * is indistinguishable from the Gerrit-only case unless the variant says otherwise.
 */
export type SignIdentityVariant = 'github' | 'gerrit' | 'github-or-gerrit';

/**
 * Which route a selected CLA Group takes. Every route but one opens the sign identity step;
 * GitLab is the exception, because Self Serve holds no verifiable GitLab identity to offer.
 */
export type ClaSignRoute = SignIdentityVariant | 'gitlab-unsupported';

/** What the sign identity step is given to render (#1252, #1917, #2002). */
export interface SignIdentityDialogData {
  variant: SignIdentityVariant;
  /** Linked GitHub accounts, from the server. Empty on the `gerrit` variant, which never fetches them. */
  accounts: GithubAccountOption[];
  /**
   * The contributor's LF username, offered as their Gerrit identity. Absent ⇒ no Gerrit card.
   *
   * Unlike `accounts` this does not come from the server, and that is safe only because it is
   * never submitted — see the step's own class doc before changing it.
   */
  gerritUsername?: string;
  /**
   * What the contributor already holds for the CLA group they picked, so the step can gray out
   * an identity that has no enabled contract type left to sign (#1914). This is where the
   * already-signed block lives: one contributor can hold several identities, so the group itself
   * stays selectable and only an identity that has already signed every enabled type is refused.
   */
  claGroupAgreements?: MyClaAgreement[];
  /** Whether the chosen group accepts an ICLA — used with `cclaEnabled` by the already-signed gate. */
  iclaEnabled?: boolean;
  /** Whether the chosen group accepts a CCLA — used with `iclaEnabled` by the already-signed gate. */
  cclaEnabled?: boolean;
}

/**
 * What the sign identity step closes with, beyond `null` for a dismissal (#1917, #2002).
 *
 * Discriminated on `kind` rather than narrowed by `in`. With two members the narrowing read
 * better; with three, one of which carries no payload at all, a tag is what keeps a Gerrit
 * choice from being mistaken for a GitHub one that lost its account number.
 *
 * The link request is kept apart from a dismissal because both leave the step with no identity
 * chosen, and only one of them should move the contributor off the page they started from.
 */
export type SignIdentitySelectResult = { kind: 'github'; githubId: string } | { kind: 'gerrit' } | { linkAccounts: true };

/** Console Gerrit route contract-type segment (#2066). */
export type GerritContractType = 'individual' | 'corporate';

/**
 * What the contract-type step is opened with (#2066).
 *
 * The step opens only for a group with both types enabled, so nothing about the *group* is left
 * for it to branch on. What it does need is what the identity confirmed a step earlier already
 * holds, so the type they cannot usefully sign again is offered as held rather than as a choice.
 */
export interface SignContractTypeDialogData {
  /**
   * Types this identity already holds for the group. At most one in practice: an identity holding
   * both is grayed at the identity step, so it never reaches here.
   */
  heldKinds: readonly ClaKind[];
}

/**
 * What the contract-type step closes with, or `null` for a dismissal (#2066).
 */
export interface SignContractTypeSelectResult {
  contractType: GerritContractType;
}

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
  /**
   * Sign Date: an instant renders in the viewer's local timezone, a bare
   * `YYYY-MM-DD` as that UTC calendar day; `'—'` when empty, unparseable, or
   * an impossible calendar date.
   */
  signedOnLabel: string;
  /** Second line under the signed date; absent when the producer sent no identity. */
  signedAsLine?: string;
  menuItems: ClaRowMenuItem[];
  /** False ⇒ render no ⋮ trigger at all, rather than one that opens an empty menu. */
  hasActions: boolean;
}

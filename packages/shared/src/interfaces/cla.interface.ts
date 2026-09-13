// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { CLA_MANAGER_REQUEST_TYPES, ORG_CLA_DETAIL_TABS } from '../constants/cla.constants';
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
   * producer sent none (legacy rows, or never invalidated). Empty after trim is
   * treated as omitted. Independent of `status`: a revoked ECLA can still carry
   * this date, because EasyCLA copies it before the sanctions override. The
   * Invalidated status note is `{Label} · {date}` only when this parses; a
   * wrong date is worse than none. Revoked notes read `flaggedAt` instead.
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
  /**
   * Lifetime upstream reported for the URL. Optional because not every upstream document
   * endpoint returns one, and omitting it is honest where `0` would tell a consumer the URL
   * has already expired. Absent means unknown, not immediate expiry.
   */
  expiresInSeconds?: number;
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
  /**
   * Salesforce id of the project a corporate signature is requested against (#1983).
   *
   * **Set only by the Organization Lens sign-options route.** The Me-lens search omits it: that
   * hand-off is keyed on `claGroupId` alone, and a field no template reads still ships to the
   * browser inside the transferred state.
   *
   * Absent on the Org Lens path too when the CLA group maps to several projects with no
   * foundation-level row — upstream declines to pick one arbitrarily. That is a real property of
   * the CLA group, not a failure, and it makes the group unsignable from here.
   */
  projectSfid?: string;
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

/**
 * Status of one organization CCLA, derived server-side (#1978).
 *
 * All three of the approved design's status values are reachable here. Upstream exposes
 * signed-ness and the sanctions flag as two independent booleans; the card has one slot, and
 * sanctions win — presenting a sanctioned entity's agreement as ordinarily signed is the more
 * damaging of the two possible errors.
 *
 * `not-started` covers an agreement the CLA service reports as unsigned. The list is mostly
 * signed agreements, but it is not exclusively so — the producer passes the signature's own
 * signed flag through, and an unsigned record reaches the list. Rendering one as `signed`
 * would be a false statement about the organization's legal position, which is the same
 * failure the sanctions precedence and the empty-versus-failure split exist to prevent.
 *
 * Signed-ness is folded in here for display, so copy elsewhere on the card must not assert
 * signing on its own: only a `signed` status licenses the word. It is additionally carried as
 * the sibling `signed` boolean, which exists for a different question — whether a document can
 * be fetched — and which this type cannot answer, because a `sanctioned` row may be signed or
 * unsigned. Read `signed` to decide about the document; read this to decide what to say.
 */
export type OrgClaGroupStatus = 'signed' | 'not-started' | 'sanctioned';

/** One Salesforce project covered by an organization's CLA Group (#1978). */
export interface OrgClaGroupProject {
  projectSfid?: string;
  projectName: string;
}

/**
 * One corporate CLA the organization holds — one signing entity, one CLA Group (#1978).
 *
 * Every field here is organization-grain. The upstream payload carries the CCLA managers
 * themselves; they are dropped at the mapper, so `claManagersCount` is all that survives.
 * That drop is at the mapper and not at the template on purpose: a template that declines to
 * render a field still ships it to the browser inside the transferred state.
 */
export interface OrgClaGroup {
  /**
   * The CCLA signature id. The row key.
   *
   * `claGroupId` is deliberately not the key: the upstream grain is (signing entity x CLA
   * group), so one organization can hold two rows for the same CLA Group under different
   * signing entities.
   */
  id: string;
  /** CLA Group display name, falling back to its UUID so a nameless row still renders. */
  claGroupName: string;
  claGroupId?: string;
  /**
   * The signing entity that actually signed. Present only when it differs from the
   * organization's own name — the common case would otherwise repeat the page title on
   * every card.
   */
  signingEntityName?: string;
  foundationName?: string;
  foundationSfid?: string;
  /** Covered projects, in the upstream's `projectName` order. May be empty. */
  projects: OrgClaGroupProject[];
  /**
   * RFC3339 instant the CCLA was signed. Carried for the agreement detail view.
   *
   * Absent on an agreement that is not signed, and the absence is load-bearing: the source
   * backfills its date field with the signature's creation time, so an unsigned agreement has
   * a date that is not a signing date. The server withholds it rather than let a consumer
   * present the moment signing began as the moment it completed.
   */
  signedOn?: string;
  /**
   * Name on the CCLA signature. Absent when the signature carries no signatory name, or when the
   * deployment predates the field — so the detail view must still be able to state a signed date
   * without naming anyone. There is no CLA-manager fallback: a manager is a different role, and
   * naming one here would attribute the signature to somebody who did not make it.
   */
  signedBy?: string;
  /**
   * Whether a signed CCLA actually exists, taken from upstream's own flag.
   *
   * Deliberately separate from `status`, which asks a different question: `status` collapses a
   * fact about the entity (sanctions) and a fact about the agreement (signing) into one slot, so
   * `status !== 'signed'` cannot be read as "there is no document".
   *
   * The list endpoint cannot currently produce a row where the two disagree — it builds every row
   * from a signature its own query has already filtered to signed — but this shape is not the
   * list's alone. The pre-signing preview constructs one for an agreement nobody has signed, and
   * the detail page's download gate serves both sources from this field. `signedOn` is not a
   * stand-in for it either: that field is additionally conditional on upstream sending a date, so
   * a signed agreement can carry no date and still have a document.
   */
  signed: boolean;
  status: OrgClaGroupStatus;
  /**
   * Upstream's own `needsClaManager` — signed with zero CLA managers — taken verbatim.
   *
   * Not re-derived from `claManagersCount`, though the two agree today. Two definitions of
   * one condition that agree now is precisely the arrangement that drifts later; the
   * producer owns this one.
   */
  needsClaManager: boolean;
  claManagersCount: number;
  /**
   * How many approval criteria (the rules deciding who may be covered) the agreement has,
   * summed across the six approval lists. This is the card's first stat.
   *
   * Optional because absence carries meaning: it says the CLA service deployment did not
   * return the count, which happens in any environment predating the producer change. That
   * is not the same as an agreement with no rules, and the two must render differently —
   * absent shows as unavailable, 0 shows as 0.
   *
   * Do not populate this from `approvedContributorsCount`, which counts the people covered
   * rather than the rules covering them; do not default it to 0; and do not fetch it per row,
   * since an approval-list call per card is an N+1 on the landing page.
   */
  approvalCriteriaCount?: number;
}

/**
 * Response of `GET /api/orgs/:orgUid/lens/cla-groups` — the Organization Lens EasyCLA list.
 *
 * `orgUid` echoes the grant-checked path parameter rather than anything the caller sent in a
 * body or query, so the client can key a cache on the org the server actually served.
 */
export interface OrgClaGroupList {
  orgUid: string;
  claGroups: OrgClaGroup[];
}

export type OrgClaDetailTab = (typeof ORG_CLA_DETAIL_TABS)[number]['id'];

/** One tab trigger as the detail page renders it. `badge` is empty when the tab carries no count. */
export interface OrgClaDetailTabView {
  id: OrgClaDetailTab;
  label: string;
  badge: string;
}

/** How one `OrgClaGroupStatus` is presented as a status pill. */
export interface OrgClaStatusDisplay {
  label: string;
  severity: TagSeverity;
}

export interface OrgClaCoverageChip {
  label: string;
  /** Whether this chip stands for a project list worth opening. Only the "Covers N projects" chip does. */
  opensCoverage: boolean;
}

export interface OrgClaCoverageDialogData {
  claGroupName: string;
  foundationName?: string;
  projects: OrgClaGroupProject[];
}

/**
 * One hand-off request for a corporate CLA (#1983).
 *
 * The organization is deliberately absent: it comes from the grant-checked `:orgUid` path
 * segment. So is the return address, which the BFF derives from the request — EasyCLA stores it
 * and later redirects to it verbatim, so a client-supplied one would be an open redirect.
 */
export interface OrgClaSignRequest {
  /** From the chosen search result. Keys the corporate signature upstream. */
  projectSfid: string;
  claGroupId: string;
  /**
   * The signatory's own checkbox state at the moment they continued — never a literal, never
   * inferred from having reached this step. The two attestations are the legally operative part
   * of this request, and the value that matters is the one the signatory actually set.
   */
  authorityAcked: boolean;
  embargoAcked: boolean;
}

/**
 * The signing session EasyCLA opened, as the client consumes it (#1983).
 *
 * The address and the signature it belongs to, and nothing else. Upstream also returns the CLA
 * group, project and company identifiers, none of which has a consumer here — the hand-off
 * navigates and the page is replaced.
 *
 * The signature id is carried because the return address cannot name it. `return_url` is an
 * *input* to the upstream request, fixed before a signature exists, so the only place the id and
 * the address are ever held together is this response — and landing the signatory back on the
 * agreement they just signed needs both.
 */
export interface OrgClaSignResponse {
  /**
   * Where the signatory completes the ceremony. Navigated to as returned, never composed.
   *
   * Never empty on this path: upstream leaves it empty only for a request sent as an email to a
   * named signatory, which this route does not make, so an empty value is a failure rather than
   * a state to render.
   */
  signUrl: string;
  /**
   * The corporate signature this session will complete — the id that keys its row on the
   * organization's CLA list, so the return can land on that agreement.
   *
   * A pointer to a named organization's agreement, and held accordingly: the client stashes it
   * for the length of the round trip, spends it once, and never puts it in an address.
   */
  signatureId: string;
}

/**
 * The two confirmations the signatory gave, as they actually stood when they continued (#1983).
 *
 * A distinct type from the request so the attestation step can close with exactly this and
 * nothing else — the step that collects them is the only place entitled to say what they were.
 */
export interface OrgClaSignAttestations {
  authorityAcked: boolean;
  embargoAcked: boolean;
}

/** What the Org Lens CLA group picker is given. */
export interface OrgClaGroupSelectDialogData {
  orgUid: string;
  /**
   * The organization's corporate CLAs, so the picker can refuse a CLA Group it already holds one
   * for. The list is the one already loaded on the CLAs page the picker opens over — it is handed
   * down rather than fetched again, mirroring `ClaGroupSelectDialogData`.
   *
   * Empty is a safe value and is what the page passes when its response belongs to a different
   * organization: no row is refused, which is the behaviour before this check existed.
   */
  claGroups: OrgClaGroup[];
}

/** What the Org Lens CLA group picker closes with. */
export interface OrgClaGroupPickerResult {
  claGroupId: string;
  projectSfid: string;
  projectName: string;
}

/**
 * The chosen CLA Group as it travels from the picker to the pre-signing preview page (#1983).
 *
 * A superset of what the signing request needs, because the preview has to *name* the agreement
 * as well as key it. Nothing on the receiving page can look these names up: the CLA service has
 * no fetch-a-CLA-group-by-id endpoint, so a page handed only ids could render a heading for an
 * agreement it cannot describe.
 */
export interface OrgClaSignSelection extends OrgClaGroupPickerResult {
  /**
   * The CLA Group's own name, which the preview heads the page with — distinct from
   * `projectName`, the covered project the corporate signature is keyed on. The two differ
   * routinely ("Cascade CLA" over "Cascade"), and search names them separately.
   */
  claGroupName: string;

  /**
   * The organization the choice was made under.
   *
   * Carried because the selected organization is a cookie any other tab can change, and this state
   * survives history restoration — so a preview can be re-entered under a company its CLA Group was
   * never chosen for. The receiving page cannot see that as a switch: the wrong organization is its
   * initial value, and a switch guard has nothing to compare against without this.
   */
  orgUid: string;
}

/**
 * A picker row, plus why it cannot be chosen. `disabledReason` is null when the row is selectable.
 *
 * A row the organization cannot sign keeps its place and states its reason rather than being
 * filtered out, so the reason is part of the row's shape rather than a lookup beside it.
 */
export interface OrgClaGroupOptionView extends ClaGroupOptionView {
  disabledReason: string | null;
}

/**
 * What the hand-off dialog is given: the chosen CLA group, and the confirmations behind it.
 *
 * The attestations travel as data rather than being re-collected here, because the step that
 * collected them is the only one entitled to say what the signatory set.
 */
export interface OrgClaSignHandoffDialogData {
  orgUid: string;
  projectSfid: string;
  claGroupId: string;
  attestations: OrgClaSignAttestations;
}

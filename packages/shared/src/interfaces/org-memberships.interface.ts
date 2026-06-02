// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

export interface OrgMembershipsSummary {
  activeMemberships: number;
  renewingWithin90Days: number;
  governanceRoles: number;
}

export interface OrgActiveMembership {
  foundationId: string;
  foundationName: string;
  /** Spec 024: foundation URL slug from ORG_LENS_MEMBERSHIPS_SUMMARY; bridges to the indexer's project_membership.project_slug (D-002). */
  foundationSlug: string;
  foundationLogo: string | null;
  projectCount: number;
  memberCount: number;
  membershipTier: string;
  tierStartDate: string | null;
  tierEndDate: string | null;
  memberSince: string | null;
  boardMembers: number;
  committeeMembers: number;
  orgProjects: number;
}

export interface OrgActiveMembershipsResponse {
  accountId: string;
  summary: OrgMembershipsSummary;
  memberships: OrgActiveMembership[];
}

export interface OrgExpiredMembership {
  foundationId: string;
  foundationName: string;
  foundationLogo: string | null;
  membershipTier: string;
  tierStartDate: string | null;
  tierEndDate: string | null;
  expirationDate: string | null;
  actionType: 'renew' | 'contact';
}

export interface OrgExpiredMembershipsResponse {
  accountId: string;
  memberships: OrgExpiredMembership[];
}

export interface OrgDiscoverOpportunity {
  foundationId: string;
  foundationName: string;
  foundationLogo: string | null;
  category: string;
  suggestedTier: string;
  relevantProjects: number;
  contributors: number;
  contributions: number;
}

export interface OrgDiscoverOpportunitiesResponse {
  accountId: string;
  opportunities: OrgDiscoverOpportunity[];
}

// Membership Detail page (spec 015) ---------------------------------------------------------

// Spec 024: full 9-role catalog (was a 6-type mock in spec 015). Each value maps 1:1 to a
// member-service key-contact role string via KEY_CONTACT_ROLE_CATALOG (see org-memberships.constants.ts).
export type OrgMembershipKeyContactType =
  | 'representative'
  | 'technical'
  | 'marketing'
  | 'pr'
  | 'legal'
  | 'billing'
  | 'po'
  | 'event-sponsorship'
  | 'authorized-signatory';

export interface OrgMembershipKeyContactPerson {
  /**
   * Spec 024: the member-service key_contact UID (Project_Role__c-derived). Used as the
   * `:contactUid` path segment on the PUT/DELETE write proxy. (In the spec-015 mock this was a
   * fabricated id.) For not-yet-persisted optimistic placeholders it may carry a `temp-` prefix.
   */
  personId: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  jobTitle: string | null;
  initials: string;
}

/**
 * Spec 024: one row of the canonical 9-role key-contact catalog. Single source of truth for the
 * upstream role string ↔ UI `contactType` ↔ display label ↔ requiredness ↔ min/max limits.
 * Materialised as `KEY_CONTACT_ROLE_CATALOG` in org-memberships.constants.ts.
 */
export interface KeyContactRoleConfig {
  /** Canonical upstream role string (member-service KeyContactRoles), used on read grouping and write bodies. */
  role: string;
  contactType: OrgMembershipKeyContactType;
  contactTypeLabel: string;
  /** True when the role must retain ≥1 contact (minContacts = 1); false ⇒ minContacts = 0. */
  required: boolean;
  minContacts: number;
  /** Maximum active contacts (member-service KeyContactRoleLimits). */
  maxContacts: number;
  /** Short role-purpose description for the per-row tooltip (FR-013). */
  tooltip: string;
}

/** Spec 024 (FR-023/§4.2): a distinct person surfaced in the Edit Key Contact modal's employee search. */
export interface KeyContactEmployee {
  /** Canonical identity — lowercased email (FR-024). */
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  jobTitle: string | null;
  initials: string;
}

/** Response envelope for `GET /api/orgs/:orgUid/lens/key-contacts/employees`. */
export interface KeyContactEmployeesResponse {
  /** The org's canonical b2b_org uuid (the route identifier) echoed back. */
  orgUid: string;
  /** Deduped by lowercased email, across all of the org's foundation memberships. */
  employees: KeyContactEmployee[];
}

/** Spec 024 (FR-014): body for `POST …/key-contacts`. */
export interface AddKeyContactRequest {
  contactType: OrgMembershipKeyContactType;
  email: string;
  firstName: string;
  lastName: string;
  jobTitle?: string | null;
}

/** Spec 024 (FR-015): body for `PUT …/key-contacts/:contactUid` (single-slot replace). */
export interface ReplaceKeyContactRequest {
  contactType: OrgMembershipKeyContactType;
  email: string;
  firstName: string;
  lastName: string;
  jobTitle?: string | null;
}

/** Spec 024 (FR-020): write-proxy response — the affected role row, re-read/echoed post-persist. */
export interface KeyContactMutationResponse {
  contact: OrgMembershipKeyContact;
}

export interface OrgMembershipKeyContact {
  contactType: OrgMembershipKeyContactType;
  contactTypeLabel: string;
  minContacts: number;
  maxContacts: number;
  people: OrgMembershipKeyContactPerson[];
}

export interface OrgMembershipFoundationHeader {
  foundationId: string;
  foundationName: string;
  foundationLogo: string | null;
  membershipTier: string;
  tierStartDate: string | null;
  tierEndDate: string | null;
  memberSince: string | null;
  status: 'active' | 'expired';
}

export interface OrgMembershipDetailResponse {
  foundation: OrgMembershipFoundationHeader | null;
  keyContacts: OrgMembershipKeyContact[];
}

// Membership Detail page — Board & Committee tab (spec 016) ----------------------------------

/**
 * One row in the Board Seats table. Carries an embedded `person` (reuses the
 * spec 015 `OrgMembershipKeyContactPerson`), the seat name, a categorical
 * `tagLabel` (distinct from seat name — e.g., "Voting Rep"), voting
 * percentage, and the `isOrgEditable` boolean that drives whether the
 * Actions cell renders a pencil OR a "Why can't I edit?" link.
 */
export interface BoardSeat {
  seatId: string;
  person: OrgMembershipKeyContactPerson;
  seatName: string;
  tagLabel: string;
  votingPercentage: number | null;
  isOrgEditable: boolean;
  reason: string | null;
}

/**
 * One row in the Committee Seats table. Asymmetric with `BoardSeat`:
 * `seatName` is replaced by `committeeName`, a `role` field is added (the
 * person's role within the committee — e.g., "Chair", "Member"), and
 * `tagLabel` is OMITTED (the Role column AND the Reassign modal pill both
 * source from `role` directly per spec 016 Q1 round 3 clarification).
 */
export interface CommitteeSeat {
  seatId: string;
  person: OrgMembershipKeyContactPerson;
  committeeName: string;
  role: string;
  votingPercentage: number | null;
  isOrgEditable: boolean;
  reason: string | null;
}

/** One row in the read-only Voting History table. No Action affordance. */
export interface VotingRecord {
  voteId: string;
  /** ISO 8601 date (`YYYY-MM-DD`). */
  date: string;
  resolution: string;
  vote: 'Yes' | 'No' | 'Abstain';
  outcome: string;
}

/** Response envelope for `GET /api/orgs/:accountId/lens/memberships/:foundationId/board-seats`. */
export interface OrgMembershipBoardSeatsResponse {
  accountId: string;
  foundationId: string;
  boardSeats: BoardSeat[];
}

/** Response envelope for `GET /api/orgs/:accountId/lens/memberships/:foundationId/committee-seats`. */
export interface OrgMembershipCommitteeSeatsResponse {
  accountId: string;
  foundationId: string;
  committeeSeats: CommitteeSeat[];
}

/** Response envelope for `GET /api/orgs/:accountId/lens/memberships/:foundationId/voting-history`. */
export interface OrgMembershipVotingHistoryResponse {
  accountId: string;
  foundationId: string;
  /** Default order: reverse-chronological (newest first). */
  votingHistory: VotingRecord[];
}

/**
 * Body shape for the future `PATCH /…/board-seats/:seatId` and
 * `PATCH /…/committee-seats/:seatId` write proxy endpoints (FR-009g). Pinned
 * now so the Reassign modal output event can use the canonical type even
 * though no HTTP call is made in v1.
 *
 * Note: `jobTitle` is intentionally NOT included — it is upstream-authoritative
 * (FR-009g / round 5 Q5).
 */
export interface ReassignSeatBody {
  firstName: string;
  lastName: string;
  email: string;
}

// Org Memberships list page — view-model types -----------------------------------------------

export type OrgMembershipsPageState = 'loading' | 'error' | 'ready' | 'empty';
export type OrgMembershipTab = 'active' | 'expired' | 'discover';

export interface OrgDropdownOption {
  label: string;
  value: string;
}

export interface ActiveMembershipRow extends OrgActiveMembership {
  initials: string;
  tierRange: string;
  memberSinceFormatted: string;
}

export interface ExpiredMembershipRow extends OrgExpiredMembership {
  initials: string;
  logoClasses: string;
  expirationDateFormatted: string;
  tierStartFormatted: string;
  tierEndFormatted: string;
  renewUrl: string;
}

export interface DiscoverOpportunityRow extends OrgDiscoverOpportunity {
  initials: string;
  logoClasses: string;
  joinUrl: string;
}

// Membership Detail page — component types ---------------------------------------------------

export type OrgMembershipDetailPageState = 'loading' | 'error' | 'ready' | 'empty' | 'notFound';
export type MembershipDetailTab = 'key-contacts' | 'board' | 'docs' | 'governance';

export interface ModalOpenState {
  contact: OrgMembershipKeyContact;
  editingPersonId: string | null;
}

export type ModalKind = 'closed' | 'replace-form' | 'chooser' | 'add-form' | 'remove-list' | 'single-add-form';

export interface EditKeyContactSubmitEvent {
  contactType: OrgMembershipKeyContactType;
  contactTypeLabel: string;
  editingPersonId: string | null;
  person: OrgMembershipKeyContactPerson;
}

export interface EditKeyContactRemoveEvent {
  contactType: OrgMembershipKeyContactType;
  contactTypeLabel: string;
  personId: string;
}

export interface ReassignSubmitEvent {
  seatId: string;
  seatKind: 'board' | 'committee';
  body: ReassignSeatBody;
}

export type SectionLoadState = 'idle' | 'loading' | 'success' | 'error';

export interface VotingRecordRow extends VotingRecord {
  formattedDate: string;
  chipClass: string;
}

// Membership Detail page — Dialog contracts (centralised per coderabbitai review) --------------

export interface EditKeyContactDialogData {
  contact: OrgMembershipKeyContact;
  foundationName: string;
  editingPersonId: string | null;
  /** Spec 024 (uuid-only): selected org b2b_org uuid, used by the modal to load the org-wide employee-search list (FR-023). */
  orgUid: string;
  /** Parent performs the pessimistic write + table reconcile; resolves on success, rejects with Error(message) on failure. */
  submit: (intent: Exclude<EditKeyContactDialogResult, null>) => Promise<void>;
}

export type EditKeyContactDialogResult =
  | { kind: 'replace'; event: EditKeyContactSubmitEvent }
  | { kind: 'add'; event: EditKeyContactSubmitEvent }
  | { kind: 'remove'; event: EditKeyContactRemoveEvent }
  | null;

export interface ReassignBoardRolesDialogData {
  seat: BoardSeat | CommitteeSeat;
  seatKind: 'board' | 'committee';
  foundationName: string;
}

export type ReassignBoardRolesDialogResult = ReassignSubmitEvent | null;

export interface WhyCantEditDialogData {
  reason: string | null;
  seatId: string;
}

export type WhyCantEditDialogResult = { contactFoundation: boolean } | null;

// Membership Detail page — Documentation tab (spec 017 baseline + spec 018 Snowflake extension)

/** One agreement document in the Documentation tab list. */
export interface OrgMembershipAgreement {
  id: string;
  name: string;
  signedDate: string;
  format: string;
  fileSizeKb: number | null;
  isCurrent: boolean;
  downloadUrl: string | null;
  statusRaw: string;
  tier: string;
}

/** TLF Certificate of Membership card payload — per-accountId, sourced from ORG_LENS_TLF_CERTIFICATE (spec 019). */
export interface OrgMembershipCertificateTemplate {
  /** Pre-formatted card title. E.g. "Linux Foundation Gold Membership Certificate". */
  title: string;
  /** Pre-formatted card subtitle. E.g. "Member since Jul 2011 · Issued to TOYOTA MOTOR CORPORATION". */
  subtitle: string;
  /** Verbatim membership tier including " Membership" suffix. E.g. "Gold Membership". */
  membershipTier: string;
  /** Verbatim Salesforce account name. */
  issuedTo: string;
  /** Pre-formatted "Mon YYYY" date string. E.g. "Jul 2011". */
  memberSinceFormatted: string;
  /** ISO YYYY-MM-DD date string for downstream re-formatting if needed. */
  memberSinceDate: string;
  /** Membership-agreement PDF URL. NULL when the upstream Opportunity has no URL recorded. */
  downloadUrl: string | null;
}

/** Response envelope for GET /api/orgs/:accountId/lens/memberships/:foundationId/documents. */
export interface OrgMembershipDocumentsResponse {
  accountId: string;
  foundationId: string;
  agreements: OrgMembershipAgreement[];
  certificateTemplate: OrgMembershipCertificateTemplate | null;
}

/** Internal service result: wire response plus non-wire degraded flag for observability (spec 019 SC-015). */
export interface OrgMembershipDocumentsResult {
  response: OrgMembershipDocumentsResponse;
  certificateDegraded: boolean;
}

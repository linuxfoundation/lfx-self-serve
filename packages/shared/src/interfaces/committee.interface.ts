// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommitteeMemberVisibility } from '../enums/committee.enum';
import { CommitteeMemberRole, CommitteeMemberVotingStatus } from '../enums/committee-member.enum';
import { GroupsIOMailingList } from './mailing-list.interface';
import { MeetingAttachment } from './meeting-attachment.interface';
import { UserSearchResult } from './search.interface';

// ── v2.0 Taxonomy Types ─────────────────────────────────────────────────────

/**
 * Sub-type for oversight committees to distinguish governance-track (TOC, TSC)
 * from advisory-track (TAC, Legal, Finance) bodies.
 * Drives subtle dashboard differences: governance sub-type shows binding vote UI,
 * advisory sub-type shows recommendation/report UI.
 */
export type OversightSubType = 'governance' | 'advisory';

/**
 * Behavioral class for group types — drives personalized dashboard layouts.
 *
 * @see LFX-One-Groups-Type-Taxonomy-Spec.docx (v1.1)
 *
 * - governing-board:        Voting, budgets, resolutions, fiduciary oversight, delegation
 * - oversight-committee:    Technical governance + collaboration (TSC, TOC, TAC, Legal, Finance, CoC)
 * - working-group:          Task-oriented collaboration, deliverables, milestones
 * - special-interest-group: Community discussions, events, knowledge sharing
 * - ambassador-program:     Outreach, evangelism, referral campaigns, ambassador engagement
 * - other:                  Catch-all for uncategorized groups; minimal generic dashboard
 */
export type GroupBehavioralClass = 'governing-board' | 'oversight-committee' | 'working-group' | 'special-interest-group' | 'ambassador-program' | 'other';

/** Display metadata for a behavioral class — used by filter chips and badges. */
export interface BehavioralClassDisplayConfig {
  label: string;
  icon: string;
  color: string;
  bgColor: string;
}

// ── Join & Invite Types (Phase 1) ───────────────────────────────────────────

/**
 * Organization reference carried on committee invites and member records.
 * Mirrors the committee-service organization object: `id`, `name`, and `website`.
 */
export interface CommitteeOrganizationReference {
  /** CDP organization ID */
  id?: string | null;
  /** Organization display name */
  name?: string | null;
  /** Organization website URL */
  website?: string | null;
}

/**
 * How users can join this group.
 *  - open:        Anyone can self-join; no approval required.
 *  - invite_only: Members / admins send invite links; invitee clicks to accept.
 *  - application: User submits application; admin reviews and approves/rejects.
 *  - closed:      Only admins can add members directly.
 */
export type JoinMode = 'open' | 'invite_only' | 'application' | 'closed';

/**
 * Status of a committee invite. Mirrors the committee-service `committee_invite`
 * resource status enum (lfx-v2-committee-service): an invite is `pending` until the
 * invitee accepts/declines, or an admin revokes it.
 */
export type CommitteeInviteStatus = 'pending' | 'accepted' | 'declined' | 'revoked';

/**
 * A pending/resolved invitation for a person (by email) to join a committee.
 *
 * Mirrors the committee-service `committee_invite` resource — the invite-and-forget
 * primitive for adding people who may not yet have an LF account (LFID). The v2 query
 * index has no identity/user resource type, so accounts can't be looked up directly;
 * inviting by email is how anyone outside the existing committee/registrant corpus is
 * added. On accept, the invite is reconciled into a `committee_member` with the
 * person's LFID populated.
 */
export interface CommitteeInvite {
  /** Invite UID */
  uid: string;
  /** Committee this invite belongs to */
  committee_uid: string;
  /** Email address the invite was delivered to */
  invitee_email: string;
  /** Suggested committee role for the invitee on acceptance (optional) */
  role?: string | null;
  /** Current invite status */
  status: CommitteeInviteStatus;
  /** Creation timestamp (RFC3339) */
  created_at: string;
  /** Suggested organization for the invitee (optional) */
  organization?: CommitteeOrganizationReference | null;
}

/**
 * Enriched, person-facing view model for a committee invitation surfaced to the
 * invitee (dashboard pending-actions + My Groups). Built server-side by joining a
 * committee-service `committee_invite` resource with its `committee` resource for
 * display context (committee name, project name, category).
 *
 * The underlying `committee_invite` resource carries ONLY: uid, committee_uid,
 * invitee_email, role, status, created_at. There is NO inviter name and NO expiry in
 * the current committee-service contract — so {@link inviter_name} and
 * {@link expires_at} are reserved, optional fields that stay `undefined` until/unless
 * the committee-service starts emitting them. Do NOT fabricate either on the BFF.
 */
export interface PendingInvitation {
  /** committee_invite UID — used for accept/decline */
  uid: string;
  /** Committee this invitation is for */
  committee_uid: string;
  /** Committee display name — enriched from the committee resource */
  committee_name: string;
  /** Project display name — enriched (optional) */
  project_name?: string | null;
  /** Committee category, for the My Groups class badge (optional) */
  category?: string | null;
  /** Suggested role on acceptance (from the invite) */
  role?: string | null;
  /** Email address the invitation was delivered to */
  invitee_email: string;
  /** Current invite status (surfaced rows are `pending`) */
  status: CommitteeInviteStatus;
  /** Creation timestamp (RFC3339) */
  created_at: string;
  /**
   * Name of the person who sent the invitation. NOT in the current committee-service
   * contract — populated only if upstream adds it. Stays `undefined` otherwise.
   */
  inviter_name?: string | null;
  /**
   * Expiration timestamp (RFC3339). NOT in the current committee-service contract —
   * populated only if upstream adds it. Stays `undefined` otherwise.
   */
  expires_at?: string | null;
  /** Suggested organization from the invite (pre-fills the accept modal) */
  organization?: CommitteeOrganizationReference | null;
  /** Whether the committee has voting enabled — enriched from the committee resource */
  enable_voting?: boolean;
  /** Whether the committee requires a business email — enriched from the committee resource */
  business_email_required?: boolean;
}

/**
 * A decline that has been optimistically applied but not yet committed upstream — held while the
 * deferred-undo timer runs so the dashboard can either fire the real decline when the timer elapses
 * (or on component destroy) or roll it back if the user hits Undo.
 */
export interface PendingDecline {
  /** committee_invite UID being declined */
  inviteUid: string;
  /** committee_uid the invite belongs to */
  committeeUid: string;
}

/**
 * Payload to create a single committee invite (committee-service create-invite).
 * Only the invitee email is required; role is an optional suggestion.
 */
export interface CreateCommitteeInviteRequest {
  /** Email of the person to invite (required) */
  invitee_email: string;
  /** Suggested role for the invitee (optional) */
  role?: string | null;
  /** Suggested default organization for the invitee (optional; pre-fills the accept flow when committee has voting or business-email rules) */
  organization?: CommitteeOrganizationReference | null;
}

/**
 * Payload for accepting a committee invite (committee-service accept-invite).
 */
export interface AcceptCommitteeInviteRequest {
  /** Organization the invitee confirms on acceptance */
  organization?: CommitteeOrganizationReference | null;
}

/** Raw organization form values shared by invite-create and invite-accept dialogs. */
export interface CommitteeOrganizationFormValue {
  organization: string;
  organization_url: string;
  organization_id: string | null;
}

/** Data passed into the accept-invite organization dialog. */
export interface AcceptInviteOrganizationDialogData {
  committeeName: string;
  organization?: CommitteeOrganizationReference | null;
}

/** Result returned by the accept-invite organization dialog on confirm. */
export interface AcceptInviteOrganizationDialogResult {
  organization: CommitteeOrganizationReference;
}

/** Context needed to accept a committee invitation from any surface. */
export interface InvitationAcceptContext {
  committeeUid: string;
  inviteUid: string;
  committeeName: string;
  organization?: CommitteeOrganizationReference | null;
  enable_voting?: boolean;
  business_email_required?: boolean;
  inviteRequiresOrganization?: boolean;
}

/**
 * Payload for accepting a committee invite (committee-service accept-invite).
 */
export interface AcceptCommitteeInviteRequest {
  /** Organization the invitee confirms on acceptance */
  organization?: CommitteeOrganizationReference | null;
}

/**
 * Per-email outcome of one create-invite call within a bulk-invite batch.
 *
 * The committee-service exposes no bulk endpoint, so the client fans out one
 * create-invite request per email and aggregates the individual outcomes here
 * to drive a partial-success summary.
 */
export interface CommitteeInviteResult {
  /** The normalized email this result is for */
  email: string;
  /** Whether the invite was created successfully */
  success: boolean;
  /** Human-readable failure reason when `success` is false */
  reason?: string;
}

/**
 * Result of parsing a free-text blob of email addresses (bulk invite input).
 * Emails are normalized (trimmed + lowercased) and de-duplicated.
 */
export interface EmailListParseResult {
  /** Unique, valid, normalized email addresses, in first-seen order */
  valid: string[];
  /** Non-empty tokens that failed email validation (original casing preserved) */
  invalid: string[];
  /** Normalized emails that appeared more than once (reported once each) */
  duplicates: string[];
}

/**
 * A committee user-search hit decorated for the add-member typeahead: whether its
 * email is already added to the input, already a member, already invited, and
 * whether the person has an LF account (LFID).
 */
export type DecoratedCommitteeSearchResult = UserSearchResult & {
  added: boolean;
  alreadyMember: boolean;
  alreadyInvited: boolean;
  lfAccount: boolean;
};

/**
 * Parsed valid invite emails partitioned by what the add-member submit will do with each.
 */
export interface CategorizedCommitteeEmails {
  /** Emails that will be invited (not already a member or pending invite). */
  toInvite: string[];
  /** Emails skipped because the person is already a member. */
  alreadyMembers: string[];
  /** Emails skipped because a pending invite already exists. */
  alreadyInvited: string[];
}

/**
 * Membership-tier eligibility thresholds for group participation.
 * Replaces the former "Membership Class" behavioral type — tier is now
 * an attribute on any group rather than a top-level type.
 */
export interface GroupEligibility {
  /** Minimum tier to join the group (default: 'any') */
  join_tier?: 'platinum' | 'gold' | 'silver' | 'any';
  /** Minimum tier to serve as chair */
  chair_tier?: 'platinum' | 'gold';
  /** Minimum tier to hold voting rights */
  voting_tier?: 'platinum' | 'gold';
}

/**
 * Lightweight committee reference for cross-module use
 * @description Minimal committee data with voting status eligibility
 */
export interface CommitteeReference {
  /** Committee UID */
  uid: string;
  /** Committee display name */
  name?: string;
  /** Allowed voting statuses: Voting Rep, Alternate Voting Rep, Observer, Emeritus, None */
  allowed_voting_statuses?: CommitteeMemberVotingStatus[];
}

/**
 * Committee entity with complete details
 * @description Represents a committee/working group within a project with full metadata
 */
export interface Committee {
  /** Unique identifier for the committee */
  uid: string;
  /** Committee name */
  name: string;
  /** Display name for UI presentation (optional override) */
  display_name?: string;
  /** Write access permission for current user (response only) */
  writer?: boolean;
  /** Committee category/type (e.g., "Technical", "Legal", "Board") */
  category: string;
  /** Behavioral class derived from category — populated by the UI before binding to list views to avoid per-row function calls in templates. */
  behavioralClass?: GroupBehavioralClass;
  /** Resolved display metadata for behavioralClass — populated by the UI alongside behavioralClass so templates read pure properties. */
  classDisplay?: BehavioralClassDisplayConfig;
  /** Optional description of the committee's purpose */
  description?: string;
  /** UID of parent committee for hierarchical structures */
  parent_uid?: string;
  /** Whether voting functionality is enabled for this committee */
  enable_voting: boolean;
  /** Whether the committee is publicly visible */
  public: boolean;
  /** Whether SSO group integration is enabled */
  sso_group_enabled: boolean;
  /** Associated SSO group name for membership sync */
  sso_group_name?: string;
  /** Committee website URL */
  website?: string | null;
  /** Whether committee membership requires review */
  requires_review?: boolean;
  /** Timestamp when committee was created */
  created_at: string;
  /** Timestamp when committee was last updated */
  updated_at: string;
  /** Total number of committee members */
  total_members: number;
  /** Total number of voting representatives (upstream field name is total_voting_repos) */
  total_voting_repos: number;
  /** Associated project UID */
  project_uid: string;
  /** Associated project name (populated from project data) */
  project_name?: string;
  /** Project URL slug (enriched for filtering) */
  project_slug?: string;
  /** Whether the project is a foundation (top-level entity) */
  is_foundation?: boolean;
  /** Parent project UID (for subprojects under a foundation) */
  parent_project_uid?: string;
  /** Foundation name this committee belongs to (populated from project hierarchy) */
  foundation_name?: string;
  /** Calendar visibility settings */
  calendar?: {
    /** Whether committee calendar is public */
    public: boolean;
  };
  /** Whether business email is required for membership (from settings) */
  business_email_required?: boolean;
  /** Whether audit logging is enabled (from settings) */
  is_audit_enabled?: boolean;
  /** Member profile visibility setting */
  member_visibility?: CommitteeMemberVisibility;
  /** Whether to show meeting attendees by default */
  show_meeting_attendees?: boolean;

  // ── v2.0 Taxonomy fields ──
  /** Sub-type for oversight committees: governance (binding) vs advisory */
  oversight_sub_type?: OversightSubType;
  /** Membership-tier eligibility thresholds for participation */
  eligibility?: GroupEligibility;

  // ── Join & Invite fields ──
  /** How users can join this group (default: 'invite_only') */
  join_mode?: JoinMode;

  // ── Communication Channels ──
  /** Whether the committee has any associated mailing lists (enriched by BFF via query-service association counts) */
  has_mailing_list?: boolean;
  /** Mailing list email address associated with the group (plain string from upstream). Set to null to clear. */
  mailing_list?: string | null;
  /** Chat channel URL or identifier associated with the group (plain string from upstream). Set to null to clear. */
  chat_channel?: string | null;

  // NOTE: chair/co_chair are NOT returned by GET /committees/{uid}.
  // Leadership is derived from committee members with role.name === "Chair" / "Vice Chair".
  // Server-side enrichment will be added in a follow-up PR.

  /** Users with write (manage) access to this committee */
  writers?: CommitteeUser[];
  /** Users with audit (review) access to this committee */
  auditors?: CommitteeUser[];

  /**
   * Users with write (manage) access *inherited* from the committee's project/foundation
   * ancestry (e.g. a foundation-level "Manage" grant). Populated by the BFF, which walks the
   * project ancestry (`project_uid → parent → … → foundation`) and unions each level's
   * permission list — response-only, display purposes only. The committee's effective `writer`
   * boolean already reflects this inheritance via the authorization model (`committee#writer`
   * derives from `writer from project`, and `project#writer` from `writer from parent`); this
   * field exists so the per-member roster can label such users "Manage" even though they are
   * absent from the committee-scoped `writers` list. Empty/absent for the levels the caller
   * cannot read (best-effort).
   */
  inherited_writers?: CommitteeUser[];
  /** Users with audit (review) access inherited from the committee's project/foundation ancestry. See {@link inherited_writers}. */
  inherited_auditors?: CommitteeUser[];

  /**
   * Caller's role in this committee, when they are a member. Absent for non-members.
   * Falls back to the literal 'Member' when the upstream membership row exists but
   * either carries no role or uses the placeholder `CommitteeMemberRole.NONE` value.
   */
  my_role?: CommitteeMemberRole | 'Member';
  /** Caller's member UID in this committee. Absent for non-members. */
  my_member_uid?: string;
}

/**
 * Committee with the current user's membership info.
 *
 * @description Extends {@link Committee}, narrowing `my_role` to required for endpoints
 * that guarantee the caller is a member (e.g. `GET /committees/my-committees`). No new
 * fields beyond the optional ones already declared on `Committee`.
 */
export interface MyCommittee extends Committee {
  /** User's role in this committee (e.g., "Chair", "Member", "Observer") */
  my_role: CommitteeMemberRole | 'Member';
  /** User's member UID in this committee (needed for leave action) */
  my_member_uid?: string;
}

/**
 * Data required to create a new committee
 * @description Input payload for committee creation API
 */
export interface CommitteeCreateData {
  /** Committee name (required) */
  name: string;
  /** Committee category (required) */
  category: string;
  /** Optional committee description */
  description?: string;
  /** Parent committee UID for hierarchical structure */
  parent_uid?: string;
  /** Require business email for membership */
  business_email_required?: boolean;
  /** Enable voting functionality */
  enable_voting?: boolean;
  /** Enable audit logging */
  is_audit_enabled?: boolean;
  /** Make committee publicly visible */
  public?: boolean;
  /** Display name override */
  display_name?: string;
  /** Enable SSO group integration */
  sso_group_enabled?: boolean;
  /** SSO group name for membership sync */
  sso_group_name?: string;
  /** Committee website URL */
  website?: string | null;
  /** Associated project UID */
  project_uid?: string;
  /** How users can join this group */
  join_mode?: JoinMode;
  /** Member profile visibility setting */
  member_visibility?: CommitteeMemberVisibility;
  /** Whether to show meeting attendees by default */
  show_meeting_attendees?: boolean;
}

/**
 * Data for updating existing committee
 * @description Partial update payload allowing any field from create data to be modified
 */
export interface CommitteeUpdateData extends Partial<CommitteeCreateData> {
  /** Update or clear mailing list email */
  mailing_list?: string | null;
  /** Update or clear chat channel */
  chat_channel?: string | null;
  /** Update the list of users with manage (write) access */
  writers?: CommitteeUser[];
  /** Update the list of users with review (audit) access */
  auditors?: CommitteeUser[];
}

/**
 * Committee settings update data
 * @description Specific settings that can be updated independently
 */
export interface CommitteeSettingsData {
  /** Update business email requirement */
  business_email_required?: boolean;
  /** Update audit logging setting */
  is_audit_enabled?: boolean;
  /** Update member profile visibility setting */
  member_visibility?: CommitteeMemberVisibility;
  /** Update show meeting attendees setting */
  show_meeting_attendees?: boolean;
  /** Update the list of users with manage (write) access */
  writers?: CommitteeUser[];
  /** Update the list of users with review (audit) access */
  auditors?: CommitteeUser[];
}

// ── Committee Dashboard Data Types ──────────────────────────────────────────
// These interfaces describe data shapes for per-group-type dashboard cards.
// Fields reflect the current mock data; will align to real API shapes when
// the corresponding V2 endpoints are available.

/** Status of an open vote */
export type CommitteeVoteStatus = 'open' | 'closed' | 'cancelled';

/** Quick-filter chip keys for the committee Members tab; `'all'` is the default. */
export type CommitteeMemberFilterChip = 'all' | 'voting' | 'observers' | 'chairs';

/** A single chip entry in the committee Members quick-filter row. */
export interface CommitteeMemberFilterChipConfig {
  key: CommitteeMemberFilterChip;
  label: string;
  count: number;
}

/**
 * An open or recent vote in a governing board or oversight committee.
 */
export interface CommitteeVote {
  uid: string;
  title: string;
  status: CommitteeVoteStatus;
  /** ISO date string for when voting closes */
  deadline: string;
  votes_for: number;
  votes_against: number;
  votes_abstain: number;
  total_eligible: number;
  created_by: string;
}

/** A single budget category line item */
export interface CommitteeBudgetCategory {
  name: string;
  allocated: number;
  spent: number;
}

/**
 * Budget summary for a governing board's fiscal year.
 */
export interface CommitteeBudgetSummary {
  fiscal_year: string;
  total_budget: number;
  spent: number;
  committed: number;
  remaining: number;
  categories: CommitteeBudgetCategory[];
}

/**
 * A passed/failed resolution from a governing or oversight committee.
 */
export interface CommitteeResolution {
  uid: string;
  title: string;
  /** ISO date string */
  date: string;
  result: string;
  votes_for: number;
  votes_against: number;
}

/** Activity type for collaboration-class groups */
export type CommitteeActivityType = 'pr_merged' | 'issue_opened' | 'release' | 'discussion' | 'comment' | 'review';

/**
 * A recent activity event shown in working-group / oversight-committee dashboards.
 */
export interface CommitteeActivity {
  uid: string;
  type: CommitteeActivityType;
  title: string;
  author: string;
  repo: string;
  /** ISO date string */
  timestamp: string;
  /** FontAwesome icon class e.g. "fa-light fa-code-pull-request" */
  icon: string;
  /** Tailwind text-color class e.g. "text-emerald-600" */
  color: string;
}

/**
 * A top contributor shown in working-group / oversight-committee dashboards.
 */
export interface CommitteeContributor {
  name: string;
  commits: number;
  prs: number;
  reviews: number;
  org: string;
}

/** Status of a working-group deliverable */
export type CommitteeDeliverableStatus = 'not-started' | 'in-progress' | 'completed' | 'blocked';

/**
 * A deliverable / milestone tracked by a working group.
 */
export interface CommitteeDeliverable {
  uid: string;
  title: string;
  status: CommitteeDeliverableStatus;
  /** Completion percentage 0–100 */
  progress: number;
  owner: string;
  /** ISO date string */
  due_date: string;
}

/**
 * A discussion thread in a special-interest-group dashboard.
 */
export interface CommitteeDiscussionThread {
  uid: string;
  title: string;
  author: string;
  replies: number;
  /** ISO date string of most recent reply */
  last_activity: string;
  tags: string[];
}

/** Format of a committee-hosted event */
export type CommitteeEventType = 'Webinar' | 'In-Person' | 'Virtual' | 'Hybrid';

/**
 * An upcoming event shown in a special-interest-group dashboard.
 */
export interface CommitteeEvent {
  uid: string;
  title: string;
  type: CommitteeEventType;
  /** ISO date string */
  date: string;
  speaker: string;
  attendees: number;
}

/** Status of an ambassador outreach campaign */
export type CommitteeCampaignStatus = 'active' | 'upcoming' | 'ended' | 'paused';

/**
 * An outreach campaign shown in an ambassador-program dashboard.
 */
export interface CommitteeOutreachCampaign {
  uid: string;
  title: string;
  status: CommitteeCampaignStatus;
  reach: number;
  conversions: number;
  conversion_rate: number;
  /** FontAwesome icon class */
  icon: string;
  /** Tailwind text-color class */
  color: string;
}

/**
 * Aggregate engagement metrics for an ambassador-program dashboard.
 */
export interface CommitteeEngagementMetrics {
  total_reach: number;
  new_members_30d: number;
  event_attendance: number;
  newsletter_open_rate: number;
  social_impressions: number;
  ambassador_count: number;
}

/** Type of a committee document entry */
export type CommitteeDocumentType = 'file' | 'link' | 'folder';

/**
 * Document types accepted by the JSON `POST /committees/:id/documents` create endpoint.
 * Files are uploaded via a separate multipart endpoint, not this one — keep this union
 * narrow so misuse (sending `type: 'file'` to the JSON endpoint) is caught at compile time.
 */
export type CreateCommitteeDocumentType = 'link' | 'folder';

/**
 * Mode discriminator for the shared document form dialog. A superset of
 * `CreateCommitteeDocumentType` because the file mode dispatches to the upload endpoint.
 */
export type DocumentFormMode = CreateCommitteeDocumentType | 'file';

/** Which resource type the shared document form dialog operates against. Drives service dispatch + copy. */
export type DocumentFormEntityType = 'committee' | 'project';

/**
 * A document or resource link associated with a committee.
 */
export interface CommitteeDocument {
  uid: string;
  type: CommitteeDocumentType;
  name: string;
  /** URL for links; download URL for files */
  url?: string;
  /** Optional description */
  description?: string;
  /** MIME type or file extension (files only) */
  mime_type?: string;
  /** File size in bytes (files only) */
  file_size?: number;
  /** ISO date string of creation */
  created_at?: string;
  /** ISO date string of last update */
  updated_at?: string;
  /** UID of the user who created the document */
  created_by?: string;
  uploaded_by?: string;
  /** Parent folder UID (for nested documents) */
  parent_uid?: string;
  /** Committee UID this document belongs to */
  committee_uid?: string;
}

/** Request body for creating a committee document */
export interface CreateCommitteeDocumentRequest {
  type: CreateCommitteeDocumentType;
  name: string;
  /** Required for type 'link' */
  url?: string;
  description?: string;
  /** Parent folder UID (to place a link inside a folder) */
  parent_uid?: string;
  /** Display name of the creator (populated by BFF from session) */
  created_by_name?: string;
}

/**
 * Multipart upload payload for a committee file document.
 * The actual `File` is sent separately via FormData / raw body — this interface
 * captures the metadata sent alongside it.
 */
export interface UploadCommitteeDocumentRequest {
  /** Display name for the document (max 500 chars) */
  name: string;
  /** Original file name (max 500 chars) */
  file_name: string;
  /** MIME type of the uploaded file */
  content_type: string;
  /**
   * File size in bytes. **BFF-only** — used to validate the request body
   * length against the client-reported size. Not forwarded to upstream
   * (upstream `UploadCommitteeDocumentRequestBody` has no `file_size` field).
   */
  file_size: number;
  /** Optional description (max 2000 chars) */
  description?: string;
  /**
   * Optional folder UID to nest the file inside a committee folder.
   * When omitted, the file lands at the committee root.
   */
  folder_uid?: string;
}

/** Attachment enriched with meeting context for display. */
export interface MeetingAttachmentWithContext {
  attachment: MeetingAttachment;
  meetingTitle: string;
  meetingDate: string;
  meetingId: string;
}

/** Unified display item that covers both meeting attachments and standalone documents. */
export interface DocumentDisplayItem {
  uid: string;
  name: string;
  type: CommitteeDocumentType;
  url?: string;
  description?: string;
  addedBy?: string;
  date?: string;
  fileSize?: number;
  /** Source for filtering: 'meeting', 'link', 'folder', or 'file' */
  source: CommitteeDocumentType | 'meeting';
  /** Whether this is a standalone document (supports edit/delete) */
  isStandalone: boolean;
  /** Original meeting attachment data (for download) */
  meetingAttachment?: MeetingAttachmentWithContext;
  /** Original committee document data (for edit/delete) */
  committeeDocument?: CommitteeDocument;
  /** Parent folder UID (for hierarchy display) */
  parentUid?: string;
  /** Number of child links inside this folder */
  childCount?: number;
  /** Whether this item is a child inside a folder (indent in table) */
  isChild?: boolean;
}

/**
 * Source category for a committee document entry in the Documents tab.
 * @description Distinguishes between attachments, recordings, transcripts, and AI summaries.
 */
export type CommitteeDocumentSource = 'link' | 'file' | 'recording' | 'transcript' | 'summary';

/**
 * Unified document item for the committee Documents tab.
 * @description Represents attachments, recording files, transcripts, and AI summaries
 * in a single shape suitable for table display.
 */
export interface CommitteeDocumentItem {
  /** Unique key for table dataKey (combination of source + id) */
  id: string;
  /** Display name shown in the Name column */
  name: string;
  /** Source type for filtering and icon selection */
  source: CommitteeDocumentSource;
  /** Person who created/added the item (display name or null) */
  addedBy: string | null;
  /** ISO date string for the Date column */
  date: string;
  /** File size in bytes (null for links and summaries) */
  fileSize: number | null;
  /** Meeting title for the "From: ..." subtitle */
  meetingTitle: string;
  /** Meeting date for the "From: ..." subtitle */
  meetingDate: string;
  /** Meeting UID — needed for attachment download APIs on upcoming meetings */
  meetingId: string;
  /** Past meeting UID — needed for past meeting APIs (null for upcoming meetings) */
  pastMeetingId: string | null;

  /** For source='link': the external URL */
  linkUrl?: string;
  /** For source='file': the attachment UID for download API */
  attachmentUid?: string;
  /** For source='recording': play URL from RecordingFile */
  playUrl?: string;
  /** For source='recording'|'transcript': download URL from RecordingFile */
  downloadUrl?: string;
  /** For source='recording': share URL from the largest RecordingSession */
  shareUrl?: string;
  /** For source='summary': data needed to open SummaryModal */
  summaryData?: {
    uid: string;
    content: string;
    approved: boolean;
  };
}

export interface DocumentAction {
  icon: string;
  tooltip: string;
}

/** View mode for the committee meetings tab. */
export type ViewMode = 'list' | 'calendar';

/** Time filter for the committee meetings tab. */
export type TimeFilter = 'upcoming' | 'past';

/** Dialog step for the Add Member search-first flow. */
export type DialogMode = 'search' | 'configure';

/**
 * A user with manage/audit access to a committee (writer or auditor).
 * Mirrors the CommitteeUser type from the upstream committee service.
 */
export interface CommitteeUser {
  username: string;
  email: string;
  name: string;
  avatar?: string;
}

// ── Committee Dialog Data/Result Interfaces ────────────────────────────────

export interface JoinApplicationDialogData {
  committeeName: string;
  mode: 'application' | 'invite_only';
}

export interface JoinApplicationDialogResult {
  message: string | undefined;
}

export interface MailingListPickerDialogData {
  mailingLists: GroupsIOMailingList[];
  associatedUids: Set<string>;
  projectUid: string;
}

export interface MailingListPickerDialogResult {
  selectedUids: Set<string>;
}

export interface DescriptionDialogData {
  mode: 'view' | 'edit';
  description: string;
}

export interface IcalSubscribeDialogData {
  feedUrl: string;
  name: string;
}

export interface EditChairsDialogData {
  members: { label: string; value: string }[];
  currentChairUid: string | null;
  currentViceChairUid: string | null;
}

export type CommitteeTab = 'overview' | 'members' | 'votes' | 'meetings' | 'surveys' | 'documents' | 'settings';

/** Configuration entry for a committee view tab. Visibility and badge are closures so each consumer can wire its own signals/state. */
export interface TabConfigEntry {
  key: CommitteeTab;
  label: string | (() => string);
  icon: string;
  visible: () => boolean;
  badge?: () => number | null;
}

/** Permission level for a committee member. */
export type CommitteePermissionLevel = 'manage' | 'review' | 'member';

/** A committee member's resolved roster permission, plus whether it was inherited rather than direct. */
export interface CommitteeMemberPermissionInfo {
  /** Resolved permission level shown on the roster. */
  level: CommitteePermissionLevel;
  /** True when `level` comes only from an inherited (project/foundation) grant, not a committee-scoped role. */
  inherited: boolean;
}

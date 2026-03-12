// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommitteeMemberVisibility } from '../enums/committee.enum';
import { CommitteeMemberVotingStatus } from '../enums/committee-member.enum';

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

// ── Join & Invite Types (Phase 1) ───────────────────────────────────────────

/**
 * How users can join this group.
 *  - open:        Anyone can self-join; no approval required.
 *  - invite-only: Members / admins send invite links; invitee clicks to accept.
 *  - apply:       User submits application; admin reviews and approves/rejects.
 *  - closed:      Only admins can add members (legacy behaviour).
 */
export type JoinMode = 'open' | 'invite-only' | 'apply' | 'closed';

/** Status of a member invite */
export type InviteStatus = 'pending' | 'accepted' | 'declined' | 'expired';

/**
 * A colleague-to-colleague or admin-to-user invitation to join a group.
 */
export interface GroupInvite {
  /** Unique invite ID */
  uid: string;
  /** Committee this invite is for */
  committee_uid: string;
  /** Email address of the invitee */
  invitee_email: string;
  /** Display name of the invitee (optional) */
  invitee_name?: string;
  /** UID of the user who sent the invite */
  invited_by_uid: string;
  /** Name of the person who sent the invite */
  invited_by_name?: string;
  /** Current status */
  status: InviteStatus;
  /** Optional personal message from inviter */
  message?: string;
  /** Role to assign on acceptance (default: 'Member') */
  suggested_role?: string;
  /** When the invite was created */
  created_at: string;
  /** When the invite expires (default: 14 days) */
  expires_at: string;
  /** When the invite was accepted / declined */
  responded_at?: string;
}

/**
 * Payload to create one or more invites.
 */
export interface CreateGroupInviteRequest {
  /** Email addresses to invite */
  emails: string[];
  /** Optional personal message included in the invite email */
  message?: string;
  /** Role to assign on acceptance */
  suggested_role?: string;
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

// ── Communication Channel Types ─────────────────────────────────────────────

/** Platform type for chat channels */
export type ChatPlatform = 'slack' | 'discord';

/**
 * A mailing list associated with a group (e.g., Groups.io, Google Groups).
 */
export interface GroupMailingList {
  /** Display name of the list (e.g., "tac-general") */
  name: string;
  /** Full URL to the mailing list archive or subscription page */
  url?: string;
  /** Number of subscribers (optional, for display) */
  subscriber_count?: number;
}

/**
 * A chat channel (Slack or Discord) associated with a group.
 */
export interface GroupChatChannel {
  /** Platform type */
  platform: ChatPlatform;
  /** Channel name (e.g., "#tac-general") */
  name: string;
  /** Direct link to the channel */
  url?: string;
}

/**
 * Committee leadership position (Chair, Co-Chair, etc.)
 * @description Represents a member in a leadership position within a committee
 */
/** Leadership role type for chair/co-chair assignment */
export type LeadershipRole = 'chair' | 'co_chair';

export interface CommitteeLeadership {
  /** Unique identifier for the leader (member UID) */
  uid: string;
  /** Leader's first name */
  first_name: string;
  /** Leader's last name */
  last_name: string;
  /** Leader's email address */
  email: string;
  /** Date when the leader was elected/appointed (ISO 8601 date string) */
  elected_date?: string;
  /** Organization the leader belongs to (may not be returned by all API versions) */
  organization?: string;
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
  website?: string;
  /** Whether committee membership requires review */
  requires_review?: boolean;
  /** Timestamp when committee was created */
  created_at: string;
  /** Timestamp when committee was last updated */
  updated_at: string;
  /** Total number of committee members */
  total_members: number;
  /** Total number of voting representatives */
  total_voting_reps: number;
  /** Associated project UID */
  project_uid: string;
  /** Associated project name (populated from project data) */
  project_name?: string;
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
  /** How users can join this group (default: 'closed') */
  join_mode?: JoinMode;

  // ── Communication Channels ──
  /** Mailing list associated with the group (e.g., Groups.io list) */
  mailing_list?: GroupMailingList;
  /** Chat channel associated with the group (Slack, Discord, etc.) */
  chat_channel?: GroupChatChannel;

  // ── Leadership ──
  /** Chair of the committee */
  chair?: CommitteeLeadership | null;
  /** Co-Chair of the committee */
  co_chair?: CommitteeLeadership | null;
}

/**
 * Committee with the current user's membership info
 * @description Extends Committee with the user's role and member UID for join/leave actions
 */
export interface MyCommittee extends Committee {
  /** User's role in this committee (e.g., "Chair", "Member", "Observer") */
  my_role: string;
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
  website?: string;
  /** Associated project UID */
  project_uid?: string;
  /** @deprecated Use join_mode instead */
  joinable?: boolean;
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
  /** Assign or remove chair */
  chair?: CommitteeLeadership | null;
  /** Assign or remove co-chair */
  co_chair?: CommitteeLeadership | null;
  /** Update or clear mailing list */
  mailing_list?: GroupMailingList | null;
  /** Update or clear chat channel */
  chat_channel?: GroupChatChannel | null;
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
}

// ── Committee Dashboard Data Types ──────────────────────────────────────────
// These interfaces describe data shapes for per-group-type dashboard cards.
// Fields reflect the current mock data; will align to real API shapes when
// the corresponding V2 endpoints are available.

/** Status of an open vote */
export type CommitteeVoteStatus = 'open' | 'closed' | 'cancelled';

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
export type CommitteeDocumentType = 'file' | 'link';

/**
 * A document or resource link associated with a committee.
 */
export interface CommitteeDocument {
  uid: string;
  type: CommitteeDocumentType;
  name: string;
  /** URL for links; download URL for files */
  url?: string;
  /** MIME type or file extension (files only) */
  mime_type?: string;
  /** File size in bytes (files only) */
  file_size?: number;
  /** ISO date string of last update */
  updated_at?: string;
  uploaded_by?: string;
}

// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  GroupsIOServiceStatus,
  GroupsIOServiceType,
  MailingListAudienceAccess,
  MailingListMemberDeliveryMode,
  MailingListMemberModStatus,
  MailingListMemberType,
  MailingListSyncMode,
  MailingListType,
  SyncApplyOutcome,
  SyncMemberType,
} from '../enums/mailing-list.enum';
import type { CommitteeReference } from './committee.interface';
import type { UserInfo } from './project.interface';

/**
 * Linked group reference for mailing lists
 * @description Represents a committee/group linked to a mailing list
 */
export interface LinkedGroup {
  /** Unique identifier for the group */
  uid: string;
  /** Display name of the group */
  name: string;
  /** Optional URL to the group page */
  url?: string;
}

/**
 * Groups.io service entity
 * @description Represents a Groups.io service that mailing lists are associated with
 */
export interface GroupsIOService {
  /** Unique service identifier */
  uid: string;
  /** Service type (primary, formation, shared) */
  type: GroupsIOServiceType;
  /** Domain for the service */
  domain: string;
  /** Groups.io group ID */
  group_id: number;
  /** Service status */
  status: GroupsIOServiceStatus;
  /** Global owners email addresses */
  global_owners: string[];
  /** Prefix for mailing lists */
  prefix: string;
  /** Associated project slug */
  project_slug: string;
  /** Associated project UID */
  project_uid: string;
  /** Groups.io URL */
  url: string;
  /** Groups.io group name */
  group_name: string;
  /** Whether the service is public */
  public: boolean;
  /** Associated project name */
  project_name: string;
  /** Parent primary service UID (for shared type services) */
  parent_service_uid?: string;
  /** Manager users who can edit/modify this resource */
  writers?: UserInfo[];
  /** Auditor users who can audit this resource */
  auditors?: UserInfo[];
  /** Whether the current user has write access (response-only, set by access check) */
  writer?: boolean;
  /** Creation timestamp */
  created_at: string;
  /** Last update timestamp */
  updated_at: string;
}

/**
 * Groups.io mailing list entity
 * @description Full mailing list data for dashboard display
 */
export interface GroupsIOMailingList {
  /** Unique mailing list identifier */
  uid: string;
  /** Groups.io group name (3-34 chars) */
  group_name: string;
  /** Parent service domain copied onto the indexed mailing list (may be absent on older records) */
  domain?: string;
  /** Whether the mailing list is publicly accessible */
  public: boolean;
  /** Origin: api, webhook, or mock */
  source: string;
  /** Mailing list type (announcement, discussion_moderated, discussion_open) */
  type: MailingListType;
  /** Controls who can discover and join this mailing list (public, approval_required, invite_only) */
  audience_access: MailingListAudienceAccess;
  /** Description of the mailing list purpose (11-500 chars) */
  description: string;
  /** Display title for the mailing list (5-100 chars) */
  title: string;
  /** Email subject prefix (optional) */
  subject_tag?: string;
  /** Parent service UID */
  service_uid: string;
  /** Associated project UID (inherited from parent service) */
  project_uid: string;
  /** Associated project name (inherited from parent service) */
  project_name: string;
  /** Associated project slug (inherited from parent service) */
  project_slug: string;
  /** Whether the project is a foundation (top-level entity) */
  is_foundation?: boolean;
  /** Parent project UID (for subprojects under a foundation) */
  parent_project_uid?: string;
  /** Audit timestamp (nullable) */
  last_reviewed_at?: string | null;
  /** Auditor user ID (nullable) */
  last_reviewed_by?: string | null;
  /** Manager users who can edit/modify this resource */
  writers?: UserInfo[];
  /** Auditor users who can audit this resource */
  auditors?: UserInfo[];
  /** Creation timestamp */
  created_at: string;
  /** Last update timestamp */
  updated_at: string;
  /** Linked committees with names and allowed voting statuses */
  committees?: CommitteeReference[];
  /** Parent service details (enriched from service lookup) */
  service?: GroupsIOService;
  /** Groups.io subgroup ID (nullable for legacy lists) */
  group_id?: number | null;
  /** Number of subscribers (read-only, maintained by service) */
  subscriber_count: number;
  /** Whether the current user has write access (response-only, set by access check) */
  writer?: boolean;
  /** Automatic membership sync direction with the linked committee. Only meaningful when committee_uid/committees is set. */
  sync_mode?: MailingListSyncMode;
}

/**
 * Mailing list with current user's membership details
 * @description Extended mailing list data including the user's subscription info for "me" lens views
 */
export interface MyMailingList extends GroupsIOMailingList {
  /** User's delivery mode in this mailing list (e.g., "Normal", "Digest", "None") */
  my_delivery_mode: MailingListMemberDeliveryMode;
  /** User's moderation status in this mailing list (e.g., "none", "moderator", "owner") */
  my_mod_status: MailingListMemberModStatus;
  /** User's member UID in this mailing list */
  my_member_uid?: string;
}

/**
 * Request payload for creating a new mailing list
 * @description Maps to Groups.io API create endpoint
 */
export interface CreateMailingListRequest {
  /** Subgroup name (3-34 chars) — maps to `name` in the upstream GroupsioSubgroupRequest API */
  name: string;
  /** Whether the mailing list is publicly accessible */
  public: boolean;
  /** Mailing list type */
  type: MailingListType;
  /** Controls who can discover and join this mailing list */
  audience_access: MailingListAudienceAccess;
  /** Description of the mailing list (11-500 chars) */
  description: string;
  /** Display title for the mailing list (5-100 chars) */
  title?: string;
  /** Parent service ID (required) — matches upstream GroupsioSubgroupRequest contract */
  service_id: string;
  /** Committee UID to associate (upstream accepts singular committee_uid) */
  committee_uid?: string | null;
  /** Linked committees with allowed voting statuses */
  committees?: CommitteeReference[];
  /** Automatic membership sync direction with the linked committee. Requires committee_uid to be set. */
  sync_mode?: MailingListSyncMode;
  /** Email subject prefix (optional) */
  subject_tag?: string;
  /** Manager users who can edit/modify this resource */
  writers?: UserInfo[];
  /** Auditor users who can audit this resource */
  auditors?: UserInfo[];
}

/**
 * Request payload for creating a Groups.io service
 * @description Used when creating a new Groups.io service
 */
export interface CreateGroupsIOServiceRequest {
  /** Service type */
  type: GroupsIOServiceType;
  /** Domain for the service */
  domain?: string;
  /** Prefix for mailing lists (optional) */
  prefix?: string;
  /** Associated project UID */
  project_uid: string;
  /** Groups.io group name */
  group_name?: string;
  /** Whether the service is publicly accessible */
  public?: boolean;
  /** Manager users who can edit/modify this resource */
  writers?: UserInfo[];
  /** Auditor users who can audit this resource */
  auditors?: UserInfo[];
}

/**
 * Request payload for updating a Groups.io service
 * @description Used when updating an existing Groups.io service
 */
export interface UpdateGroupsIOServiceRequest {
  /** Domain for the service (optional) */
  domain?: string;
  /** Prefix for mailing lists (optional) */
  prefix?: string;
  /** Whether the service is publicly accessible (optional) */
  public?: boolean;
  /** Service status (optional) */
  status?: string;
  /** Manager users who can edit/modify this resource */
  writers?: UserInfo[];
  /** Auditor users who can audit this resource */
  auditors?: UserInfo[];
}

/**
 * Mailing list member entity (Groups.io member)
 * @description Represents a member of a mailing list
 */
export interface MailingListMember {
  /** Unique member identifier */
  uid: string;
  /** Parent mailing list UID */
  mailing_list_uid: string;
  /** Groups.io member ID */
  member_id?: number;
  /** Groups.io group ID for this membership */
  group_id?: number;
  /** Member's username/handle */
  username?: string;
  /** Member's display name (combined first + last; returned by the API as `name`) */
  name?: string;
  /** Member's first name */
  first_name?: string;
  /** Member's last name */
  last_name?: string;
  /** Member's email address */
  email: string;
  /** Member's organization */
  organization?: string;
  /** Member's job title */
  job_title?: string;
  /** How member was added (committee or direct) */
  member_type: MailingListMemberType;
  /** Email delivery mode (Groups.io API values, e.g. email_delivery_single, email_delivery_digest, email_delivery_none) */
  delivery_mode: MailingListMemberDeliveryMode;
  /** Moderation status (none, moderator, owner) */
  mod_status: MailingListMemberModStatus;
  /** Member active status */
  status: string;
  /** Last review timestamp */
  last_reviewed_at?: string | null;
  /** User who last reviewed */
  last_reviewed_by?: string | null;
  /** Creation timestamp */
  created_at: string;
  /** Last update timestamp */
  updated_at: string;
}

/**
 * Upstream single-member GET response (`GroupsioMember`)
 * @description Carries `id` instead of the index document's `uid`, and no `mailing_list_uid` —
 * list membership must be verified against the query-service index instead
 */
export interface GroupsIOMemberResponse extends Omit<MailingListMember, 'uid' | 'mailing_list_uid'> {
  /** Unique member identifier */
  id: string;
}

/**
 * Request payload for creating a mailing list member
 * @description Input payload for adding members to mailing lists
 */
export interface CreateMailingListMemberRequest {
  /** Member's email address (required) */
  email: string;
  /** Member's display name — maps to `name` in the upstream GroupsioMemberRequest API */
  name?: string | null;
  /** Member's organization */
  organization?: string | null;
  /** Member's job title */
  job_title?: string | null;
  /** How member was added */
  member_type?: MailingListMemberType;
  /** Email delivery mode */
  delivery_mode?: MailingListMemberDeliveryMode;
  /** Moderation status */
  mod_status?: MailingListMemberModStatus;
}

/**
 * Request payload for updating a mailing list member
 * @description Partial update for existing members (email is immutable)
 */
export interface UpdateMailingListMemberRequest {
  /** Member's display name — maps to `name` in the upstream GroupsioMemberRequest API */
  name?: string | null;
  /** Member's organization */
  organization?: string | null;
  /** Member's job title */
  job_title?: string | null;
  /** Email delivery mode */
  delivery_mode?: MailingListMemberDeliveryMode;
  /** Moderation status */
  mod_status?: MailingListMemberModStatus;
}

/**
 * Outcome of one mailing list's `updateMailingList` call inside a committee's batched
 * link/unlink/direction-change save (#4026). `status` is only populated on failure — either the
 * HTTP error's status, or (for an activation skipped because its dependent slot-release failed)
 * the status copied from that release failure, so permission-denied detection still works for
 * skipped entries.
 */
export interface MailingListAssociationUpdateResult {
  uid: string;
  success: boolean;
  status?: number;
}

/** One linked group in the mailing list table, with its canonical group-details link. */
export interface MailingListGroupLink {
  uid: string;
  /** Group name; null when the linked group carries none. */
  name: string | null;
  /** Group-details link commands from the list's own project tier (`/foundation/...` vs `/project/...`); null when the group has no uid to open. */
  commands: string[] | null;
}

/**
 * Table row decorated with canonical view-link state (GH-1567); `viewCommands` already holds the
 * flat fallback, so the template never branches. Mirrors `CommitteeTableRowVm`.
 */
export interface MailingListTableRowVm extends GroupsIOMailingList {
  viewCommands: string[];
  /** The first few linked groups that can be opened, in the order the list carries them; the rest are summarised as "+N more". */
  groupLinks: MailingListGroupLink[];
  /** `?project=` for the view link — present only when the list carries a `project_slug`. */
  linkQueryParams: { project: string } | null;
  /** Public Groups.io page for the list, when derivable from its domain/service */
  groupsIoUrl: string | null;
  /** Me-lens subscription fields, present only when the row was sourced from `MyMailingList` */
  my_delivery_mode?: MailingListMemberDeliveryMode;
  my_mod_status?: MailingListMemberModStatus;
  my_member_uid?: string;
  /** Whether the current user is subscribed to this list (drives the Member badge outside the Me lens) */
  isMember: boolean;
  /** Whether the current user can self-join this list (public audience access, not already a member) */
  canJoin: boolean;
  /** Precomputed display label for the My Subscription column (avoids a template-bound lookup) */
  mySubscriptionLabel: string;
}

/**
 * A member proposed for addition by a sync-diff (either direction)
 * @description Mirrors the upstream `SyncDiffAdd` model
 */
export interface SyncDiffAdd {
  /** Member's email address */
  email: string;
  /** Source-side member identifier (committee member UID or mailing list member ID) */
  member_id: string;
  /** Which side of the sync this member originates from */
  member_type: SyncMemberType;
  /**
   * Display name from the source roster, carried through unchanged.
   * NOTE: this is NOT a fuzzy/name-match suggestion against the other side's roster — that
   * PCC-1604 parity gap is tracked separately and blocked on ITX; see linuxfoundation/lfx-self-serve#4364.
   */
  name?: string;
}

/**
 * A member proposed for removal by a sync-diff (either direction)
 * @description Mirrors the upstream `SyncDiffRemove` model
 */
export interface SyncDiffRemove {
  /** Member's email address */
  email: string;
  /** Source-side member identifier (committee member UID or mailing list member ID) */
  member_id: string;
  /** Which side of the sync this member originates from */
  member_type: SyncMemberType;
}

/**
 * A member present on both sides with mismatched emails — neither added nor removed automatically
 * @description Mirrors the upstream `SyncDiffConflict` model
 */
export interface SyncDiffConflict {
  /** Email on the committee side */
  committee_email: string;
  /** Email on the mailing list side */
  mailing_list_email: string;
  /** Display name, when available */
  name?: string;
}

/**
 * Preview of the pending changes between a committee's roster and its linked mailing list
 * @description Returned by `GET /groupsio/mailing-lists/{mailing_list_uid}/sync-diff`
 */
export interface SyncDiff {
  /** Mailing list UID this diff was computed for */
  mailing_list_id: string;
  /** Linked committee UID this diff was computed against */
  committee_uid: string;
  /** Sync direction/mode in effect when this diff was computed */
  sync_mode: MailingListSyncMode;
  /** Members proposed for addition */
  adds: SyncDiffAdd[];
  /** Members proposed for removal */
  removes: SyncDiffRemove[];
  /** Members present on both sides with mismatched emails, requiring manual resolution */
  conflicts: SyncDiffConflict[];
}

/**
 * Result of applying one proposed add during sync-apply
 * @description Mirrors the upstream `SyncApplyAddResult` model
 */
export interface SyncApplyAddResult {
  /** Member's email address */
  email: string;
  /** Source-side member identifier (committee member UID or mailing list member ID) */
  member_id: string;
  /** Which side of the sync this member originates from */
  member_type: SyncMemberType;
  /** What actually happened when this add was applied */
  outcome: SyncApplyOutcome;
  /**
   * Display name from the source roster, carried through unchanged — shown alongside an
   * `invited` outcome so the admin can see who the invite was sent for. NOT a fuzzy name-match
   * suggestion; see the `name` field doc on `SyncDiffAdd` and linuxfoundation/lfx-self-serve#4364.
   */
  name_hint?: string;
  /** Error detail when `outcome` is `failed` */
  error?: string;
}

/**
 * Result of applying one proposed removal during sync-apply
 * @description Mirrors the upstream `SyncApplyRemoveResult` model
 */
export interface SyncApplyRemoveResult {
  /** Member's email address */
  email: string;
  /** Source-side member identifier (committee member UID or mailing list member ID) */
  member_id: string;
  /** Which side of the sync this member originates from */
  member_type: SyncMemberType;
  /** What actually happened when this removal was applied */
  outcome: SyncApplyOutcome;
  /** Error detail when `outcome` is `failed` */
  error?: string;
}

/**
 * Outcome of applying a sync-diff
 * @description Returned by `POST /groupsio/mailing-lists/{mailing_list_uid}/sync-apply`
 */
export interface SyncApplyResult {
  /** Mailing list UID the apply was run against */
  mailing_list_id: string;
  /** Linked committee UID the apply was run against */
  committee_uid: string;
  /** Results of each applied addition */
  added: SyncApplyAddResult[];
  /** Results of each applied removal */
  removed: SyncApplyRemoveResult[];
}

/**
 * Request payload for sync-apply
 * @description The admin-approved subset of a `SyncDiff`'s adds/removes to actually apply.
 * `committee_uid` is rejected with a 409 Conflict if the mailing list is no longer linked to it
 * (guards against the committee being relinked between preview and apply).
 */
export interface SyncApplyRequest {
  /** Linked committee UID the diff was previewed against */
  committee_uid: string;
  /** Approved subset of the diff's proposed adds */
  adds: SyncDiffAdd[];
  /** Approved subset of the diff's proposed removes */
  removes: SyncDiffRemove[];
}

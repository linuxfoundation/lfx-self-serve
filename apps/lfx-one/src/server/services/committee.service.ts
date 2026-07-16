// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommitteeMemberRole } from '@lfx-one/shared/enums';
import {
  AcceptCommitteeInviteRequest,
  Committee,
  CommitteeCreateData,
  CommitteeDocument,
  CommitteeInvite,
  CommitteeJoinApplication,
  CommitteeMember,
  CommitteeSettingsData,
  CommitteeUpdateData,
  CommitteeUser,
  CreateCommitteeDocumentRequest,
  CreateCommitteeInviteRequest,
  CreateCommitteeJoinApplicationRequest,
  CreateCommitteeMemberRequest,
  GroupsIOMailingList,
  MyCommittee,
  PendingCommitteeInviteForOrg,
  PendingInvitation,
  Project,
  ProjectSettings,
  QueryServiceCountResponse,
  QueryServiceResponse,
  UploadCommitteeDocumentRequest,
} from '@lfx-one/shared/interfaces';
import { invitationRequiresOrganization } from '@lfx-one/shared/utils';
import { Request } from 'express';
import FormData from 'form-data';

import { ResourceNotFoundError } from '../errors';
import { pollEndpoint } from '../helpers/poll-endpoint.helper';
import { fetchAllQueryResources } from '../helpers/query-service.helper';
import { logger } from '../services/logger.service';
import { cleanUserDisplayName, getUsernameFromAuth } from '../utils/auth-helper';
import { AccessCheckService } from './access-check.service';
import { ETagService } from './etag.service';
import { MicroserviceProxyService } from './microservice-proxy.service';
import { ProjectService } from './project.service';

/** Upstream response shape for committee folders */
interface CommitteeFolder {
  uid: string;
  committee_uid?: string;
  name: string;
  created_by_uid?: string;
  /** LF username of the creator, auto-populated by upstream from the JWT. */
  created_by_username?: string;
  created_at?: string;
  updated_at?: string;
}

/** Upstream response shape for committee links */
interface CommitteeLink {
  uid: string;
  committee_uid?: string;
  name: string;
  url?: string;
  description?: string;
  folder_uid?: string;
  created_by_uid?: string;
  /** LF username of the creator, auto-populated by upstream from the JWT. */
  created_by_username?: string;
  created_at?: string;
  updated_at?: string;
}

/** Upstream response shape for committee document file uploads */
interface CommitteeDocumentUpstreamResponse {
  uid: string;
  name: string;
  file_name: string;
  file_size: number;
  content_type: string;
  description?: string;
  committee_uid?: string;
  created_at?: string;
  updated_at?: string;
  uploaded_by_username?: string;
}

/**
 * Query-service shape for an indexed `committee_document` resource. Files are not exposed
 * via a list endpoint upstream; they're discovered via the indexer (subject
 * `lfx.index.committee_document`).
 *
 * Per `CommitteeDocument.Tags()` in lfx-v2-committee-service, every committee_document
 * resource is indexed with the following tags:
 *   - the bare uid                          → `{uid}`
 *   - `committee_document_uid:{uid}`        — single-document lookup (returns at most 1)
 *   - `committee_uid:{committeeUID}`        — list all documents for a committee
 *   - `content_type:{contentType}`          — filter by MIME type
 *   - `uploaded_by:{uploadedByUsername}`    — filter by uploader
 *
 * Use `committee_uid:` for listing and `committee_document_uid:` for single-document lookups
 * to avoid scanning every file in the committee.
 */
interface CommitteeDocumentQueryResult {
  uid: string;
  name: string;
  file_name?: string;
  file_size?: number;
  content_type?: string;
  description?: string;
  committee_uid?: string;
  folder_uid?: string;
  created_at?: string;
  updated_at?: string;
  uploaded_by_username?: string;
}

/**
 * Service for handling committee business logic
 */
export class CommitteeService {
  private accessCheckService: AccessCheckService;
  private etagService: ETagService;
  private microserviceProxy: MicroserviceProxyService;
  private projectService: ProjectService;

  public constructor() {
    this.accessCheckService = new AccessCheckService();
    this.microserviceProxy = new MicroserviceProxyService();
    this.etagService = new ETagService();
    this.projectService = new ProjectService();
  }

  /**
   * Fetches all committees based on query parameters
   */
  public async getCommittees(req: Request, query: Record<string, any> = {}): Promise<Committee[]> {
    const queryFilters = { ...query };
    delete queryFilters['page_token'];
    delete queryFilters['page_size'];

    const params = {
      ...queryFilters,
      type: 'committee',
    };

    // For scoped requests (tags=project_uid:<uid> or parent=committee:<uid>), the
    // upstream query service has already enforced listing visibility — applying a
    // secondary access check here would silently drop listable committees from the
    // project dashboard or child-committee views. Click-time access is still enforced
    // by GET /committees/:id. Unscoped (cross-project) calls keep the access filter
    // so personal "my-relevant" listings remain scoped to public/writer/member
    // committees.
    const tags = query['tags'];
    const parent = query['parent'];
    const hasProjectUidTag =
      (typeof tags === 'string' && tags.split(',').some((t) => t.trim().startsWith('project_uid:'))) ||
      (Array.isArray(tags) && tags.some((t) => typeof t === 'string' && t.startsWith('project_uid:')));
    const hasScopedParent = typeof parent === 'string' && parent.startsWith('committee:');
    const isScopedListing = hasProjectUidTag || hasScopedParent;

    logger.debug(req, 'get_committees', 'Fetching committees', {
      is_scoped_listing: isScopedListing,
    });

    let committees = await fetchAllQueryResources<Committee>(req, (pageToken) =>
      this.microserviceProxy.proxyRequest<QueryServiceResponse<Committee>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
        ...params,
        ...(pageToken && { page_token: pageToken }),
      })
    );

    // Enrich with mailing-list presence via batched queries (OR-tag semantics, chunked at 100 UIDs).
    // total_members is already indexed by the committee-service as part of
    // CommitteeBaseWithReadonlyAttributes — no separate per-committee count call needed.
    const committeeUids = committees.map((c) => c.uid).filter(Boolean);
    const committeesWithMailingList = committeeUids.length > 0 ? await this.getCommitteesWithMailingList(req, committeeUids) : new Set<string>();

    committees = committees.map((committee) => ({
      ...committee,
      total_members: committee.total_members ?? 0,
      has_mailing_list: committeesWithMailingList.has(committee.uid),
    }));

    // Add writer access field (used by the access filter below and consumed by the UI)
    committees = await this.accessCheckService.addAccessToResources(req, committees, 'committee');

    if (!isScopedListing) {
      // Unscoped (cross-project) listings: scope to committees the caller can act on
      // (public, writer, or explicit member). This is an access filter, not a visibility
      // filter — the query service already controls listing visibility upstream. We keep
      // it here so personal "my-relevant" cross-project results stay focused.
      const myUids = await this.getMyCommitteeUids(req);
      const totalBefore = committees.length;

      committees = committees.filter((c) => c.public || c.writer === true || myUids.has(c.uid));

      if (committees.length < totalBefore) {
        logger.debug(req, 'get_committees', 'Filtered committees outside caller access scope', {
          filtered_out: totalBefore - committees.length,
          total: totalBefore,
        });
      }
    }

    return committees;
  }

  /**
   * Fetches the count of committees based on query parameters
   */
  public async getCommitteesCount(req: Request, query: Record<string, any> = {}): Promise<number> {
    const params = {
      ...query,
      type: 'committee',
    };

    const { count } = await this.microserviceProxy.proxyRequest<QueryServiceCountResponse>(req, 'LFX_V2_SERVICE', '/query/resources/count', 'GET', params);

    return count;
  }

  /**
   * Fetches a single committee by ID.
   *
   * @param options.includeMembership When true, enriches the response with the caller's
   *   `my_role` / `my_member_uid` resolved via a username-tagged membership query. Costs
   *   one or more extra `/query/resources` calls (typically one — paginates only if upstream
   *   returns >50 matching rows for the caller, which should be rare for a single committee),
   *   so default is `false`. Enable only on user-facing reads (e.g. the GET /committees/:id
   *   controller), not on internal validation reads (member CRUD, meeting fan-out) where
   *   the caller-membership fields are unused.
   * @param options.includeProjectMetadata When true, enriches the response with `project_name`,
   *   `project_slug`, `is_foundation`, and `parent_project_uid` via
   *   `ProjectService.enrichWithProjectData`. Costs one extra upstream project fetch
   *   (de-duplicated/batched), so default is `false`. Enable only on user-facing reads
   *   that need slug-based navigation (e.g. the GET /committees/:id controller for the
   *   detail page's Parent Project link). Internal callers (existence checks, meeting
   *   fan-out, member CRUD) should leave this off — they don't use these fields.
   * @param options.includeInheritedPermissions When true, enriches the response with
   *   `inherited_writers` / `inherited_auditors` — the manage/review grants the committee
   *   inherits from its project/foundation ancestry, so the members roster can label
   *   inherited managers correctly (see LFXV2-2059). Walks the project ancestry (up to
   *   `MAX_DEPTH` levels) making two parallel upstream reads per level — 2-4 calls for the
   *   typical 1-2-level hierarchy. Best-effort (a level the caller can't read contributes
   *   nothing and never blocks the fetch), so default is `false`. Enable only on the
   *   user-facing detail read (GET /committees/:id).
   */
  public async getCommitteeById(
    req: Request,
    committeeId: string,
    options: {
      includeMembership?: boolean;
      includeProjectMetadata?: boolean;
      includeInheritedPermissions?: boolean;
      /** When true, a settings-service failure throws instead of silently returning {}. Use on
       *  write paths (e.g. accept invite) where an unknown business_email_required must not
       *  be treated as false (fail-closed). */
      throwOnSettingsError?: boolean;
    } = {}
  ): Promise<Committee> {
    const committee = await this.microserviceProxy.proxyRequest<Committee>(req, 'LFX_V2_SERVICE', `/committees/${committeeId}`, 'GET');

    if (!committee) {
      throw new ResourceNotFoundError('Committee', committeeId, {
        operation: 'get_committee_by_id',
        service: 'committee_service',
        path: `/committees/${committeeId}`,
      });
    }

    // Fetch settings, optional caller membership, access, and optional inherited
    // (parent-project) permissions in parallel.
    const [settings, membership, withAccess, inheritedPermissions] = await Promise.all([
      this.getCommitteeSettings(req, committeeId, { throwOnError: options.throwOnSettingsError }),
      options.includeMembership ? this.getCallerMembership(req, committeeId) : Promise.resolve(null),
      this.accessCheckService.addAccessToResource(req, committee, 'committee'),
      options.includeInheritedPermissions ? this.getInheritedPermissions(req, committee.project_uid) : Promise.resolve(null),
    ]);

    const merged = {
      ...withAccess,
      ...settings,
      ...(membership && { my_role: membership.role, my_member_uid: membership.member_uid }),
      ...(inheritedPermissions && { inherited_writers: inheritedPermissions.writers, inherited_auditors: inheritedPermissions.auditors }),
    };

    if (!options.includeProjectMetadata) {
      return merged;
    }

    // Enrich with project metadata so the UI can resolve project_uid -> project_slug for navigation.
    const [enriched] = await this.projectService.enrichWithProjectData(req, [merged]);
    return enriched;
  }

  /**
   * Creates a new committee with optional settings
   */
  public async createCommittee(req: Request, data: CommitteeCreateData): Promise<Committee> {
    // Extract settings fields
    const { business_email_required, is_audit_enabled, show_meeting_attendees, member_visibility, ...committeeData } = data;

    // Step 1: Create committee
    const newCommittee = await this.microserviceProxy.proxyRequest<Committee>(req, 'LFX_V2_SERVICE', '/committees', 'POST', {}, committeeData);

    // Step 2: Update settings if provided
    if (business_email_required !== undefined || is_audit_enabled !== undefined || show_meeting_attendees !== undefined || member_visibility !== undefined) {
      try {
        await this.updateCommitteeSettings(req, newCommittee.uid, { business_email_required, is_audit_enabled, show_meeting_attendees, member_visibility });
      } catch {
        logger.warning(req, 'create_committee_settings', 'Failed to update committee settings, but committee was created successfully', {
          committee_uid: newCommittee.uid,
        });
      }
    }

    return {
      ...newCommittee,
      ...(business_email_required !== undefined && { business_email_required }),
      ...(is_audit_enabled !== undefined && { is_audit_enabled }),
      ...(show_meeting_attendees !== undefined && { show_meeting_attendees }),
      ...(member_visibility !== undefined && { member_visibility }),
    };
  }

  /**
   * Updates an existing committee using ETag for concurrency control
   */
  public async updateCommittee(req: Request, committeeId: string, data: CommitteeUpdateData): Promise<Committee> {
    // Extract settings fields — writers/auditors belong to UpdateCommitteeSettingsRequestBody,
    // NOT UpdateCommitteeBaseRequestBody, so they must go through the settings endpoint
    const { business_email_required, is_audit_enabled, show_meeting_attendees, member_visibility, writers, auditors, ...committeeData } = data;

    const hasSettingsUpdate =
      business_email_required !== undefined ||
      is_audit_enabled !== undefined ||
      show_meeting_attendees !== undefined ||
      member_visibility !== undefined ||
      writers !== undefined ||
      auditors !== undefined;
    const hasCoreUpdate = Object.keys(committeeData).length > 0;

    let updatedCommittee: Committee;

    if (hasCoreUpdate) {
      // Step 1: Fetch committee with ETag
      const { data: currentCommittee, etag } = await this.etagService.fetchWithETag<Committee>(
        req,
        'LFX_V2_SERVICE',
        `/committees/${committeeId}`,
        'update_committee'
      );

      // Step 2: Strip read-only and computed fields, then merge with update data (PUT replaces the entire resource)
      /* eslint-disable @typescript-eslint/no-unused-vars -- intentional destructuring to strip server-computed fields */
      const {
        uid: _uid,
        created_at: _createdAt,
        updated_at: _updatedAt,
        total_members: _totalMembers,
        total_voting_repos: _totalVotingRepos,
        writer: _writer,
        project_name: _projectName,
        foundation_name: _foundationName,
        writers: _writers,
        auditors: _auditors,
        ...mutableFields
      } = currentCommittee;
      /* eslint-enable @typescript-eslint/no-unused-vars */

      const mergedData = {
        ...mutableFields,
        ...committeeData,
      };

      // Step 3: Update committee with ETag (PUT)
      updatedCommittee = await this.etagService.updateWithETag<Committee>(
        req,
        'LFX_V2_SERVICE',
        `/committees/${committeeId}`,
        etag,
        mergedData,
        'update_committee'
      );
    } else {
      // No core fields to update — fetch current committee for the response
      updatedCommittee = await this.microserviceProxy.proxyRequest<Committee>(req, 'LFX_V2_SERVICE', `/committees/${committeeId}`, 'GET');
    }

    // Step 3: Update settings if provided — propagate errors so callers aren't misled
    // (unlike the create path, there's no partial-success story here: if settings fail,
    // the response should not echo writers/auditors as if they were persisted)
    if (hasSettingsUpdate) {
      await this.updateCommitteeSettings(req, committeeId, {
        business_email_required,
        is_audit_enabled,
        show_meeting_attendees,
        member_visibility,
        writers,
        auditors,
      });
    }

    return {
      ...updatedCommittee,
      ...(business_email_required !== undefined && { business_email_required }),
      ...(is_audit_enabled !== undefined && { is_audit_enabled }),
      ...(show_meeting_attendees !== undefined && { show_meeting_attendees }),
      ...(member_visibility !== undefined && { member_visibility }),
      ...(writers !== undefined && { writers }),
      ...(auditors !== undefined && { auditors }),
      // Workaround: upstream committee-service PUT does not include mailing_list in the response body
      // (verified 2026-03-29). Prefer the upstream value if present; fall back to the request payload.
      // TODO: Remove this workaround once upstream echoes mailing_list in PUT responses.
      ...(committeeData.mailing_list !== undefined && { mailing_list: updatedCommittee.mailing_list ?? committeeData.mailing_list }),
    };
  }

  /**
   * Deletes a committee using ETag for concurrency control
   */
  public async deleteCommittee(req: Request, committeeId: string): Promise<void> {
    // Step 1: Fetch committee with ETag
    const { etag } = await this.etagService.fetchWithETag<Committee>(req, 'LFX_V2_SERVICE', `/committees/${committeeId}`, 'delete_committee');

    // Step 2: Delete committee with ETag
    await this.etagService.deleteWithETag(req, 'LFX_V2_SERVICE', `/committees/${committeeId}`, etag, 'delete_committee');
  }

  /**
   * Fetches all members for a specific committee
   */
  public async getCommitteeMembers(req: Request, committeeId: string, query: Record<string, any> = {}): Promise<CommitteeMember[]> {
    const queryFilters = { ...query };
    delete queryFilters['page_token'];
    delete queryFilters['page_size'];

    const params = {
      ...queryFilters,
      type: 'committee_member',
      tags: `committee_uid:${committeeId}`,
    };

    return fetchAllQueryResources<CommitteeMember>(req, (pageToken) =>
      this.microserviceProxy.proxyRequest<QueryServiceResponse<CommitteeMember>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
        ...params,
        ...(pageToken && { page_token: pageToken }),
      })
    );
  }

  /**
   * Fetches a single committee member by ID
   */
  public async getCommitteeMemberById(req: Request, committeeId: string, memberId: string): Promise<CommitteeMember> {
    const member = await this.microserviceProxy.proxyRequest<CommitteeMember>(req, 'LFX_V2_SERVICE', `/committees/${committeeId}/members/${memberId}`, 'GET');

    if (!member) {
      throw new ResourceNotFoundError('Committee member', memberId, {
        operation: 'get_committee_member_by_id',
        service: 'committee_service',
        path: `/committees/${committeeId}/members/${memberId}`,
      });
    }

    return member;
  }

  /**
   * Creates a new committee member
   */
  public async createCommitteeMember(req: Request, committeeId: string, data: CreateCommitteeMemberRequest): Promise<CommitteeMember> {
    const newMember = await this.microserviceProxy.proxyRequest<CommitteeMember>(req, 'LFX_V2_SERVICE', `/committees/${committeeId}/members`, 'POST', {}, data);

    logger.debug(req, 'create_committee_member', 'Committee member created successfully', {
      committee_uid: committeeId,
      member_uid: newMember.uid,
    });

    return newMember;
  }

  /**
   * Updates an existing committee member using ETag for concurrency control
   */
  public async updateCommitteeMember(
    req: Request,
    committeeId: string,
    memberId: string,
    data: Partial<CreateCommitteeMemberRequest>
  ): Promise<CommitteeMember> {
    // Validate committee exists first
    await this.getCommitteeById(req, committeeId);

    // Step 1: Fetch current member with ETag
    const { data: currentMember, etag } = await this.etagService.fetchWithETag<CommitteeMember>(
      req,
      'LFX_V2_SERVICE',
      `/committees/${committeeId}/members/${memberId}`,
      'update_committee_member'
    );

    // Step 2: Strip read-only fields, then merge with update data (PUT requires full resource)
    /* eslint-disable @typescript-eslint/no-unused-vars -- intentional destructuring to strip server-computed fields */
    const {
      uid: _uid,
      created_at: _createdAt,
      updated_at: _updatedAt,
      committee_uid: _committeeUid,
      committee_name: _committeeName,
      committee_category: _committeeCategory,
      ...mutableMemberFields
    } = currentMember;
    /* eslint-enable @typescript-eslint/no-unused-vars */

    const mergedData = { ...mutableMemberFields, ...data };

    // Step 3: Update member with ETag
    const updatedMember = await this.etagService.updateWithETag<CommitteeMember>(
      req,
      'LFX_V2_SERVICE',
      `/committees/${committeeId}/members/${memberId}`,
      etag,
      mergedData,
      'update_committee_member'
    );

    logger.debug(req, 'update_committee_member', 'Committee member updated successfully', {
      committee_uid: committeeId,
      member_uid: memberId,
    });

    return updatedMember;
  }

  /**
   * Deletes a committee member using ETag for concurrency control
   */
  public async deleteCommitteeMember(req: Request, committeeId: string, memberId: string): Promise<void> {
    // Validate committee exists first
    await this.getCommitteeById(req, committeeId);

    // Step 1: Fetch member with ETag
    const { etag } = await this.etagService.fetchWithETag<CommitteeMember>(
      req,
      'LFX_V2_SERVICE',
      `/committees/${committeeId}/members/${memberId}`,
      'delete_committee_member'
    );

    // Step 2: Delete member with ETag
    await this.etagService.deleteWithETag(req, 'LFX_V2_SERVICE', `/committees/${committeeId}/members/${memberId}`, etag, 'delete_committee_member');

    logger.debug(req, 'delete_committee_member', 'Committee member deleted successfully', {
      committee_uid: committeeId,
      member_uid: memberId,
    });
  }

  // ── Committee Invites ───────────────────────────────────────────────────
  // Invite-by-email is the add-member primitive for people who may not yet have
  // an LF account. Pending/resolved invites are read from the query index
  // (committee_invite resource); create/revoke go through the committee-service.

  /**
   * Fetches all invites for a committee from the query index. Callers filter by
   * status (e.g. pending) client-side; the roster only surfaces pending ones.
   */
  public async getCommitteeInvites(req: Request, committeeId: string, query: Record<string, any> = {}): Promise<CommitteeInvite[]> {
    const queryFilters = { ...query };
    delete queryFilters['page_token'];
    delete queryFilters['page_size'];

    const params = {
      ...queryFilters,
      type: 'committee_invite',
      tags: `committee_uid:${committeeId}`,
    };

    return fetchAllQueryResources<CommitteeInvite>(req, (pageToken) =>
      this.microserviceProxy.proxyRequest<QueryServiceResponse<CommitteeInvite>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
        ...params,
        ...(pageToken && { page_token: pageToken }),
      })
    );
  }

  /**
   * Creates a single committee invite. The committee-service has no bulk endpoint,
   * so bulk invite is the frontend fanning out one call per email.
   */
  public async createCommitteeInvite(req: Request, committeeId: string, data: CreateCommitteeInviteRequest): Promise<CommitteeInvite> {
    const invite = await this.microserviceProxy.proxyRequest<CommitteeInvite>(req, 'LFX_V2_SERVICE', `/committees/${committeeId}/invites`, 'POST', {}, data);

    logger.debug(req, 'create_committee_invite', 'Committee invite created successfully', {
      committee_uid: committeeId,
      invite_uid: invite.uid,
    });

    return invite;
  }

  /**
   * Revokes a pending committee invite. The upstream revoke-invite endpoint is a
   * plain DELETE (no ETag concurrency control).
   */
  public async revokeCommitteeInvite(req: Request, committeeId: string, inviteId: string): Promise<void> {
    await this.microserviceProxy.proxyRequest<void>(req, 'LFX_V2_SERVICE', `/committees/${committeeId}/invites/${inviteId}`, 'DELETE');

    logger.debug(req, 'revoke_committee_invite', 'Committee invite revoked successfully', {
      committee_uid: committeeId,
      invite_uid: inviteId,
    });
  }

  // ── My Pending Invitations (invitee-facing) ───────────────────────────────
  // The invitee side of invite-by-email: surface the committee_invite resources
  // addressed to the current user's email, enriched with committee/project display
  // context for the dashboard and My Groups. Accept/decline are invitee-authenticated
  // committee-service calls (upstream enforces principal == invitee_email).

  /**
   * Returns the current user's pending committee invitations, enriched for display.
   *
   * Reads `committee_invite` resources tagged with the user's email from the query
   * index, filters to `status === 'pending'` client-side, then batch-enriches the
   * distinct committees (name, category) and their projects (project_name) so each
   * row can render without further round-trips. Enrichment is best-effort: if a
   * committee/project lookup fails, the row is still returned with `committee_name`
   * falling back to the committee UID — the list is never dropped wholesale.
   *
   * `inviter_name` / `expires_at` are left undefined — the committee-service contract
   * does not provide them today.
   */
  public async getMyPendingInvitations(req: Request, email: string): Promise<PendingInvitation[]> {
    const pendingInvites = await this.fetchPendingCommitteeInvitesByEmail(req, email);
    if (pendingInvites.length === 0) {
      return [];
    }

    logger.info(req, 'get_my_pending_invitations', 'Found pending invitations, enriching with committee data', {
      pending_count: pendingInvites.length,
    });

    // Enrich committee context (category, project_name) for the distinct committees once.
    // committee_name and organization_required are sourced directly from the invite itself
    // (committee-service ≥ v1.1) so no committee/settings fetch is required to decide org
    // requirement — those endpoints fail the access check for invitees who are not yet viewers.
    // Best-effort: a failed lookup degrades gracefully; category/project_name become null.
    const committeeUids = Array.from(new Set(pendingInvites.map((invite) => invite.committee_uid).filter(Boolean)));
    const committeeContext = new Map<
      string,
      {
        committee_name: string;
        category?: string | null;
        project_name?: string | null;
      }
    >();

    try {
      const committees = await this.getCommitteesByIds(req, committeeUids);
      const enriched = await this.projectService.enrichWithProjectData(req, Array.from(committees.values()));
      const projectNameByCommittee = new Map(enriched.map((committee) => [committee.uid, committee.project_name]));

      for (const uid of committeeUids) {
        const committee = committees.get(uid);
        if (committee) {
          committeeContext.set(uid, {
            committee_name: committee.name || uid,
            category: committee.category ?? null,
            project_name: projectNameByCommittee.get(uid) || null,
          });
        }
      }
    } catch (error) {
      logger.warning(req, 'get_my_pending_invitations', 'Committee enrichment failed, returning invitations with UID fallback', {
        committee_count: committeeUids.length,
        err: error,
      });
    }

    return pendingInvites.map((invite) => {
      const context = committeeContext.get(invite.committee_uid);
      // Prefer the invite's own committee_name (access-safe, set at invite-creation time),
      // fall back to the enriched committee resource name, then the UID.
      const committeeName = invite.committee_name?.trim() || context?.committee_name || invite.committee_uid;
      return {
        uid: invite.uid,
        committee_uid: invite.committee_uid,
        committee_name: committeeName,
        project_name: context?.project_name ?? null,
        category: context?.category ?? null,
        role: invite.role ?? null,
        invitee_email: invite.invitee_email,
        status: invite.status,
        created_at: invite.created_at,
        organization: invite.organization ?? null,
        organization_required: invite.organization_required ?? null,
        // inviter_name / expires_at are intentionally omitted (left undefined) — they're reserved
        // optional fields not in the committee-service contract yet, so JSON drops them rather than
        // sending an explicit null that consumers would have to disambiguate from "set".
      } satisfies PendingInvitation;
    });
  }

  /**
   * Legacy path for LFID invite JWTs that pre-date the {@link committee_invite_uid} claim.
   * Searches pending committee_invites by email, selects the one(s) matching
   * {@link params.resourceUid} (the committee UID from the JWT), and auto-accepts them.
   *
   * Returns `undefined` when no matching invite is visible yet — the FGA invitee tuple may
   * still be propagating; the caller should wait and retry. Returns `null` when acceptance
   * completed successfully. Returns {@link PendingCommitteeInviteForOrg} when the invite
   * requires an organization that was not pre-filled — the client must collect it.
   */
  public async acceptPendingCommitteeInvitesAfterLfidAccept(
    req: Request,
    params: { invitedEmail: string; resourceUid: string }
  ): Promise<PendingCommitteeInviteForOrg | null | undefined> {
    const pendingInvites = await this.fetchPendingCommitteeInvitesByEmail(req, params.invitedEmail);
    if (pendingInvites.length === 0) {
      logger.debug(req, 'accept_invite', 'No pending committee invitations to auto-accept after LFID invite');
      return undefined;
    }

    const toAccept = this.selectCommitteeInvitesForLfidAccept(pendingInvites, params.resourceUid);
    if (toAccept.length === 0) {
      logger.warning(req, 'accept_invite', 'Pending committee invitations found but none matched the committee UID — will retry', {
        pending_count: pendingInvites.length,
        resource_uid: params.resourceUid,
      });
      return undefined;
    }

    logger.info(req, 'accept_invite', 'Auto-accepting committee invitations after LFID invite (legacy path)', {
      accept_count: toAccept.length,
      resource_uid: params.resourceUid,
    });

    let pendingForOrg: PendingCommitteeInviteForOrg | null = null;

    for (const invite of toAccept) {
      try {
        // organization_required is carried on the invite itself (committee-service ≥ v1.1) so no
        // committee/settings fetch is needed — those fail the access check for non-viewer invitees.
        // Fail-closed when the field is absent: treat as org-required so we skip rather than
        // auto-accept without the required organization.
        const requiresOrganization = invitationRequiresOrganization({ organization_required: invite.organization_required });

        if (requiresOrganization) {
          const orgName = invite.organization?.name?.trim() || null;
          if (!orgName) {
            if (!pendingForOrg) {
              logger.info(req, 'accept_invite', 'Committee invite requires organization — returning to client for manual org collection', {
                committee_uid: invite.committee_uid,
                invite_uid: invite.uid,
              });
              pendingForOrg = {
                committee_uid: invite.committee_uid,
                invite_uid: invite.uid,
                committee_name: invite.committee_name?.trim() || invite.committee_uid,
                organization: invite.organization ?? null,
              };
            }
            continue;
          }
          const orgPayload = {
            name: orgName,
            id: invite.organization?.id?.trim() || null,
            website: invite.organization?.website?.trim() || null,
          };
          await this.acceptCommitteeInvite(req, invite.committee_uid, invite.uid, { organization: orgPayload });
        } else {
          await this.acceptCommitteeInvite(req, invite.committee_uid, invite.uid);
        }
      } catch (error) {
        logger.warning(req, 'accept_invite', 'Failed to auto-accept committee invitation after LFID invite', {
          committee_uid: invite.committee_uid,
          invite_uid: invite.uid,
          err: error,
        });
        throw error;
      }
    }

    if (pendingForOrg) {
      return pendingForOrg;
    }
    return null;
  }

  /**
   * Accepts a committee invitation on behalf of the invitee. The upstream endpoint is
   * invitee-authenticated (committee-service enforces principal == invitee_email).
   */
  public async acceptCommitteeInvite(req: Request, committeeId: string, inviteId: string, body?: AcceptCommitteeInviteRequest): Promise<void> {
    await this.microserviceProxy.proxyRequest<void>(req, 'LFX_V2_SERVICE', `/committees/${committeeId}/invites/${inviteId}/accept`, 'POST', {}, body ?? {});

    logger.debug(req, 'accept_committee_invite', 'Committee invite accepted successfully', {
      committee_uid: committeeId,
      invite_uid: inviteId,
    });
  }

  /**
   * Declines a committee invitation on behalf of the invitee. The upstream endpoint is
   * invitee-authenticated (committee-service enforces principal == invitee_email).
   */
  public async declineCommitteeInvite(req: Request, committeeId: string, inviteId: string): Promise<void> {
    await this.microserviceProxy.proxyRequest<void>(req, 'LFX_V2_SERVICE', `/committees/${committeeId}/invites/${inviteId}/decline`, 'POST');

    logger.debug(req, 'decline_committee_invite', 'Committee invite declined successfully', {
      committee_uid: committeeId,
      invite_uid: inviteId,
    });
  }

  /**
   * Returns the specific pending committee invite for {@link email} that matches
   * {@link committeeUid} + {@link inviteUid}, or `null` when not found.
   *
   * Uses the email-scoped query index — accessible to the invitee regardless of whether they
   * are a committee viewer — so this is safe to call before the invite is accepted.
   */
  public async getPendingInviteForUser(req: Request, email: string, committeeUid: string, inviteUid: string): Promise<CommitteeInvite | null> {
    const pending = await this.fetchPendingCommitteeInvitesByEmail(req, email);
    return pending.find((invite) => invite.committee_uid === committeeUid && invite.uid === inviteUid) ?? null;
  }

  // ── Persona Helper ──────────────────────────────────────────────────────

  public async getCommitteeMembersByCategory(req: Request, username: string, userEmail: string, category: string): Promise<CommitteeMember[]> {
    const params = {
      type: 'committee_member',
      tags_all: [`username:${username}`, `committee_category:${category}`],
    };

    const userMemberships = await fetchAllQueryResources<CommitteeMember>(req, (pageToken) =>
      this.microserviceProxy.proxyRequest<QueryServiceResponse<CommitteeMember>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
        ...params,
        ...(pageToken && { page_token: pageToken }),
      })
    );

    logger.debug(req, 'get_committee_members_by_category', 'Committee memberships retrieved', {
      username,
      category,
      memberships_count: userMemberships.length,
    });

    return userMemberships;
  }

  // ── My Committees ─────────────────────────────────────────────────────────

  /**
   * Returns the set of committee UIDs the current user is a member of.
   *
   * Lightweight alternative to {@link getMyCommittees} for callers that only need
   * membership UIDs (e.g. cross-project access filtering). Skips the per-committee
   * count and project enrichment fan-out performed by the full method.
   */
  public async getMyCommitteeUids(req: Request, projectUid?: string): Promise<Set<string>> {
    const username = await getUsernameFromAuth(req);
    if (!username) {
      return new Set();
    }

    const tagsAll = [`username:${username}`];
    if (projectUid) {
      tagsAll.push(`project_uid:${projectUid}`);
    }

    const memberships = await fetchAllQueryResources<CommitteeMember>(req, (pageToken) =>
      this.microserviceProxy.proxyRequest<QueryServiceResponse<CommitteeMember>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
        type: 'committee_member',
        tags_all: tagsAll,
        ...(pageToken && { page_token: pageToken }),
      })
    );

    return new Set(memberships.map((m) => m.committee_uid).filter((uid): uid is string => Boolean(uid)));
  }

  public async getMyCommittees(req: Request, projectUid?: string, foundationUid?: string): Promise<MyCommittee[]> {
    const username = await getUsernameFromAuth(req);
    if (!username) {
      return [];
    }

    // Fetch all committee_member records for the current user (paginated)
    // When projectUid is provided (e.g. document service), scope the query for efficiency
    const tagsAll = [`username:${username}`];
    if (projectUid) {
      tagsAll.push(`project_uid:${projectUid}`);
    }

    const memberships = await fetchAllQueryResources<CommitteeMember>(req, (pageToken) =>
      this.microserviceProxy.proxyRequest<QueryServiceResponse<CommitteeMember>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
        type: 'committee_member',
        tags_all: tagsAll,
        ...(pageToken && { page_token: pageToken }),
      })
    );

    if (memberships.length === 0) {
      return [];
    }

    logger.debug(req, 'get_my_committees', 'Found user memberships', {
      username,
      membership_count: memberships.length,
    });

    const membershipsByCommittee = new Map<string, CommitteeMember[]>();
    for (const m of memberships) {
      if (!m.committee_uid) continue;
      const bucket = membershipsByCommittee.get(m.committee_uid);
      if (bucket) {
        bucket.push(m);
      } else {
        membershipsByCommittee.set(m.committee_uid, [m]);
      }
    }

    const membershipMap = new Map<string, { role: CommitteeMemberRole | 'Member'; member_uid: string; committee_category?: string }>();
    for (const [committeeUid, rows] of membershipsByCommittee) {
      if (rows.length > 1) {
        logger.warning(req, 'get_my_committees', 'Multiple membership rows for (username, committee_uid); picking highest-privilege role', {
          committee_uid: committeeUid,
          row_count: rows.length,
        });
      }
      const best = this.pickBestMembership(rows);
      if (!best) continue;
      const roleName = best.role?.name;
      membershipMap.set(committeeUid, {
        role: !roleName || roleName === CommitteeMemberRole.NONE ? 'Member' : roleName,
        member_uid: best.uid,
        committee_category: best.committee_category,
      });
    }

    // Batch-fetch committee resources from the query service in one or more batched requests
    // (chunked at 100 UIDs per request by getCommitteesByIds). Avoids the N-way upstream
    // fan-out to GET /committees/:uid, which has been observed to 404 on memberships
    // indexed by the query service.
    const committeeUids = Array.from(membershipMap.keys());
    const committees = await this.getCommitteesByIds(req, committeeUids);

    // Batch check mailing-list presence for all committee UIDs in one query instead of N
    // per-committee count calls. total_members is already indexed by the committee-service.
    const committeesWithMailingList = committeeUids.length > 0 ? await this.getCommitteesWithMailingList(req, committeeUids) : new Set<string>();

    // Enrich each committee with membership metadata; counts come from the indexed resource
    const enriched = committeeUids.map((uid) => {
      const committee = committees.get(uid);
      if (!committee) {
        logger.warning(req, 'get_my_committees', 'Committee not found in query service, skipping', {
          committee_uid: uid,
        });
        return null;
      }
      const membership = membershipMap.get(uid)!;
      return {
        ...committee,
        category: committee.category || membership.committee_category || '',
        total_members: committee.total_members ?? 0,
        has_mailing_list: committeesWithMailingList.has(uid),
        my_role: membership.role,
        my_member_uid: membership.member_uid,
      } as MyCommittee;
    });

    let result = enriched.filter((c): c is MyCommittee => c !== null);

    // Filter by project or foundation if specified (used by document service)
    if (projectUid) {
      result = result.filter((c) => c.project_uid === projectUid);
    } else if (foundationUid) {
      const uids = await this.projectService.getFoundationProjectUids(req, foundationUid);
      const uidSet = new Set(uids);
      result = result.filter((c) => uidSet.has(c.project_uid));
    }

    // Enrich with project data (name, slug, is_foundation, parent_project_uid)
    return this.projectService.enrichWithProjectData(req, result);
  }

  // ── Join / Leave Methods ────────────────────────────────────────────────────

  public async joinCommittee(req: Request, committeeId: string): Promise<CommitteeMember> {
    return this.microserviceProxy.proxyRequest<CommitteeMember>(req, 'LFX_V2_SERVICE', `/committees/${committeeId}/join`, 'POST');
  }

  public async leaveCommittee(req: Request, committeeId: string): Promise<void> {
    await this.microserviceProxy.proxyRequest(req, 'LFX_V2_SERVICE', `/committees/${committeeId}/leave`, 'DELETE');
  }

  /**
   * Submits a join application for a committee with join_mode 'application'.
   */
  public async submitApplication(req: Request, committeeId: string, body: CreateCommitteeJoinApplicationRequest): Promise<CommitteeJoinApplication> {
    logger.debug(req, 'submit_committee_application', 'Submitting join application', { committee_uid: committeeId });
    return this.microserviceProxy.proxyRequest<CommitteeJoinApplication>(req, 'LFX_V2_SERVICE', `/committees/${committeeId}/applications`, 'POST', {}, body);
  }

  // ── Committee Documents ────────────────────────────────────────────────────

  public async getCommitteeDocuments(req: Request, committeeId: string): Promise<CommitteeDocument[]> {
    logger.debug(req, 'get_committee_documents', 'Fetching committee folders, links, and files', {
      committee_uid: committeeId,
    });

    // No upstream LIST endpoint for files — query the indexer by `committee_uid` tag.
    const [folders, links, files] = await Promise.all([
      this.microserviceProxy.proxyRequest<CommitteeFolder[]>(req, 'LFX_V2_SERVICE', `/committees/${committeeId}/folders`, 'GET').catch((err) => {
        logger.warning(req, 'get_committee_documents', 'Failed to fetch committee folders, returning empty list', {
          committee_uid: committeeId,
          err,
        });
        return [] as CommitteeFolder[];
      }),
      this.microserviceProxy.proxyRequest<CommitteeLink[]>(req, 'LFX_V2_SERVICE', `/committees/${committeeId}/links`, 'GET').catch((err) => {
        logger.warning(req, 'get_committee_documents', 'Failed to fetch committee links, returning empty list', {
          committee_uid: committeeId,
          err,
        });
        return [] as CommitteeLink[];
      }),
      // Follows page_token across all pages so large committees aren't truncated.
      fetchAllQueryResources<CommitteeDocumentQueryResult>(req, (pageToken) =>
        this.microserviceProxy.proxyRequest<QueryServiceResponse<CommitteeDocumentQueryResult>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
          type: 'committee_document',
          tags: `committee_uid:${committeeId}`,
          ...(pageToken && { page_token: pageToken }),
        })
      ).catch((err) => {
        logger.warning(req, 'get_committee_documents', 'Failed to fetch committee files via query service, returning empty list', {
          committee_uid: committeeId,
          err,
        });
        return [] as CommitteeDocumentQueryResult[];
      }),
    ]);

    // Normalize folders → CommitteeDocument
    const folderDocs: CommitteeDocument[] = (folders || []).map((f) => ({
      uid: f.uid,
      type: 'folder' as const,
      name: f.name,
      created_at: f.created_at,
      updated_at: f.updated_at,
      created_by: f.created_by_uid,
      uploaded_by: cleanUserDisplayName(f.created_by_username),
      committee_uid: f.committee_uid,
    }));

    // Normalize links → CommitteeDocument
    const linkDocs: CommitteeDocument[] = (links || []).map((l) => ({
      uid: l.uid,
      type: 'link' as const,
      name: l.name,
      url: l.url,
      description: l.description,
      created_at: l.created_at,
      updated_at: l.updated_at,
      created_by: l.created_by_uid,
      uploaded_by: cleanUserDisplayName(l.created_by_username),
      parent_uid: l.folder_uid,
      committee_uid: l.committee_uid,
    }));

    // Normalize uploaded files → CommitteeDocument
    const fileDocs: CommitteeDocument[] = (files || []).map((f) => ({
      uid: f.uid,
      type: 'file' as const,
      name: f.name,
      description: f.description,
      file_size: f.file_size,
      mime_type: f.content_type,
      created_at: f.created_at,
      updated_at: f.updated_at,
      uploaded_by: cleanUserDisplayName(f.uploaded_by_username),
      parent_uid: f.folder_uid,
      committee_uid: f.committee_uid,
    }));

    return [...folderDocs, ...linkDocs, ...fileDocs];
  }

  /**
   * Creates a new folder or link for a committee.
   * Routes to the correct upstream endpoint based on type.
   */
  public async createCommitteeDocument(req: Request, committeeId: string, data: CreateCommitteeDocumentRequest): Promise<CommitteeDocument> {
    if (data.type !== 'folder' && data.type !== 'link') {
      throw new Error(`Unsupported document type: ${data.type}. Only 'link' and 'folder' are supported.`);
    }

    if (data.type === 'folder') {
      const folder = await this.microserviceProxy.proxyRequest<CommitteeFolder>(
        req,
        'LFX_V2_SERVICE',
        `/committees/${committeeId}/folders`,
        'POST',
        {},
        {
          name: data.name,
          created_by_name: data.created_by_name,
        }
      );

      logger.debug(req, 'create_committee_folder', 'Committee folder created successfully', {
        committee_uid: committeeId,
        folder_uid: folder.uid,
      });

      return {
        uid: folder.uid,
        type: 'folder',
        name: folder.name,
        created_at: folder.created_at,
        updated_at: folder.updated_at,
        created_by: folder.created_by_uid,
        uploaded_by: cleanUserDisplayName(folder.created_by_username),
        committee_uid: folder.committee_uid,
      };
    }

    // Link
    const link = await this.microserviceProxy.proxyRequest<CommitteeLink>(
      req,
      'LFX_V2_SERVICE',
      `/committees/${committeeId}/links`,
      'POST',
      {},
      {
        name: data.name,
        url: data.url,
        description: data.description,
        folder_uid: data.parent_uid,
        created_by_name: data.created_by_name,
      }
    );

    logger.debug(req, 'create_committee_link', 'Committee link created successfully', {
      committee_uid: committeeId,
      link_uid: link.uid,
    });

    return {
      uid: link.uid,
      type: 'link',
      name: link.name,
      url: link.url,
      description: link.description,
      created_at: link.created_at,
      updated_at: link.updated_at,
      created_by: link.created_by_uid,
      uploaded_by: cleanUserDisplayName(link.created_by_username),
      parent_uid: link.folder_uid,
      committee_uid: link.committee_uid,
    };
  }

  /**
   * Uploads a file document to a committee via multipart/form-data.
   */
  public async uploadCommitteeDocument(
    req: Request,
    committeeId: string,
    fileBuffer: Buffer,
    uploadData: UploadCommitteeDocumentRequest
  ): Promise<CommitteeDocument> {
    logger.debug(req, 'upload_committee_document', 'Uploading file to committee service', {
      committee_uid: committeeId,
      file_name: uploadData.file_name,
      file_size: uploadData.file_size,
    });

    // file_size is intentionally omitted — upstream UploadCommitteeDocumentRequestBody declares
    // name, file_name, content_type, file, description, folder_uid. Goa drops unknown fields.
    const formData = new FormData();
    formData.append('file', fileBuffer, {
      filename: uploadData.file_name,
      contentType: uploadData.content_type,
    });
    formData.append('name', uploadData.name);
    formData.append('file_name', uploadData.file_name);
    formData.append('content_type', uploadData.content_type);
    if (uploadData.description) {
      formData.append('description', uploadData.description);
    }
    if (uploadData.folder_uid) {
      formData.append('folder_uid', uploadData.folder_uid);
    }

    // X-Sync=true blocks until the upstream indexer ACKs the publish, preventing stale list reads.
    const result = await this.microserviceProxy.proxyRequest<CommitteeDocumentUpstreamResponse>(
      req,
      'LFX_V2_SERVICE',
      `/committees/${committeeId}/documents`,
      'POST',
      undefined,
      formData,
      { 'X-Sync': 'true' }
    );

    logger.info(req, 'upload_committee_document', 'Committee document uploaded successfully', {
      committee_uid: committeeId,
      document_uid: result.uid,
      file_name: result.file_name,
      file_size: result.file_size,
    });

    // Poll until the query service sees the new doc — indexer is async to the upstream write.
    await pollEndpoint({
      req,
      operation: 'upload_committee_document_index_poll',
      pollFn: async () => {
        const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<{ uid: string }>>(
          req,
          'LFX_V2_SERVICE',
          '/query/resources',
          'GET',
          {
            type: 'committee_document',
            tags: `committee_document_uid:${result.uid}`,
          }
        );
        return (resources?.length ?? 0) > 0;
      },
      maxRetries: 5,
      retryDelayMs: 400,
      metadata: { committee_uid: committeeId, document_uid: result.uid },
    });

    return {
      uid: result.uid,
      type: 'file',
      name: result.name,
      description: result.description,
      file_size: result.file_size,
      mime_type: result.content_type,
      created_at: result.created_at,
      updated_at: result.updated_at,
      uploaded_by: cleanUserDisplayName(result.uploaded_by_username),
      committee_uid: result.committee_uid,
    };
  }

  /**
   * Fetches the indexed metadata for a single committee document file so the
   * controller can set `Content-Type` and `Content-Disposition` headers before
   * streaming the binary back.
   *
   * Queries by `committee_document_uid:{documentId}` AND `committee_uid:{committeeId}`
   * — every committee document is indexed with both tags (per CommitteeDocument.Tags()
   * in the upstream service). Using `tags_all` ensures a document UID from one committee
   * can't return metadata for a document owned by another. The query returns at most
   * one resource, keeping the lookup O(1) regardless of file count.
   *
   * Falls back to safe defaults if the metadata fetch fails or returns nothing so a
   * download attempt is never blocked by a stale or unavailable index.
   */
  public async getCommitteeDocumentMetadata(req: Request, committeeId: string, documentId: string): Promise<{ contentType: string; fileName: string }> {
    logger.debug(req, 'get_committee_document_metadata', 'Fetching document metadata from indexer', {
      committee_uid: committeeId,
      document_uid: documentId,
    });

    // Scope by committee_uid in addition to committee_document_uid so a leaked or guessed
    // documentId can't surface metadata for a document belonging to a different committee.
    const metadata = await this.microserviceProxy
      .proxyRequest<QueryServiceResponse<CommitteeDocumentQueryResult>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
        type: 'committee_document',
        tags_all: [`committee_document_uid:${documentId}`, `committee_uid:${committeeId}`],
      })
      .then((resp) => resp.resources?.[0]?.data ?? null)
      .catch((err) => {
        logger.warning(req, 'get_committee_document_metadata', 'Failed to fetch document metadata, using fallback values', {
          document_uid: documentId,
          err,
        });
        return null;
      });

    return {
      contentType: metadata?.content_type || 'application/octet-stream',
      fileName: metadata?.file_name || `${documentId}.bin`,
    };
  }

  /**
   * Opens a streaming HTTP request against the upstream document download
   * endpoint and returns the raw fetch Response. The caller is expected to
   * pipe `response.body` directly to its own Express response — buffering the
   * whole file would create memory pressure under concurrent downloads given
   * the 100MB upload limit.
   */
  public async getCommitteeDocumentStream(req: Request, committeeId: string, documentId: string): Promise<Response> {
    logger.debug(req, 'get_committee_document_stream', 'Opening upstream stream for committee document', {
      committee_uid: committeeId,
      document_uid: documentId,
    });

    return this.microserviceProxy.proxyStreamRequest(req, 'LFX_V2_SERVICE', `/committees/${committeeId}/documents/${documentId}/download`, 'GET');
  }

  /**
   * Deletes a committee folder or link using ETag for concurrency control.
   * @param documentType 'folder' or 'link' — determines which upstream endpoint to call
   */
  public async deleteCommitteeDocument(req: Request, committeeId: string, documentId: string, documentType: string): Promise<void> {
    const resourcePath = documentType === 'folder' ? `/committees/${committeeId}/folders/${documentId}` : `/committees/${committeeId}/links/${documentId}`;

    // Step 1: Fetch resource with ETag
    const { etag } = await this.etagService.fetchWithETag<CommitteeDocument>(req, 'LFX_V2_SERVICE', resourcePath, 'delete_committee_document');

    // Step 2: Delete resource with ETag
    await this.etagService.deleteWithETag(req, 'LFX_V2_SERVICE', resourcePath, etag, 'delete_committee_document');

    logger.debug(req, 'delete_committee_document', `Committee ${documentType} deleted successfully`, {
      committee_uid: committeeId,
      document_uid: documentId,
      document_type: documentType,
    });
  }

  /**
   * Batch-fetches committee resources by UID from the query service.
   * Chunks UIDs at 100 per request (URL-length guard) using `filters_or=uid:X`
   * for OR semantics on data.uid. Returns a map keyed by `uid` for O(1) lookup.
   */
  private async getCommitteesByIds(req: Request, uids: string[]): Promise<Map<string, Committee>> {
    const unique = Array.from(new Set(uids)).filter(Boolean);
    if (unique.length === 0) return new Map();

    const BATCH_SIZE = 100;
    const batches: string[][] = [];
    for (let i = 0; i < unique.length; i += BATCH_SIZE) {
      batches.push(unique.slice(i, i + BATCH_SIZE));
    }

    // Rethrow batch failures — returning [] would make callers treat real memberships as
    // "committee not found" and silently drop them (defeats failOnPartial: true).
    const batchResults = await Promise.all(
      batches.map(async (batch) => {
        try {
          return await fetchAllQueryResources<Committee>(
            req,
            (pageToken) =>
              this.microserviceProxy.proxyRequest<QueryServiceResponse<Committee>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
                type: 'committee',
                filters_or: batch.map((uid) => `uid:${uid}`),
                ...(pageToken && { page_token: pageToken }),
              }),
            { failOnPartial: true }
          );
        } catch (error) {
          logger.warning(req, 'get_committees_by_ids', 'Batched committee fetch failed', {
            batch_size: batch.length,
            err: error,
          });
          throw error;
        }
      })
    );

    const byUid = new Map<string, Committee>();
    for (const committee of batchResults.flat()) {
      if (committee?.uid) {
        byUid.set(committee.uid, committee);
      }
    }

    return byUid;
  }

  /**
   * Fetches the caller's membership row for a single committee, or null if none.
   * Uses the username-tagged query so visibility is independent of which email
   * the caller authenticated with — matching the pattern used by
   * {@link getMyCommittees} / {@link getMyCommitteeUids} for the same `committee_member`
   * resource type.
   *
   * Reuses {@link getCommitteeMembers} (which paginates via `fetchAllQueryResources`)
   * to keep the read pattern consistent with the rest of the service and with
   * {@link meeting.helper.ts} which uses the same `(username, committee_uid)` lookup.
   */
  private async getCallerMembership(req: Request, committeeId: string): Promise<{ role: CommitteeMemberRole | 'Member'; member_uid: string } | null> {
    const username = await getUsernameFromAuth(req);
    if (!username) {
      return null;
    }

    try {
      const memberships = await this.getCommitteeMembers(req, committeeId, { tags_all: [`username:${username}`] });
      if (memberships.length === 0) {
        return null;
      }

      // Defensive: if upstream ever returns multiples (duplicate index entry, multi-account
      // edge case), prefer the highest-privilege role so the UI doesn't randomly downgrade.
      if (memberships.length > 1) {
        logger.warning(req, 'get_caller_membership', 'Multiple membership rows for (username, committee_uid); picking highest-privilege role', {
          committee_uid: committeeId,
          row_count: memberships.length,
        });
      }

      const best = this.pickBestMembership(memberships);
      if (!best) {
        return null;
      }

      const roleName = best.role?.name;
      return {
        role: !roleName || roleName === CommitteeMemberRole.NONE ? 'Member' : roleName,
        member_uid: best.uid,
      };
    } catch (error) {
      logger.warning(req, 'get_caller_membership', 'Failed to resolve caller membership, treating as non-member', {
        committee_uid: committeeId,
        err: error,
      });
      return null;
    }
  }

  /**
   * Numeric priority for committee roles, used to deterministically pick the "best"
   * row when multiple membership rows exist for the same caller. Higher = more privileged.
   *
   * Any named role outranks `None`/missing so a real membership row is never tied with
   * a placeholder row. Chair / Vice Chair are explicitly elevated above the rest.
   */
  private rolePriority(role: CommitteeMemberRole | undefined): number {
    if (role === CommitteeMemberRole.CHAIR) return 3;
    if (role === CommitteeMemberRole.VICE_CHAIR) return 2;
    if (!role || role === CommitteeMemberRole.NONE) return 0;
    return 1;
  }

  /**
   * Selects the highest-privilege membership row from a set of duplicates for the
   * same `(username, committee_uid)` pair. Shared between {@link getCallerMembership}
   * and {@link getMyCommittees} so the detail and dashboard endpoints surface the
   * same `my_role` / `my_member_uid` for a given group when upstream returns
   * multiple rows (duplicate index entry, multi-account edge case).
   *
   * Ties on role priority are broken deterministically by lexicographically smallest
   * `uid`, so repeated requests pick the same row regardless of upstream ordering.
   */
  private pickBestMembership(memberships: CommitteeMember[]): CommitteeMember | null {
    if (memberships.length === 0) {
      return null;
    }
    return memberships.reduce((best, current) => {
      const currentPriority = this.rolePriority(current.role?.name);
      const bestPriority = this.rolePriority(best.role?.name);
      if (currentPriority !== bestPriority) {
        return currentPriority > bestPriority ? current : best;
      }
      // Tie-breaker: prefer lexicographically smallest uid for stable ordering across requests.
      return (current.uid ?? '') < (best.uid ?? '') ? current : best;
    });
  }

  /**
   * Fetches committee settings by ID.
   * By default returns {} on error so callers that display settings can degrade gracefully.
   * Pass { throwOnError: true } on write paths where an unknown setting must not silently
   * default to false (e.g. accept-invite org enforcement).
   */
  private async getCommitteeSettings(req: Request, committeeId: string, options: { throwOnError?: boolean } = {}): Promise<CommitteeSettingsData> {
    try {
      const settings = await this.microserviceProxy.proxyRequest<CommitteeSettingsData>(req, 'LFX_V2_SERVICE', `/committees/${committeeId}/settings`, 'GET');

      return settings || {};
    } catch (error) {
      if (options.throwOnError) {
        throw error;
      }
      logger.warning(req, 'get_committee_settings', 'Failed to fetch committee settings, returning empty', {
        committee_uid: committeeId,
      });
      return {};
    }
  }

  /**
   * Collects the manage/review grants the committee inherits from its project ancestry so the
   * members roster can label users who hold a "Manage" / "Reviewer" grant at the project or
   * foundation level rather than directly on the committee (LFXV2-2059).
   *
   * Walks the chain `committee's project_uid -> parent -> ... -> foundation root`, reading each
   * level's project settings and unioning the writers/auditors. This mirrors the authorization
   * model, which inherits at every hop (`committee#writer` derives from `writer from project`,
   * and `project#writer` from `writer from parent`), so a grant anywhere up the chain — most
   * importantly a foundation-level "Manage" — is an effective committee grant. Reading only the
   * immediate project (the round-1 behaviour) missed grants stored higher up, which is why a
   * foundation manager still showed as a plain member.
   *
   * Best-effort and never throws — inherited labels are display-only and must not break the
   * committee fetch. A level the caller cannot read (or a missing project) simply contributes no
   * grants. The walk is depth-capped and visited-guarded so a malformed parent link cannot loop.
   *
   * @returns Deduped writers/auditors mapped to `CommitteeUser`, matching the shape of the
   *   committee-scoped `writers` / `auditors` lists.
   */
  private async getInheritedPermissions(req: Request, projectUid?: string): Promise<{ writers: CommitteeUser[]; auditors: CommitteeUser[] }> {
    if (!projectUid) {
      return { writers: [], auditors: [] };
    }

    // Project UserInfo -> CommitteeUser (username is optional upstream; default to '' so roster
    // matching falls back to email, mirroring how committee writers/auditors match).
    const toCommitteeUser = (u: { name: string; email: string; username?: string; avatar?: string }): CommitteeUser => ({
      username: u.username ?? '',
      email: u.email,
      name: u.name,
      avatar: u.avatar,
    });
    // Dedup key: prefer the Auth0 username, fall back to email — the same identity keys the
    // roster matches on, so a user granted at two levels collapses to one entry.
    const keyOf = (u: CommitteeUser): string => (u.username || u.email || '').toLowerCase();

    const writersByKey = new Map<string, CommitteeUser>();
    const auditorsByKey = new Map<string, CommitteeUser>();
    const visited = new Set<string>();
    // The documented use case is a foundation-level grant 1-2 levels above the committee, so cap
    // the walk at 3 levels (<=6 upstream calls) — enough to cover the known hierarchy with a small
    // margin while bounding the per-request cost. Truncation is logged below (never silent), and
    // the constant can be raised if deeper trees need support.
    const MAX_DEPTH = 3;

    let currentUid: string | undefined = projectUid;
    while (currentUid && !visited.has(currentUid) && visited.size < MAX_DEPTH) {
      const levelUid: string = currentUid;
      visited.add(levelUid);

      // This level's grants and the project record (to find the parent) in parallel; both are
      // best-effort so an unreadable level contributes nothing and the walk still continues.
      // Capture the error at debug — a caller lacking read access to an ancestor is an expected
      // outcome (not a system fault), but the failure must remain diagnosable since it silently
      // shrinks the inherited lists this feature surfaces.
      const [settings, project]: [ProjectSettings | null, Project | null] = await Promise.all([
        this.projectService.getProjectSettings(req, levelUid).catch((error) => {
          logger.debug(req, 'get_inherited_permissions', 'Failed to read project settings; skipping level', {
            project_uid: levelUid,
            error: error instanceof Error ? error.message : String(error),
          });
          return null;
        }),
        this.projectService.getProjectById(req, levelUid, false).catch((error) => {
          logger.debug(req, 'get_inherited_permissions', 'Failed to read project record; stopping ancestry walk', {
            project_uid: levelUid,
            error: error instanceof Error ? error.message : String(error),
          });
          return null;
        }),
      ]);

      for (const u of settings?.writers ?? []) {
        const cu = toCommitteeUser(u);
        writersByKey.set(keyOf(cu), cu);
      }
      for (const u of settings?.auditors ?? []) {
        const cu = toCommitteeUser(u);
        auditorsByKey.set(keyOf(cu), cu);
      }

      currentUid = project?.parent_uid || undefined;
    }

    // Surface a truncated walk (more ancestry remained when the depth cap was hit) so a missed
    // deep-hierarchy grant is diagnosable rather than a silent cap.
    if (currentUid && !visited.has(currentUid)) {
      logger.debug(req, 'get_inherited_permissions', 'Ancestry walk truncated at MAX_DEPTH; deeper grants not collected', {
        project_uid: projectUid,
        max_depth: MAX_DEPTH,
        next_unvisited_project_uid: currentUid,
      });
    }

    logger.debug(req, 'get_inherited_permissions', 'Collected inherited committee permissions from project ancestry', {
      project_uid: projectUid,
      levels_visited: visited.size,
      inherited_writers: writersByKey.size,
      inherited_auditors: auditorsByKey.size,
    });

    return { writers: [...writersByKey.values()], auditors: [...auditorsByKey.values()] };
  }

  /**
   * Updates committee settings using ETag for concurrency control.
   * Fetches current settings first to preserve existing values (PUT replaces the full resource).
   */
  private async updateCommitteeSettings(req: Request, committeeId: string, settings: CommitteeSettingsData): Promise<void> {
    // Fetch current settings + ETag — need current data so the PUT doesn't wipe existing values
    const { data: currentSettings, etag } = await this.etagService.fetchWithETag<CommitteeSettingsData>(
      req,
      'LFX_V2_SERVICE',
      `/committees/${committeeId}/settings`,
      'update_committee_settings'
    );

    // Merge provided fields over current settings
    const settingsData = {
      ...currentSettings,
      ...(settings.business_email_required !== undefined && { business_email_required: settings.business_email_required }),
      ...(settings.is_audit_enabled !== undefined && { is_audit_enabled: settings.is_audit_enabled }),
      ...(settings.show_meeting_attendees !== undefined && { show_meeting_attendees: settings.show_meeting_attendees }),
      ...(settings.member_visibility !== undefined && { member_visibility: settings.member_visibility }),
      ...(settings.writers !== undefined && { writers: settings.writers }),
      ...(settings.auditors !== undefined && { auditors: settings.auditors }),
    };

    // Update settings with ETag
    await this.etagService.updateWithETag(req, 'LFX_V2_SERVICE', `/committees/${committeeId}/settings`, etag, settingsData, 'update_committee_settings');

    logger.debug(req, 'update_committee_settings', 'Committee settings updated successfully', {
      committee_uid: committeeId,
      updated_fields: Object.keys(settings).filter((k) => settings[k as keyof CommitteeSettingsData] !== undefined),
      writers_count: settingsData.writers?.length,
      auditors_count: settingsData.auditors?.length,
    });
  }

  /**
   * Returns the subset of the provided committee UIDs that have at least one associated
   * `groupsio_mailing_list` resource. Uses OR-tag semantics (the query service `tags`
   * parameter is ArrayOf(String) with OR logic) instead of one count call per committee.
   * UIDs are chunked at 100 per request for URL-length safety; batches run concurrently
   * via Promise.allSettled so a single chunk failure does not suppress the others.
   */
  private async getCommitteesWithMailingList(req: Request, committeeUids: string[]): Promise<Set<string>> {
    const unique = [...new Set(committeeUids)].filter(Boolean);
    if (unique.length === 0) return new Set();

    const BATCH_SIZE = 100;
    const batches: string[][] = [];
    for (let i = 0; i < unique.length; i += BATCH_SIZE) {
      batches.push(unique.slice(i, i + BATCH_SIZE));
    }

    // Run batches concurrently; isolate each batch's failure so one transient error
    // does not suppress mailing-list flags for committees in unrelated batches.
    // Committee UIDs are in ml.committees[].uid — not a top-level committee_uid field.
    const results = await Promise.allSettled(
      batches.map((batch) =>
        fetchAllQueryResources<GroupsIOMailingList>(
          req,
          (pageToken) =>
            this.microserviceProxy.proxyRequest<QueryServiceResponse<GroupsIOMailingList>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
              type: 'groupsio_mailing_list',
              tags: batch.map((uid) => `committee_uid:${uid}`),
              ...(pageToken && { page_token: pageToken }),
            }),
          { failOnPartial: true }
        )
      )
    );

    const found = new Set<string>();
    for (const [i, result] of results.entries()) {
      if (result.status === 'fulfilled') {
        for (const ml of result.value) {
          for (const ref of ml.committees ?? []) {
            if (ref.uid) found.add(ref.uid);
          }
        }
      } else {
        logger.warning(req, 'get_committees_with_mailing_list', 'Batch mailing-list fetch failed, affected committees default to false', {
          batch_index: i,
          batch_size: batches[i].length,
          sample_uids: batches[i].slice(0, 3),
          err: result.reason,
        });
      }
    }

    return found;
  }

  /**
   * Returns pending committee_invite resources for {@link email}, without display enrichment.
   */
  private async fetchPendingCommitteeInvitesByEmail(req: Request, email: string): Promise<CommitteeInvite[]> {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      return [];
    }

    // Don't log the invitee email — it's PII and the request is already correlated by req.id and
    // the authenticated session. The upstream query is still scoped to normalizedEmail.
    logger.debug(req, 'fetch_pending_committee_invites', 'Fetching pending committee invitations for user');

    const invites = await fetchAllQueryResources<CommitteeInvite>(req, (pageToken) =>
      this.microserviceProxy.proxyRequest<QueryServiceResponse<CommitteeInvite>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
        type: 'committee_invite',
        tags: `invitee_email:${normalizedEmail}`,
        ...(pageToken && { page_token: pageToken }),
      })
    );

    return invites.filter((invite) => invite.status === 'pending');
  }

  /**
   * Filters {@link pending} invites to those whose committee UID matches {@link resourceUid}.
   * Used by the legacy LFID invite flow where the JWT carries the committee UID (resource_uid)
   * but not the exact invite UID.
   *
   * Returns an empty array when no match is found — the caller should treat this as
   * "not yet visible" and retry (FGA invitee tuple may still be propagating).
   */
  private selectCommitteeInvitesForLfidAccept(pending: CommitteeInvite[], resourceUid: string): CommitteeInvite[] {
    const trimmedResourceUid = resourceUid.trim();
    if (!trimmedResourceUid) {
      return [];
    }
    return pending.filter((invite) => invite.committee_uid === trimmedResourceUid);
  }
}

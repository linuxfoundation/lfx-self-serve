// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  Committee,
  CommitteeCreateData,
  CommitteeDocument,
  CommitteeJoinApplication,
  CommitteeMember,
  CommitteeSettingsData,
  CommitteeUpdateData,
  CreateCommitteeDocumentRequest,
  CreateCommitteeJoinApplicationRequest,
  CreateCommitteeMemberRequest,
  MyCommittee,
  QueryServiceCountResponse,
  QueryServiceResponse,
} from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { ResourceNotFoundError } from '../errors';
import { fetchAllQueryResources } from '../helpers/query-service.helper';
import { logger } from '../services/logger.service';
import { getUsernameFromAuth } from '../utils/auth-helper';
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
  created_by_name?: string;
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
  created_by_name?: string;
  created_at?: string;
  updated_at?: string;
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

    // Get member count and mailing list association for each committee in parallel
    committees = await Promise.all(
      committees.map(async (committee) => {
        const [memberCount, mlCount] = await Promise.all([
          this.getCommitteeMembersCount(req, committee.uid),
          this.getMailingListCountByCommittee(req, committee.uid),
        ]);
        return {
          ...committee,
          total_members: memberCount,
          has_mailing_list: mlCount > 0,
        };
      })
    );

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
   * Fetches a single committee by ID
   */
  public async getCommitteeById(req: Request, committeeId: string): Promise<Committee> {
    const committee = await this.microserviceProxy.proxyRequest<Committee>(req, 'LFX_V2_SERVICE', `/committees/${committeeId}`, 'GET');

    if (!committee) {
      throw new ResourceNotFoundError('Committee', committeeId, {
        operation: 'get_committee_by_id',
        service: 'committee_service',
        path: `/committees/${committeeId}`,
      });
    }

    // Fetch committee settings for enrichment.
    // Settings (GET /committees/:uid/settings) is the authoritative source for writers/auditors —
    // CommitteeFull (GET /committees/:uid) does not consistently return them in practice.
    const settings = await this.getCommitteeSettings(req, committeeId);

    const committeeWithEnrichment = {
      ...committee,
      ...settings,
    };

    // Add writer access field to the committee
    return await this.accessCheckService.addAccessToResource(req, committeeWithEnrichment, 'committee');
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
   * Fetches count of all members for a specific committee
   */
  public async getCommitteeMembersCount(req: Request, committeeId: string, query: Record<string, any> = {}): Promise<number> {
    logger.debug(req, 'get_committee_members_count', 'Fetching committee members count', {
      committee_uid: committeeId,
      query,
    });

    const params = {
      ...query,
      type: 'committee_member',
      tags: `committee_uid:${committeeId}`,
    };

    const { count } = await this.microserviceProxy.proxyRequest<QueryServiceCountResponse>(req, 'LFX_V2_SERVICE', `/query/resources/count`, 'GET', params);

    return count;
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

  // ── Persona Helper ──────────────────────────────────────────────────────

  public async getCommitteeMembersByCategory(req: Request, username: string, userEmail: string, category: string): Promise<CommitteeMember[]> {
    const params = {
      v: '1',
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
        v: '1',
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
        v: '1',
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

    // Build a map of committee_uid → membership metadata for quick lookup
    const membershipMap = new Map<string, { role: string; member_uid: string; committee_category?: string }>();
    for (const m of memberships) {
      membershipMap.set(m.committee_uid, {
        role: m.role?.name || 'Member',
        member_uid: m.uid,
        committee_category: m.committee_category,
      });
    }

    // Batch-fetch committee resources from the query service in one or more batched requests
    // (chunked at 100 UIDs per request by getCommitteesByIds). Avoids the N-way upstream
    // fan-out to GET /committees/:uid, which has been observed to 404 on memberships
    // indexed by the query service.
    const committeeUids = Array.from(membershipMap.keys());
    const committees = await this.getCommitteesByIds(req, committeeUids);

    // Enrich each committee with per-committee counts (query-service) and membership metadata
    const enriched = await Promise.all(
      committeeUids.map(async (uid) => {
        const committee = committees.get(uid);
        if (!committee) {
          logger.warning(req, 'get_my_committees', 'Committee not found in query service, skipping', {
            committee_uid: uid,
          });
          return null;
        }
        const [memberCountRes, mlCountRes] = await Promise.allSettled([this.getCommitteeMembersCount(req, uid), this.getMailingListCountByCommittee(req, uid)]);
        if (memberCountRes.status === 'rejected') {
          logger.warning(req, 'get_my_committees', 'Failed to fetch committee members count, defaulting to 0', {
            committee_uid: uid,
            err: memberCountRes.reason,
          });
        }
        if (mlCountRes.status === 'rejected') {
          logger.warning(req, 'get_my_committees', 'Failed to fetch mailing list count, defaulting to false', {
            committee_uid: uid,
            err: mlCountRes.reason,
          });
        }
        const membership = membershipMap.get(uid)!;
        return {
          ...committee,
          category: committee.category || membership.committee_category || '',
          total_members: memberCountRes.status === 'fulfilled' ? memberCountRes.value : 0,
          has_mailing_list: mlCountRes.status === 'fulfilled' ? mlCountRes.value > 0 : false,
          my_role: membership.role,
          my_member_uid: membership.member_uid,
        } as MyCommittee;
      })
    );

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
    logger.debug(req, 'get_committee_documents', 'Fetching committee folders and links', {
      committee_uid: committeeId,
    });

    // Fetch folders and links in parallel
    const [folders, links] = await Promise.all([
      this.microserviceProxy.proxyRequest<CommitteeFolder[]>(req, 'LFX_V2_SERVICE', `/committees/${committeeId}/folders`, 'GET').catch((err) => {
        logger.warning(req, 'get_committee_documents', 'Failed to fetch committee folders, returning empty list', {
          committee_uid: committeeId,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
        return [] as CommitteeFolder[];
      }),
      this.microserviceProxy.proxyRequest<CommitteeLink[]>(req, 'LFX_V2_SERVICE', `/committees/${committeeId}/links`, 'GET').catch((err) => {
        logger.warning(req, 'get_committee_documents', 'Failed to fetch committee links, returning empty list', {
          committee_uid: committeeId,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
        return [] as CommitteeLink[];
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
      uploaded_by: f.created_by_name,
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
      uploaded_by: l.created_by_name,
      parent_uid: l.folder_uid,
      committee_uid: l.committee_uid,
    }));

    return [...folderDocs, ...linkDocs];
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
        uploaded_by: folder.created_by_name,
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
      uploaded_by: link.created_by_name,
      parent_uid: link.folder_uid,
      committee_uid: link.committee_uid,
    };
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
                v: '1',
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
   * Fetches committee settings by ID
   * @returns Committee settings or empty object if not found/error
   */
  private async getCommitteeSettings(req: Request, committeeId: string): Promise<CommitteeSettingsData> {
    try {
      const settings = await this.microserviceProxy.proxyRequest<CommitteeSettingsData>(req, 'LFX_V2_SERVICE', `/committees/${committeeId}/settings`, 'GET');

      return settings || {};
    } catch {
      logger.debug(req, 'get_committee_settings', 'Failed to fetch committee settings, returning empty', {
        committee_uid: committeeId,
      });
      return {};
    }
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
   * Fetches count of mailing lists associated with a specific committee.
   * Used to determine the has_mailing_list flag for committee list views.
   */
  private async getMailingListCountByCommittee(req: Request, committeeId: string): Promise<number> {
    try {
      const { count } = await this.microserviceProxy.proxyRequest<QueryServiceCountResponse>(req, 'LFX_V2_SERVICE', '/query/resources/count', 'GET', {
        type: 'groupsio_mailing_list',
        tags: `committee_uid:${committeeId}`,
      });
      return count;
    } catch (error) {
      logger.debug(req, 'get_mailing_list_count_by_committee', 'Failed to fetch mailing list count, defaulting to 0', {
        committee_uid: committeeId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return 0;
    }
  }
}

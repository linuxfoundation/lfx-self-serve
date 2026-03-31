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

import { getUsernameFromAuth } from '../utils/auth-helper';

import { ResourceNotFoundError } from '../errors';
import { logger } from '../services/logger.service';
import { AccessCheckService } from './access-check.service';
import { ETagService } from './etag.service';
import { MicroserviceProxyService } from './microservice-proxy.service';

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

  public constructor() {
    this.accessCheckService = new AccessCheckService();
    this.microserviceProxy = new MicroserviceProxyService();
    this.etagService = new ETagService();
  }

  /**
   * Fetches all committees based on query parameters
   */
  public async getCommittees(req: Request, query: Record<string, any> = {}): Promise<Committee[]> {
    const params = {
      ...query,
      type: 'committee',
    };

    const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<Committee>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', params);

    let committees = resources.map((resource) => resource.data);

    // Get member count for each committee in parallel
    committees = await Promise.all(
      committees.map(async (committee) => {
        const memberCount = await this.getCommitteeMembersCount(req, committee.uid);
        return {
          ...committee,
          total_members: memberCount,
        };
      })
    );

    // Add writer access field so the filter below can use it
    committees = await this.accessCheckService.addAccessToResources(req, committees, 'committee');

    // Visibility filter: only show committees the current user can actually open.
    // The query service may return committees the committee service will reject (403/404),
    // so we filter to: public committees, committees the user has write access to,
    // or committees the user is an explicit member of.
    const myCommittees = await this.getMyCommittees(req);
    const myUids = new Set(myCommittees.map((c) => c.uid));
    const totalBefore = committees.length;

    committees = committees.filter((c) => c.public || c.writer === true || myUids.has(c.uid));

    if (committees.length < totalBefore) {
      logger.debug(req, 'get_committees', 'Filtered non-visible committees', {
        filtered_count: totalBefore - committees.length,
        total: totalBefore,
      });
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

    // Fetch committee settings for enrichment
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
    // Extract settings fields — everything else goes through PUT
    const { business_email_required, is_audit_enabled, show_meeting_attendees, member_visibility, ...committeeData } = data;

    const hasSettingsUpdate =
      business_email_required !== undefined || is_audit_enabled !== undefined || show_meeting_attendees !== undefined || member_visibility !== undefined;
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

    // Step 3: Update settings if provided
    if (hasSettingsUpdate) {
      try {
        await this.updateCommitteeSettings(req, committeeId, {
          business_email_required,
          is_audit_enabled,
          show_meeting_attendees,
          member_visibility,
        });
      } catch {
        logger.warning(req, 'update_committee_settings', 'Failed to update committee settings, but committee was updated successfully', {
          committee_uid: committeeId,
        });
      }
    }

    return {
      ...updatedCommittee,
      ...(business_email_required !== undefined && { business_email_required }),
      ...(is_audit_enabled !== undefined && { is_audit_enabled }),
      ...(show_meeting_attendees !== undefined && { show_meeting_attendees }),
      ...(member_visibility !== undefined && { member_visibility }),
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
    const params = {
      ...query,
      type: 'committee_member',
      tags: `committee_uid:${committeeId}`,
    };

    const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<CommitteeMember>>(
      req,
      'LFX_V2_SERVICE',
      `/query/resources`,
      'GET',
      params
    );

    return resources.map((resource) => resource.data);
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

    const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<CommitteeMember>>(
      req,
      'LFX_V2_SERVICE',
      '/query/resources',
      'GET',
      params
    );

    const userMemberships = resources.map((resource) => resource.data);

    logger.debug(req, 'get_committee_members_by_category', 'Committee memberships retrieved', {
      username,
      category,
      memberships_count: userMemberships.length,
    });

    return userMemberships;
  }

  // ── My Committees ─────────────────────────────────────────────────────────

  public async getMyCommittees(req: Request, projectUid?: string): Promise<MyCommittee[]> {
    const username = await getUsernameFromAuth(req);
    if (!username) {
      return [];
    }

    // Fetch all committee_member records for the current user
    const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<CommitteeMember>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
      v: '1',
      type: 'committee_member',
      tags_all: [`username:${username}`],
    });

    const memberships = resources.map((r) => r.data);

    if (memberships.length === 0) {
      return [];
    }

    logger.debug(req, 'get_my_committees', 'Found user memberships', {
      username,
      membership_count: memberships.length,
    });

    // Build a map of committee_uid → role for quick lookup
    const membershipMap = new Map<string, { role: string; member_uid: string }>();
    for (const m of memberships) {
      membershipMap.set(m.committee_uid, {
        role: m.role?.name || 'Member',
        member_uid: m.uid,
      });
    }

    // Fetch committee details for each membership in parallel
    const committeeUids = Array.from(membershipMap.keys());
    const committees = await Promise.all(
      committeeUids.map(async (uid) => {
        try {
          const committee = await this.microserviceProxy.proxyRequest<Committee>(req, 'LFX_V2_SERVICE', `/committees/${uid}`, 'GET');
          const memberCount = await this.getCommitteeMembersCount(req, uid);
          const membership = membershipMap.get(uid)!;
          return {
            ...committee,
            total_members: memberCount,
            my_role: membership.role,
            my_member_uid: membership.member_uid,
          } as MyCommittee;
        } catch (error) {
          logger.warning(req, 'get_my_committees', 'Failed to enrich committee membership, skipping committee', {
            committee_uid: uid,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
          return null;
        }
      })
    );

    const result = committees.filter((c): c is MyCommittee => c !== null);

    // Filter by project_uid server-side if provided
    if (projectUid) {
      return result.filter((c) => c.project_uid === projectUid);
    }

    return result;
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
   * Updates committee settings using ETag for concurrency control
   */
  private async updateCommitteeSettings(req: Request, committeeId: string, settings: CommitteeSettingsData): Promise<void> {
    const settingsData = {
      ...(settings.business_email_required !== undefined && {
        business_email_required: settings.business_email_required,
      }),
      ...(settings.is_audit_enabled !== undefined && {
        is_audit_enabled: settings.is_audit_enabled,
      }),
      ...(settings.show_meeting_attendees !== undefined && {
        show_meeting_attendees: settings.show_meeting_attendees,
      }),
      ...(settings.member_visibility !== undefined && {
        member_visibility: settings.member_visibility,
      }),
    };

    // Fetch settings with ETag
    const { etag } = await this.etagService.fetchWithETag<CommitteeSettingsData>(
      req,
      'LFX_V2_SERVICE',
      `/committees/${committeeId}/settings`,
      'update_committee_settings'
    );

    // Update settings with ETag
    await this.etagService.updateWithETag(req, 'LFX_V2_SERVICE', `/committees/${committeeId}/settings`, etag, settingsData, 'update_committee_settings');

    logger.debug(req, 'update_committee_settings', 'Committee settings updated successfully', {
      committee_uid: committeeId,
      settings_data: settingsData,
    });
  }
}

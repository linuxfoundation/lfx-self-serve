// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CHAIR_ROLES } from '@lfx-one/shared/constants';
import { CommitteeMemberVisibility, MeetingVisibility } from '@lfx-one/shared/enums';
import {
  Committee,
  CommitteeMember,
  GroupsIOMailingList,
  PublicGroupContext,
  PublicGroupDetail,
  PublicGroupDirectoryResponse,
  PublicGroupLinks,
  PublicGroupMeeting,
  PublicGroupMember,
  PublicGroupSummary,
  QueryServiceResponse,
} from '@lfx-one/shared/interfaces';
import { buildCommitteeCadenceSummary, getGroupBehavioralClass } from '@lfx-one/shared/utils';
import { NextFunction, Request, Response } from 'express';

import { AuthorizationError, ResourceNotFoundError } from '../errors';
import { validateUidParameter } from '../helpers/validation.helper';
import { logger } from '../services/logger.service';
import { CommitteeService } from '../services/committee.service';
import { MeetingService } from '../services/meeting.service';
import { MicroserviceProxyService } from '../services/microservice-proxy.service';
import { ProjectService } from '../services/project.service';
import { getEffectiveEmail, getEffectiveUsername } from '../utils/auth-helper';
import { generateM2MToken } from '../utils/m2m-token.util';

export class PublicGroupsController {
  private committeeService: CommitteeService = new CommitteeService();
  private meetingService: MeetingService = new MeetingService();
  private microserviceProxy: MicroserviceProxyService = new MicroserviceProxyService();
  private projectService: ProjectService = new ProjectService();

  public async getPublicGroupById(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { id } = req.params;

    const startTime = logger.startOperation(req, 'get_public_group_by_id', { group_uid: id });

    try {
      if (!validateUidParameter(id, req, next, { operation: 'get_public_group_by_id', service: 'public_groups_controller' })) {
        return;
      }

      const originalToken = req.bearerToken;
      // M2M token required: public endpoint has no user session; app credentials needed for upstream calls
      const m2mToken = await generateM2MToken(req);
      req.bearerToken = m2mToken;

      const committee = await this.committeeService.getCommitteeById(req, id);

      if (!committee.public) {
        throw new AuthorizationError('This group is private', {
          operation: 'get_public_group_by_id',
          service: 'public_groups_controller',
          path: `/committees/${id}`,
          code: 'GROUP_PRIVATE',
        });
      }

      const [members, project, meetingsResponse, mailingListsResponse] = await Promise.all([
        this.committeeService.getCommitteeMembers(req, id),
        this.projectService.getProjectById(req, committee.project_uid, false),
        this.meetingService.getMeetings(req, { tags: `committee_uid:${id}` }, 'v1_meeting', false),
        this.microserviceProxy
          .proxyRequest<QueryServiceResponse<GroupsIOMailingList>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
            type: 'groupsio_mailing_list',
            tags: `committee_uid:${id}`,
          })
          .catch(() => ({ resources: [] })),
      ]);

      const hasPublicMailingList = mailingListsResponse.resources.some((r) => r.data.public);

      const visibility = committee.member_visibility || CommitteeMemberVisibility.HIDDEN;
      const chairs =
        visibility === CommitteeMemberVisibility.HIDDEN
          ? []
          : members
              .filter((m: CommitteeMember) => m.role?.name && CHAIR_ROLES.has(m.role.name))
              .map(
                (m: CommitteeMember): PublicGroupMember => ({
                  name: `${m.first_name} ${m.last_name}`.trim(),
                  organization: m.organization?.name,
                  role: m.role?.name,
                })
              );

      const now = new Date().toISOString();
      const upcomingMeetings = meetingsResponse.data
        .filter((m) => m.visibility === MeetingVisibility.PUBLIC && m.start_time >= now)
        .sort((a, b) => a.start_time.localeCompare(b.start_time))
        .slice(0, 5)
        .map(
          (m): PublicGroupMeeting => ({
            uid: m.id,
            title: m.title,
            starts_at: m.start_time,
            timezone: m.timezone,
            url: `/meetings/${m.id}`,
          })
        );

      let parentProject = project;
      if (project?.parent_uid) {
        parentProject = await this.projectService.getProjectById(req, project.parent_uid, false);
      }

      const context: PublicGroupContext = {
        scope: project?.parent_uid ? 'project' : 'foundation',
        foundation_uid: parentProject?.uid || project?.uid || committee.project_uid,
        foundation_name: parentProject?.name || project?.name || '',
        foundation_slug: parentProject?.slug || project?.slug || '',
        foundation_logo_url: parentProject?.logo_url || project?.logo_url || undefined,
        ...(project?.parent_uid && {
          project_uid: project.uid,
          project_name: project.name,
          project_slug: project.slug,
          project_logo_url: project.logo_url || undefined,
        }),
      };

      let mailingListLink: string | undefined;
      if (hasPublicMailingList && committee.mailing_list) {
        const ml = committee.mailing_list;
        mailingListLink = !ml.startsWith('http') && !ml.startsWith('mailto:') && ml.includes('@') ? `mailto:${ml}` : ml;
      }

      const links: PublicGroupLinks = {
        website: committee.website,
        mailing_list: mailingListLink,
        calendar: committee.calendar?.public ? `/public/api/committees/${id}/calendar.ics` : undefined,
      };

      const publicMeetings = meetingsResponse.data.filter((m) => m.visibility === MeetingVisibility.PUBLIC);
      const cadence = buildCommitteeCadenceSummary(publicMeetings);

      const detail: PublicGroupDetail = {
        uid: committee.uid,
        name: committee.name,
        description: committee.description ?? undefined,
        category: committee.category,
        join_mode: committee.join_mode,
        total_members: committee.total_members,
        context,
        chairs,
        links,
        upcoming_meetings: upcomingMeetings,
        cadence: cadence !== 'No recurring meetings scheduled' ? cadence : undefined,
        calendar_url: links.calendar ?? undefined,
        member_visibility: visibility,
      };

      const isAuthenticated = req.oidc?.isAuthenticated();
      if (isAuthenticated && originalToken !== undefined) {
        req.bearerToken = originalToken;
        try {
          const callerEmail = getEffectiveEmail(req);
          const callerUsername = getEffectiveUsername(req);
          const callerMembership = members.find(
            (m: CommitteeMember) => (callerEmail && m.email?.toLowerCase() === callerEmail) || (callerUsername && m.username && m.username === callerUsername)
          );
          if (callerMembership) {
            detail.is_member = true;
            detail.my_role = callerMembership.role?.name || 'Member';
          }
        } catch {
          logger.debug(req, 'get_public_group_by_id', 'Failed to resolve caller membership', { group_uid: id });
        }
        req.bearerToken = m2mToken;
      }

      logger.success(req, 'get_public_group_by_id', startTime, {
        group_uid: id,
        group_name: committee.name,
        chairs_count: chairs.length,
        meetings_count: upcomingMeetings.length,
      });

      res.json(detail);
    } catch (error) {
      return next(error);
    }
  }

  public async getPublicGroupsByFoundation(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { identifier } = req.params;
    const startTime = logger.startOperation(req, 'get_public_groups_by_foundation', { identifier });

    try {
      // M2M token required: public endpoint with no user session; app credentials needed for upstream calls
      const m2mToken = await generateM2MToken(req);
      req.bearerToken = m2mToken;

      const foundationUid = await this.resolveProjectIdentifier(req, identifier);
      const [foundation, childUids] = await Promise.all([
        this.projectService.getProjectById(req, foundationUid, false),
        this.projectService.getFoundationProjectUids(req, foundationUid),
      ]);

      const allCommittees = await this.fetchPublicCommitteesForProjects(req, childUids);
      const projects = await this.resolveContextProjects(req, allCommittees);

      const groups = allCommittees.map((c) => this.buildGroupSummary(c, projects, foundation, null));

      const response: PublicGroupDirectoryResponse = { groups, total: groups.length };

      logger.success(req, 'get_public_groups_by_foundation', startTime, {
        foundation_uid: foundationUid,
        groups_count: groups.length,
      });

      res.json(response);
    } catch (error) {
      return next(error);
    }
  }

  public async getPublicGroupsByProject(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { identifier } = req.params;
    const startTime = logger.startOperation(req, 'get_public_groups_by_project', { identifier });

    try {
      // M2M token required: public endpoint with no user session; app credentials needed for upstream calls
      const m2mToken = await generateM2MToken(req);
      req.bearerToken = m2mToken;

      const projectUid = await this.resolveProjectIdentifier(req, identifier);
      const project = await this.projectService.getProjectById(req, projectUid, false);

      let parentFoundation = null;
      if (project.parent_uid) {
        parentFoundation = await this.projectService.getProjectById(req, project.parent_uid, false).catch(() => null);
      }

      const committees = await this.committeeService.getCommittees(req, { tags: `project_uid:${projectUid}` }, { skipMailingListEnrichment: true });
      const publicCommittees = committees.filter((c) => c.public);

      const groups = publicCommittees.map((c) =>
        this.buildGroupSummary(c, new Map([[projectUid, project]]), parentFoundation ?? project, project.parent_uid ? project : null)
      );

      const response: PublicGroupDirectoryResponse = { groups, total: groups.length };

      logger.success(req, 'get_public_groups_by_project', startTime, {
        project_uid: projectUid,
        groups_count: groups.length,
      });

      res.json(response);
    } catch (error) {
      return next(error);
    }
  }

  private async resolveProjectIdentifier(req: Request, identifier: string): Promise<string> {
    // UUID v4 pattern — treat as UID directly
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier)) {
      return identifier;
    }
    const result = await this.projectService.getProjectIdBySlug(req, identifier);
    if (!result.exists || !result.uid) {
      throw new ResourceNotFoundError('Project', identifier, {
        operation: 'resolve_project_identifier',
        service: 'public_groups_controller',
        path: `/projects/${identifier}`,
      });
    }
    return result.uid;
  }

  private async fetchPublicCommitteesForProjects(req: Request, projectUids: string[]): Promise<Committee[]> {
    const BATCH_LIMIT = 10;
    const uids = projectUids.slice(0, BATCH_LIMIT);
    const batches = await Promise.all(
      uids.map((uid) => this.committeeService.getCommittees(req, { tags: `project_uid:${uid}` }, { skipMailingListEnrichment: true }).catch(() => []))
    );
    const seen = new Set<string>();
    const result: Committee[] = [];
    for (const batch of batches) {
      for (const c of batch) {
        if (c.public && !seen.has(c.uid)) {
          seen.add(c.uid);
          result.push(c);
        }
      }
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }

  private async resolveContextProjects(req: Request, committees: Committee[]): Promise<Map<string, any>> {
    const uids = [...new Set(committees.map((c) => c.project_uid).filter(Boolean))];
    const BATCH_SIZE = 10;
    const map = new Map<string, any>();
    for (let i = 0; i < uids.length; i += BATCH_SIZE) {
      const batch = uids.slice(i, i + BATCH_SIZE);
      const projects = await Promise.all(batch.map((uid) => this.projectService.getProjectById(req, uid, false).catch(() => null)));
      for (let j = 0; j < batch.length; j++) {
        const p = projects[j];
        if (p) map.set(batch[j], p);
      }
    }
    return map;
  }

  private buildGroupSummary(committee: Committee, projectMap: Map<string, any>, foundation: any, project: any): PublicGroupSummary {
    const proj = project ?? projectMap.get(committee.project_uid) ?? null;
    const isFoundationScope = !proj || proj.uid === foundation?.uid;

    const context: PublicGroupContext = {
      scope: isFoundationScope ? 'foundation' : 'project',
      foundation_uid: foundation?.uid ?? committee.project_uid,
      foundation_name: foundation?.name ?? '',
      foundation_slug: foundation?.slug ?? '',
      foundation_logo_url: foundation?.logo_url ?? undefined,
      ...(!isFoundationScope &&
        proj && {
          project_uid: proj.uid,
          project_name: proj.name,
          project_slug: proj.slug,
          project_logo_url: proj.logo_url ?? undefined,
        }),
    };

    return {
      uid: committee.uid,
      name: committee.name,
      display_name: committee.display_name,
      description: committee.description ?? undefined,
      category: committee.category,
      behavioral_class: getGroupBehavioralClass(committee.category),
      context,
      join_mode: committee.join_mode,
      total_members: committee.total_members,
      website: committee.website,
      mailing_list: committee.mailing_list,
      chat_channel: committee.chat_channel,
      has_public_calendar: committee.calendar?.public ?? false,
    };
  }
}

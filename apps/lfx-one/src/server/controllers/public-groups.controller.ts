// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CHAIR_ROLES, UUID_REGEX } from '@lfx-one/shared/constants';
import { CommitteeMemberVisibility, MeetingVisibility } from '@lfx-one/shared/enums';
import {
  Committee,
  CommitteeMember,
  GroupsIOMailingList,
  PublicGroupContext,
  PublicGroupDetail,
  PublicGroupLinks,
  PublicGroupMeeting,
  PublicGroupMember,
  QueryServiceResponse,
} from '@lfx-one/shared/interfaces';
import { buildCommitteeCadenceSummary } from '@lfx-one/shared/utils';
import { NextFunction, Request, Response } from 'express';

import { AuthorizationError } from '../errors';
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

      let committeeUid = id;
      if (!UUID_REGEX.test(id)) {
        const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<Committee>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
          type: 'committee',
          tags: `public_name:${id}`,
          page_size: 1,
        });
        if (resources.length === 0) {
          throw new AuthorizationError('Group not found', {
            operation: 'get_public_group_by_id',
            service: 'public_groups_controller',
            path: `/groups/${id}`,
            code: 'GROUP_NOT_FOUND',
          });
        }
        committeeUid = resources[0].id;
      }

      const committee = await this.committeeService.getCommitteeById(req, committeeUid);

      if (!committee.public) {
        throw new AuthorizationError('This group is private', {
          operation: 'get_public_group_by_id',
          service: 'public_groups_controller',
          path: `/committees/${committeeUid}`,
          code: 'GROUP_PRIVATE',
        });
      }

      const [members, project, meetingsResponse, mailingListsResponse] = await Promise.all([
        this.committeeService.getCommitteeMembers(req, committeeUid),
        this.projectService.getProjectById(req, committee.project_uid, false),
        this.meetingService.getMeetings(req, { tags: `committee_uid:${committeeUid}` }, 'v1_meeting', false),
        this.microserviceProxy
          .proxyRequest<QueryServiceResponse<GroupsIOMailingList>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
            type: 'groupsio_mailing_list',
            tags: `committee_uid:${committeeUid}`,
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
        calendar: committee.calendar?.public ? `/public/api/committees/${committeeUid}/calendar.ics` : undefined,
      };

      const publicMeetings = meetingsResponse.data.filter((m) => m.visibility === MeetingVisibility.PUBLIC);
      const cadence = buildCommitteeCadenceSummary(publicMeetings);

      const detail: PublicGroupDetail = {
        uid: committee.uid,
        name: committee.name,
        public_name: committee.public_name || undefined,
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
          logger.debug(req, 'get_public_group_by_id', 'Failed to resolve caller membership', { group_uid: committeeUid });
        }
        req.bearerToken = m2mToken;
      }

      logger.success(req, 'get_public_group_by_id', startTime, {
        group_uid: committeeUid,
        group_name: committee.name,
        chairs_count: chairs.length,
        meetings_count: upcomingMeetings.length,
      });

      res.json(detail);
    } catch (error) {
      return next(error);
    }
  }
}

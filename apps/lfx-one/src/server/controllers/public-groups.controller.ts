// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommitteeMemberRole } from '@lfx-one/shared/enums';
import { CommitteeMember, PublicGroupContext, PublicGroupDetail, PublicGroupLinks, PublicGroupMeeting, PublicGroupMember } from '@lfx-one/shared/interfaces';
import { MeetingVisibility } from '@lfx-one/shared/enums';
import { NextFunction, Request, Response } from 'express';

import { ResourceNotFoundError } from '../errors';
import { validateUidParameter } from '../helpers/validation.helper';
import { logger } from '../services/logger.service';
import { CommitteeService } from '../services/committee.service';
import { MeetingService } from '../services/meeting.service';
import { ProjectService } from '../services/project.service';
import { generateM2MToken } from '../utils/m2m-token.util';

const CHAIR_ROLES = new Set<string>([CommitteeMemberRole.CHAIR, CommitteeMemberRole.VICE_CHAIR]);

export class PublicGroupsController {
  private committeeService: CommitteeService = new CommitteeService();
  private meetingService: MeetingService = new MeetingService();
  private projectService: ProjectService = new ProjectService();

  public async getPublicGroupById(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { id } = req.params;

    const startTime = logger.startOperation(req, 'get_public_group_by_id', { group_uid: id });

    try {
      if (!validateUidParameter(id, req, next, { operation: 'get_public_group_by_id', service: 'public_groups_controller' })) {
        return;
      }

      const originalToken = req.bearerToken;
      const m2mToken = await generateM2MToken(req);
      req.bearerToken = m2mToken;

      const committee = await this.committeeService.getCommitteeById(req, id);

      if (!committee.public) {
        throw new ResourceNotFoundError('Group', id, {
          operation: 'get_public_group_by_id',
          service: 'public_groups_controller',
          path: `/committees/${id}`,
        });
      }

      const [members, project, meetingsResponse] = await Promise.all([
        this.committeeService.getCommitteeMembers(req, id),
        this.projectService.getProjectById(req, committee.project_uid, false),
        this.meetingService.getMeetings(req, { tags: `committee_uid:${id}` }, 'v1_meeting', false),
      ]);

      const chairs = members
        .filter((m: CommitteeMember) => m.role?.name && CHAIR_ROLES.has(m.role.name))
        .map(
          (m: CommitteeMember): PublicGroupMember => ({
            name: `${m.first_name} ${m.last_name}`.trim(),
            organization: m.organization?.name,
            role: m.role?.name,
          })
        );

      const upcomingMeetings = meetingsResponse.data
        .filter((m) => m.visibility === MeetingVisibility.PUBLIC)
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
        ...(project?.parent_uid && {
          project_uid: project.uid,
          project_name: project.name,
          project_slug: project.slug,
        }),
      };

      const links: PublicGroupLinks = {
        website: committee.website,
        mailing_list: committee.mailing_list,
        chat_channel: committee.chat_channel,
        calendar: committee.calendar?.public ? `/public/api/committees/${id}/calendar.ics` : undefined,
      };

      const detail: PublicGroupDetail = {
        uid: committee.uid,
        name: committee.name,
        description: committee.description ?? undefined,
        category: committee.category,
        join_mode: committee.join_mode,
        total_members: committee.total_members ?? members.length,
        context,
        chairs,
        links,
        upcoming_meetings: upcomingMeetings,
        calendar_url: links.calendar ?? undefined,
        member_visibility: committee.member_visibility!,
      };

      const isAuthenticated = req.oidc?.isAuthenticated();
      if (isAuthenticated && originalToken !== undefined) {
        req.bearerToken = originalToken;
        try {
          const callerMembership = members.find(
            (m: CommitteeMember) => m.email === req.oidc?.user?.['email'] || m.username === req.oidc?.user?.['preferred_username']
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
}

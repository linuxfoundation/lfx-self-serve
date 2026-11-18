// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  CHAIR_ROLES,
  PUBLIC_FOUNDATION_GROUPS_UID_FAN_OUT_CAP,
  QUERY_SERVICE_FILTERS_OR_BATCH_SIZE,
  QUERY_SERVICE_MAX_PAGE_SIZE,
  UUID_REGEX,
} from '@lfx-one/shared/constants';
import { CommitteeMemberVisibility, MeetingVisibility } from '@lfx-one/shared/enums';
import {
  Committee,
  CommitteeMember,
  GroupsIOMailingList,
  Project,
  PublicGroupContext,
  PublicGroupDetail,
  PublicGroupDirectoryResponse,
  PublicGroupLinks,
  PublicGroupMeeting,
  PublicGroupMember,
  PublicGroupSummary,
  QueryServiceResponse,
} from '@lfx-one/shared/interfaces';
// Deep-import (not the `utils` barrel): this controller runs under plain Node in server-side
// vitest specs, and the barrel re-exports form.utils.ts, which statically imports
// @angular/forms and crashes JIT compilation outside Angular's own runtime (GH-2381).
import { getGroupBehavioralClass } from '@lfx-one/shared/utils/committee.utils';
import { buildCommitteeCadenceSummary } from '@lfx-one/shared/utils/meeting.utils';
import { isPubliclyDiscoverableProject } from '@lfx-one/shared/utils/project-stage.utils';
import { NextFunction, Request, Response } from 'express';

import { AuthorizationError, isBaseApiError, ResourceNotFoundError } from '../errors';
import { fetchAllQueryResources } from '../helpers/query-service.helper';
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

      // Include misses before the owning-project gate so every not-found path is non-cacheable.
      res.setHeader('Cache-Control', 'no-store');

      const originalToken = req.bearerToken;
      // M2M token required: public endpoint has no user session; app credentials needed for upstream calls
      const m2mToken = await generateM2MToken(req);
      req.bearerToken = m2mToken;

      const committeeUid = await this.committeeService.resolveCommitteeUid(req, id, {
        operation: 'get_public_group_by_id',
        service: 'public_groups_controller',
        path: `/groups/${id}`,
        resourceType: 'Group',
      });

      // An unknown group UUID gets the same not-found error as an unknown group slug (which resolveCommitteeUid
      // throws above) and as a group under a hidden project (below), so the three are indistinguishable.
      const committee = await this.committeeService.getCommitteeById(req, committeeUid).catch((error: unknown) => {
        if (isBaseApiError(error) && error.statusCode === 404) {
          throw this.groupNotFoundError(id);
        }
        throw error;
      });

      // Gate before revealing group privacy or fetching related data. Hidden or temporarily unresolvable
      // owning projects get the same refusal as an unknown group (lfx-self-serve-ops#437).
      const project = await this.projectService.getPubliclyDiscoverableProject(req, committee.project_uid).catch((error: unknown) => {
        logger.warning(req, 'get_public_group_by_id', 'Owning project lookup failed; answering group as not found', {
          project_uid: committee.project_uid,
          err: error,
        });
        return null;
      });
      if (!project) {
        throw this.groupNotFoundError(id);
      }

      if (!committee.public) {
        throw new AuthorizationError('This group is private', {
          operation: 'get_public_group_by_id',
          service: 'public_groups_controller',
          path: `/committees/${committeeUid}`,
          code: 'GROUP_PRIVATE',
        });
      }

      const [members, meetingsResponse, mailingListsResponse] = await Promise.all([
        this.committeeService.getCommitteeMembers(req, committeeUid),
        this.meetingService.getMeetings(req, { tags: `committee_uid:${committeeUid}` }, 'v1_meeting', false),
        this.microserviceProxy
          .proxyRequest<QueryServiceResponse<GroupsIOMailingList>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
            type: 'groupsio_mailing_list',
            tags: `committee_uid:${committeeUid}`,
          })
          .catch(() => ({ resources: [] })),
      ]);

      const hasPublicMailingList = mailingListsResponse.resources.some((r) => r.data.public);

      // Fail closed: only an explicit `basic_profile` exposes chairs. Unset or unrecognised values
      // are treated as hidden, matching the shared `canViewCommitteeRoster` rule.
      const visibility =
        committee.member_visibility === CommitteeMemberVisibility.BASIC_PROFILE ? CommitteeMemberVisibility.BASIC_PROFILE : CommitteeMemberVisibility.HIDDEN;
      const chairs =
        visibility !== CommitteeMemberVisibility.BASIC_PROFILE
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

      // A hidden parent, or a failed lookup, leaves the project top-level.
      const parentProject = project.parent_uid ? await this.getDiscoverableParent(req, 'get_public_group_by_id', project.parent_uid) : null;

      const context: PublicGroupContext = {
        scope: parentProject ? 'project' : 'foundation',
        foundation_uid: parentProject?.uid || project.uid || committee.project_uid,
        foundation_name: parentProject?.name || project.name || '',
        foundation_slug: parentProject?.slug || project.slug || '',
        foundation_logo_url: parentProject?.logo_url || project.logo_url || undefined,
        ...(parentProject && {
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
        sso_group_name: committee.sso_group_name || undefined,
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
        // Passthrough of committee-service's ExternalSource[] contract (committee-service PR #175).
        external_sources: committee.external_sources,
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

  public async getPublicGroupsByFoundation(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { identifier } = req.params;
    const startTime = logger.startOperation(req, 'get_public_groups_by_foundation', { identifier });

    try {
      // M2M token required: public endpoint with no user session; app credentials needed for upstream calls
      const m2mToken = await generateM2MToken(req);
      req.bearerToken = m2mToken;

      const isFoundationUid = UUID_REGEX.test(identifier);
      if (!isFoundationUid) {
        res.setHeader('Cache-Control', 'no-store');
      }

      const foundationUid = await this.resolveProjectIdentifier(req, identifier);
      // Slugs whose metadata is hidden or unavailable share the unknown-slug refusal. UID metadata
      // failures still propagate (lfx-self-serve-ops#437).
      const foundation = await this.projectService.getPubliclyDiscoverableProject(req, foundationUid).catch((error: unknown) => {
        if (isFoundationUid) {
          throw error;
        }
        logger.warning(req, 'get_public_groups_by_foundation', 'Foundation lookup failed; answering slug as not found', {
          project_uid: foundationUid,
          err: error,
        });
        return null;
      });
      if (!foundation) {
        throw this.projectNotFoundError(identifier);
      }
      const childUids = await this.projectService.getFoundationProjectUids(req, foundationUid);

      // getFoundationProjectUids resolves the full nested sub-foundation tree (GH-2382), so
      // childUids can legitimately number in the hundreds for a large umbrella foundation.
      // fetchPublicCommitteesForProjects and resolveContextProjects batch upstream queries at
      // QUERY_SERVICE_FILTERS_OR_BATCH_SIZE (100 UIDs per filters_or request), and
      // PUBLIC_FOUNDATION_GROUPS_UID_FAN_OUT_CAP bounds the per-request project scope on this
      // public/unauthenticated endpoint independently of getFoundationProjectUids's own traversal
      // caps (PR #2436 review).
      //
      // childUids is a Set-insertion-ordered array from getFoundationProjectUids: container UIDs
      // land first, but leaf children are appended as concurrent workers finish, so raw insertion
      // order is non-deterministic across otherwise-identical requests. Sort before slicing so a
      // truncated directory is at least stable/reproducible rather than changing between calls
      // (Copilot + Cursor Bugbot review), and surface the truncation explicitly via `truncated` on
      // the response instead of silently returning an incomplete-looking-complete directory.
      let scopedUids = childUids;
      let truncated = false;
      if (childUids.length > PUBLIC_FOUNDATION_GROUPS_UID_FAN_OUT_CAP) {
        truncated = true;
        logger.warning(req, 'get_public_groups_by_foundation', 'Truncating project UID fan-out for public groups endpoint', {
          foundation_uid: foundationUid,
          uid_count: childUids.length,
          cap: PUBLIC_FOUNDATION_GROUPS_UID_FAN_OUT_CAP,
        });
        // Pin foundationUid so the cap never drops the viewed foundation's own directly-attached
        // committees — sorting the full list can otherwise exclude it (Copilot + Cursor Bugbot review).
        const remaining = childUids.filter((uid) => uid !== foundationUid).sort();
        scopedUids = [foundationUid, ...remaining].slice(0, PUBLIC_FOUNDATION_GROUPS_UID_FAN_OUT_CAP);
      }

      const allCommittees = await this.fetchPublicCommitteesForProjects(req, scopedUids);
      const projects = await this.resolveContextProjects(req, allCommittees);

      // Drop committees whose owning child project is hidden or unconfirmed, so a confidential child
      // project's name can never surface as group context (lfx-self-serve-ops#437).
      const groups = allCommittees
        .filter((c) => c.project_uid === foundationUid || projects.get(c.project_uid))
        .map((c) => this.buildGroupSummary(c, projects, foundation, null));

      const response: PublicGroupDirectoryResponse = { groups, total: groups.length, ...(truncated ? { truncated: true } : {}) };

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

      const isProjectUid = UUID_REGEX.test(identifier);
      if (!isProjectUid) {
        res.setHeader('Cache-Control', 'no-store');
      }

      const projectUid = await this.resolveProjectIdentifier(req, identifier);
      // Slugs whose metadata is hidden or unavailable share the unknown-slug refusal. UID metadata
      // failures still propagate (lfx-self-serve-ops#437).
      const project = await this.projectService.getPubliclyDiscoverableProject(req, projectUid).catch((error: unknown) => {
        if (isProjectUid) {
          throw error;
        }
        logger.warning(req, 'get_public_groups_by_project', 'Project lookup failed; answering slug as not found', { project_uid: projectUid, err: error });
        return null;
      });
      if (!project) {
        throw this.projectNotFoundError(identifier);
      }

      let parentFoundation = null;
      if (project.parent_uid) {
        // A hidden parent, or a failed lookup, leaves the project top-level.
        const candidate = await this.getDiscoverableParent(req, 'get_public_groups_by_project', project.parent_uid);
        // ROOT is an administrative pseudo-project — treat its children as top-level foundations
        if (candidate && candidate.slug !== 'ROOT') {
          parentFoundation = candidate;
        }
      }

      const committees = await this.committeeService.getCommittees(req, { tags: `project_uid:${projectUid}` }, { skipMailingListEnrichment: true });
      const publicCommittees = committees.filter((c) => c.public);

      const groups = publicCommittees
        .map((c) => this.buildGroupSummary(c, new Map([[projectUid, project]]), parentFoundation ?? project, project.parent_uid ? project : null))
        .sort((a, b) => a.name.localeCompare(b.name, 'en'));

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
    // Treat UUIDs as UIDs directly, using the same classification as the public error policy above.
    if (UUID_REGEX.test(identifier)) {
      return identifier;
    }
    const result = await this.projectService.getProjectIdBySlug(req, identifier);
    if (!result.exists || !result.uid) {
      throw this.projectNotFoundError(identifier);
    }
    return result.uid;
  }

  /** The not-found error for an unknown project identifier — also thrown for a hidden one, so the two are indistinguishable. */
  private projectNotFoundError(identifier: string): ResourceNotFoundError {
    return new ResourceNotFoundError('Project', identifier, {
      operation: 'resolve_project_identifier',
      service: 'public_groups_controller',
      path: `/projects/${identifier}`,
    });
  }

  /** The not-found error resolveCommitteeUid throws for an unknown group slug on `/groups/:id` — reused for every other not-found case there. */
  private groupNotFoundError(id: string): ResourceNotFoundError {
    return new ResourceNotFoundError('Group', id, { operation: 'get_public_group_by_id', service: 'public_groups_controller', path: `/groups/${id}` });
  }

  /**
   * A parent foundation only feeds group context, so a transient lookup failure degrades to "top-level"
   * rather than failing the route; a hidden parent is null either way (lfx-self-serve-ops#437).
   */
  private async getDiscoverableParent(req: Request, operation: string, parentUid: string): Promise<Project | null> {
    try {
      return await this.projectService.getPubliclyDiscoverableProject(req, parentUid);
    } catch (error) {
      logger.warning(req, operation, 'Parent foundation lookup failed, treating project as top-level', { parent_uid: parentUid, err: error });
      return null;
    }
  }

  private async fetchPublicCommitteesForProjects(req: Request, projectUids: string[]): Promise<Committee[]> {
    const uniqueUids = Array.from(new Set(projectUids)).filter(Boolean);
    if (uniqueUids.length === 0) {
      return [];
    }

    const batches: string[][] = [];
    for (let i = 0; i < uniqueUids.length; i += QUERY_SERVICE_FILTERS_OR_BATCH_SIZE) {
      batches.push(uniqueUids.slice(i, i + QUERY_SERVICE_FILTERS_OR_BATCH_SIZE));
    }

    const batchResults = await Promise.all(
      batches.map(async (batch) => {
        try {
          return await fetchAllQueryResources<Committee>(
            req,
            (pageToken) =>
              this.microserviceProxy.proxyRequest<QueryServiceResponse<Committee>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
                type: 'committee',
                filters_or: batch.map((uid) => `project_uid:${uid}`),
                page_size: QUERY_SERVICE_MAX_PAGE_SIZE,
                ...(pageToken && { page_token: pageToken }),
              }),
            { failOnPartial: true }
          );
        } catch (error) {
          logger.warning(req, 'fetch_public_committees_for_projects', 'Batched committee fetch failed', {
            batch_size: batch.length,
            err: error,
          });
          throw error;
        }
      })
    );

    const seen = new Set<string>();
    const result: Committee[] = [];
    for (const committee of batchResults.flat()) {
      if (committee?.uid && committee.public === true && !seen.has(committee.uid)) {
        seen.add(committee.uid);
        result.push(committee);
      }
    }

    return result.sort((a, b) => a.name.localeCompare(b.name, 'en'));
  }

  private async resolveContextProjects(req: Request, committees: Committee[]): Promise<Map<string, Project>> {
    const uids = [...new Set(committees.map((c) => c.project_uid).filter(Boolean))];
    if (uids.length === 0) {
      return new Map();
    }

    const byUid = await this.projectService.getProjectsByIds(req, uids).catch((error: unknown) => {
      logger.warning(req, 'resolve_context_projects', 'Batched project lookup failed, dropping child committees from the directory', {
        uid_count: uids.length,
        err: error,
      });
      return new Map<string, Project>();
    });

    const discoverable = new Map<string, Project>();
    for (const [uid, project] of byUid) {
      if (isPubliclyDiscoverableProject(project)) {
        discoverable.set(uid, project);
      }
    }
    return discoverable;
  }

  private buildGroupSummary(committee: Committee, projectMap: Map<string, Project>, foundation: Project | null, project: Project | null): PublicGroupSummary {
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
      has_public_calendar: committee.calendar?.public ?? false,
    };
  }
}

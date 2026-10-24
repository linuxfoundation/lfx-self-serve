// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CHAIR_ROLES, MKTG_ARTIFACT_PARTITION_REGEX, MKTG_PROJECT_TOC_CATEGORY } from '@lfx-one/shared/constants';
import { CommitteeMemberRole, CommitteeMemberStatus } from '@lfx-one/shared/enums';
import type { MktgProjectRole, MktgProjectRoles } from '@lfx-one/shared/interfaces';
import { canViewCommitteeRoster, maskEmailForLogs } from '@lfx-one/shared/utils';
import type { Request } from 'express';

import { isBaseApiError, ServiceValidationError } from '../errors';
import { CommitteeService } from './committee.service';
import { logger } from './logger.service';
import { ProjectService } from './project.service';

/** Caller-scoped roster scaffold, not a grant. TOC name/username are visibility-gated; opaque subject is not. B2/B3 provisional. */
export class MktgProjectRolesService {
  private readonly projectService = new ProjectService();
  private readonly committeeService = new CommitteeService();
  private readonly requests = new WeakMap<Request, Map<string, Promise<MktgProjectRoles>>>();

  /** Only request/project scoped: concurrent consumers share the same source reads, not another caller's roster. */
  public rolesOf(req: Request, project: string): Promise<MktgProjectRoles> {
    if (!MKTG_ARTIFACT_PARTITION_REGEX.test(project)) return Promise.reject(ServiceValidationError.forField('project', 'Invalid project uid'));
    let projects = this.requests.get(req);
    if (!projects) {
      projects = new Map();
      this.requests.set(req, projects);
    }
    let roles = projects.get(project);
    if (!roles) {
      roles = Promise.all([this.executiveDirectorOf(req, project), this.tocChairOf(req, project)]).then(([ed, tocChair]) => ({ ed, tocChair }));
      projects.set(project, roles);
    }
    return roles;
  }

  /** Provisional B2: project settings supplies the person; FGA decision authorization is a later policy seam. */
  private async executiveDirectorOf(req: Request, project: string): Promise<MktgProjectRole | null> {
    try {
      const person = (await this.projectService.getProjectSettings(req, project)).executive_director;
      return person ? await this.subjectOf(req, 'ed', person.name, person.email, person.username) : null;
    } catch (error) {
      if (!isBaseApiError(error)) throw error;
      logger.warning(req, 'mktg_project_roles_read', 'Executive director roster is unresolved', { role: 'ed', code: error.code });
      return null;
    }
  }

  /** Provisional B3: caller-visible exact TOC; prefer one active Chair, else one Vice Chair. Real ties remain unresolved. */
  private async tocChairOf(req: Request, project: string): Promise<MktgProjectRole | null> {
    try {
      const committees = await this.committeeService.getCommittees(
        req,
        { tags: `project_uid:${project}` },
        { skipMailingListEnrichment: true, requireComplete: true }
      );
      const toc = committees.filter((committee) => committee.project_uid === project && committee.category === MKTG_PROJECT_TOC_CATEGORY);
      if (toc.length !== 1) return null;
      const committee = toc[0];
      const members = await this.committeeService.getCommitteeMembers(req, committee.uid, { require_complete: 'true' });
      const chairs = members.filter(
        (member) => member.committee_uid === committee.uid && member.status === CommitteeMemberStatus.ACTIVE && CHAIR_ROLES.has(member.role?.name ?? '')
      );
      const primary = chairs.filter((member) => member.role?.name === CommitteeMemberRole.CHAIR);
      const preferred = primary.length ? primary : chairs;
      if (preferred.length !== 1) return null;
      const chair = preferred[0];
      const person = await this.subjectOf(req, 'tocChair', `${chair.first_name ?? ''} ${chair.last_name ?? ''}`.trim(), chair.email, chair.username);
      let visible = false;
      try {
        const detail = await this.committeeService.getCommitteeById(req, committee.uid, { includeAuditor: true });
        visible = detail.uid === committee.uid && detail.project_uid === project && canViewCommitteeRoster(detail);
      } catch (error) {
        if (!isBaseApiError(error)) throw error;
        logger.warning(req, 'mktg_project_roles_visibility', 'Chair display is unavailable', { role: 'tocChair', code: error.code });
      }
      return visible ? person : { name: null, subject: person.subject };
    } catch (error) {
      if (!isBaseApiError(error)) throw error;
      logger.warning(req, 'mktg_project_roles_read', 'TOC chair roster is unresolved', { role: 'tocChair', code: error.code });
      return null;
    }
  }

  /** Order 6: existing directory EMAIL_TO_SUB lookup, never a guessed getUserInfo field or username hash. */
  private async subjectOf(
    req: Request,
    role: keyof MktgProjectRoles,
    name: string | null | undefined,
    email: string | undefined,
    username?: string
  ): Promise<MktgProjectRole> {
    const person: MktgProjectRole = { name: name?.trim() || null, subject: null, ...(username?.trim() ? { username: username.trim() } : {}) };
    if (!email?.trim()) return person;
    try {
      const subject = await this.projectService.resolveEmailToSub(req, email);
      if (subject.trim()) person.subject = subject;
    } catch (error) {
      if (!isBaseApiError(error)) throw error;
      // Do not attach error.message/err: upstream failures may carry the lookup's raw address.
      logger.warning(req, 'mktg_project_roles_subject', 'Role subject is unresolved', { role, email: maskEmailForLogs(email), code: error.code });
    }
    return person;
  }
}

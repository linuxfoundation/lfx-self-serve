// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  FORMATION_TEAM_NAME,
  PROJECT_APPLICATION_PARENT_KEY,
  PROJECT_APPLICATION_PROJECT_UID_KEY,
  PROJECT_APPLICATION_SLUG_KEY,
} from '@lfx-one/shared/constants';
import type {
  CreateProjectRequest,
  Project,
  ProjectApplication,
  ProjectApplicationAction,
  ProjectApplicationAnswers,
  ProjectApplicationWriteResult,
  QueryServiceResponse,
  UpstreamCreateProjectApplicationRequest,
  UpstreamProjectApplication,
  UpstreamProjectApplicationDoc,
} from '@lfx-one/shared/interfaces';
import { buildCreateProjectRequest, normalizeProjectApplicationDoc, normalizeUpstreamProjectApplication } from '@lfx-one/shared/utils';
import { Request } from 'express';

import { AuthorizationError, ConflictError, InvalidRequestError, isMicroserviceError, PreconditionFailedError, ResourceNotFoundError } from '../errors';
import { fetchAllQueryResources } from '../helpers/query-service.helper';
import { stripAuthPrefix } from '../utils/auth-helper';
import { generateM2MToken } from '../utils/m2m-token.util';
import { AccessCheckService } from './access-check.service';
import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';
import { ProjectService } from './project.service';

/**
 * BFF for project applications — "Propose a project" (#3037), backed by `lfx-v2-formation-service`'s
 * `/project-applications` routes (#1962).
 *
 * - Writes go to formation-service. Create uses the self-serve M2M token (the gateway admits only
 *   `team:global_project_application_admin`, which the M2M principal holds, so "any signed-in user may
 *   propose" needs no per-user grant); every other write uses the caller's own token so OpenFGA decides
 *   whether they are the submitter (`writer`) or the formation team (`formation_team`).
 * - Reads go to query-service (`type=project_application`) with the caller's token; query-service returns
 *   only documents the caller may view. There is no formation-service read route by design.
 * - Every mutation after create carries `If-Match: <revision>`.
 */
export class ProjectApplicationService {
  private readonly microserviceProxy = new MicroserviceProxyService();
  private readonly accessCheckService = new AccessCheckService();
  private readonly projectService = new ProjectService();

  /**
   * The signed-in user's own applications. The `submitter:` tag narrows the search; query-service's
   * per-document access check is the authorization. The client-side backstop drops any document not
   * submitted by the caller — a formation-team member's "mine" list must not become the whole queue.
   */
  public async listMine(req: Request, username: string): Promise<ProjectApplication[]> {
    const normalizedUsername = stripAuthPrefix(username);
    const docs = await this.queryApplications(req, [`submitter:${normalizedUsername}`], 'list_my_project_applications');
    const mine = docs.filter((doc) => doc.submitter_username === normalizedUsername);
    if (mine.length !== docs.length) {
      logger.warning(req, 'list_my_project_applications', 'Dropped index rows not submitted by the caller', { dropped: docs.length - mine.length });
    }
    return this.sortNewestFirst(mine.map(normalizeProjectApplicationDoc));
  }

  /** The formation team's review queue — every application the caller may view, with no project-tree filter. */
  public async listQueue(req: Request): Promise<ProjectApplication[]> {
    const docs = await this.queryApplications(req, undefined, 'list_project_application_queue');
    return this.sortNewestFirst(docs.map(normalizeProjectApplicationDoc));
  }

  /** Whether the caller is on the formation team — gates the queue tab and staff-only actions in the UI. Fails closed. */
  public async isFormationTeamMember(req: Request): Promise<boolean> {
    return this.accessCheckService.checkSingleAccess(req, { resource: 'team', id: FORMATION_TEAM_NAME, access: 'member' });
  }

  /**
   * The same check for write decisions: an access-check outage throws instead of reading as "not a member",
   * so a write aborts rather than silently dropping the stored parent or misreporting the outage as a 403.
   */
  public async isFormationTeamMemberStrict(req: Request): Promise<boolean> {
    return this.accessCheckService.checkSingleAccessStrict(req, { resource: 'team', id: FORMATION_TEAM_NAME, access: 'member' });
  }

  /**
   * Submits an application as the signed-in user. The identity is copied from the session by the
   * controller, never from the browser. M2M is the credential the formation-service contract requires
   * for create (the self-serve principal is the trusted intake client); the route has already
   * required a session and refused impersonation, and the submitter identity in the payload keeps the
   * action attributable to the human who made it.
   */
  public async create(req: Request, payload: UpstreamCreateProjectApplicationRequest): Promise<ProjectApplicationWriteResult> {
    const m2mToken = await generateM2MToken(req);
    try {
      const response = await this.microserviceProxy.proxyRequestWithResponse<UpstreamProjectApplication>(
        req,
        'LFX_V2_FORMATION_SERVICE',
        '/project-applications',
        'POST',
        undefined,
        payload,
        undefined,
        { bearerToken: m2mToken }
      );
      return { application: normalizeUpstreamProjectApplication(response.data), etag: this.readEtag(response.headers) };
    } catch (error) {
      throw this.mapWriteError(error, req, 'create_project_application', 'new');
    }
  }

  /** Replaces the complete answer map. The caller sends the whole object so unknown keys survive. */
  public async revise(req: Request, uid: string, ifMatch: string, application: ProjectApplicationAnswers): Promise<ProjectApplicationWriteResult> {
    return this.write(req, uid, `/project-applications/${encodeURIComponent(uid)}`, 'PUT', ifMatch, { application }, 'revise_project_application');
  }

  public async withdraw(req: Request, uid: string, ifMatch: string): Promise<ProjectApplicationWriteResult> {
    return this.transition(req, uid, ifMatch, 'withdraw');
  }

  public async deny(req: Request, uid: string, ifMatch: string): Promise<ProjectApplicationWriteResult> {
    return this.transition(req, uid, ifMatch, 'deny');
  }

  /**
   * Records the formation team's choices, creates the project, then accepts (#1995). formation-service's
   * accept route takes no body and creates nothing, so:
   *
   * 1. Revise at the caller's held revision, adding `parent_project_uid` and `project_slug`. This is the
   *    optimistic-concurrency check, and it records what the team chose before anything is created.
   * 2. Create the project in project-service under that parent with the caller's own token — project-service's
   *    FGA decides whether they may create under the parent — then revise again to record its `project_uid`.
   *    When the answers already carry a `project_uid` (a retry after the create landed but a later step
   *    failed), the create is skipped and the recorded parent and slug are kept, so the project is never
   *    created twice. When the uid was lost before it was recorded, the create's slug conflict adopts the
   *    earlier project if it is under the same parent with the same name.
   * 3. Accept at the latest revision.
   *
   * The create comes before the accept so a refused create (slug taken, no permission) leaves the application
   * submitted rather than accepted with no project. Revise is guarded upstream on `writer`, which the submitter
   * also holds, while accept needs `formation_team`; the membership pre-check keeps a non-team caller from
   * committing any step. Any failure throws; the caller's held revision is then stale, so the UI never replays
   * a write — it drops the application on a 404 and reloads on anything else.
   */
  public async accept(
    req: Request,
    uid: string,
    ifMatch: string,
    application: ProjectApplicationAnswers,
    parentProjectUid: string,
    projectSlug: string
  ): Promise<ProjectApplicationWriteResult> {
    await this.assertFormationTeamMember(req, 'accept_project_application');
    // Once the project exists, its recorded parent and slug are the truth: a retry must not rewrite them to
    // choices that no longer describe the project.
    const recordedProjectUid = this.recordedString(application, PROJECT_APPLICATION_PROJECT_UID_KEY);
    const parent = (recordedProjectUid && this.recordedString(application, PROJECT_APPLICATION_PARENT_KEY)) || parentProjectUid;
    const slug = (recordedProjectUid && this.recordedString(application, PROJECT_APPLICATION_SLUG_KEY)) || projectSlug;

    let current = await this.revise(req, uid, ifMatch, {
      ...application,
      [PROJECT_APPLICATION_PARENT_KEY]: parent,
      [PROJECT_APPLICATION_SLUG_KEY]: slug,
    });

    const existingProjectUid = this.recordedString(current.application.application, PROJECT_APPLICATION_PROJECT_UID_KEY);
    if (existingProjectUid) {
      logger.info(req, 'accept_project_application', 'Project already created for this application; skipping create', { uid, project_uid: existingProjectUid });
    } else {
      const project = await this.createProject(req, uid, buildCreateProjectRequest(current.application.application, parent, slug));
      current = await this.revise(req, uid, String(current.application.revision), {
        ...current.application.application,
        [PROJECT_APPLICATION_PROJECT_UID_KEY]: project.uid,
      });
    }

    return this.transition(req, uid, String(current.application.revision), 'accept');
  }

  /**
   * Refuses the call unless the caller is on the formation team. Used for BFF-side guards that exist
   * only to avoid a half-applied multi-step write; upstream OpenFGA remains the authorization.
   */
  public async assertFormationTeamMember(req: Request, operation: string): Promise<void> {
    if (!(await this.isFormationTeamMemberStrict(req))) {
      throw new AuthorizationError('Only the formation team can perform this action', {
        operation,
        service: 'formation_service',
        path: req.path,
        code: 'PROJECT_APPLICATION_FORBIDDEN',
      });
    }
  }

  /** Deletes the application and its indexed document. Upstream returns 204. */
  public async remove(req: Request, uid: string, ifMatch: string): Promise<void> {
    try {
      await this.microserviceProxy.proxyRequest<null>(
        req,
        'LFX_V2_FORMATION_SERVICE',
        `/project-applications/${encodeURIComponent(uid)}`,
        'DELETE',
        undefined,
        undefined,
        {
          'If-Match': ifMatch,
        }
      );
    } catch (error) {
      throw this.mapWriteError(error, req, 'delete_project_application', uid);
    }
  }

  /**
   * project-service `POST /projects` with the caller's token. `X-Sync` waits for the indexer, so the project is
   * searchable (e.g. as a parent in the accept dialog) as soon as the accept returns.
   */
  private async createProject(req: Request, uid: string, body: CreateProjectRequest): Promise<Project> {
    const operation = 'create_project_from_application';
    try {
      const project = await this.microserviceProxy.proxyRequest<Project>(req, 'LFX_V2_SERVICE', '/projects', 'POST', undefined, body, { 'X-Sync': 'true' });
      logger.info(req, operation, 'Created project for accepted application', { uid, project_uid: project.uid, slug: body.slug });
      return project;
    } catch (error) {
      if (isMicroserviceError(error) && error.statusCode === 409) {
        const adopted = await this.findProjectCreatedEarlier(req, body);
        if (adopted) {
          logger.warning(req, operation, "Slug conflict is this application's own earlier create; adopting that project", {
            uid,
            project_uid: adopted.uid,
            slug: body.slug,
          });
          return adopted;
        }
      }
      throw this.mapCreateProjectError(error, req, operation, uid, body.slug);
    }
  }

  /**
   * After a slug conflict, finds the project an earlier accept of this same application created but never got
   * to record — its uid lost to a failed follow-up revise, or wiped by a submitter's revise (which drops staff
   * keys). It is adopted only when it sits under the same parent with the same name; anything else is a
   * genuine conflict. A failed lookup reads as "not found", so the caller surfaces the conflict.
   */
  private async findProjectCreatedEarlier(req: Request, body: CreateProjectRequest): Promise<Project | null> {
    try {
      const { exists, uid } = await this.projectService.getProjectIdBySlug(req, body.slug);
      if (!exists || !uid) {
        return null;
      }
      const project = await this.microserviceProxy.proxyRequest<Project>(req, 'LFX_V2_SERVICE', `/projects/${encodeURIComponent(uid)}`, 'GET');
      return project?.parent_uid === body.parent_uid && project.name === body.name ? project : null;
    } catch {
      return null;
    }
  }

  private recordedString(answers: ProjectApplicationAnswers, key: string): string {
    const value = answers[key];
    return typeof value === 'string' ? value : '';
  }

  private transition(req: Request, uid: string, ifMatch: string, action: ProjectApplicationAction): Promise<ProjectApplicationWriteResult> {
    return this.write(req, uid, `/project-applications/${encodeURIComponent(uid)}/${action}`, 'POST', ifMatch, undefined, `${action}_project_application`);
  }

  private async write(
    req: Request,
    uid: string,
    path: string,
    method: 'PUT' | 'POST',
    ifMatch: string,
    body: Record<string, unknown> | undefined,
    operation: string
  ): Promise<ProjectApplicationWriteResult> {
    try {
      const response = await this.microserviceProxy.proxyRequestWithResponse<UpstreamProjectApplication>(
        req,
        'LFX_V2_FORMATION_SERVICE',
        path,
        method,
        undefined,
        body,
        {
          'If-Match': ifMatch,
        }
      );
      return { application: normalizeUpstreamProjectApplication(response.data), etag: this.readEtag(response.headers) };
    } catch (error) {
      throw this.mapWriteError(error, req, operation, uid);
    }
  }

  private async queryApplications(req: Request, tags: string[] | undefined, operation: string): Promise<UpstreamProjectApplicationDoc[]> {
    logger.debug(req, operation, 'Querying project applications', { tagged: Boolean(tags) });
    return fetchAllQueryResources<UpstreamProjectApplicationDoc>(
      req,
      (pageToken) =>
        this.microserviceProxy.proxyRequest<QueryServiceResponse<UpstreamProjectApplicationDoc>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
          type: 'project_application',
          ...(tags && { tags }),
          page_size: 100,
          ...(pageToken && { page_token: pageToken }),
        }),
      { failOnPartial: true }
    );
  }

  private sortNewestFirst(applications: ProjectApplication[]): ProjectApplication[] {
    return [...applications].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));
  }

  /** Upstream sends the next revision as a bare-digit `ETag`; tolerate a quoted form defensively. */
  private readEtag(headers: Record<string, string> | undefined): string | null {
    const raw = headers?.['etag'] ?? headers?.['ETag'];
    if (!raw) {
      return null;
    }
    return raw.replace(/^W\//, '').replace(/"/g, '').trim() || null;
  }

  /**
   * Maps formation-service write errors onto BFF error classes by status and `reason` — mirroring
   * `FormationService.mapFormationWriteError`. The upstream message names the field and expected shape;
   * at most it quotes the caller's own input back to them (e.g. a `formation_list` entry), so it is safe to
   * show the caller. Only uid, status and reason are logged — never answers or messages.
   */
  private mapWriteError(error: unknown, req: Request, operation: string, uid: string): unknown {
    if (!isMicroserviceError(error)) {
      return error;
    }
    const options = { operation, service: 'formation_service', path: req.path };
    const reason = typeof error.errorBody?.reason === 'string' ? error.errorBody.reason : undefined;
    logger.warning(req, operation, 'Project application write refused upstream', { uid, status: error.statusCode, reason });

    switch (error.statusCode) {
      case 400:
        return new InvalidRequestError(error.errorBody?.message ?? 'The application is invalid', (reason ?? 'invalid_request').toUpperCase(), options);
      case 403:
        return new AuthorizationError('You do not have permission to perform this action on the application', {
          ...options,
          code: 'PROJECT_APPLICATION_FORBIDDEN',
        });
      case 404:
        return new ResourceNotFoundError('ProjectApplication', uid, options);
      case 409:
        return new ConflictError(
          error.errorBody?.message ?? "The requested change conflicts with the application's current state",
          (reason ?? 'conflict').toUpperCase(),
          options
        );
      case 412:
        return new PreconditionFailedError(error.errorBody?.message ?? 'The application changed since it was loaded', options);
      default:
        return error;
    }
  }

  /**
   * Maps project-service create errors. A slug conflict and a missing grant on the parent are the expected
   * refusals, so both get a message the formation team can act on. Only uid, slug and status are logged.
   */
  private mapCreateProjectError(error: unknown, req: Request, operation: string, uid: string, slug: string): unknown {
    if (!isMicroserviceError(error)) {
      return error;
    }
    const options = { operation, service: 'project_service', path: req.path };
    logger.warning(req, operation, 'Project create refused upstream', { uid, slug, status: error.statusCode });

    switch (error.statusCode) {
      case 400:
        return new InvalidRequestError(error.errorBody?.message ?? 'The project could not be created from this application', 'INVALID_PROJECT', options);
      case 403:
        return new AuthorizationError('You do not have permission to create a project under the chosen parent project', {
          ...options,
          code: 'PROJECT_CREATE_FORBIDDEN',
        });
      case 409:
        return new ConflictError(`The project slug "${slug}" is already used by another project; choose another`, 'PROJECT_SLUG_CONFLICT', options);
      default:
        return error;
    }
  }
}

export const projectApplicationService = new ProjectApplicationService();

// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FORMATION_TEAM_NAME, PROJECT_APPLICATION_PARENT_KEY } from '@lfx-one/shared/constants';
import type {
  ProjectApplication,
  ProjectApplicationAction,
  ProjectApplicationAnswers,
  ProjectApplicationWriteResult,
  QueryServiceResponse,
  UpstreamCreateProjectApplicationRequest,
  UpstreamProjectApplication,
  UpstreamProjectApplicationDoc,
} from '@lfx-one/shared/interfaces';
import { normalizeProjectApplicationDoc, normalizeUpstreamProjectApplication } from '@lfx-one/shared/utils';
import { Request } from 'express';

import { AuthorizationError, ConflictError, InvalidRequestError, isMicroserviceError, PreconditionFailedError, ResourceNotFoundError } from '../errors';
import { fetchAllQueryResources } from '../helpers/query-service.helper';
import { stripAuthPrefix } from '../utils/auth-helper';
import { generateM2MToken } from '../utils/m2m-token.util';
import { AccessCheckService } from './access-check.service';
import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';

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
   * Records the formation team's chosen parent, then accepts. formation-service's accept route takes no
   * body, so the parent travels as `application.parent_project_uid` (a product decision on #3037 — the
   * downstream project create reads it; formation-service itself keeps it as an unknown answer key) via a
   * revise first, and accept then runs at the revision that revise returned.
   *
   * Revise is guarded upstream on `writer`, which the submitter also holds, while accept needs
   * `formation_team`. The membership pre-check keeps a non-team caller from committing the revise and
   * then being refused the accept. The gateway's check on accept remains the real authorization. A
   * failure after the revise landed still throws; the caller's held revision is then stale, so the UI
   * never replays either write — it drops the application on a 404 and reloads on anything else.
   */
  public async accept(
    req: Request,
    uid: string,
    ifMatch: string,
    application: ProjectApplicationAnswers,
    parentProjectUid: string
  ): Promise<ProjectApplicationWriteResult> {
    await this.assertFormationTeamMember(req, 'accept_project_application');
    const revised = await this.revise(req, uid, ifMatch, { ...application, [PROJECT_APPLICATION_PARENT_KEY]: parentProjectUid });
    return this.transition(req, uid, String(revised.application.revision), 'accept');
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
}

export const projectApplicationService = new ProjectApplicationService();

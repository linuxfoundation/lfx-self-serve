// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NEWSLETTER_COMMITTEE_CATEGORY, UUID_REGEX } from '@lfx-one/shared/constants';
import {
  ApiRequestOptions,
  Committee,
  CreateCommitteeMemberRequest,
  NewsletterSignupResponse,
  Project,
  PublicNewsletterSignupInfo,
} from '@lfx-one/shared/interfaces';
// Deep-import (not the `utils` barrel): server-side vitest specs run under plain Node, and the
// barrel re-exports form.utils.ts, which statically imports @angular/forms (GH-2381).
import { isValidEmail, maskEmailForLogs } from '@lfx-one/shared/utils/email.utils';
import { Request } from 'express';

import { MicroserviceError, ResourceNotFoundError, ServiceValidationError } from '../errors';
import { generateM2MToken } from '../utils/m2m-token.util';
import { CommitteeService } from './committee.service';
import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';
import { ProjectService } from './project.service';

interface NewsletterSignupTarget {
  project: Project;
  committee: Committee;
}

/**
 * Backs the anonymous, per-Newsletter-group signup page. There is no user session, so every
 * upstream call carries an M2M token scoped through `ApiRequestOptions` (never `req.bearerToken`).
 */
export class NewsletterSignupService {
  private committeeService: CommitteeService = new CommitteeService();
  private microserviceProxy: MicroserviceProxyService = new MicroserviceProxyService();
  private projectService: ProjectService = new ProjectService();

  /**
   * Returns the slim projection the signup page renders, after confirming the group is a
   * Newsletter group that belongs to the project in the link.
   */
  public async getSignupInfo(req: Request, projectSlug: string, groupUid: string): Promise<PublicNewsletterSignupInfo> {
    const requestOptions = await this.getRequestOptions(req);
    const { project, committee } = await this.resolveSignupTarget(req, projectSlug, groupUid, requestOptions);

    return {
      project: {
        name: project.name,
        slug: project.slug,
        ...(project.logo_url && { logo_url: project.logo_url }),
      },
      group: {
        uid: committee.uid,
        name: committee.display_name || committee.name,
        ...(committee.description && { description: committee.description }),
      },
    };
  }

  /**
   * Adds the email to the Newsletter group. When the email maps to an LF account its username and
   * name ride along; otherwise the member is created by email alone. An existing membership (409)
   * is a success, and the response never says which case applied.
   */
  public async subscribe(req: Request, projectSlug: string, groupUid: string, rawEmail: unknown): Promise<NewsletterSignupResponse> {
    const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
    if (!isValidEmail(email)) {
      throw ServiceValidationError.forField('email', 'Please enter a valid email address', {
        operation: 'subscribe_newsletter_signup',
        service: 'newsletter_signup_service',
      });
    }

    const requestOptions = await this.getRequestOptions(req);
    const { committee } = await this.resolveSignupTarget(req, projectSlug, groupUid, requestOptions);
    const member = await this.buildMemberPayload(req, email);

    try {
      // Notification suppressed: the visitor asked to subscribe — a committee invite email would be noise.
      await this.committeeService.createCommitteeMember(req, committee.uid, member, true, requestOptions);
      logger.debug(req, 'subscribe_newsletter_signup', 'Added newsletter subscriber to group', {
        committee_uid: committee.uid,
        email: maskEmailForLogs(email),
        matched_account: !!member.username,
      });
    } catch (error) {
      if (error instanceof MicroserviceError && error.statusCode === 409) {
        logger.debug(req, 'subscribe_newsletter_signup', 'Email already a member of the group, treating as subscribed', {
          committee_uid: committee.uid,
          email: maskEmailForLogs(email),
        });
      } else {
        throw error;
      }
    }

    return { status: 'subscribed' };
  }

  private async getRequestOptions(req: Request): Promise<ApiRequestOptions> {
    // M2M token required: anonymous public page with no user session.
    const m2mToken = await generateM2MToken(req);
    return { bearerToken: m2mToken };
  }

  /**
   * Resolves the link's project slug and group uid, and rejects (as a generic 404) any group that
   * is not a Newsletter group of that project — a link cannot be repointed at another group.
   */
  private async resolveSignupTarget(req: Request, projectSlug: string, groupUid: string, requestOptions: ApiRequestOptions): Promise<NewsletterSignupTarget> {
    const notFound = (): ResourceNotFoundError =>
      new ResourceNotFoundError('Newsletter signup', groupUid, {
        operation: 'resolve_newsletter_signup_target',
        service: 'newsletter_signup_service',
        path: `/projects/${projectSlug}/newsletter-signup/${groupUid}`,
      });

    // The uid is interpolated into the upstream path, so anything that is not a UUID is rejected
    // here rather than forwarded.
    if (!UUID_REGEX.test(groupUid) || !projectSlug) {
      throw notFound();
    }

    const slugLookup = await this.projectService.getProjectIdBySlug(req, projectSlug);
    if (!slugLookup.exists || !slugLookup.uid) {
      throw notFound();
    }

    const [project, committee] = await Promise.all([
      this.microserviceProxy.proxyRequest<Project>(
        req,
        'LFX_V2_SERVICE',
        `/projects/${slugLookup.uid}`,
        'GET',
        undefined,
        undefined,
        undefined,
        requestOptions
      ),
      this.microserviceProxy
        .proxyRequest<Committee>(req, 'LFX_V2_SERVICE', `/committees/${groupUid}`, 'GET', undefined, undefined, undefined, requestOptions)
        .catch((error: unknown) => {
          if (error instanceof MicroserviceError && error.statusCode === 404) {
            throw notFound();
          }
          throw error;
        }),
    ]);

    if (!project || !committee || committee.category !== NEWSLETTER_COMMITTEE_CATEGORY || committee.project_uid !== project.uid) {
      logger.debug(req, 'resolve_newsletter_signup_target', 'Signup link does not point at a Newsletter group of this project', {
        project_slug: projectSlug,
        committee_uid: groupUid,
        category: committee?.category,
      });
      throw notFound();
    }

    return { project, committee };
  }

  /**
   * Looks the email up in the LF user directory (email → username → metadata). A miss or a
   * directory failure degrades to an email-only member rather than failing the signup.
   */
  private async buildMemberPayload(req: Request, email: string): Promise<CreateCommitteeMemberRequest> {
    try {
      const user = await this.projectService.getUserInfo(req, email);
      const member: CreateCommitteeMemberRequest = { email, username: user.username };

      // Only split a real "First Last" name — getUserInfo falls back to the username when the
      // directory has no name, which must not be stored as a first name.
      const name = user.name?.trim();
      if (name && name !== user.username) {
        const [firstName, ...rest] = name.split(/\s+/);
        member.first_name = firstName;
        if (rest.length > 0) {
          member.last_name = rest.join(' ');
        }
      }

      return member;
    } catch (error) {
      if (error instanceof ResourceNotFoundError) {
        logger.debug(req, 'subscribe_newsletter_signup', 'No LF account for email, subscribing by email only', {
          email: maskEmailForLogs(email),
        });
      } else {
        logger.warning(req, 'subscribe_newsletter_signup', 'User lookup failed, subscribing by email only', {
          email: maskEmailForLogs(email),
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return { email };
    }
  }
}

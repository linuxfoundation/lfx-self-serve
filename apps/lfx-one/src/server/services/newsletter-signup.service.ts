// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NEWSLETTER_COMMITTEE_CATEGORY, UUID_REGEX } from '@lfx-one/shared/constants';
import {
  ApiRequestOptions,
  Committee,
  CommitteeSettingsData,
  CreateCommitteeMemberRequest,
  NewsletterSignupResponse,
  NewsletterSignupTarget,
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
    const { project, committee, acceptingSignups } = await this.resolveSignupTarget(req, projectSlug, groupUid, requestOptions);

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
      accepting_signups: acceptingSignups,
    };
  }

  /**
   * Adds the email to the Newsletter group. Upstream links the member to the matching LF account
   * when there is one. An existing membership (409) is a success, and the response never says
   * whether the email matched an account or was already subscribed.
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
    const { committee, acceptingSignups } = await this.resolveSignupTarget(req, projectSlug, groupUid, requestOptions);
    if (!acceptingSignups) {
      // `field: 'group'` (not `email`) so the page shows a "not accepting signups" message rather
      // than blaming the visitor's address.
      throw ServiceValidationError.forField('group', 'This newsletter is not accepting signups right now', {
        operation: 'subscribe_newsletter_signup',
        service: 'newsletter_signup_service',
      });
    }
    // Email only: committee-service resolves the LF account itself (email → username, plus
    // first/last name from the directory's given/family name) and discards any caller-supplied
    // username, so a BFF-side lookup would only duplicate NATS round-trips on an anonymous route.
    const member: CreateCommitteeMemberRequest = { email };

    try {
      // Notification suppressed: the visitor asked to subscribe — a committee invite email would be noise.
      await this.committeeService.createCommitteeMember(req, committee.uid, member, true, requestOptions);
      logger.debug(req, 'subscribe_newsletter_signup', 'Added newsletter subscriber to group', {
        committee_uid: committee.uid,
        email: maskEmailForLogs(email),
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
   *
   * `acceptingSignups` is false for a group upstream would refuse an email-only member for:
   * voting-enabled groups and business-email-required groups both demand an organization (and the
   * latter a corporate domain), which an anonymous visitor cannot supply.
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

    // Strict: a NATS outage must surface as a retryable 503, not as "this link isn't valid".
    const slugLookup = await this.projectService.getProjectIdBySlug(req, projectSlug, { strict: true });
    if (!slugLookup.exists || !slugLookup.uid) {
      throw notFound();
    }

    const [project, committee, settings] = await Promise.all([
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
      // Best-effort: on failure, assume signups are open and let upstream validation decide.
      this.microserviceProxy
        .proxyRequest<CommitteeSettingsData>(req, 'LFX_V2_SERVICE', `/committees/${groupUid}/settings`, 'GET', undefined, undefined, undefined, requestOptions)
        .catch((error: unknown): CommitteeSettingsData => {
          logger.warning(req, 'resolve_newsletter_signup_target', 'Failed to read group settings, assuming signups are open', {
            committee_uid: groupUid,
            error: error instanceof Error ? error.message : String(error),
          });
          return {};
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

    const acceptingSignups = !committee.enable_voting && !settings?.business_email_required;

    return { project, committee, acceptingSignups };
  }
}

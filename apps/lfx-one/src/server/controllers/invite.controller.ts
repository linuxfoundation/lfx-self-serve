// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NatsSubjects } from '@lfx-one/shared/enums';
import { InviteTokenPayload, PendingCommitteeInviteForOrg } from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';
import { errors as JoseErrors, JWK, JWT } from 'jose';

import { AuthorizationError, ServiceValidationError } from '../errors';
import { validateAndSanitizeUrl } from '../helpers/url-validation';
import { logger } from '../services/logger.service';
import { CommitteeService } from '../services/committee.service';
import { NatsService } from '../services/nats.service';
import { getEffectiveEmail, getEffectiveUsername } from '../utils/auth-helper';

/** Controller for non-LF user invite acceptance via signed JWT. */
export class InviteController {
  /** Delay before each legacy email-search attempt while waiting for FGA tuple propagation. */
  private static readonly fgaPropagationDelayMs = 3_000;
  /** Total number of legacy email-search attempts (each preceded by fgaPropagationDelayMs). */
  private static readonly fgaLegacyMaxAttempts = 3;
  private readonly natsService = new NatsService();
  private readonly committeeService = new CommitteeService();

  /** POST /api/invite/accept — verify JWT (HS256), publish NATS fire-and-forget, return return_url. */
  public async acceptInvite(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'accept_invite');

    try {
      const { token } = req.body as { token?: unknown };

      if (!token || typeof token !== 'string') {
        return next(
          ServiceValidationError.forField('token', 'Invite token is required', {
            operation: 'accept_invite',
            service: 'invite_controller',
            path: req.path,
          })
        );
      }

      const jwtSecret = process.env['INVITE_SERVICE_JWT_SECRET'];
      if (!jwtSecret) {
        return next(new Error('INVITE_SERVICE_JWT_SECRET is not configured'));
      }

      let payload: InviteTokenPayload;
      try {
        payload = this.verifyInviteToken(token, jwtSecret);
      } catch (err) {
        if (err instanceof JoseErrors.JWTExpired) {
          return next(
            new AuthorizationError('Invite link has expired', {
              operation: 'accept_invite',
              service: 'invite_controller',
              path: req.path,
              code: 'INVITE_EXPIRED',
            })
          );
        }
        return next(
          ServiceValidationError.forField('token', 'Invite token is invalid', {
            operation: 'accept_invite',
            service: 'invite_controller',
            path: req.path,
          })
        );
      }

      if (!payload.invite_uid || typeof payload.invite_uid !== 'string') {
        return next(
          ServiceValidationError.forField('token', 'Invite token is missing required claims', {
            operation: 'accept_invite',
            service: 'invite_controller',
            path: req.path,
          })
        );
      }

      const safeReturnUrl = this.validateReturnUrl(payload.return_url);
      if (!safeReturnUrl) {
        return next(
          ServiceValidationError.forField('return_url', 'Invite token contains an invalid return URL', {
            operation: 'accept_invite',
            service: 'invite_controller',
            path: req.path,
          })
        );
      }

      const username = getEffectiveUsername(req);
      if (!username) {
        return next(
          new AuthorizationError('Could not determine username from session', {
            operation: 'accept_invite',
            service: 'invite_controller',
            path: req.path,
          })
        );
      }

      const codec = this.natsService.getCodec();
      await this.natsService.publish(NatsSubjects.INVITE_ACCEPTED, codec.encode(JSON.stringify({ invite_uid: payload.invite_uid, username })));

      logger.success(req, 'accept_invite', startTime, {
        invite_uid: payload.invite_uid,
        username,
        resource_uid: payload.resource_uid,
      });

      // Best-effort — committee auto-accept failures must not block LFID invite acceptance.
      // The LFID invite is already accepted at this point (user has registered/logged in);
      // INVITE_ACCEPTED has been published above. Committee auto-accept is a separate side
      // effect that runs after.
      let pendingCommitteeInvite: PendingCommitteeInviteForOrg | undefined;
      try {
        pendingCommitteeInvite = (await this.autoAcceptCommitteeInvite(req, payload)) ?? undefined;
      } catch (error) {
        logger.warning(req, 'accept_invite', 'Committee invite auto-accept failed — LFID invite already accepted', {
          invite_uid: payload.invite_uid,
          err: error,
        });
      }

      res.json({ return_url: safeReturnUrl, ...(pendingCommitteeInvite && { pending_committee_invite: pendingCommitteeInvite }) });
    } catch (error) {
      next(error);
    }
  }

  // Secret used as raw UTF-8 bytes to match Go invite service []byte(secret) key derivation.
  private verifyInviteToken(token: string, secret: string): InviteTokenPayload {
    const key = JWK.asKey(Buffer.from(secret));
    const payload = JWT.verify<InviteTokenPayload>(token, key, { algorithms: ['HS256'] });
    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
      throw new Error('Token is missing required exp claim');
    }
    return payload;
  }

  // Only lfx.dev (apex) and *.lfx.dev (subdomains) are valid redirect destinations — prevents open-redirect.
  private validateReturnUrl(url: string): string | null {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:') return null;
      if (!parsed.hostname.endsWith('.lfx.dev') && parsed.hostname !== 'lfx.dev') return null;
      return validateAndSanitizeUrl(url) ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Accepts the committee invite associated with the LFID invite JWT.
   *
   * **New path** (JWT carries `committee_invite_uid`): calls the committee accept endpoint
   * directly — no email search needed since both the committee UID (`resource_uid`) and the
   * invite UID (`committee_invite_uid`) are embedded in the JWT.
   *
   * **Legacy path** (JWT pre-dates `committee_invite_uid`): falls back to searching pending
   * invites by email. Waits {@link InviteController.fgaPropagationDelayMs} before each attempt
   * so that the FGA invitee tuple has time to propagate; retries up to
   * {@link InviteController.fgaLegacyMaxAttempts} times total. Returns a
   * {@link PendingCommitteeInviteForOrg} when an invite requires an
   * organization that was not pre-filled — the client must collect the org and re-submit.
   *
   * Requires the session email to match the email claim in the JWT. Committee auto-accept is
   * best-effort — failures are caught by the caller, logged, and do not block the redirect.
   */
  private async autoAcceptCommitteeInvite(req: Request, payload: InviteTokenPayload): Promise<PendingCommitteeInviteForOrg | null> {
    const invitedEmail = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
    const sessionEmail = getEffectiveEmail(req)?.trim().toLowerCase() ?? null;

    if (!invitedEmail) {
      logger.warning(req, 'accept_invite', 'Skipping committee invite auto-accept — LFID invite token has no email claim', {
        invite_uid: payload.invite_uid,
      });
      return null;
    }

    if (!sessionEmail) {
      logger.warning(req, 'accept_invite', 'Skipping committee invite auto-accept — session email unavailable', {
        invite_uid: payload.invite_uid,
      });
      return null;
    }

    if (invitedEmail !== sessionEmail) {
      logger.info(req, 'accept_invite', 'Skipping committee invite auto-accept — session email does not match LFID invite token email', {
        invite_uid: payload.invite_uid,
      });
      return null;
    }

    // JWT.verify only validates the signature — claims can be null, non-strings, or whitespace.
    const committeeInviteUid = typeof payload.committee_invite_uid === 'string' ? payload.committee_invite_uid.trim() : '';
    const committeeUid = typeof payload.resource_uid === 'string' ? payload.resource_uid.trim() : '';

    if (committeeInviteUid) {
      // Both UIDs are known — call accept directly without searching.
      if (!committeeUid) {
        throw ServiceValidationError.forField('resource_uid', 'Invite token is missing the committee UID required to accept this invite', {
          operation: 'accept_invite',
          service: 'invite_controller',
          path: req.path,
        });
      }

      // Read org context directly from JWT claims — no email fetch needed. Claims are
      // map[string]string in Go so organization_required is the string "true" or "false".
      // Claims are absent on JWTs issued before the committee service v0.4.17 deploy;
      // in that transitional window we accept directly without org check.
      const organizationRequired = payload.organization_required === 'true';
      const committeeName = typeof payload.committee_name === 'string' ? payload.committee_name.trim() || committeeUid : committeeUid;

      if (organizationRequired) {
        const orgName = typeof payload.organization_name === 'string' ? payload.organization_name.trim() || null : null;
        if (!orgName) {
          logger.info(req, 'accept_invite', 'Committee invite requires organization — returning to client for manual org collection', {
            committee_uid: committeeUid,
            committee_invite_uid: committeeInviteUid,
          });
          const orgId = typeof payload.organization_id === 'string' ? payload.organization_id.trim() || null : null;
          const orgWebsite = typeof payload.organization_website === 'string' ? payload.organization_website.trim() || null : null;
          return {
            committee_uid: committeeUid,
            invite_uid: committeeInviteUid,
            committee_name: committeeName,
            // Only pass an organization object when there is at least one field to pre-fill.
            // An all-null object is truthy and would suppress the current-employer fallback
            // in InvitationAcceptFlowService.
            organization: orgId || orgWebsite ? { id: orgId, name: null, website: orgWebsite } : null,
          };
        }
        await this.committeeService.acceptCommitteeInvite(req, committeeUid, committeeInviteUid, {
          organization: {
            name: orgName,
            id: typeof payload.organization_id === 'string' ? payload.organization_id.trim() || null : null,
            website: typeof payload.organization_website === 'string' ? payload.organization_website.trim() || null : null,
          },
        });
      } else {
        await this.committeeService.acceptCommitteeInvite(req, committeeUid, committeeInviteUid);
      }

      logger.info(req, 'accept_invite', 'Committee invite accepted directly after LFID invite', {
        committee_uid: committeeUid,
        committee_invite_uid: committeeInviteUid,
      });
      return null;
    }

    // Legacy path: JWT pre-dates committee_invite_uid — search pending invites by email.
    // Require committeeUid so the search is scoped to the specific committee; without it we
    // cannot safely identify which pending invite to accept and must skip.
    if (!committeeUid) {
      logger.warning(req, 'accept_invite', 'Skipping legacy committee invite auto-accept — resource_uid (committee UID) is absent from the JWT', {
        invite_uid: payload.invite_uid,
      });
      return null;
    }

    // Skip the committee path entirely for explicitly non-committee resource types. Omitting
    // resource_type (very old JWTs) still enters this path for backward compatibility.
    const resourceType = typeof payload.resource_type === 'string' ? payload.resource_type.trim() : '';
    if (resourceType && resourceType !== 'group') {
      logger.info(req, 'accept_invite', 'Skipping legacy committee invite auto-accept — resource is not a committee', {
        invite_uid: payload.invite_uid,
        resource_type: resourceType,
      });
      return null;
    }

    // Wait before every attempt (including the first) so the FGA invitee tuple can propagate.
    for (let attempt = 0; attempt < InviteController.fgaLegacyMaxAttempts; attempt++) {
      await new Promise<void>((resolve) => setTimeout(resolve, InviteController.fgaPropagationDelayMs));

      const result = await this.committeeService.acceptPendingCommitteeInvitesAfterLfidAccept(req, {
        invitedEmail,
        resourceUid: committeeUid,
      });

      // undefined = invite not visible yet — FGA still propagating; retry.
      // null | PendingCommitteeInviteForOrg = processed; return immediately.
      if (result !== undefined) {
        return result ?? null;
      }
    }

    logger.warning(req, 'accept_invite', 'Legacy committee invite auto-accept exhausted retries without finding a matching invite', {
      invite_uid: payload.invite_uid,
      resource_uid: committeeUid,
    });
    return null;
  }
}

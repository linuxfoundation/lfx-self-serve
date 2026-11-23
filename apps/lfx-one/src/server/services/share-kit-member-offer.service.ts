// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { SHARE_KIT_MEMBER_CODES_ENV, SHARE_KIT_SLUG_PATTERN } from '@lfx-one/shared/constants';
import { ShareKitContent, ShareKitMemberOffer } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { resolveVerifiedUserEmails } from '../helpers/user-emails.helper';
import { generateM2MToken } from '../utils/m2m-token.util';
import { EmailVerificationService } from './email-verification.service';
import { logger } from './logger.service';
import { NewsletterMemberBenefitService } from './newsletter-member-benefit.service';

/**
 * Reads member discount codes from `SHARE_KIT_MEMBER_CODES` (JSON keyed by event slug), set from the
 * deployment's secret store. Malformed JSON or entries are ignored (logged without values): no code
 * means no member offer, never a leaked or wrong one.
 */
export function readShareKitMemberCodes(raw: string | undefined): Map<string, string> {
  const codes = new Map<string, string>();
  if (!raw) return codes;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    for (const [slug, code] of Object.entries(parsed)) {
      if (SHARE_KIT_SLUG_PATTERN.test(slug) && typeof code === 'string' && code.trim()) {
        codes.set(slug, code.trim());
      }
    }
  } catch {
    logger.warning(
      undefined,
      'read_share_kit_member_codes',
      `${SHARE_KIT_MEMBER_CODES_ENV} is not a JSON object of event slug to code; no member codes loaded`,
      {}
    );
  }
  return codes;
}

/**
 * Decides what the share kit tells this visitor about its member discount (#6061). The code is only
 * returned to a signed-in visitor with a verified email at an active member company of the kit's
 * membership; anonymous callers and failed lookups never receive it (fail closed).
 */
export class ShareKitMemberOfferService {
  private readonly codes: Map<string, string>;

  public constructor(
    private readonly memberBenefitService: NewsletterMemberBenefitService = new NewsletterMemberBenefitService(),
    private readonly emailVerificationService: EmailVerificationService = new EmailVerificationService(),
    codes?: Map<string, string>
  ) {
    this.codes = codes ?? readShareKitMemberCodes(process.env[SHARE_KIT_MEMBER_CODES_ENV]);
  }

  /** Undefined when the kit has no member benefit or no code is configured for it: the page then shows no offer. */
  public async resolveOffer(req: Request, kit: ShareKitContent): Promise<ShareKitMemberOffer | undefined> {
    const benefit = kit.memberBenefit;
    const code = this.codes.get(kit.eventSlug);
    if (!benefit || !code) return undefined;

    if (!req.oidc?.isAuthenticated()) {
      return { status: 'sign_in' };
    }

    try {
      const verifiedEmails = await resolveVerifiedUserEmails(req, this.emailVerificationService, { strict: true });
      const m2mToken = await generateM2MToken(req);
      const eligibility = await this.memberBenefitService.resolveEligibility(req, m2mToken, verifiedEmails, benefit.membershipSlug);
      if (!eligibility.match) {
        logger.debug(req, 'resolve_share_kit_member_offer', 'Signed-in visitor is not at a member company', {
          event_slug: kit.eventSlug,
          reason: eligibility.denied_reason,
        });
        return { status: 'not_member' };
      }
      logger.debug(req, 'resolve_share_kit_member_offer', 'Signed-in visitor is at a member company', {
        event_slug: kit.eventSlug,
        b2b_org_uid: eligibility.match.b2b_org_uid,
      });
      return { status: 'eligible', code, companyName: eligibility.match.company_name || undefined };
    } catch (error) {
      logger.warning(req, 'resolve_share_kit_member_offer', 'Membership lookup failed; withholding the member code', {
        event_slug: kit.eventSlug,
        err: error,
      });
      return { status: 'unavailable' };
    }
  }
}

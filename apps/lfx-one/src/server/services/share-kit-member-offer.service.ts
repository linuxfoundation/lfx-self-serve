// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  SHARE_KIT_MEMBER_CODES_ENV,
  SHARE_KIT_MEMBERSHIP_CACHE_MAX_ENTRIES,
  SHARE_KIT_MEMBERSHIP_CACHE_MS,
  SHARE_KIT_SLUG_PATTERN,
} from '@lfx-one/shared/constants';
import { ShareKitContent, ShareKitMemberOffer, ShareKitMembershipCacheEntry } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { resolveVerifiedUserEmails } from '../helpers/user-emails.helper';
import { getEffectiveUsername } from '../utils/auth-helper';
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
  /** Read on first use, not at construction: the route builds this service before `server.ts` loads `.env`. */
  private codes: Map<string, string> | null;
  /** Recent membership answers per user and membership, so a page reload or a launch-day spike doesn't repeat the lookup. */
  private readonly memberships = new Map<string, ShareKitMembershipCacheEntry>();

  public constructor(
    private readonly memberBenefitService: NewsletterMemberBenefitService = new NewsletterMemberBenefitService(),
    private readonly emailVerificationService: EmailVerificationService = new EmailVerificationService(),
    codes?: Map<string, string>,
    private readonly now: () => number = Date.now
  ) {
    this.codes = codes ?? null;
  }

  /** Undefined when the kit has no member benefit or no code is configured for it: the page then shows no offer. */
  public async resolveOffer(req: Request, kit: ShareKitContent): Promise<ShareKitMemberOffer | undefined> {
    const benefit = kit.memberBenefit;
    const code = this.memberCodes().get(kit.eventSlug);
    if (!benefit || !code) return undefined;

    if (!req.oidc?.isAuthenticated()) {
      return { status: 'sign_in' };
    }

    try {
      const companyName = await this.lookUpMembership(req, benefit.membershipSlug, kit.eventSlug);
      if (companyName === null) {
        return { status: 'not_member' };
      }
      return { status: 'eligible', code, companyName: companyName || undefined };
    } catch (error) {
      logger.warning(req, 'resolve_share_kit_member_offer', 'Membership lookup failed; withholding the member code', {
        event_slug: kit.eventSlug,
        err: error,
      });
      return { status: 'unavailable' };
    }
  }

  private memberCodes(): Map<string, string> {
    this.codes ??= readShareKitMemberCodes(process.env[SHARE_KIT_MEMBER_CODES_ENV]);
    return this.codes;
  }

  /**
   * The name of the visitor's member company for `membershipSlug` ('' when unnamed), or null when they are not at
   * one. Both answers are kept for `SHARE_KIT_MEMBERSHIP_CACHE_MS`; a failed lookup throws and is not kept.
   */
  private async lookUpMembership(req: Request, membershipSlug: string, eventSlug: string): Promise<string | null> {
    const username = getEffectiveUsername(req);
    const cacheKey = username ? `${username}|${membershipSlug}` : null;
    const cached = cacheKey ? this.memberships.get(cacheKey) : undefined;
    if (cached && cached.expiresAt > this.now()) {
      logger.debug(req, 'resolve_share_kit_member_offer', 'Using recent membership answer', { event_slug: eventSlug, member: cached.companyName !== null });
      return cached.companyName;
    }

    // Independent of each other; the M2M token is itself cached process-wide until shortly before it expires.
    const [verifiedEmails, m2mToken] = await Promise.all([
      resolveVerifiedUserEmails(req, this.emailVerificationService, { strict: true }),
      generateM2MToken(req),
    ]);
    const eligibility = await this.memberBenefitService.resolveEligibility(req, m2mToken, verifiedEmails, membershipSlug);
    const companyName = eligibility.match ? eligibility.match.company_name || '' : null;
    if (eligibility.match) {
      logger.debug(req, 'resolve_share_kit_member_offer', 'Signed-in visitor is at a member company', {
        event_slug: eventSlug,
        b2b_org_uid: eligibility.match.b2b_org_uid,
      });
    } else {
      logger.debug(req, 'resolve_share_kit_member_offer', 'Signed-in visitor is not at a member company', {
        event_slug: eventSlug,
        reason: eligibility.denied_reason,
      });
    }

    if (cacheKey) {
      if (this.memberships.size >= SHARE_KIT_MEMBERSHIP_CACHE_MAX_ENTRIES) {
        this.memberships.clear();
      }
      this.memberships.set(cacheKey, { expiresAt: this.now() + SHARE_KIT_MEMBERSHIP_CACHE_MS, companyName });
    }
    return companyName;
  }
}

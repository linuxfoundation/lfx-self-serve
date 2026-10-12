// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Newsletter, NewsletterMemberBenefitEligibility } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { generateM2MToken } = vi.hoisted(() => ({ generateM2MToken: vi.fn() }));

vi.mock('../utils/m2m-token.util', () => ({ generateM2MToken }));
vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));
vi.mock('../services/newsletter.service', () => ({ NewsletterService: class {} }));
vi.mock('../services/newsletter-member-benefit.service', () => ({ NewsletterMemberBenefitService: class {} }));
vi.mock('../services/access-check.service', () => ({ AccessCheckService: class {} }));

import type { NextFunction, Request, Response } from 'express';

import type { AccessCheckService } from '../services/access-check.service';
import type { NewsletterMemberBenefitService } from '../services/newsletter-member-benefit.service';
import type { NewsletterService } from '../services/newsletter.service';
import { NewsletterReaderController } from './newsletter-reader.controller';

const PROJECT_UID = '11111111-1111-4111-8111-111111111111';
const NEWSLETTER_UID = '22222222-2222-4222-8222-222222222222';

function makeNewsletter(overrides: Partial<Newsletter> = {}): Newsletter {
  return {
    id: NEWSLETTER_UID,
    project_uid: PROJECT_UID,
    subject: 'Weekly',
    body_html: '<p>hi</p>',
    ed_reply_email: 'ed@example.org',
    committee_uids: ['news-1'],
    status: 'sent',
    total_recipients: 1,
    created_by: 'someone',
    version: 1,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    ...overrides,
  };
}

const eligible: NewsletterMemberBenefitEligibility = {
  verified_emails: ['jane@acme-motors.example'],
  match: { email: 'jane@acme-motors.example', b2b_org_uid: '0014100000AcmeAAAA', company_name: 'Acme Motors' },
};

function makeRes(): Response & { body?: unknown; statusCode: number } {
  const res = { statusCode: 200 } as Response & { body?: unknown; statusCode: number };
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res;
  }) as unknown as Response['status'];
  res.json = vi.fn((body: unknown) => {
    res.body = body;
    return res;
  }) as unknown as Response['json'];
  res.set = vi.fn(() => res) as unknown as Response['set'];
  return res;
}

describe('NewsletterReaderController', () => {
  const newsletterService = { getNewsletter: vi.fn() };
  const accessCheckService = { checkSingleAccessStrict: vi.fn() };
  const memberBenefitService = {
    getVerifiedEmails: vi.fn(),
    isGroupMember: vi.fn(),
    resolveEligibility: vi.fn(),
    resolveNewsletterGroup: vi.fn(),
    addToNewsletterGroup: vi.fn(),
  };
  let controller: NewsletterReaderController;
  let req: Request;
  let next: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
    generateM2MToken.mockResolvedValue('m2m');
    newsletterService.getNewsletter.mockResolvedValue(makeNewsletter());
    accessCheckService.checkSingleAccessStrict.mockResolvedValue(false);
    memberBenefitService.getVerifiedEmails.mockResolvedValue(['jane@acme-motors.example']);
    memberBenefitService.isGroupMember.mockResolvedValue(false);
    memberBenefitService.resolveEligibility.mockResolvedValue(eligible);
    memberBenefitService.resolveNewsletterGroup.mockResolvedValue({ uid: 'news-1', name: 'LF Weekly' });
    memberBenefitService.addToNewsletterGroup.mockResolvedValue('added');
    controller = new NewsletterReaderController(
      newsletterService as unknown as NewsletterService,
      memberBenefitService as unknown as NewsletterMemberBenefitService,
      accessCheckService as unknown as AccessCheckService
    );
    req = { params: { projectUid: PROJECT_UID, newsletterUid: NEWSLETTER_UID }, path: '/reader' } as unknown as Request;
    next = vi.fn();
  });

  describe('getReaderAccess', () => {
    it('returns manager for project writers, drafts included, without membership lookups', async () => {
      accessCheckService.checkSingleAccessStrict.mockResolvedValue(true);
      newsletterService.getNewsletter.mockResolvedValue(makeNewsletter({ status: 'draft' }));
      const res = makeRes();

      await controller.getReaderAccess(req, res, next);

      expect(res.body).toMatchObject({ access: 'manager', newsletter: { status: 'draft' } });
      expect(generateM2MToken).not.toHaveBeenCalled();
    });

    it('404s an unsent issue for non-managers with the draft code', async () => {
      newsletterService.getNewsletter.mockResolvedValue(makeNewsletter({ status: 'draft' }));

      await controller.getReaderAccess(req, makeRes(), next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404, code: 'NEWSLETTER_NOT_SENT' }));
    });

    it('returns group_member when the reader is already in the audience', async () => {
      memberBenefitService.isGroupMember.mockResolvedValue(true);
      const res = makeRes();

      await controller.getReaderAccess(req, res, next);

      expect(res.body).toMatchObject({ access: 'group_member' });
      expect(memberBenefitService.resolveEligibility).not.toHaveBeenCalled();
    });

    it('returns eligible with the qualifying email, company and group — and writes nothing', async () => {
      const res = makeRes();

      await controller.getReaderAccess(req, res, next);

      expect(res.body).toEqual({
        access: 'eligible',
        newsletter: makeNewsletter(),
        qualifying_email: 'jane@acme-motors.example',
        company_name: 'Acme Motors',
        committee_name: 'LF Weekly',
      });
      expect(memberBenefitService.addToNewsletterGroup).not.toHaveBeenCalled();
      expect(res.set).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    });

    it('withholds the body when denied', async () => {
      memberBenefitService.resolveEligibility.mockResolvedValue({ verified_emails: [], match: null, denied_reason: 'no_company_email' });
      const res = makeRes();

      await controller.getReaderAccess(req, res, next);

      expect(res.body).toEqual({ access: 'denied', denied_reason: 'no_company_email' });
    });

    it('denies an eligible reader when the issue has no newsletter group', async () => {
      memberBenefitService.resolveNewsletterGroup.mockResolvedValue(null);
      const res = makeRes();

      await controller.getReaderAccess(req, res, next);

      expect(res.body).toEqual({ access: 'denied', denied_reason: 'no_newsletter_group' });
    });

    it('rejects malformed ids before any upstream call', async () => {
      req.params['newsletterUid'] = 'not-a-uuid';

      await controller.getReaderAccess(req, makeRes(), next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
      expect(newsletterService.getNewsletter).not.toHaveBeenCalled();
    });

    it('propagates an eligibility outage instead of denying', async () => {
      memberBenefitService.resolveEligibility.mockRejectedValue(Object.assign(new Error('down'), { statusCode: 503 }));

      await controller.getReaderAccess(req, makeRes(), next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 503 }));
    });
  });

  describe('joinNewsletterGroup', () => {
    it('re-checks eligibility and adds the qualifying email (201)', async () => {
      const res = makeRes();

      await controller.joinNewsletterGroup(req, res, next);

      expect(memberBenefitService.resolveEligibility).toHaveBeenCalled();
      expect(memberBenefitService.addToNewsletterGroup).toHaveBeenCalledWith(req, 'm2m', { uid: 'news-1', name: 'LF Weekly' }, eligible.match);
      expect(res.statusCode).toBe(201);
      expect(res.body).toEqual({ status: 'added', email: 'jane@acme-motors.example', committee_name: 'LF Weekly', company_name: 'Acme Motors' });
    });

    it('answers 200 already_member on a conflict', async () => {
      memberBenefitService.addToNewsletterGroup.mockResolvedValue('already_member');
      const res = makeRes();

      await controller.joinNewsletterGroup(req, res, next);

      expect(res.statusCode).toBe(200);
      expect(res.body).toMatchObject({ status: 'already_member' });
    });

    it('refuses (403) a caller who is not eligible, without writing', async () => {
      memberBenefitService.resolveEligibility.mockResolvedValue({ verified_emails: [], match: null, denied_reason: 'not_member_company' });

      await controller.joinNewsletterGroup(req, makeRes(), next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403, code: 'NEWSLETTER_MEMBER_BENEFIT_NOT_ELIGIBLE' }));
      expect(memberBenefitService.addToNewsletterGroup).not.toHaveBeenCalled();
    });

    it('answers already_member for a reader already in the group, without writing', async () => {
      memberBenefitService.isGroupMember.mockResolvedValue(true);
      const res = makeRes();

      await controller.joinNewsletterGroup(req, res, next);

      expect(res.statusCode).toBe(200);
      expect(res.body).toMatchObject({ status: 'already_member' });
      expect(memberBenefitService.addToNewsletterGroup).not.toHaveBeenCalled();
    });

    it('refuses managers (nothing to join)', async () => {
      accessCheckService.checkSingleAccessStrict.mockResolvedValue(true);

      await controller.joinNewsletterGroup(req, makeRes(), next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
      expect(memberBenefitService.addToNewsletterGroup).not.toHaveBeenCalled();
    });
  });
});

// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The controller imports the `@lfx-one/shared/utils` barrel, which pulls @angular/forms; the JIT
// compiler must be present in this plain-Node runtime.
import '@angular/compiler';

import type { Newsletter, NewsletterReaderEvaluation } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));
vi.mock('../services/newsletter-member-benefit.service', () => ({ NewsletterMemberBenefitService: class {} }));

import type { NextFunction, Request, Response } from 'express';

import type { NewsletterMemberBenefitService } from '../services/newsletter-member-benefit.service';
import { NewsletterReaderController } from './newsletter-reader.controller';

const PROJECT_UID = '11111111-1111-4111-8111-111111111111';
const NEWSLETTER_UID = '22222222-2222-4222-8222-222222222222';

function makeNewsletter(): Newsletter {
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
  };
}

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
  const memberBenefitService = { evaluateReaderAccess: vi.fn(), joinNewsletterGroup: vi.fn() };
  let controller: NewsletterReaderController;
  let req: Request;
  let next: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new NewsletterReaderController(memberBenefitService as unknown as NewsletterMemberBenefitService);
    req = { params: { projectUid: PROJECT_UID, newsletterUid: NEWSLETTER_UID }, path: '/reader' } as unknown as Request;
    next = vi.fn();
  });

  describe('getReaderAccess', () => {
    it.each(['manager', 'auditor', 'group_member'] as const)('returns %s with the issue, uncached', async (level) => {
      memberBenefitService.evaluateReaderAccess.mockResolvedValue({ level, newsletter: makeNewsletter() } satisfies NewsletterReaderEvaluation);
      const res = makeRes();

      await controller.getReaderAccess(req, res, next);

      expect(res.body).toEqual({ access: level, newsletter: makeNewsletter() });
      expect(res.set).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    });

    it('maps eligible to the qualifying email, company and group', async () => {
      memberBenefitService.evaluateReaderAccess.mockResolvedValue({
        level: 'eligible',
        newsletter: makeNewsletter(),
        match: { email: 'jane@acme-motors.example', b2b_org_uid: '0014100000AcmeAAAA', company_name: 'Acme Motors' },
        group: { uid: 'news-1', name: 'LF Weekly' },
      } satisfies NewsletterReaderEvaluation);
      const res = makeRes();

      await controller.getReaderAccess(req, res, next);

      expect(res.body).toEqual({
        access: 'eligible',
        newsletter: makeNewsletter(),
        qualifying_email: 'jane@acme-motors.example',
        company_name: 'Acme Motors',
        committee_name: 'LF Weekly',
      });
    });

    it('withholds the body when denied', async () => {
      memberBenefitService.evaluateReaderAccess.mockResolvedValue({ level: 'denied', newsletter: makeNewsletter(), reason: 'no_company_email' });
      const res = makeRes();

      await controller.getReaderAccess(req, res, next);

      expect(res.body).toEqual({ access: 'denied', denied_reason: 'no_company_email' });
    });

    it('rejects malformed ids before any lookup', async () => {
      req.params['newsletterUid'] = 'not-a-uuid';

      await controller.getReaderAccess(req, makeRes(), next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
      expect(memberBenefitService.evaluateReaderAccess).not.toHaveBeenCalled();
    });

    it('passes lookup failures to the error handler', async () => {
      memberBenefitService.evaluateReaderAccess.mockRejectedValue(Object.assign(new Error('down'), { statusCode: 503 }));

      await controller.getReaderAccess(req, makeRes(), next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 503 }));
    });
  });

  describe('joinNewsletterGroup', () => {
    it('answers 201 when the email was added', async () => {
      const result = { status: 'added', email: 'jane@acme-motors.example', committee_name: 'LF Weekly', company_name: 'Acme Motors' };
      memberBenefitService.joinNewsletterGroup.mockResolvedValue(result);
      const res = makeRes();

      await controller.joinNewsletterGroup(req, res, next);

      expect(memberBenefitService.joinNewsletterGroup).toHaveBeenCalledWith(req, PROJECT_UID, NEWSLETTER_UID);
      expect(res.statusCode).toBe(201);
      expect(res.body).toEqual(result);
    });

    it('answers 200 when already a member', async () => {
      memberBenefitService.joinNewsletterGroup.mockResolvedValue({ status: 'already_member', email: '', committee_name: '', company_name: '' });
      const res = makeRes();

      await controller.joinNewsletterGroup(req, res, next);

      expect(res.statusCode).toBe(200);
    });

    it('passes refusals to the error handler', async () => {
      memberBenefitService.joinNewsletterGroup.mockRejectedValue(Object.assign(new Error('no'), { statusCode: 403 }));

      await controller.joinNewsletterGroup(req, makeRes(), next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    });
  });
});

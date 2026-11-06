// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { generateM2MToken } = vi.hoisted(() => ({ generateM2MToken: vi.fn() }));

vi.mock('./newsletter-invite.service', () => ({ NewsletterInviteService: class {} }));
vi.mock('./newsletter-member-benefit.service', () => ({ NewsletterMemberBenefitService: class {} }));
vi.mock('./newsletter.service', () => ({ NewsletterService: class {} }));
vi.mock('./project.service', () => ({ ProjectService: class {} }));
vi.mock('./email.service', () => ({ EmailService: class {} }));
vi.mock('../utils/m2m-token.util', () => ({ generateM2MToken }));
vi.mock('./logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import type { Request } from 'express';

import { AuthorizationError, InvalidRequestError, MicroserviceError, ResourceNotFoundError, ServiceValidationError } from '../errors';
import { createNewsletterInviteToken, readNewsletterInviteToken } from '../utils/newsletter-guest-token.util';
import { NewsletterGuestService } from './newsletter-guest.service';

const req = {} as Request;
const foundation = { uid: 'f-1', slug: 'acme-foundation', name: 'Acme Foundation', logo_url: null };
const resolved = { foundation, membership: { slug: 'acme-foundation', name: 'Acme Foundation' } };
const committee = { uid: 'c-news', name: 'Acme Newsletter', project_uid: 'p-1', category: 'Newsletter' };
const company = { b2b_org_uid: 'org-1', company_name: 'Acme Motors' };
const issueId = '11111111-2222-4333-8444-555555555555';

function sentIssue(id: string, sentAt: string, committeeUids: string[] = ['c-news']) {
  return { id, project_uid: 'p-1', subject: `Issue ${id}`, body_html: `<p>${id}</p>`, status: 'sent', sent_at: sentAt, committee_uids: committeeUids };
}

function makeDeps() {
  return {
    inviteService: {
      getNewsletterCommittee: vi.fn().mockResolvedValue(committee),
      resolveFoundation: vi.fn().mockResolvedValue(resolved),
      normalizeInviteEmail: vi.fn((email: string) => email.trim().toLowerCase()),
      claimRecipientCooldown: vi.fn().mockReturnValue(true),
      releaseRecipientCooldown: vi.fn(),
      singleLine: vi.fn((value: string) => value),
    },
    memberBenefitService: {
      findMemberCompanyForEmail: vi.fn().mockResolvedValue(company),
      addToNewsletterGroup: vi.fn().mockResolvedValue('added'),
      resolveNewsletterGroup: vi.fn().mockResolvedValue({ uid: 'c-news', name: 'Acme Newsletter' }),
      isEmailInGroup: vi.fn().mockResolvedValue(false),
    },
    newsletterService: {
      getNewsletter: vi.fn(async (_req: Request, _projectUid: string, id: string) => sentIssue(id, '2026-10-01T00:00:00Z')),
      getLatestCommitteeNewsletter: vi.fn().mockResolvedValue({ id: 'n-new', project_uid: 'p-1', subject: 'Issue n-new', sent_at: '2026-10-15T00:00:00Z' }),
    },
    projectService: { getProjectIdBySlug: vi.fn().mockResolvedValue({ exists: true, uid: 'p-1' }) },
    emailService: { sendEmail: vi.fn().mockResolvedValue(undefined) },
  };
}

describe('NewsletterGuestService', () => {
  let deps: ReturnType<typeof makeDeps>;
  let service: NewsletterGuestService;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env['PCC_BASE_URL'] = 'https://app.lfx.example';
    process.env['PCC_AUTH0_SECRET'] = 'test-session-secret';
    generateM2MToken.mockResolvedValue('m2m');
    deps = makeDeps();
    service = new NewsletterGuestService(deps as unknown as ConstructorParameters<typeof NewsletterGuestService>[0]);
  });

  describe('inspectInvite', () => {
    it('names the foundation, member company and invited address of a valid invite', async () => {
      const info = await service.inspectInvite(req, createNewsletterInviteToken('c-news', 'jane@acme-motors.example'));

      expect(info).toEqual({
        status: 'valid',
        foundation,
        membership_name: 'Acme Foundation',
        committee_uid: 'c-news',
        masked_email: 'ja***@acme***.example',
        company_name: 'Acme Motors',
        teaser: { subject: 'Issue n-new', image_url: null, excerpt: 'n-new' },
      });
      expect(JSON.stringify(info)).not.toContain('jane@acme-motors.example');
      expect(deps.memberBenefitService.findMemberCompanyForEmail).toHaveBeenCalledWith(req, 'm2m', 'jane@acme-motors.example', 'acme-foundation');
    });

    it('reports an expired or tampered token without any lookup', async () => {
      expect(await service.inspectInvite(req, createNewsletterInviteToken('c-news', 'jane@acme-motors.example', 0))).toEqual({ status: 'expired' });
      expect(await service.inspectInvite(req, 'forged.token')).toEqual({ status: 'invalid' });
      expect(generateM2MToken).not.toHaveBeenCalled();
    });

    it('is invalid when the group is no longer a newsletter group, and not eligible when the company left', async () => {
      const token = createNewsletterInviteToken('c-news', 'jane@acme-motors.example');
      deps.inviteService.getNewsletterCommittee.mockResolvedValueOnce(null);
      expect(await service.inspectInvite(req, token)).toEqual({ status: 'invalid' });

      deps.memberBenefitService.findMemberCompanyForEmail.mockResolvedValueOnce(null);
      const notEligible = await service.inspectInvite(req, token);
      expect(notEligible).toMatchObject({ status: 'not_eligible', foundation, masked_email: 'ja***@acme***.example' });
      expect(notEligible.teaser).toBeUndefined();
    });

    it('builds the teaser from the latest issue without its body, and omits it when the read fails', async () => {
      const token = createNewsletterInviteToken('c-news', 'jane@acme-motors.example');
      deps.newsletterService.getNewsletter.mockResolvedValueOnce({
        ...sentIssue('n-new', '2026-10-15T00:00:00Z'),
        body_html: `<img src="https://cdn.example.com/hero.png"><p>${'Long story. '.repeat(100)}</p>`,
      });
      const { teaser } = await service.inspectInvite(req, token);
      expect(teaser?.image_url).toBe('https://cdn.example.com/hero.png');
      expect(teaser?.excerpt.length).toBeLessThanOrEqual(600);
      expect(teaser?.excerpt.endsWith('…')).toBe(true);

      deps.newsletterService.getLatestCommitteeNewsletter.mockRejectedValueOnce(new Error('upstream down'));
      const info = await service.inspectInvite(req, token);
      expect(info.status).toBe('valid');
      expect(info.teaser).toBeUndefined();
    });
  });

  describe('acceptInvite', () => {
    it('adds the invited address to the group and returns the latest issue sent to it', async () => {
      const grant = await service.acceptInvite(req, createNewsletterInviteToken('c-news', 'jane@acme-motors.example'));

      expect(deps.memberBenefitService.addToNewsletterGroup).toHaveBeenCalledWith(
        req,
        'm2m',
        { uid: 'c-news', name: 'Acme Newsletter' },
        { email: 'jane@acme-motors.example', b2b_org_uid: 'org-1', company_name: 'Acme Motors' }
      );
      expect(deps.newsletterService.getLatestCommitteeNewsletter).toHaveBeenCalledWith(req, 'c-news', { bearerToken: 'm2m' });
      expect(deps.newsletterService.getNewsletter).toHaveBeenCalledWith(req, 'p-1', 'n-new', { bearerToken: 'm2m' });
      expect(deps.inviteService.resolveFoundation).toHaveBeenCalledWith(req, 'p-1', { bearerToken: 'm2m' });
      expect(grant.issue).toMatchObject({ foundation, masked_email: 'ja***@acme***.example', confirmation_sent: false, newsletter: { id: 'n-new' } });
      expect(grant.session).toEqual({ e: 'jane@acme-motors.example', c: 'c-news', f: 'f-1', v: true });
    });

    it('returns no issue when the group has sent none', async () => {
      deps.newsletterService.getLatestCommitteeNewsletter.mockResolvedValueOnce(null);
      const grant = await service.acceptInvite(req, createNewsletterInviteToken('c-news', 'jane@acme-motors.example'));
      expect(grant.issue.newsletter).toBeNull();
    });

    it('refuses an expired link and an address whose company is no longer a member, without adding it', async () => {
      await expect(service.acceptInvite(req, createNewsletterInviteToken('c-news', 'jane@acme-motors.example', 0))).rejects.toBeInstanceOf(InvalidRequestError);

      deps.memberBenefitService.findMemberCompanyForEmail.mockResolvedValueOnce(null);
      await expect(service.acceptInvite(req, createNewsletterInviteToken('c-news', 'jane@acme-motors.example'))).rejects.toBeInstanceOf(AuthorizationError);
      expect(deps.memberBenefitService.addToNewsletterGroup).not.toHaveBeenCalled();
    });
  });

  describe('requestSharedAccess', () => {
    it('opens the shared issue for a member-company email and emails a signed confirmation link without joining the list', async () => {
      const grant = await service.requestSharedAccess(req, 'acme-foundation', issueId, ' Jane@Acme-Motors.example ');

      expect(grant.issue).toMatchObject({
        masked_email: 'ja***@acme***.example',
        confirmation_sent: true,
        newsletter: { id: issueId, body_html: `<p>${issueId}</p>` },
      });
      expect(grant.session).toEqual({ e: 'jane@acme-motors.example', c: 'c-news', f: 'f-1', v: false });
      expect(deps.memberBenefitService.addToNewsletterGroup).not.toHaveBeenCalled();

      const sent = deps.emailService.sendEmail.mock.calls[0][1];
      expect(sent.to).toBe('jane@acme-motors.example');
      const token = decodeURIComponent(/newsletters\/invite#token=(\S+)/.exec(sent.text)?.[1] ?? '');
      expect(readNewsletterInviteToken(token)).toMatchObject({ status: 'valid', payload: { c: 'c-news', e: 'jane@acme-motors.example' } });
    });

    it('rejects an email that is not at a member company', async () => {
      deps.memberBenefitService.findMemberCompanyForEmail.mockResolvedValueOnce(null);
      await expect(service.requestSharedAccess(req, 'acme-foundation', issueId, 'jane@elsewhere.example')).rejects.toBeInstanceOf(ServiceValidationError);
      expect(deps.emailService.sendEmail).not.toHaveBeenCalled();
    });

    it('treats an unsent issue, an issue with no newsletter group, and a malformed id as unavailable', async () => {
      deps.newsletterService.getNewsletter.mockResolvedValueOnce({ ...sentIssue(issueId, ''), status: 'draft' });
      await expect(service.requestSharedAccess(req, 'acme-foundation', issueId, 'jane@acme-motors.example')).rejects.toBeInstanceOf(ResourceNotFoundError);

      deps.memberBenefitService.resolveNewsletterGroup.mockResolvedValueOnce(null);
      await expect(service.requestSharedAccess(req, 'acme-foundation', issueId, 'jane@acme-motors.example')).rejects.toBeInstanceOf(ResourceNotFoundError);

      await expect(service.requestSharedAccess(req, 'acme-foundation', 'not-a-uuid', 'jane@acme-motors.example')).rejects.toBeInstanceOf(ResourceNotFoundError);
    });

    it('answers the same whether or not the reader is already on the list, and survives a failed email', async () => {
      deps.memberBenefitService.isEmailInGroup.mockResolvedValueOnce(true);
      expect((await service.requestSharedAccess(req, 'acme-foundation', issueId, 'jane@acme-motors.example')).issue.confirmation_sent).toBe(true);
      expect(deps.emailService.sendEmail).not.toHaveBeenCalled();

      deps.emailService.sendEmail.mockRejectedValueOnce(new MicroserviceError('rejected', 502, 'EMAIL_SEND_FAILED'));
      expect((await service.requestSharedAccess(req, 'acme-foundation', issueId, 'jane@acme-motors.example')).issue.confirmation_sent).toBe(true);
      expect(deps.inviteService.releaseRecipientCooldown).toHaveBeenCalledWith(`c-news|jane@acme-motors.example`);
    });

    it('keeps the confirmation cooldown when the send outcome is unknown', async () => {
      deps.emailService.sendEmail.mockRejectedValueOnce(new MicroserviceError('unconfirmed', 502, 'EMAIL_SEND_UNCONFIRMED'));
      await service.requestSharedAccess(req, 'acme-foundation', issueId, 'jane@acme-motors.example');

      deps.emailService.sendEmail.mockRejectedValueOnce(new MicroserviceError('lost', 502, 'EMAIL_SEND_FAILED', { transportFailure: true }));
      await service.requestSharedAccess(req, 'acme-foundation', issueId, 'jane@acme-motors.example');

      expect(deps.inviteService.releaseRecipientCooldown).not.toHaveBeenCalled();
    });
  });

  describe('getSharedIssue', () => {
    it('returns only the foundation prompt and a teaser without a session, or with a session for another foundation', async () => {
      expect(await service.getSharedIssue(req, null, 'acme-foundation', issueId)).toEqual({
        issue: null,
        foundation,
        membership_name: 'Acme Foundation',
        teaser: { subject: `Issue ${issueId}`, image_url: null, excerpt: issueId },
      });
      expect(
        await service.getSharedIssue(
          req,
          { e: 'jane@acme-motors.example', c: 'c-x', f: 'f-other', v: true, exp: Date.now() + 1000 },
          'acme-foundation',
          issueId
        )
      ).toMatchObject({
        issue: null,
      });
    });

    it('returns the issue for a session on its foundation', async () => {
      const response = await service.getSharedIssue(
        req,
        { e: 'jane@acme-motors.example', c: 'c-news', f: 'f-1', v: false, exp: Date.now() + 1000 },
        'acme-foundation',
        issueId
      );
      expect(response.issue).toMatchObject({ masked_email: 'ja***@acme***.example', confirmation_sent: true, newsletter: { id: issueId } });
    });

    it('returns nothing for an issue the member benefit does not open', async () => {
      deps.projectService.getProjectIdBySlug.mockResolvedValueOnce({ exists: false });
      expect(await service.getSharedIssue(req, null, 'acme-foundation', issueId)).toEqual({ issue: null });
    });
  });
});

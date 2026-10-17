// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The service imports the `@lfx-one/shared/utils` barrel, which pulls @angular/forms; the JIT
// compiler must be present in this plain-Node runtime.
import '@angular/compiler';

import { ProjectFunding } from '@lfx-one/shared/enums';
import type { MyNewsletter, Project } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { resolveVerifiedUserEmails, resolveRootProjectUid, generateM2MToken, getEffectiveName, getEffectiveUsername } = vi.hoisted(() => ({
  resolveVerifiedUserEmails: vi.fn(),
  resolveRootProjectUid: vi.fn(),
  generateM2MToken: vi.fn(),
  getEffectiveName: vi.fn(),
  getEffectiveUsername: vi.fn(),
}));

vi.mock('./microservice-proxy.service', () => ({ MicroserviceProxyService: class {} }));
vi.mock('./email-verification.service', () => ({ EmailVerificationService: class {} }));
vi.mock('./newsletter.service', () => ({ NewsletterService: class {} }));
vi.mock('./committee.service', () => ({ CommitteeService: class {} }));
vi.mock('./project.service', () => ({ ProjectService: class {} }));
vi.mock('./email.service', () => ({ EmailService: class {} }));
vi.mock('./newsletter-member-benefit.service', () => ({ NewsletterMemberBenefitService: class {} }));
vi.mock('./nats.service', () => ({ NatsService: class {} }));
vi.mock('../helpers/user-emails.helper', () => ({ resolveVerifiedUserEmails }));
vi.mock('../helpers/root-project.helper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../helpers/root-project.helper')>()),
  resolveRootProjectUid,
}));
vi.mock('../utils/auth-helper', () => ({ getEffectiveName, getEffectiveUsername }));
vi.mock('../utils/m2m-token.util', () => ({ generateM2MToken }));
vi.mock('./logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import type { Request } from 'express';

import { AuthorizationError, ResourceNotFoundError, ServiceValidationError } from '../errors';
import { NewsletterInviteService } from './newsletter-invite.service';

const req = {} as unknown as Request;

const FOUNDATION: Partial<Project> = {
  uid: 'f-1',
  slug: 'acme-foundation',
  name: 'Acme Foundation',
  logo_url: 'https://logos.example/acme.png',
  stage: 'Active',
  funding: ProjectFunding.Funded,
  funding_model: ['Membership'],
};
const PLAIN_PARENT: Partial<Project> = { uid: 'pp-1', slug: 'plain-parent', name: 'Plain Parent', parent_uid: 'f-1' };
const GRANDCHILD: Partial<Project> = { uid: 'gc-1', slug: 'grandchild', name: 'Grandchild', parent_uid: 'pp-1' };
const CHILD: Partial<Project> = { uid: 'p-1', slug: 'acme-child', name: 'Acme Child', parent_uid: 'f-1' };
const OTHER_FOUNDATION: Partial<Project> = { uid: 'f-2', slug: 'beta-foundation', name: 'Beta Foundation', logo_url: '', stage: 'Formation' };
// Top-level projects are parented to the hidden ROOT project, which getProjectsByIds never returns.
const TLF: Partial<Project> = {
  uid: 'tlf-1',
  slug: 'tlf',
  name: 'The Linux Foundation',
  parent_uid: 'root-uid',
  stage: 'Active',
  funding_model: ['Membership'],
};
const LF_PRODUCTS: Partial<Project> = {
  uid: 'lfp-1',
  slug: 'lfproducts',
  name: 'LF Products',
  parent_uid: 'root-uid',
  stage: 'Active',
  legal_entity_type: 'Internal Allocation',
  // Membership-funded on paper, so only the Internal Allocation rule sends it to The Linux Foundation's roster.
  funding_model: ['Membership'],
};

const NEWSLETTER_GROUP = { uid: 'c-news', name: 'Acme Weekly', category: 'Newsletter', project_uid: 'f-1' };
const BETA_GROUP = { uid: 'c-beta', name: 'Beta Weekly', category: 'Newsletter', project_uid: 'f-2' };
const TLF_GROUP = { uid: 'c-tlf', name: 'TLF Weekly', category: 'Newsletter', project_uid: 'tlf-1' };
const LFP_GROUP = { uid: 'c-lfp', name: 'GB', category: 'Newsletter', project_uid: 'lfp-1' };
const BOARD = { uid: 'c-board', name: 'Acme Board', category: 'Board', project_uid: 'f-1' };

const MATCH = { email: 'jane@acme-motors.example', b2b_org_uid: 'org-1', company_name: 'Acme Motors' };

function feedRow(id: string, sentAt: string, foundationUid = 'f-1'): MyNewsletter {
  return {
    id,
    project_uid: foundationUid,
    subject: `Issue ${id}`,
    sent_at: sentAt,
    foundation_uid: foundationUid,
    foundation_slug: foundationUid === 'f-1' ? 'acme-foundation' : 'beta-foundation',
    foundation_name: foundationUid === 'f-1' ? 'Acme Foundation' : 'Beta Foundation',
    foundation_logo_url: null,
  };
}

describe('NewsletterInviteService', () => {
  let committees: Record<string, unknown>[];
  const deps = {
    memberBenefitService: {
      resolveEligibility: vi.fn(),
      resolveEligibilityByRoster: vi.fn(),
      findMemberCompanyForEmail: vi.fn(),
      isEmailInGroup: vi.fn(),
      isGroupMember: vi.fn(),
      addToNewsletterGroup: vi.fn(),
    },
    newsletterService: { getMyNewsletters: vi.fn() },
    committeeService: { getMyCommitteeUids: vi.fn() },
    projectService: { getProjectsByIds: vi.fn() },
    emailVerificationService: {},
    emailService: { sendEmail: vi.fn() },
    microserviceProxy: { proxyRequest: vi.fn() },
  };
  let service: NewsletterInviteService;

  beforeEach(() => {
    vi.clearAllMocks();
    NewsletterInviteService.resetRecentInvites();
    process.env['PCC_BASE_URL'] = 'https://app.lfx.example';
    committees = [NEWSLETTER_GROUP, BOARD];

    generateM2MToken.mockResolvedValue('m2m');
    resolveRootProjectUid.mockResolvedValue('root-uid');
    resolveVerifiedUserEmails.mockResolvedValue([MATCH.email]);
    getEffectiveName.mockReturnValue('Jane Doe');
    deps.memberBenefitService.resolveEligibility.mockResolvedValue({ verified_emails: [MATCH.email], match: MATCH });
    // The batched grid check behaves like resolveEligibility per roster, with a failed roster as null.
    deps.memberBenefitService.resolveEligibilityByRoster.mockImplementation(async (r: Request, token: string, emails: string[], slugs: string[]) => {
      const settled = await Promise.allSettled(slugs.map((slug) => deps.memberBenefitService.resolveEligibility(r, token, emails, slug)));
      return new Map(slugs.map((slug, i) => [slug, settled[i].status === 'fulfilled' ? settled[i].value : null]));
    });
    deps.committeeService.getMyCommitteeUids.mockResolvedValue(new Set(['c-news', 'c-board']));
    deps.newsletterService.getMyNewsletters.mockResolvedValue({ newsletters: [], complete: true });
    deps.projectService.getProjectsByIds.mockImplementation(async (_req: Request, uids: Set<string>) => {
      const all = [FOUNDATION, CHILD, OTHER_FOUNDATION, PLAIN_PARENT, GRANDCHILD, TLF, LF_PRODUCTS];
      return new Map(all.filter((project) => uids.has(project.uid as string)).map((project) => [project.uid, project]));
    });
    // Every query-service committee read: return the committees whose uid tag was asked for.
    deps.microserviceProxy.proxyRequest.mockImplementation(
      async (_req: Request, _svc: string, _path: string, _method: string, query: Record<string, unknown>) => {
        const tags = (query['tags'] as string[]).map((tag) => tag.replace('committee_uid:', ''));
        return { resources: committees.filter((committee) => tags.includes(committee['uid'] as string)).map((data) => ({ data })) };
      }
    );

    service = new NewsletterInviteService(deps as never);
  });

  describe('getMyNewsletterFoundations', () => {
    it('groups the feed by foundation with received counts, newest first, and adds groups that have not sent yet', async () => {
      deps.committeeService.getMyCommitteeUids.mockResolvedValue(new Set(['c-news', 'c-beta']));
      committees = [NEWSLETTER_GROUP, BETA_GROUP];
      deps.newsletterService.getMyNewsletters.mockResolvedValue({
        newsletters: [feedRow('n-2', '2026-10-05T00:00:00Z'), feedRow('n-1', '2026-09-01T00:00:00Z')],
        complete: true,
      });

      const result = await service.getMyNewsletterFoundations(req);

      expect(result.foundations.map((card) => [card.uid, card.received_count, card.last_sent_at])).toEqual([
        ['f-1', 2, '2026-10-05T00:00:00Z'],
        ['f-2', 0, null],
      ]);
      expect(result.foundations[0].newsletter_group).toEqual({ uid: 'c-news', name: 'Acme Weekly' });
      expect(result.foundations.every((card) => card.can_invite)).toBe(true);
      expect(result.inviter).toEqual({ eligible: true, company_name: 'Acme Motors' });
      // The feed reuses the membership set instead of reading it twice.
      expect(deps.newsletterService.getMyNewsletters).toHaveBeenCalledWith(req, new Set(['c-news', 'c-beta']));
    });

    it('rolls a child project newsletter group up to its foundation and never uses non-Newsletter committees', async () => {
      committees = [{ ...NEWSLETTER_GROUP, project_uid: 'p-1' }, BOARD];

      const result = await service.getMyNewsletterFoundations(req);

      expect(result.foundations).toHaveLength(1);
      expect(result.foundations[0]).toMatchObject({ uid: 'f-1', slug: 'acme-foundation', newsletter_group: { uid: 'c-news', name: 'Acme Weekly' } });
    });

    it('never treats a parent that is not a confirmed foundation as the foundation', async () => {
      committees = [{ ...NEWSLETTER_GROUP, project_uid: 'gc-1' }];

      const result = await service.getMyNewsletterFoundations(req);

      expect(result.foundations[0]).toMatchObject({ uid: 'gc-1', slug: 'grandchild' });
    });

    it('stays fail-soft when project data is unavailable for the card grid', async () => {
      deps.projectService.getProjectsByIds.mockResolvedValue(new Map());

      const result = await service.getMyNewsletterFoundations(req);

      expect(result.foundations).toEqual([]);
    });

    it('hides invites (but still renders cards) when the inviter is not at a member company', async () => {
      deps.memberBenefitService.resolveEligibility.mockResolvedValue({ verified_emails: [], match: null, denied_reason: 'no_company_email' });
      deps.newsletterService.getMyNewsletters.mockResolvedValue({ newsletters: [feedRow('n-1', '2026-09-01T00:00:00Z')], complete: true });

      const result = await service.getMyNewsletterFoundations(req);

      expect(result.inviter).toEqual({ eligible: false, company_name: null, denied_reason: 'no_company_email' });
      expect(result.foundations[0].can_invite).toBe(false);
    });

    it('fails soft when the eligibility or group lookups are down', async () => {
      resolveVerifiedUserEmails.mockRejectedValue(new Error('auth-service down'));
      deps.microserviceProxy.proxyRequest.mockRejectedValue(new Error('query-service down'));
      deps.newsletterService.getMyNewsletters.mockResolvedValue({ newsletters: [feedRow('n-1', '2026-09-01T00:00:00Z')], complete: true });

      const result = await service.getMyNewsletterFoundations(req);

      expect(result.inviter.denied_reason).toBe('unavailable');
      expect(result.foundations).toHaveLength(1);
      expect(result.foundations[0]).toMatchObject({ newsletter_group: null, can_invite: false });
    });
    it('decides each card against its own foundation: own members when membership-funded, else The Linux Foundation', async () => {
      deps.committeeService.getMyCommitteeUids.mockResolvedValue(new Set(['c-news', 'c-beta', 'c-lfp']));
      committees = [NEWSLETTER_GROUP, BETA_GROUP, LFP_GROUP];
      // The user's company is a TLF member but not an Acme Foundation member.
      deps.memberBenefitService.resolveEligibility.mockImplementation(async (_req: Request, _token: string, emails: string[], slug: string) =>
        slug === 'tlf' ? { verified_emails: emails, match: MATCH } : { verified_emails: emails, match: null, denied_reason: 'not_member_company' }
      );

      const result = await service.getMyNewsletterFoundations(req);
      const byUid = new Map(result.foundations.map((card) => [card.uid, card]));

      expect(byUid.get('f-1')).toMatchObject({ can_invite: false, membership_name: 'Acme Foundation', invite_denied_reason: 'not_member_company' });
      expect(byUid.get('f-2')).toMatchObject({ can_invite: true, membership_name: 'The Linux Foundation' });
      expect(byUid.get('lfp-1')).toMatchObject({ can_invite: true, membership_name: 'The Linux Foundation' });
      expect(byUid.get('lfp-1')).not.toHaveProperty('invite_denied_reason');
      // One roster read per membership scope, not per card.
      expect(deps.memberBenefitService.resolveEligibility.mock.calls.map((call) => call[3]).sort()).toEqual(['acme-foundation', 'tlf']);
      expect(result.inviter).toEqual({ eligible: true, company_name: 'Acme Motors' });
    });

    it('hides invites only on cards whose membership roster could not be checked', async () => {
      deps.committeeService.getMyCommitteeUids.mockResolvedValue(new Set(['c-news', 'c-beta']));
      committees = [NEWSLETTER_GROUP, BETA_GROUP];
      deps.memberBenefitService.resolveEligibility.mockImplementation(async (_req: Request, _token: string, emails: string[], slug: string) => {
        if (slug === 'acme-foundation') throw new Error('membership read failed');
        return { verified_emails: emails, match: MATCH };
      });

      const byUid = new Map((await service.getMyNewsletterFoundations(req)).foundations.map((card) => [card.uid, card]));

      expect(byUid.get('f-1')).toMatchObject({ can_invite: false, invite_denied_reason: 'unavailable' });
      expect(byUid.get('f-2')).toMatchObject({ can_invite: true });
    });

    it("reads a card as 'unavailable', not 'join the list', when its group's project could not be resolved", async () => {
      resolveRootProjectUid.mockResolvedValue(null);
      deps.committeeService.getMyCommitteeUids.mockResolvedValue(new Set(['c-tlf']));
      committees = [TLF_GROUP];
      deps.newsletterService.getMyNewsletters.mockResolvedValue({ newsletters: [feedRow('n-1', '2026-09-01T00:00:00Z', 'tlf-1')], complete: true });

      const [card] = (await service.getMyNewsletterFoundations(req)).foundations;

      expect(card).toMatchObject({ uid: 'tlf-1', can_invite: false, invite_denied_reason: 'unavailable' });
    });

    it('marks cards without a newsletter group as not invitable', async () => {
      deps.newsletterService.getMyNewsletters.mockResolvedValue({ newsletters: [feedRow('n-1', '2026-09-01T00:00:00Z', 'f-2')], complete: true });
      deps.committeeService.getMyCommitteeUids.mockResolvedValue(new Set());
      committees = [];

      const [card] = (await service.getMyNewsletterFoundations(req)).foundations;

      expect(card).toMatchObject({ uid: 'f-2', can_invite: false, membership_name: null, invite_denied_reason: 'no_newsletter_group' });
    });
  });

  describe('sendInvite', () => {
    beforeEach(() => {
      deps.memberBenefitService.findMemberCompanyForEmail.mockResolvedValue({ b2b_org_uid: 'org-2', company_name: 'Acme Motors' });
      deps.memberBenefitService.isEmailInGroup.mockResolvedValue(false);
      deps.emailService.sendEmail.mockResolvedValue({ email_id: 'e-1' });
    });

    it('emails a member-company coworker a link to the foundation drill-down', async () => {
      const result = await service.sendInvite(req, 'f-1', '  Coworker@Acme-Motors.example ');

      expect(result).toEqual({ email: 'coworker@acme-motors.example', foundation_name: 'Acme Foundation' });
      const sent = deps.emailService.sendEmail.mock.calls[0][1];
      expect(sent.to).toBe('coworker@acme-motors.example');
      expect(sent.subject).toBe("You're invited to the Acme Foundation newsletter");
      expect(sent.html).toContain('<strong>Jane Doe</strong>');
      expect(sent.html).toContain(
        `https://app.lfx.example/login?returnTo=${encodeURIComponent('/newsletters/my/acme-foundation?invite=c-news')}`.replace(/&/g, '&amp;')
      );
      expect(sent.text).toContain('Acme Motors');
    });

    it('rejects personal mailboxes and malformed addresses before any lookup', async () => {
      await expect(service.sendInvite(req, 'f-1', 'someone@gmail.example')).rejects.toBeInstanceOf(ServiceValidationError);
      await expect(service.sendInvite(req, 'f-1', 'not-an-email')).rejects.toBeInstanceOf(ServiceValidationError);
      expect(deps.committeeService.getMyCommitteeUids).not.toHaveBeenCalled();
    });

    it("refuses a sender who is not in the foundation's newsletter group", async () => {
      await expect(service.sendInvite(req, 'f-2', 'coworker@acme-motors.example')).rejects.toBeInstanceOf(AuthorizationError);
      expect(deps.emailService.sendEmail).not.toHaveBeenCalled();
    });

    it('refuses a sender who is not at a member company', async () => {
      deps.memberBenefitService.resolveEligibility.mockResolvedValue({ verified_emails: [], match: null, denied_reason: 'not_member_company' });

      await expect(service.sendInvite(req, 'f-1', 'coworker@acme-motors.example')).rejects.toBeInstanceOf(AuthorizationError);
    });

    it("rejects an invitee whose company is not a member of the card's foundation", async () => {
      deps.memberBenefitService.findMemberCompanyForEmail.mockResolvedValue(null);

      const error = await service.sendInvite(req, 'f-1', 'someone@other-corp.example').catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ServiceValidationError);
      expect((error as ServiceValidationError).validationErrors[0]).toMatchObject({
        code: 'NEWSLETTER_INVITE_NOT_MEMBER_COMPANY',
        message: "other-corp.example isn't a member company of Acme Foundation",
      });
      // Both the sender and the invitee are checked against the foundation's own members.
      expect(deps.memberBenefitService.resolveEligibility).toHaveBeenCalledWith(req, 'm2m', [MATCH.email], 'acme-foundation');
      expect(deps.memberBenefitService.findMemberCompanyForEmail).toHaveBeenCalledWith(req, 'm2m', 'someone@other-corp.example', 'acme-foundation');
      expect(deps.emailService.sendEmail).not.toHaveBeenCalled();
    });

    it('answers the same for someone already on the list without emailing them again', async () => {
      deps.memberBenefitService.isEmailInGroup.mockResolvedValue(true);

      const result = await service.sendInvite(req, 'f-1', 'coworker@acme-motors.example');

      expect(result).toEqual({ email: 'coworker@acme-motors.example', foundation_name: 'Acme Foundation' });
      expect(deps.emailService.sendEmail).not.toHaveBeenCalled();
    });

    it('puts a cleaned, capped inviter name in the body and never in the subject', async () => {
      getEffectiveName.mockReturnValue(`Jane\r\nVerify at https://phish.example/now ${'x'.repeat(100)}`);

      await service.sendInvite(req, 'f-1', 'coworker@acme-motors.example');

      const sent = deps.emailService.sendEmail.mock.calls[0][1];
      expect(sent.subject).toBe("You're invited to the Acme Foundation newsletter");
      expect(sent.text).not.toContain('phish.example');
      expect(sent.text).not.toMatch(/Jane\r?\n/);
      expect(sent.text).toContain('…');
    });

    it('emails one address about one list at most once per cooldown, with the same answer', async () => {
      await service.sendInvite(req, 'f-1', 'coworker@acme-motors.example');
      const again = await service.sendInvite(req, 'f-1', 'coworker@acme-motors.example');

      expect(again).toEqual({ email: 'coworker@acme-motors.example', foundation_name: 'Acme Foundation' });
      expect(deps.emailService.sendEmail).toHaveBeenCalledTimes(1);
    });

    it('sends once when the same invite is submitted twice concurrently', async () => {
      await Promise.all([service.sendInvite(req, 'f-1', 'coworker@acme-motors.example'), service.sendInvite(req, 'f-1', 'coworker@acme-motors.example')]);

      expect(deps.emailService.sendEmail).toHaveBeenCalledTimes(1);
    });

    it('releases the cooldown when the send fails, so the sender can retry', async () => {
      deps.emailService.sendEmail.mockRejectedValueOnce(new Error('email-service down'));

      await expect(service.sendInvite(req, 'f-1', 'coworker@acme-motors.example')).rejects.toThrow('email-service down');
      await service.sendInvite(req, 'f-1', 'coworker@acme-motors.example');

      expect(deps.emailService.sendEmail).toHaveBeenCalledTimes(2);
    });

    it('strips bare-domain lures from the inviter name and falls back when nothing is left', async () => {
      getEffectiveName.mockReturnValue('Jane Pay now at lfx-secure.example/login');
      await service.sendInvite(req, 'f-1', 'coworker@acme-motors.example');
      expect(deps.emailService.sendEmail.mock.calls[0][1].text).not.toContain('lfx-secure.example');
      expect(deps.emailService.sendEmail.mock.calls[0][1].text).toContain('Jane Pay now at has invited you');

      getEffectiveName.mockReturnValue('lfx-secure.example');
      await service.sendInvite(req, 'f-1', 'other@acme-motors.example');
      expect(deps.emailService.sendEmail.mock.calls[1][1].text).toContain('A colleague has invited you');
    });

    it('answers a retryable 503, not a membership refusal, when project data is unavailable', async () => {
      deps.projectService.getProjectsByIds.mockResolvedValue(new Map());

      await expect(service.sendInvite(req, 'f-1', 'coworker@acme-motors.example')).rejects.toMatchObject({
        statusCode: 503,
        code: 'NEWSLETTER_FOUNDATION_UNAVAILABLE',
      });
    });

    it('rejects addresses with characters outside the plain address shape', async () => {
      await expect(service.sendInvite(req, 'f-1', 'a,b@acme-motors.example')).rejects.toBeInstanceOf(ServiceValidationError);
      await expect(service.sendInvite(req, 'f-1', '"x"@acme-motors.example')).rejects.toBeInstanceOf(ServiceValidationError);
    });

    it('fails closed instead of mailing a guessed link when the app origin is not configured', async () => {
      delete process.env['PCC_BASE_URL'];

      await expect(service.sendInvite(req, 'f-1', 'coworker@acme-motors.example')).rejects.toThrow('PCC_BASE_URL');
      expect(deps.emailService.sendEmail).not.toHaveBeenCalled();
    });
    it('invites to a top-level project parented to ROOT, checking The Linux Foundation members when it has none of its own', async () => {
      deps.committeeService.getMyCommitteeUids.mockResolvedValue(new Set(['c-tlf', 'c-lfp']));
      committees = [TLF_GROUP, LFP_GROUP];
      deps.memberBenefitService.findMemberCompanyForEmail.mockResolvedValue({ b2b_org_uid: 'org-2', company_name: 'Google' });

      await expect(service.sendInvite(req, 'lfp-1', 'test@google.example')).resolves.toEqual({ email: 'test@google.example', foundation_name: 'LF Products' });
      await expect(service.sendInvite(req, 'tlf-1', 'test@google.example')).resolves.toEqual({
        email: 'test@google.example',
        foundation_name: 'The Linux Foundation',
      });

      expect(deps.memberBenefitService.findMemberCompanyForEmail.mock.calls.map((call) => call[3])).toEqual(['tlf', 'tlf']);
      expect(deps.emailService.sendEmail).toHaveBeenCalledTimes(2);
    });

    it("does not let another group's unresolvable project block an invite", async () => {
      deps.committeeService.getMyCommitteeUids.mockResolvedValue(new Set(['c-news', 'c-orphan']));
      committees = [NEWSLETTER_GROUP, { uid: 'c-orphan', name: 'Orphan', category: 'Newsletter', project_uid: 'missing-project' }];

      await expect(service.sendInvite(req, 'f-1', 'coworker@acme-motors.example')).resolves.toMatchObject({ foundation_name: 'Acme Foundation' });
    });

    it('still answers 503 when the ROOT project cannot be identified and the target foundation sits under it', async () => {
      resolveRootProjectUid.mockResolvedValue(null);
      deps.committeeService.getMyCommitteeUids.mockResolvedValue(new Set(['c-lfp']));
      committees = [LFP_GROUP];

      await expect(service.sendInvite(req, 'lfp-1', 'test@google.example')).rejects.toMatchObject({ statusCode: 503 });
    });
  });

  describe('getJoinStatus / joinGroup', () => {
    beforeEach(() => {
      deps.memberBenefitService.isGroupMember.mockResolvedValue(false);
    });

    it("answers a retryable 503, not 'invalid invite', when the group's project cannot be loaded", async () => {
      deps.projectService.getProjectsByIds.mockResolvedValue(new Map());

      await expect(service.getJoinStatus(req, 'c-news')).rejects.toMatchObject({ statusCode: 503 });
    });

    it('treats a committee that is not a Newsletter group as an invalid invite', async () => {
      await expect(service.getJoinStatus(req, 'c-board')).rejects.toBeInstanceOf(ResourceNotFoundError);
      await expect(service.joinGroup(req, 'c-board')).rejects.toBeInstanceOf(ResourceNotFoundError);
      expect(deps.memberBenefitService.addToNewsletterGroup).not.toHaveBeenCalled();
    });

    it('reports an eligible user with the email and company that will be used', async () => {
      const status = await service.getJoinStatus(req, 'c-news');

      expect(status).toEqual({
        state: 'eligible',
        group: { uid: 'c-news', name: 'Acme Weekly' },
        foundation: { uid: 'f-1', slug: 'acme-foundation', name: 'Acme Foundation', logo_url: 'https://logos.example/acme.png' },
        membership_name: 'Acme Foundation',
        email: MATCH.email,
        company_name: 'Acme Motors',
      });
      expect(deps.memberBenefitService.resolveEligibility).toHaveBeenCalledWith(req, 'm2m', [MATCH.email], 'acme-foundation');
    });

    it('checks the landing of a ROOT-parented project without its own members against The Linux Foundation', async () => {
      committees = [LFP_GROUP];

      await expect(service.getJoinStatus(req, 'c-lfp')).resolves.toMatchObject({
        state: 'eligible',
        foundation: { uid: 'lfp-1', name: 'LF Products' },
        membership_name: 'The Linux Foundation',
      });
      expect(deps.memberBenefitService.resolveEligibility).toHaveBeenCalledWith(req, 'm2m', [MATCH.email], 'tlf');
    });

    it('reports an existing member and a denied user', async () => {
      deps.memberBenefitService.isGroupMember.mockResolvedValueOnce(true);
      expect((await service.getJoinStatus(req, 'c-news')).state).toBe('already_member');

      deps.memberBenefitService.resolveEligibility.mockResolvedValue({ verified_emails: [], match: null, denied_reason: 'no_company_email' });
      expect(await service.getJoinStatus(req, 'c-news')).toMatchObject({ state: 'denied', denied_reason: 'no_company_email' });
    });

    it('adds an eligible user and refuses a denied one', async () => {
      deps.memberBenefitService.addToNewsletterGroup.mockResolvedValue('added');

      expect(await service.joinGroup(req, 'c-news')).toEqual({
        status: 'added',
        email: MATCH.email,
        committee_name: 'Acme Weekly',
        company_name: 'Acme Motors',
      });
      expect(deps.memberBenefitService.addToNewsletterGroup).toHaveBeenCalledWith(req, 'm2m', { uid: 'c-news', name: 'Acme Weekly' }, MATCH);

      deps.memberBenefitService.resolveEligibility.mockResolvedValue({ verified_emails: [], match: null, denied_reason: 'not_member_company' });
      await expect(service.joinGroup(req, 'c-news')).rejects.toBeInstanceOf(AuthorizationError);
    });
  });
});

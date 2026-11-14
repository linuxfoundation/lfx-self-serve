// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The service imports the `@lfx-one/shared/utils` barrel, which pulls @angular/forms; the JIT
// compiler must be present in this plain-Node runtime.
import '@angular/compiler';

import type { Newsletter } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { proxyRequest, resolveVerifiedUserEmails, getEffectiveUsername, generateM2MToken, getNewsletter, checkAccessStrict, createCommitteeMember } = vi.hoisted(
  () => ({
    proxyRequest: vi.fn(),
    resolveVerifiedUserEmails: vi.fn(),
    getEffectiveUsername: vi.fn(),
    generateM2MToken: vi.fn(),
    getNewsletter: vi.fn(),
    checkAccessStrict: vi.fn(),
    createCommitteeMember: vi.fn(),
  })
);

vi.mock('./microservice-proxy.service', () => ({
  MicroserviceProxyService: class {
    public proxyRequest = proxyRequest;
  },
}));
vi.mock('./email-verification.service', () => ({ EmailVerificationService: class {} }));
vi.mock('./newsletter.service', () => ({
  NewsletterService: class {
    public getNewsletter = getNewsletter;
  },
}));
vi.mock('./access-check.service', () => ({
  AccessCheckService: class {
    public checkAccessStrict = checkAccessStrict;
  },
}));
vi.mock('./committee.service', () => ({
  CommitteeService: class {
    public createCommitteeMember = createCommitteeMember;
  },
}));
vi.mock('../helpers/user-emails.helper', () => ({ resolveVerifiedUserEmails }));
vi.mock('../utils/auth-helper', () => ({ getEffectiveUsername }));
vi.mock('../utils/m2m-token.util', () => ({ generateM2MToken }));
vi.mock('./logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import type { Request } from 'express';

import { MicroserviceError } from '../errors';
import { NewsletterMemberBenefitService } from './newsletter-member-benefit.service';

const req = {} as unknown as Request;
const M2M = 'm2m-token';
const PROJECT_UID = 'p-1';
const NEWSLETTER_UID = 'n-1';

const ORG_A = '0014100000AcmeAAAA';
const ORG_B = '0014100000BetaAAAA';

interface Membership {
  b2b_org_uid: string;
  company_domain?: string;
  company_name?: string;
  status: string;
  project_slug?: string;
}

interface B2bOrg {
  uid: string;
  primary_domain?: string;
  domain_aliases?: string[];
}

/** Routes query-service reads by `type` so each test declares only the data it needs. */
function stubUpstream(options: {
  memberships?: Membership[] | (() => Promise<unknown>);
  b2bOrgs?: B2bOrg[] | Error;
  committeeMembers?: (query: Record<string, unknown>) => boolean;
  committees?: Record<string, { name: string; category: string }>;
}): void {
  proxyRequest.mockImplementation(async (_req: Request, _svc: string, path: string, _method: string, query: Record<string, unknown>) => {
    if (path !== '/query/resources') throw new Error(`unexpected upstream call ${path}`);
    if (query['type'] === 'project_membership') {
      if (typeof options.memberships === 'function') return options.memberships();
      // Like query-service, answer only the memberships of the requested project slug.
      const slug = String(query['filters_all']).replace('project_slug:', '');
      return {
        resources: (options.memberships ?? [])
          .map((data) => ({ type: 'project_membership', id: data.b2b_org_uid, data: { project_slug: 'tlf', ...data } }))
          .filter((resource) => resource.data.project_slug === slug),
      };
    }
    if (query['type'] === 'b2b_org') {
      if (options.b2bOrgs instanceof Error) throw options.b2bOrgs;
      // Real envelope: the canonical id is on the wrapper (`b2b_org:<sfid>`), not in `data`.
      return { resources: (options.b2bOrgs ?? []).map(({ uid, ...data }) => ({ type: 'b2b_org', id: `b2b_org:${uid}`, data })) };
    }
    if (query['type'] === 'committee_member') {
      return { resources: options.committeeMembers?.(query) ? [{ type: 'committee_member', id: 'm-1', data: {} }] : [] };
    }
    if (query['type'] === 'committee') {
      // Reversed to prove the service picks by the issue's order, not the index's.
      const uids = (query['tags'] as string[]).map((tag) => tag.replace('committee_uid:', '')).reverse();
      return {
        resources: uids.filter((uid) => options.committees?.[uid]).map((uid) => ({ type: 'committee', id: uid, data: { uid, ...options.committees?.[uid] } })),
      };
    }
    throw new Error(`unexpected query type ${String(query['type'])}`);
  });
}

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

function grant(access: { writer?: boolean; auditor?: boolean } = {}): Map<string, boolean> {
  return new Map([
    [`${PROJECT_UID}#writer_guard`, !!access.writer],
    [`${PROJECT_UID}#auditor_guard`, !!access.auditor],
  ]);
}

const ACME_ACTIVE: Membership = { b2b_org_uid: ORG_A, company_domain: 'acme-motors.example', company_name: 'Acme Motors', status: 'Active' };
const NEWSLETTER_GROUP = { 'news-1': { name: 'LF Weekly', category: 'Newsletter' } };

describe('NewsletterMemberBenefitService', () => {
  let service: NewsletterMemberBenefitService;

  beforeEach(() => {
    NewsletterMemberBenefitService.resetDomainIndexCache();
    vi.clearAllMocks();
    proxyRequest.mockReset();
    getEffectiveUsername.mockReturnValue('jdoe');
    generateM2MToken.mockResolvedValue(M2M);
    getNewsletter.mockResolvedValue(makeNewsletter());
    checkAccessStrict.mockResolvedValue(grant());
    resolveVerifiedUserEmails.mockResolvedValue(['jane@acme-motors.example']);
    createCommitteeMember.mockResolvedValue({ uid: 'new-member' });
    service = new NewsletterMemberBenefitService();
  });

  describe('evaluateReaderAccess (the reader ladder)', () => {
    it('returns manager for project writers, drafts included, without membership lookups', async () => {
      checkAccessStrict.mockResolvedValue(grant({ writer: true }));
      getNewsletter.mockResolvedValue(makeNewsletter({ status: 'draft' }));

      const result = await service.evaluateReaderAccess(req, PROJECT_UID, NEWSLETTER_UID);

      expect(result.level).toBe('manager');
      expect(generateM2MToken).not.toHaveBeenCalled();
    });

    it('404s an unsent issue for non-managers with the draft code', async () => {
      checkAccessStrict.mockResolvedValue(grant({ auditor: true }));
      getNewsletter.mockResolvedValue(makeNewsletter({ status: 'scheduled' }));

      await expect(service.evaluateReaderAccess(req, PROJECT_UID, NEWSLETTER_UID)).rejects.toMatchObject({ statusCode: 404, code: 'NEWSLETTER_NOT_SENT' });
    });

    it('lets project auditors (incl. LF staff) read sent issues without a membership check', async () => {
      checkAccessStrict.mockResolvedValue(grant({ auditor: true }));

      const result = await service.evaluateReaderAccess(req, PROJECT_UID, NEWSLETTER_UID);

      expect(result.level).toBe('auditor');
      expect(resolveVerifiedUserEmails).not.toHaveBeenCalled();
    });

    it('returns group_member when the reader is already in the audience', async () => {
      stubUpstream({ committeeMembers: () => true });

      const result = await service.evaluateReaderAccess(req, PROJECT_UID, NEWSLETTER_UID);

      expect(result.level).toBe('group_member');
    });

    it('returns eligible with the match and the newsletter group', async () => {
      stubUpstream({ memberships: [ACME_ACTIVE], committees: NEWSLETTER_GROUP });

      const result = await service.evaluateReaderAccess(req, PROJECT_UID, NEWSLETTER_UID);

      expect(result).toMatchObject({
        level: 'eligible',
        match: { email: 'jane@acme-motors.example', b2b_org_uid: ORG_A, company_name: 'Acme Motors' },
        group: { uid: 'news-1', name: 'LF Weekly' },
      });
      expect(createCommitteeMember).not.toHaveBeenCalled();
    });

    it('denies an eligible reader when the issue has no newsletter group', async () => {
      stubUpstream({ memberships: [ACME_ACTIVE], committees: { 'news-1': { name: 'Board', category: 'Board' } } });

      await expect(service.evaluateReaderAccess(req, PROJECT_UID, NEWSLETTER_UID)).resolves.toMatchObject({ level: 'denied', reason: 'no_newsletter_group' });
    });

    it('reads verified emails strictly, so an auth-service outage errors instead of denying', async () => {
      resolveVerifiedUserEmails.mockRejectedValue(new MicroserviceError('down', 503, 'USER_EMAILS_UNAVAILABLE'));

      await expect(service.evaluateReaderAccess(req, PROJECT_UID, NEWSLETTER_UID)).rejects.toMatchObject({ statusCode: 503 });
      expect(resolveVerifiedUserEmails).toHaveBeenCalledWith(req, expect.anything(), { strict: true });
    });
  });

  describe('getReadableNewsletter (project-scoped GET)', () => {
    it('returns drafts to managers', async () => {
      checkAccessStrict.mockResolvedValue(grant({ writer: true }));
      getNewsletter.mockResolvedValue(makeNewsletter({ status: 'draft' }));

      await expect(service.getReadableNewsletter(req, PROJECT_UID, NEWSLETTER_UID)).resolves.toMatchObject({ status: 'draft' });
    });

    it('404s drafts for everyone else', async () => {
      getNewsletter.mockResolvedValue(makeNewsletter({ status: 'draft' }));

      await expect(service.getReadableNewsletter(req, PROJECT_UID, NEWSLETTER_UID)).rejects.toMatchObject({ statusCode: 404 });
    });

    it('returns a sent issue to group members', async () => {
      stubUpstream({ committeeMembers: () => true });

      await expect(service.getReadableNewsletter(req, PROJECT_UID, NEWSLETTER_UID)).resolves.toMatchObject({ id: NEWSLETTER_UID });
    });

    it('refuses (403) a denied caller instead of returning the body', async () => {
      stubUpstream({ memberships: [ACME_ACTIVE] });
      resolveVerifiedUserEmails.mockResolvedValue(['jane@vendor-corp.example']);

      await expect(service.getReadableNewsletter(req, PROJECT_UID, NEWSLETTER_UID)).rejects.toMatchObject({ statusCode: 403, code: 'NEWSLETTER_MEMBERS_ONLY' });
    });
  });

  describe('assertPublisherRead (project newsletter list)', () => {
    it.each([{ writer: true }, { auditor: true }])('allows %o', async (access) => {
      checkAccessStrict.mockResolvedValue(grant(access));

      await expect(service.assertPublisherRead(req, PROJECT_UID)).resolves.toBeUndefined();
    });

    it('refuses (403) project viewers who are neither writer nor auditor', async () => {
      await expect(service.assertPublisherRead(req, PROJECT_UID)).rejects.toMatchObject({ statusCode: 403, code: 'NEWSLETTER_LIST_FORBIDDEN' });
    });
  });

  describe('joinNewsletterGroup', () => {
    it('re-checks eligibility and adds the work email with the member company, invite suppressed, via M2M', async () => {
      stubUpstream({ memberships: [ACME_ACTIVE], committees: NEWSLETTER_GROUP });

      const result = await service.joinNewsletterGroup(req, PROJECT_UID, NEWSLETTER_UID);

      expect(result).toEqual({ status: 'added', email: 'jane@acme-motors.example', committee_name: 'LF Weekly', company_name: 'Acme Motors' });
      expect(createCommitteeMember).toHaveBeenCalledWith(
        req,
        'news-1',
        { email: 'jane@acme-motors.example', organization: { id: ORG_A, name: 'Acme Motors' } },
        true,
        { bearerToken: M2M }
      );
    });

    it('treats a 409 as already a member', async () => {
      stubUpstream({ memberships: [ACME_ACTIVE], committees: NEWSLETTER_GROUP });
      createCommitteeMember.mockRejectedValue(new MicroserviceError('exists', 409, 'CONFLICT'));

      await expect(service.joinNewsletterGroup(req, PROJECT_UID, NEWSLETTER_UID)).resolves.toMatchObject({ status: 'already_member' });
    });

    it('answers already_member for a reader already in the group, without writing', async () => {
      stubUpstream({ committeeMembers: () => true });

      await expect(service.joinNewsletterGroup(req, PROJECT_UID, NEWSLETTER_UID)).resolves.toMatchObject({ status: 'already_member' });
      expect(createCommitteeMember).not.toHaveBeenCalled();
    });

    it('refuses (403) a caller who is not eligible, without writing', async () => {
      stubUpstream({ memberships: [ACME_ACTIVE] });
      resolveVerifiedUserEmails.mockResolvedValue(['jane@vendor-corp.example']);

      await expect(service.joinNewsletterGroup(req, PROJECT_UID, NEWSLETTER_UID)).rejects.toMatchObject({
        statusCode: 403,
        code: 'NEWSLETTER_MEMBER_BENEFIT_NOT_ELIGIBLE',
      });
      expect(createCommitteeMember).not.toHaveBeenCalled();
    });

    it('refuses managers (nothing to join)', async () => {
      checkAccessStrict.mockResolvedValue(grant({ writer: true }));

      await expect(service.joinNewsletterGroup(req, PROJECT_UID, NEWSLETTER_UID)).rejects.toMatchObject({ statusCode: 403 });
    });

    it('propagates other add failures', async () => {
      stubUpstream({ memberships: [ACME_ACTIVE], committees: NEWSLETTER_GROUP });
      createCommitteeMember.mockRejectedValue(new MicroserviceError('forbidden', 403, 'FORBIDDEN'));

      await expect(service.joinNewsletterGroup(req, PROJECT_UID, NEWSLETTER_UID)).rejects.toMatchObject({ statusCode: 403 });
    });
  });

  describe('resolveEligibility', () => {
    it('matches a verified work email against an active TLF membership domain, case-insensitively', async () => {
      stubUpstream({ memberships: [{ ...ACME_ACTIVE, company_domain: 'Acme-Motors.EXAMPLE' }] });

      const result = await service.resolveEligibility(req, M2M, ['jane@acme-motors.example']);

      expect(result.match).toEqual({ email: 'jane@acme-motors.example', b2b_org_uid: ORG_A, company_name: 'Acme Motors' });
    });

    it('matches a subdomain address through its parent domain', async () => {
      stubUpstream({ memberships: [{ ...ACME_ACTIVE, status: 'Purchased' }] });

      const result = await service.resolveEligibility(req, M2M, ['jane@eng.acme-motors.example']);

      expect(result.match?.b2b_org_uid).toBe(ORG_A);
    });

    it('ignores expired and cancelled memberships', async () => {
      stubUpstream({
        memberships: [
          { ...ACME_ACTIVE, status: 'Expired' },
          { b2b_org_uid: ORG_B, company_domain: 'beta-coastal.example', status: 'Active', company_name: 'Beta Coastal' },
        ],
      });

      const result = await service.resolveEligibility(req, M2M, ['jane@acme-motors.example']);

      expect(result.match).toBeNull();
      expect(result.denied_reason).toBe('not_member_company');
    });

    it('never qualifies a personal mailbox, even when a membership lists that domain', async () => {
      stubUpstream({ memberships: [{ b2b_org_uid: ORG_A, company_domain: 'gmail.example', status: 'Active' }] });

      const result = await service.resolveEligibility(req, M2M, ['jane.doe@gmail.example']);

      expect(result).toMatchObject({ match: null, denied_reason: 'no_company_email' });
      expect(proxyRequest).not.toHaveBeenCalled();
    });

    it('prefers the first verified email that qualifies (primary first)', async () => {
      stubUpstream({
        memberships: [ACME_ACTIVE, { b2b_org_uid: ORG_B, company_domain: 'beta-coastal.example', company_name: 'Beta Coastal', status: 'Active' }],
      });

      const result = await service.resolveEligibility(req, M2M, ['jane@beta-coastal.example', 'jane@acme-motors.example']);

      expect(result.match?.b2b_org_uid).toBe(ORG_B);
    });

    it('matches a b2b_org domain alias when the company holds an active TLF membership', async () => {
      stubUpstream({ memberships: [ACME_ACTIVE], b2bOrgs: [{ uid: ORG_A, primary_domain: 'acme-motors.example', domain_aliases: ['acme-labs.example'] }] });

      const result = await service.resolveEligibility(req, M2M, ['jane@acme-labs.example']);

      expect(result.match).toEqual({ email: 'jane@acme-labs.example', b2b_org_uid: ORG_A, company_name: 'Acme Motors' });
    });

    it('rejects a b2b_org alias hit for a company without an active TLF membership', async () => {
      stubUpstream({ memberships: [ACME_ACTIVE], b2bOrgs: [{ uid: ORG_B, primary_domain: 'beta-coastal.example', domain_aliases: ['beta-labs.example'] }] });

      await expect(service.resolveEligibility(req, M2M, ['jane@beta-labs.example'])).resolves.toMatchObject({ match: null });
    });

    it('re-checks b2b_org records and ignores rows that do not carry the exact domain', async () => {
      stubUpstream({ memberships: [ACME_ACTIVE], b2bOrgs: [{ uid: ORG_A, primary_domain: 'acme-motors.example', domain_aliases: ['other.example'] }] });

      await expect(service.resolveEligibility(req, M2M, ['jane@acme-labs.example'])).resolves.toMatchObject({ match: null });
    });

    it('falls back to membership domains when the b2b_org read fails', async () => {
      stubUpstream({ memberships: [ACME_ACTIVE], b2bOrgs: new MicroserviceError('forbidden', 403, 'FORBIDDEN') });

      const result = await service.resolveEligibility(req, M2M, ['jane@acme-motors.example']);

      expect(result.match?.b2b_org_uid).toBe(ORG_A);
    });

    it('never treats a partially paged b2b_org result as complete', async () => {
      proxyRequest.mockImplementation(async (_req: Request, _svc: string, _path: string, _method: string, query: Record<string, unknown>) => {
        if (query['type'] === 'project_membership') {
          return { resources: [{ type: 'project_membership', id: ORG_A, data: { project_slug: 'tlf', ...ACME_ACTIVE } }] };
        }
        if (query['type'] === 'b2b_org' && !query['page_token']) {
          return { resources: [{ type: 'b2b_org', id: `b2b_org:${ORG_A}`, data: { domain_aliases: ['acme-labs.example'] } }], page_token: 'next' };
        }
        throw new MicroserviceError('page 2 failed', 502, 'BAD_GATEWAY');
      });

      await expect(service.resolveEligibility(req, M2M, ['jane@acme-labs.example'])).resolves.toMatchObject({ match: null });
    });

    it('sends lowercased candidate domains to the b2b_org query with the M2M token', async () => {
      stubUpstream({ memberships: [ACME_ACTIVE] });

      await service.resolveEligibility(req, M2M, ['jane@eng.acme-motors.example']);

      const b2bCall = proxyRequest.mock.calls.find((call) => call[4]?.type === 'b2b_org');
      expect(b2bCall?.[4]).toMatchObject({
        tags_all: ['is_member:true'],
        filters_or: [
          'primary_domain:eng.acme-motors.example',
          'domain_aliases:eng.acme-motors.example',
          'primary_domain:acme-motors.example',
          'domain_aliases:acme-motors.example',
        ],
      });
      expect(b2bCall?.[7]).toEqual({ bearerToken: M2M });
    });

    it('caps the candidate domains sent upstream', async () => {
      stubUpstream({ memberships: [ACME_ACTIVE] });
      const emails = Array.from({ length: 30 }, (_, i) => `jane@team${i}.vendor-corp.example`);

      await service.resolveEligibility(req, M2M, emails);

      const b2bCall = proxyRequest.mock.calls.find((call) => call[4]?.type === 'b2b_org');
      expect((b2bCall?.[4].filters_or as string[]).length).toBe(2 * 20);
    });

    it('requests both casings of every active status', async () => {
      stubUpstream({ memberships: [ACME_ACTIVE] });

      await service.resolveEligibility(req, M2M, ['jane@acme-motors.example']);

      const membershipCall = proxyRequest.mock.calls.find((call) => call[4]?.type === 'project_membership');
      expect(membershipCall?.[4].filters_or).toEqual(['status:Active', 'status:active', 'status:Purchased', 'status:purchased']);
    });
  });

  describe('TLF membership index cache', () => {
    it('loads once and serves later checks from the cache', async () => {
      stubUpstream({ memberships: [ACME_ACTIVE] });

      await service.resolveEligibility(req, M2M, ['jane@acme-motors.example']);
      await service.resolveEligibility(req, M2M, ['john@acme-motors.example']);

      expect(proxyRequest.mock.calls.filter((call) => call[4]?.type === 'project_membership')).toHaveLength(1);
    });

    it('shares one in-flight load between concurrent checks', async () => {
      let release: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => (release = resolve));
      stubUpstream({
        memberships: async () => {
          await gate;
          return { resources: [{ type: 'project_membership', id: ORG_A, data: { project_slug: 'tlf', ...ACME_ACTIVE } }] };
        },
      });

      const first = service.resolveEligibility(req, M2M, ['jane@acme-motors.example']);
      const second = service.resolveEligibility(req, M2M, ['john@acme-motors.example']);
      await Promise.resolve();
      release!();

      await expect(Promise.all([first, second])).resolves.toHaveLength(2);
      expect(proxyRequest.mock.calls.filter((call) => call[4]?.type === 'project_membership')).toHaveLength(1);
    });

    it('fails closed (503) on an empty index and never caches the failure', async () => {
      stubUpstream({ memberships: [] });

      await expect(service.resolveEligibility(req, M2M, ['jane@acme-motors.example'])).rejects.toMatchObject({ statusCode: 503 });

      stubUpstream({ memberships: [ACME_ACTIVE] });
      await expect(service.resolveEligibility(req, M2M, ['jane@acme-motors.example'])).resolves.toMatchObject({ match: { b2b_org_uid: ORG_A } });
    });

    it('delivers a load failure to every concurrent waiter', async () => {
      stubUpstream({ memberships: () => Promise.reject(new MicroserviceError('boom', 502, 'BAD_GATEWAY')) });

      const results = await Promise.allSettled([
        service.resolveEligibility(req, M2M, ['jane@acme-motors.example']),
        service.resolveEligibility(req, M2M, ['john@acme-motors.example']),
      ]);

      expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected']);
    });
  });

  describe('isGroupMember', () => {
    it('finds a member by username', async () => {
      stubUpstream({ committeeMembers: (query) => (query['tags_all'] as string[] | undefined)?.includes('username:jdoe') === true });

      await expect(service.isGroupMember(req, M2M, ['c-1'], [])).resolves.toBe(true);
    });

    it('finds a member added by email only', async () => {
      getEffectiveUsername.mockReturnValue(null);
      stubUpstream({ committeeMembers: (query) => (query['filters_or'] as string[] | undefined)?.includes('email:jane@acme-motors.example') === true });

      await expect(service.isGroupMember(req, M2M, ['c-1'], ['jane@acme-motors.example'])).resolves.toBe(true);
    });

    it('drops emails that are unsafe to put in a query filter', async () => {
      getEffectiveUsername.mockReturnValue(null);
      stubUpstream({ committeeMembers: () => true });

      await expect(service.isGroupMember(req, M2M, ['c-1'], ['a:b@acme-motors.example', 'x,y@acme-motors.example', 'Upper@ACME.example'])).resolves.toBe(false);
      expect(proxyRequest).not.toHaveBeenCalled();
    });

    it('returns false without upstream calls when the issue has no committees', async () => {
      await expect(service.isGroupMember(req, M2M, [], ['jane@acme-motors.example'])).resolves.toBe(false);
      expect(proxyRequest).not.toHaveBeenCalled();
    });
  });

  describe('findMemberCompanyForEmail (invitee check)', () => {
    it('returns the TLF member company for an address on a member domain or its subdomain', async () => {
      stubUpstream({ memberships: [ACME_ACTIVE] });

      expect(await service.findMemberCompanyForEmail(req, M2M, 'pat@acme-motors.example')).toEqual({ b2b_org_uid: ORG_A, company_name: 'Acme Motors' });
      expect(await service.findMemberCompanyForEmail(req, M2M, 'pat@eng.acme-motors.example')).toEqual({ b2b_org_uid: ORG_A, company_name: 'Acme Motors' });
    });

    it('returns null for a non-member domain and never looks up a personal mailbox', async () => {
      stubUpstream({ memberships: [ACME_ACTIVE, { ...ACME_ACTIVE, company_domain: 'gmail.example' }] });

      expect(await service.findMemberCompanyForEmail(req, M2M, 'pat@other-corp.example')).toBeNull();
      proxyRequest.mockClear();
      expect(await service.findMemberCompanyForEmail(req, M2M, 'pat@gmail.example')).toBeNull();
      expect(proxyRequest).not.toHaveBeenCalled();
    });

    it("checks a named foundation's own members, separately from TLF's", async () => {
      const BETA_AAIF: Membership = {
        b2b_org_uid: ORG_B,
        company_domain: 'beta-labs.example',
        company_name: 'Beta Labs',
        status: 'Active',
        project_slug: 'aaif',
      };
      stubUpstream({ memberships: [ACME_ACTIVE, BETA_AAIF] });

      // Acme is a TLF member but not an AAIF member; Beta is the reverse.
      expect(await service.findMemberCompanyForEmail(req, M2M, 'pat@acme-motors.example', 'aaif')).toBeNull();
      expect(await service.findMemberCompanyForEmail(req, M2M, 'kim@beta-labs.example', 'aaif')).toEqual({ b2b_org_uid: ORG_B, company_name: 'Beta Labs' });
      expect(await service.findMemberCompanyForEmail(req, M2M, 'pat@acme-motors.example')).toEqual({ b2b_org_uid: ORG_A, company_name: 'Acme Motors' });
      expect(await service.findMemberCompanyForEmail(req, M2M, 'kim@beta-labs.example')).toBeNull();

      const membershipQueries = proxyRequest.mock.calls.filter((call) => call[4]['type'] === 'project_membership').map((call) => call[4]['filters_all']);
      // One cached load per roster.
      expect(membershipQueries).toEqual(['project_slug:aaif', 'project_slug:tlf']);
    });

    it("treats an empty foundation roster as an outage (503), never as 'not a member', and does not cache it", async () => {
      stubUpstream({ memberships: [ACME_ACTIVE] });

      await expect(service.findMemberCompanyForEmail(req, M2M, 'pat@acme-motors.example', 'renamed-foundation')).rejects.toMatchObject({
        statusCode: 503,
        code: 'MEMBER_BENEFIT_INDEX_UNAVAILABLE',
      });
      stubUpstream({ memberships: [{ ...ACME_ACTIVE, project_slug: 'renamed-foundation' }] });
      await expect(service.findMemberCompanyForEmail(req, M2M, 'pat@acme-motors.example', 'renamed-foundation')).resolves.toEqual({
        b2b_org_uid: ORG_A,
        company_name: 'Acme Motors',
      });
    });
  });

  describe('isEmailInGroup (invite roster check)', () => {
    it('checks one address against one group with the M2M token', async () => {
      stubUpstream({ committeeMembers: (query) => (query['filters_or'] as string[])[0] === 'email:pat@acme-motors.example' });

      expect(await service.isEmailInGroup(req, M2M, 'news-1', 'pat@acme-motors.example')).toBe(true);
      expect(await service.isEmailInGroup(req, M2M, 'news-1', 'sam@acme-motors.example')).toBe(false);
      expect(proxyRequest.mock.calls[0][3]).toBe('GET');
      expect(proxyRequest.mock.calls[0][4]).toMatchObject({ type: 'committee_member', tags: ['committee_uid:news-1'] });
      expect(proxyRequest.mock.calls[0][7]).toEqual({ bearerToken: M2M });
    });

    it('answers false without an upstream call for a value unsafe to filter on', async () => {
      expect(await service.isEmailInGroup(req, M2M, 'news-1', 'a,b@acme-motors.example')).toBe(false);
      expect(proxyRequest).not.toHaveBeenCalled();
    });
  });

  describe('resolveNewsletterGroup', () => {
    it('picks the first Newsletter-category committee in the issue order and never another category', async () => {
      stubUpstream({ committees: { 'board-1': { name: 'Governing Board', category: 'Board' }, ...NEWSLETTER_GROUP } });

      await expect(service.resolveNewsletterGroup(req, M2M, makeNewsletter({ committee_uids: ['board-1', 'news-1'] }))).resolves.toEqual({
        uid: 'news-1',
        name: 'LF Weekly',
      });
    });

    it('returns null when the audience has no newsletter group', async () => {
      stubUpstream({ committees: { 'board-1': { name: 'Governing Board', category: 'Board' } } });

      await expect(service.resolveNewsletterGroup(req, M2M, makeNewsletter({ committee_uids: ['board-1'] }))).resolves.toBeNull();
    });
  });
});

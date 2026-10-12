// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Newsletter } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { proxyRequest, resolveVerifiedUserEmails, getEffectiveUsername } = vi.hoisted(() => ({
  proxyRequest: vi.fn(),
  resolveVerifiedUserEmails: vi.fn(),
  getEffectiveUsername: vi.fn(),
}));

vi.mock('./microservice-proxy.service', () => ({
  MicroserviceProxyService: class {
    public proxyRequest = proxyRequest;
  },
}));
vi.mock('./email-verification.service', () => ({ EmailVerificationService: class {} }));
vi.mock('../helpers/user-emails.helper', () => ({ resolveVerifiedUserEmails }));
vi.mock('../utils/auth-helper', () => ({ getEffectiveUsername }));
vi.mock('./logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import type { Request } from 'express';

import { MicroserviceError } from '../errors';
import { NewsletterMemberBenefitService } from './newsletter-member-benefit.service';

const req = {} as unknown as Request;
const M2M = 'm2m-token';

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

/** Routes proxyRequest by query-service `type` / path so each test declares only the data it needs. */
function stubUpstream(options: {
  memberships?: Membership[];
  b2bOrgs?: B2bOrg[] | Error;
  committeeMembers?: (query: Record<string, unknown>) => boolean;
  committees?: Record<string, { name: string; category: string }>;
  memberCreate?: () => Promise<unknown>;
}): void {
  proxyRequest.mockImplementation(async (_req: Request, _svc: string, path: string, method: string, query: Record<string, unknown>) => {
    if (path === '/query/resources') {
      if (query['type'] === 'project_membership') {
        return {
          resources: (options.memberships ?? []).map((data) => ({ type: 'project_membership', id: data.b2b_org_uid, data: { project_slug: 'tlf', ...data } })),
        };
      }
      if (query['type'] === 'b2b_org') {
        if (options.b2bOrgs instanceof Error) throw options.b2bOrgs;
        return { resources: (options.b2bOrgs ?? []).map((data) => ({ type: 'b2b_org', id: data.uid, data })) };
      }
      if (query['type'] === 'committee_member') {
        return { resources: options.committeeMembers?.(query) ? [{ type: 'committee_member', id: 'm-1', data: {} }] : [] };
      }
      if (query['type'] === 'committee') {
        // Return in reverse to prove the service picks by the issue's order, not the index's.
        const uids = (query['tags'] as string[]).map((tag) => tag.replace('committee_uid:', '')).reverse();
        return {
          resources: uids
            .filter((uid) => options.committees?.[uid])
            .map((uid) => ({ type: 'committee', id: uid, data: { uid, ...options.committees?.[uid] } })),
        };
      }
    }
    if (method === 'POST' && path.endsWith('/members')) {
      return options.memberCreate ? options.memberCreate() : { uid: 'new-member' };
    }
    throw new Error(`unexpected upstream call ${method} ${path}`);
  });
}

function makeNewsletter(committeeUids: string[]): Newsletter {
  return {
    id: 'n-1',
    project_uid: 'p-1',
    subject: 'Weekly',
    body_html: '<p>hi</p>',
    ed_reply_email: 'ed@example.org',
    committee_uids: committeeUids,
    status: 'sent',
    total_recipients: 1,
    created_by: 'someone',
    version: 1,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
  };
}

describe('NewsletterMemberBenefitService', () => {
  let service: NewsletterMemberBenefitService;

  beforeEach(() => {
    NewsletterMemberBenefitService.resetDomainIndexCache();
    proxyRequest.mockReset();
    resolveVerifiedUserEmails.mockReset();
    getEffectiveUsername.mockReset().mockReturnValue('jdoe');
    service = new NewsletterMemberBenefitService();
  });

  describe('resolveEligibility', () => {
    it('matches a verified work email against an active TLF membership domain', async () => {
      stubUpstream({ memberships: [{ b2b_org_uid: ORG_A, company_domain: 'Acme-Motors.example', company_name: 'Acme Motors', status: 'Active' }] });

      const result = await service.resolveEligibility(req, M2M, ['jane@acme-motors.example']);

      expect(result.match).toEqual({ email: 'jane@acme-motors.example', b2b_org_uid: ORG_A, company_name: 'Acme Motors' });
      expect(result.denied_reason).toBeUndefined();
    });

    it('matches a subdomain address through its parent domain', async () => {
      stubUpstream({ memberships: [{ b2b_org_uid: ORG_A, company_domain: 'acme-motors.example', company_name: 'Acme Motors', status: 'Purchased' }] });

      const result = await service.resolveEligibility(req, M2M, ['jane@eng.acme-motors.example']);

      expect(result.match?.b2b_org_uid).toBe(ORG_A);
    });

    it('ignores expired and cancelled memberships', async () => {
      stubUpstream({
        memberships: [
          { b2b_org_uid: ORG_A, company_domain: 'acme-motors.example', status: 'Expired' },
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

      expect(result.match).toBeNull();
      expect(result.denied_reason).toBe('no_company_email');
      expect(proxyRequest).not.toHaveBeenCalled();
    });

    it('prefers the first verified email that qualifies (primary first)', async () => {
      stubUpstream({
        memberships: [
          { b2b_org_uid: ORG_A, company_domain: 'acme-motors.example', company_name: 'Acme Motors', status: 'Active' },
          { b2b_org_uid: ORG_B, company_domain: 'beta-coastal.example', company_name: 'Beta Coastal', status: 'Active' },
        ],
      });

      const result = await service.resolveEligibility(req, M2M, ['jane@beta-coastal.example', 'jane@acme-motors.example']);

      expect(result.match?.b2b_org_uid).toBe(ORG_B);
    });

    it('matches a b2b_org domain alias when the company holds an active TLF membership', async () => {
      stubUpstream({
        memberships: [{ b2b_org_uid: ORG_A, company_domain: 'acme-motors.example', company_name: 'Acme Motors', status: 'Active' }],
        b2bOrgs: [{ uid: ORG_A, primary_domain: 'acme-motors.example', domain_aliases: ['acme-labs.example'] }],
      });

      const result = await service.resolveEligibility(req, M2M, ['jane@acme-labs.example']);

      expect(result.match).toEqual({ email: 'jane@acme-labs.example', b2b_org_uid: ORG_A, company_name: 'Acme Motors' });
    });

    it('rejects a b2b_org alias hit for a company without an active TLF membership', async () => {
      stubUpstream({
        memberships: [{ b2b_org_uid: ORG_A, company_domain: 'acme-motors.example', status: 'Active' }],
        b2bOrgs: [{ uid: ORG_B, primary_domain: 'beta-coastal.example', domain_aliases: ['beta-labs.example'] }],
      });

      const result = await service.resolveEligibility(req, M2M, ['jane@beta-labs.example']);

      expect(result.match).toBeNull();
    });

    it('re-checks b2b_org records and ignores rows that do not carry the exact domain', async () => {
      stubUpstream({
        memberships: [{ b2b_org_uid: ORG_A, company_domain: 'acme-motors.example', status: 'Active' }],
        b2bOrgs: [{ uid: ORG_A, primary_domain: 'acme-motors.example', domain_aliases: ['other.example'] }],
      });

      const result = await service.resolveEligibility(req, M2M, ['jane@acme-labs.example']);

      expect(result.match).toBeNull();
    });

    it('falls back to membership domains when the b2b_org read fails', async () => {
      stubUpstream({
        memberships: [{ b2b_org_uid: ORG_A, company_domain: 'acme-motors.example', company_name: 'Acme Motors', status: 'Active' }],
        b2bOrgs: new MicroserviceError('forbidden', 403, 'FORBIDDEN'),
      });

      const result = await service.resolveEligibility(req, M2M, ['jane@acme-motors.example']);

      expect(result.match?.b2b_org_uid).toBe(ORG_A);
    });

    it('sends lowercased candidate domains to the b2b_org query with the M2M token', async () => {
      stubUpstream({ memberships: [{ b2b_org_uid: ORG_A, company_domain: 'acme-motors.example', status: 'Active' }] });

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

    it('fails closed (throws) instead of denying when no active TLF membership is readable', async () => {
      stubUpstream({ memberships: [] });

      await expect(service.resolveEligibility(req, M2M, ['jane@acme-motors.example'])).rejects.toMatchObject({ statusCode: 503 });
    });

    it('caches the membership index across calls', async () => {
      stubUpstream({ memberships: [{ b2b_org_uid: ORG_A, company_domain: 'acme-motors.example', status: 'Active' }] });

      await service.resolveEligibility(req, M2M, ['jane@acme-motors.example']);
      await service.resolveEligibility(req, M2M, ['john@acme-motors.example']);

      const membershipReads = proxyRequest.mock.calls.filter((call) => call[4]?.type === 'project_membership');
      expect(membershipReads).toHaveLength(1);
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

    it('returns false without upstream calls when the issue has no committees', async () => {
      await expect(service.isGroupMember(req, M2M, [], ['jane@acme-motors.example'])).resolves.toBe(false);
      expect(proxyRequest).not.toHaveBeenCalled();
    });
  });

  describe('resolveNewsletterGroup', () => {
    it('picks the first Newsletter-category committee and never another category', async () => {
      stubUpstream({
        committees: {
          'board-1': { name: 'Governing Board', category: 'Board' },
          'news-1': { name: 'LF Weekly', category: 'Newsletter' },
        },
      });

      await expect(service.resolveNewsletterGroup(req, M2M, makeNewsletter(['board-1', 'news-1']))).resolves.toEqual({ uid: 'news-1', name: 'LF Weekly' });
    });

    it('returns null when the audience has no newsletter group', async () => {
      stubUpstream({ committees: { 'board-1': { name: 'Governing Board', category: 'Board' } } });

      await expect(service.resolveNewsletterGroup(req, M2M, makeNewsletter(['board-1']))).resolves.toBeNull();
    });
  });

  describe('addToNewsletterGroup', () => {
    const match = { email: 'jane@acme-motors.example', b2b_org_uid: ORG_A, company_name: 'Acme Motors' };
    const group = { uid: 'news-1', name: 'LF Weekly' };

    it('adds the work email with the member company and suppresses the invite email', async () => {
      stubUpstream({});

      await expect(service.addToNewsletterGroup(req, M2M, group, match)).resolves.toBe('added');

      const createCall = proxyRequest.mock.calls.find((call) => call[3] === 'POST');
      expect(createCall?.[2]).toBe('/committees/news-1/members');
      expect(createCall?.[5]).toEqual({ email: 'jane@acme-motors.example', organization: { id: ORG_A, name: 'Acme Motors' } });
      expect(createCall?.[6]).toEqual({ 'X-Skip-Notification': 'true' });
      expect(createCall?.[7]).toEqual({ bearerToken: M2M });
    });

    it('treats a 409 as already a member', async () => {
      stubUpstream({ memberCreate: () => Promise.reject(new MicroserviceError('exists', 409, 'CONFLICT')) });

      await expect(service.addToNewsletterGroup(req, M2M, group, match)).resolves.toBe('already_member');
    });

    it('propagates other failures', async () => {
      stubUpstream({ memberCreate: () => Promise.reject(new MicroserviceError('boom', 502, 'BAD_GATEWAY')) });

      await expect(service.addToNewsletterGroup(req, M2M, group, match)).rejects.toMatchObject({ statusCode: 502 });
    });
  });
});

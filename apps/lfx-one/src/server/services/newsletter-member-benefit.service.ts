// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  MEMBER_BENEFIT_ACTIVE_MEMBERSHIP_STATUSES,
  MEMBER_BENEFIT_ACTIVE_STATUS_FILTERS,
  MEMBER_BENEFIT_B2B_ORG_MAX_RESULTS,
  MEMBER_BENEFIT_DOMAIN_INDEX_TTL_MS,
  MEMBER_BENEFIT_FILTER_SAFE_EMAIL,
  MEMBER_BENEFIT_FOUNDATION_SLUG,
  MEMBER_BENEFIT_MAX_CANDIDATE_DOMAINS,
  NEWSLETTER_COMMITTEE_CATEGORY,
  NEWSLETTER_MEMBER_BENEFIT_NOT_ELIGIBLE_ERROR_CODE,
  NEWSLETTER_NOT_SENT_ERROR_CODE,
} from '@lfx-one/shared/constants';
import {
  B2bOrgIndexedDoc,
  Committee,
  MemberBenefitCompany,
  MemberBenefitDomainIndex,
  Newsletter,
  NewsletterJoinResult,
  NewsletterMemberBenefitEligibility,
  NewsletterMemberBenefitGroup,
  NewsletterMemberBenefitMatch,
  NewsletterReaderEvaluation,
  ProjectMembershipDoc,
  QueryServiceResponse,
} from '@lfx-one/shared/interfaces';
import {
  candidateMemberDomains,
  emailDomain,
  isFilterSafeIdentifier,
  isFilterSafeUsername,
  isPersonalEmailDomain,
  normalizeDomain,
} from '@lfx-one/shared/utils';
import { Request } from 'express';

import { AuthorizationError, isBaseApiError, MicroserviceError, ResourceNotFoundError } from '../errors';
import { fetchAllQueryResources } from '../helpers/query-service.helper';
import { resolveVerifiedUserEmails } from '../helpers/user-emails.helper';
import { getEffectiveUsername } from '../utils/auth-helper';
import { generateM2MToken } from '../utils/m2m-token.util';
import { AccessCheckService } from './access-check.service';
import { CommitteeService } from './committee.service';
import { EmailVerificationService } from './email-verification.service';
import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';
import { NewsletterService } from './newsletter.service';

/**
 * Newsletter permalink reader access and the Linux Foundation member benefit (#3469): an employee
 * of a TLF member company may read a newsletter permalink and is added to the newsletter's group.
 *
 * Reader access ladder ({@link evaluateReaderAccess}), evaluated on every call:
 * 1. project `writer_guard` → `manager` (drafts included)
 * 2. any other caller only ever sees SENT issues (unsent → 404 `NEWSLETTER_NOT_SENT`)
 * 3. project `auditor_guard` (incl. LF staff) → `auditor`
 * 4. already in one of the issue's audience committees → `group_member`
 * 5. verified email at an active TLF member company, and the issue has a Newsletter-category
 *    group → `eligible`
 * 6. otherwise → `denied`
 *
 * The ladder gates every BFF read of a single issue — the reader endpoint and the project-scoped
 * GET ({@link getReadableNewsletter}) — and the benefit join. Upstream newsletter-service still
 * authorizes `GET /projects/{uid}/newsletters/{id}` on `project#viewer` alone.
 *
 * Facts the signed-in user cannot read with their own token — TLF memberships, member-company
 * domains, group rosters — and the single group add use the app's M2M token, scoped per call
 * through `ApiRequestOptions.bearerToken`, only after the issue was read with the user's token.
 * Identity always comes from the user's session (auth-service verified emails), never the client.
 *
 * Domain sources, unioned:
 * 1. `project_membership.company_domain` of active TLF memberships (one domain per membership).
 * 2. `b2b_org.primary_domain` / `domain_aliases` of member companies — the full domain set, but
 *    `b2b_org` is gated on `auditor` and is fail-soft: when the M2M client cannot read it the check
 *    degrades to source 1 instead of denying. A b2b_org hit still needs an active TLF membership.
 */
export class NewsletterMemberBenefitService {
  private static domainIndexCache: { value: MemberBenefitDomainIndex; expiresAt: number } | null = null;
  private static domainIndexInFlight: Promise<MemberBenefitDomainIndex> | null = null;

  private readonly microserviceProxy: MicroserviceProxyService;
  private readonly emailVerificationService: EmailVerificationService;
  private readonly newsletterService: NewsletterService;
  private readonly accessCheckService: AccessCheckService;
  private readonly committeeService: CommitteeService;

  public constructor(
    microserviceProxy?: MicroserviceProxyService,
    emailVerificationService?: EmailVerificationService,
    newsletterService?: NewsletterService,
    accessCheckService?: AccessCheckService,
    committeeService?: CommitteeService
  ) {
    this.microserviceProxy = microserviceProxy ?? new MicroserviceProxyService();
    this.emailVerificationService = emailVerificationService ?? new EmailVerificationService();
    this.newsletterService = newsletterService ?? new NewsletterService();
    this.accessCheckService = accessCheckService ?? new AccessCheckService();
    this.committeeService = committeeService ?? new CommitteeService();
  }

  /** Test seam: forget the cached TLF domain index. */
  public static resetDomainIndexCache(): void {
    NewsletterMemberBenefitService.domainIndexCache = null;
    NewsletterMemberBenefitService.domainIndexInFlight = null;
  }

  /** The reader access ladder for one issue (see the class doc). Throws on any lookup outage rather than denying. */
  public async evaluateReaderAccess(req: Request, projectUid: string, newsletterUid: string): Promise<NewsletterReaderEvaluation> {
    const [newsletter, access] = await Promise.all([
      this.newsletterService.getNewsletter(req, projectUid, newsletterUid),
      this.accessCheckService.checkAccessStrict(req, [
        { resource: 'project', id: projectUid, access: 'writer_guard' },
        { resource: 'project', id: projectUid, access: 'auditor_guard' },
      ]),
    ]);

    if (access.get(`${projectUid}#writer_guard`)) return { level: 'manager', newsletter };

    if (newsletter.status !== 'sent') {
      throw new ResourceNotFoundError('Newsletter', newsletterUid, {
        operation: 'evaluate_newsletter_reader_access',
        service: 'newsletter_member_benefit',
        code: NEWSLETTER_NOT_SENT_ERROR_CODE,
      });
    }

    if (access.get(`${projectUid}#auditor_guard`)) return { level: 'auditor', newsletter };

    const m2mToken = await generateM2MToken(req);
    const verifiedEmails = await resolveVerifiedUserEmails(req, this.emailVerificationService, { strict: true });

    if (await this.isGroupMember(req, m2mToken, newsletter.committee_uids ?? [], verifiedEmails)) {
      return { level: 'group_member', newsletter };
    }

    const eligibility = await this.resolveEligibility(req, m2mToken, verifiedEmails);
    if (!eligibility.match) {
      return { level: 'denied', newsletter, reason: eligibility.denied_reason ?? 'not_member_company' };
    }

    const group = await this.resolveNewsletterGroup(req, m2mToken, newsletter);
    if (!group) {
      return { level: 'denied', newsletter, reason: 'no_newsletter_group' };
    }

    return { level: 'eligible', newsletter, match: eligibility.match, group };
  }

  /**
   * The issue for the project-scoped single GET (`/api/projects/:projectUid/newsletters/:id`),
   * behind the same ladder as the reader so that route cannot bypass it: managers get drafts,
   * other callers get sent issues only when not `denied` (403 `NEWSLETTER_MEMBERS_ONLY`).
   */
  public async getReadableNewsletter(req: Request, projectUid: string, newsletterUid: string): Promise<Newsletter> {
    const evaluation = await this.evaluateReaderAccess(req, projectUid, newsletterUid);
    if (evaluation.level === 'denied') {
      throw new AuthorizationError('This newsletter is available to its group and to Linux Foundation member companies', {
        operation: 'get_readable_newsletter',
        service: 'newsletter_member_benefit',
        code: 'NEWSLETTER_MEMBERS_ONLY',
      });
    }
    return evaluation.newsletter;
  }

  /**
   * Guard for the publisher collection (`GET /api/projects/:projectUid/newsletters`), whose rows
   * carry `body_html` and drafts: only project `writer_guard` or `auditor_guard` holders (writers,
   * auditors, EDs, LF staff — everyone the publisher UI admits) may list. Members and member
   * employees read single issues through the ladder instead, so the list cannot bypass it.
   */
  public async assertPublisherRead(req: Request, projectUid: string): Promise<void> {
    const access = await this.accessCheckService.checkAccessStrict(req, [
      { resource: 'project', id: projectUid, access: 'writer_guard' },
      { resource: 'project', id: projectUid, access: 'auditor_guard' },
    ]);
    if (!access.get(`${projectUid}#writer_guard`) && !access.get(`${projectUid}#auditor_guard`)) {
      throw new AuthorizationError('Only project managers and auditors can list newsletters', {
        operation: 'assert_publisher_read',
        service: 'newsletter_member_benefit',
        code: 'NEWSLETTER_LIST_FORBIDDEN',
      });
    }
  }

  /**
   * The member benefit: re-runs the whole ladder, then adds the caller's qualifying work email to
   * the issue's newsletter group. A caller already in the group gets `already_member` (a second tab,
   * or a retry after the add was indexed). Managers, auditors and denied callers are refused.
   */
  public async joinNewsletterGroup(req: Request, projectUid: string, newsletterUid: string): Promise<NewsletterJoinResult> {
    const evaluation = await this.evaluateReaderAccess(req, projectUid, newsletterUid);

    if (evaluation.level === 'group_member') {
      return { status: 'already_member', email: '', committee_name: '', company_name: '' };
    }

    if (evaluation.level !== 'eligible') {
      throw new AuthorizationError('Not eligible to join this newsletter', {
        operation: 'join_newsletter_group',
        service: 'newsletter_member_benefit',
        code: NEWSLETTER_MEMBER_BENEFIT_NOT_ELIGIBLE_ERROR_CODE,
      });
    }

    const status = await this.addToNewsletterGroup(req, await generateM2MToken(req), evaluation.group, evaluation.match);
    logger.info(req, 'newsletter_member_benefit_join', 'Member benefit join completed', {
      committee_uid: evaluation.group.uid,
      b2b_org_uid: evaluation.match.b2b_org_uid,
      status,
    });
    return { status, email: evaluation.match.email, committee_name: evaluation.group.name, company_name: evaluation.match.company_name };
  }

  /**
   * Whether the signed-in user qualifies through a verified email at an active TLF member company.
   * Emails are tried in auth-service order (primary first); within an email the most specific
   * domain wins. Throws when the membership index cannot be loaded — an outage must never read as
   * "not a member".
   */
  public async resolveEligibility(req: Request, m2mToken: string, verifiedEmails: string[]): Promise<NewsletterMemberBenefitEligibility> {
    const companyEmails: { email: string; candidates: string[] }[] = [];
    for (const email of verifiedEmails) {
      const domain = emailDomain(email);
      if (!domain || isPersonalEmailDomain(domain)) continue;
      const candidates = candidateMemberDomains(domain);
      if (candidates.length > 0) companyEmails.push({ email, candidates });
    }

    if (companyEmails.length === 0) {
      return { verified_emails: verifiedEmails, match: null, denied_reason: 'no_company_email' };
    }

    const allCandidates = [...new Set(companyEmails.flatMap((entry) => entry.candidates))].slice(0, MEMBER_BENEFIT_MAX_CANDIDATE_DOMAINS);
    const [index, b2bMatches] = await Promise.all([this.getDomainIndex(req, m2mToken), this.findB2bOrgMatches(req, m2mToken, allCandidates)]);

    for (const { email, candidates } of companyEmails) {
      for (const candidate of candidates) {
        const company = this.pickCompany(candidate, index, b2bMatches);
        if (company) {
          const match: NewsletterMemberBenefitMatch = { email, b2b_org_uid: company.b2b_org_uid, company_name: company.company_name };
          logger.debug(req, 'newsletter_member_benefit_eligibility', 'Verified email matched an active TLF member company', {
            b2b_org_uid: company.b2b_org_uid,
            matched_domain: candidate,
          });
          return { verified_emails: verifiedEmails, match };
        }
      }
    }

    return { verified_emails: verifiedEmails, match: null, denied_reason: 'not_member_company' };
  }

  /**
   * The active TLF member company an arbitrary email's domain belongs to (the newsletter invite
   * check on the invitee's address), or null for a personal mailbox or a non-member domain. Same
   * index and matching as {@link resolveEligibility}; throws when the index cannot be loaded.
   */
  public async findMemberCompanyForEmail(req: Request, m2mToken: string, email: string): Promise<MemberBenefitCompany | null> {
    const domain = emailDomain(email);
    if (!domain || isPersonalEmailDomain(domain)) return null;
    const candidates = candidateMemberDomains(domain).slice(0, MEMBER_BENEFIT_MAX_CANDIDATE_DOMAINS);
    if (candidates.length === 0) return null;

    const [index, b2bMatches] = await Promise.all([this.getDomainIndex(req, m2mToken), this.findB2bOrgMatches(req, m2mToken, candidates)]);
    for (const candidate of candidates) {
      const company = this.pickCompany(candidate, index, b2bMatches);
      if (company) return company;
    }
    return null;
  }

  /**
   * The first of the newsletter's audience committees that is a Newsletter-category group. Only
   * such a group is ever auto-joined: other audience committees (a board, a TAC) carry real
   * permissions and must never be granted by a domain match. Null when the issue has none.
   */
  public async resolveNewsletterGroup(req: Request, m2mToken: string, newsletter: Newsletter): Promise<NewsletterMemberBenefitGroup | null> {
    const committeeUids = (newsletter.committee_uids ?? []).filter(isFilterSafeIdentifier);
    if (committeeUids.length === 0) return null;

    // One indexed read for the whole audience (`tags` is OR), then pick in the issue's own order.
    const response = await this.microserviceProxy.proxyRequest<QueryServiceResponse<Committee>>(
      req,
      'LFX_V2_SERVICE',
      '/query/resources',
      'GET',
      { type: 'committee', tags: committeeUids.map((uid) => `committee_uid:${uid}`), page_size: committeeUids.length },
      undefined,
      undefined,
      { bearerToken: m2mToken }
    );

    const byUid = new Map((response?.resources ?? []).map((resource) => [resource.data?.uid, resource.data]));
    for (const committeeUid of committeeUids) {
      const committee = byUid.get(committeeUid);
      if (committee?.category === NEWSLETTER_COMMITTEE_CATEGORY) {
        return { uid: committeeUid, name: committee.name };
      }
    }
    return null;
  }

  /**
   * Whether the user is already a member of any of the issue's audience committees — by LFID
   * username, or by one of their verified emails (members added by email may have no username).
   */
  public async isGroupMember(req: Request, m2mToken: string, committeeUids: string[], verifiedEmails: string[]): Promise<boolean> {
    const committeeTags = committeeUids.filter(isFilterSafeIdentifier).map((uid) => `committee_uid:${uid}`);
    if (committeeTags.length === 0) return false;

    const username = getEffectiveUsername(req);
    const emailFilters = verifiedEmails.filter((email) => MEMBER_BENEFIT_FILTER_SAFE_EMAIL.test(email)).map((email) => `email:${email}`);

    const lookups: Promise<boolean>[] = [];
    if (username && isFilterSafeUsername(username)) {
      lookups.push(this.hasCommitteeMemberRow(req, m2mToken, { tags: committeeTags, tags_all: [`username:${username}`] }));
    }
    if (emailFilters.length > 0) {
      lookups.push(this.hasCommitteeMemberRow(req, m2mToken, { tags: committeeTags, filters_or: emailFilters }));
    }

    const results = await Promise.all(lookups);
    return results.some(Boolean);
  }

  /** Whether one email (not the signed-in user) is already on a group's roster — the invite skip check. */
  public async isEmailInGroup(req: Request, m2mToken: string, committeeUid: string, email: string): Promise<boolean> {
    if (!isFilterSafeIdentifier(committeeUid) || !MEMBER_BENEFIT_FILTER_SAFE_EMAIL.test(email)) return false;
    return this.hasCommitteeMemberRow(req, m2mToken, { tags: [`committee_uid:${committeeUid}`], filters_or: [`email:${email}`] });
  }

  /**
   * Adds the qualifying work email to the newsletter group. M2M because newsletter groups are
   * invite-only and member-create requires `committee#writer` (granted to the app's client in
   * #3470); the caller must already have re-verified eligibility in-app. The member gets the
   * matched member company as their organization, and the generic group-invite email is
   * suppressed because the reader page shows its own confirmation. A 409 means already a member.
   */
  public async addToNewsletterGroup(
    req: Request,
    m2mToken: string,
    group: NewsletterMemberBenefitGroup,
    match: NewsletterMemberBenefitMatch
  ): Promise<NewsletterJoinResult['status']> {
    try {
      await this.committeeService.createCommitteeMember(
        req,
        group.uid,
        { email: match.email, organization: { id: match.b2b_org_uid, name: match.company_name || null } },
        true,
        { bearerToken: m2mToken }
      );
      return 'added';
    } catch (error) {
      if (isBaseApiError(error) && error.statusCode === 409) return 'already_member';
      throw error;
    }
  }

  private async hasCommitteeMemberRow(req: Request, m2mToken: string, query: Record<string, unknown>): Promise<boolean> {
    const response = await this.microserviceProxy.proxyRequest<QueryServiceResponse<unknown>>(
      req,
      'LFX_V2_SERVICE',
      '/query/resources',
      'GET',
      { type: 'committee_member', page_size: 1, ...query },
      undefined,
      undefined,
      { bearerToken: m2mToken }
    );
    return (response?.resources?.length ?? 0) > 0;
  }

  /** The bare id of a query-service resource id (`b2b_org:<sfid>` → `<sfid>`); '' when absent. */
  private resourceUid(resourceId: string | undefined | null): string {
    if (!resourceId) return '';
    const colon = resourceId.indexOf(':');
    return colon === -1 ? resourceId : resourceId.substring(colon + 1);
  }

  /** Exact-domain company for a candidate: the TLF membership index first, then b2b_org hits that hold an active TLF membership. */
  private pickCompany(candidate: string, index: MemberBenefitDomainIndex, b2bMatches: Map<string, string[]>): MemberBenefitCompany | null {
    const fromMembership = index.by_domain.get(candidate);
    if (fromMembership && fromMembership.length > 0) return fromMembership[0];

    for (const orgUid of b2bMatches.get(candidate) ?? []) {
      const companyName = index.active_org_uids.get(orgUid);
      if (companyName !== undefined) return { b2b_org_uid: orgUid, company_name: companyName };
    }
    return null;
  }

  /** Cached (per process) index of active TLF memberships; concurrent misses share one load. Failures are never cached. */
  private async getDomainIndex(req: Request, m2mToken: string): Promise<MemberBenefitDomainIndex> {
    const cached = NewsletterMemberBenefitService.domainIndexCache;
    if (cached && Date.now() < cached.expiresAt) return cached.value;

    if (!NewsletterMemberBenefitService.domainIndexInFlight) {
      NewsletterMemberBenefitService.domainIndexInFlight = this.loadDomainIndex(req, m2mToken)
        .then((value) => {
          NewsletterMemberBenefitService.domainIndexCache = { value, expiresAt: Date.now() + MEMBER_BENEFIT_DOMAIN_INDEX_TTL_MS };
          return value;
        })
        .finally(() => {
          NewsletterMemberBenefitService.domainIndexInFlight = null;
        });
    }
    return NewsletterMemberBenefitService.domainIndexInFlight;
  }

  private async loadDomainIndex(req: Request, m2mToken: string): Promise<MemberBenefitDomainIndex> {
    const memberships = await fetchAllQueryResources<ProjectMembershipDoc>(
      req,
      (pageToken) =>
        this.microserviceProxy.proxyRequest<QueryServiceResponse<ProjectMembershipDoc>>(
          req,
          'LFX_V2_SERVICE',
          '/query/resources',
          'GET',
          {
            type: 'project_membership',
            filters_all: `project_slug:${MEMBER_BENEFIT_FOUNDATION_SLUG}`,
            filters_or: MEMBER_BENEFIT_ACTIVE_STATUS_FILTERS,
            page_size: 1000,
            ...(pageToken && { page_token: pageToken }),
          },
          undefined,
          undefined,
          { bearerToken: m2mToken }
        ),
      { failOnPartial: true }
    );

    const byDomain = new Map<string, MemberBenefitCompany[]>();
    const activeOrgUids = new Map<string, string>();
    for (const membership of memberships) {
      if (membership.project_slug !== MEMBER_BENEFIT_FOUNDATION_SLUG) continue;
      if (!MEMBER_BENEFIT_ACTIVE_MEMBERSHIP_STATUSES.has((membership.status ?? '').toLowerCase())) continue;
      const orgUid = membership.b2b_org_uid;
      if (!orgUid) continue;

      const companyName = membership.company_name?.trim() || activeOrgUids.get(orgUid) || '';
      activeOrgUids.set(orgUid, companyName);

      const domain = normalizeDomain(membership.company_domain);
      if (!domain) continue;
      const companies = byDomain.get(domain) ?? [];
      if (!companies.some((company) => company.b2b_org_uid === orgUid)) {
        companies.push({ b2b_org_uid: orgUid, company_name: companyName });
        byDomain.set(domain, companies);
      }
    }

    // TLF always has active members; an empty index means the read was filtered or broken, and
    // caching it would silently deny every member for the TTL.
    if (activeOrgUids.size === 0) {
      logger.warning(req, 'newsletter_member_benefit_domain_index', 'TLF membership read returned no active members', { membership_rows: memberships.length });
      throw new MicroserviceError('Linux Foundation membership data is unavailable', 503, 'MEMBER_BENEFIT_INDEX_UNAVAILABLE', {
        operation: 'newsletter_member_benefit_domain_index',
        service: 'query_service',
      });
    }

    logger.info(req, 'newsletter_member_benefit_domain_index', 'Loaded TLF member domain index', {
      foundation_slug: MEMBER_BENEFIT_FOUNDATION_SLUG,
      membership_rows: memberships.length,
      active_orgs: activeOrgUids.size,
      domains: byDomain.size,
    });
    return { by_domain: byDomain, active_org_uids: activeOrgUids };
  }

  /**
   * Member companies whose `primary_domain` or `domain_aliases` exactly equal a candidate domain,
   * keyed by that domain. Query-service matching is exact and case-sensitive, so candidates are
   * lowercased and every returned record is re-checked. All-or-nothing: a failed later page
   * discards the earlier ones rather than passing a partial set off as every alias hit. Fail-soft:
   * any failure (including the M2M client lacking `b2b_org` read access, which shows as an empty
   * result) yields no matches.
   */
  private async findB2bOrgMatches(req: Request, m2mToken: string, domains: string[]): Promise<Map<string, string[]>> {
    const matches = new Map<string, string[]>();
    if (domains.length === 0) return matches;

    const filtersOr = domains.flatMap((domain) => [`primary_domain:${domain}`, `domain_aliases:${domain}`]);
    try {
      const orgs = await fetchAllQueryResources<B2bOrgIndexedDoc>(
        req,
        (pageToken) =>
          this.microserviceProxy
            .proxyRequest<QueryServiceResponse<B2bOrgIndexedDoc>>(
              req,
              'LFX_V2_SERVICE',
              '/query/resources',
              'GET',
              {
                type: 'b2b_org',
                tags_all: ['is_member:true'],
                filters_or: filtersOr,
                page_size: 50,
                ...(pageToken && { page_token: pageToken }),
              },
              undefined,
              undefined,
              { bearerToken: m2mToken }
            )
            // The canonical account id lives on the query-service wrapper (`resource.id`, e.g.
            // `b2b_org:<sfid>`), which flattening drops — carry it onto the row, as the other
            // b2b_org consumers do (`org-navigation.service.ts`), falling back to `data.uid`.
            .then((page) => ({
              ...page,
              resources: (page?.resources ?? []).map((resource) => ({
                ...resource,
                data: { ...resource.data, uid: this.resourceUid(resource.id) || resource.data?.uid },
              })),
            })),
        { maxResults: MEMBER_BENEFIT_B2B_ORG_MAX_RESULTS, failOnPartial: true }
      );

      const wanted = new Set(domains);
      for (const org of orgs) {
        if (!org.uid) continue;
        const orgDomains = [org.primary_domain, ...(org.domain_aliases ?? [])]
          .map((value) => normalizeDomain(value))
          .filter((value): value is string => !!value);
        for (const domain of new Set(orgDomains)) {
          if (!wanted.has(domain)) continue;
          const uids = matches.get(domain) ?? [];
          if (!uids.includes(org.uid)) uids.push(org.uid);
          matches.set(domain, uids);
        }
      }
    } catch (error) {
      logger.warning(req, 'newsletter_member_benefit_b2b_org', 'b2b_org domain lookup failed — falling back to membership domains only', {
        domain_count: domains.length,
        err: error,
      });
    }
    return matches;
  }
}

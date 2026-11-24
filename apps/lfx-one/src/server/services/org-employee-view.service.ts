// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  ORG_AFFILIATION_LOOKUP_TIMEOUT_MS,
  ORG_LENS_EMPLOYEE_VIEW_CACHE_MAX_ENTRIES,
  ORG_LENS_EMPLOYEE_VIEW_CACHE_TTL_MS,
  ORG_LENS_EMPLOYEE_VIEW_CONSUMER_MAIL_DOMAINS,
  ORG_LENS_EMPLOYEE_VIEW_MAX_CANDIDATE_DOMAINS,
} from '@lfx-one/shared/constants';
import type {
  B2bOrgIndexedDoc,
  OrgEmployeeViewDenial,
  OrgEmployeeViewVerdict,
  OrgLensEmployeeViewGrant,
  QueryServiceResponse,
  RoleGrantsResponse,
} from '@lfx-one/shared/interfaces';
// Deep imports, never the `utils` barrel (see org-affiliation.service.ts).
import { candidateMemberDomains, emailDomain, isPersonalEmailDomain, normalizeDomain, registrableDomain } from '@lfx-one/shared/utils/email-domain.utils';
import type { Request } from 'express';

import { fetchAllQueryResources } from '../helpers/query-service.helper';
import { isOrgLensEmployeeViewEnabled } from '../helpers/org-lens-employee-view-flag.helper';
import { MicroserviceError } from '../errors/microservice.error';
import { resolveVerifiedUserEmails } from '../helpers/user-emails.helper';
import { getEffectiveEmail, getEffectiveUsername } from '../utils/auth-helper';
import { generateM2MToken } from '../utils/m2m-token.util';
import { AccessCheckService } from './access-check.service';
import { CdpService } from './cdp.service';
import { EmailVerificationService } from './email-verification.service';
import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';
import { OrgRoleGrantsService } from './org-role-grants.service';
import { claOnlyEntryApplies } from './org-cla-only-orgs.service';

const OPERATION = 'resolve_org_lens_employee_view';

/** Legal-form words dropped from the end of a company name before comparing ("Acme Motors, Inc." = "Acme Motors"). */
const COMPANY_NAME_SUFFIXES = new Set([
  'inc',
  'incorporated',
  'llc',
  'ltd',
  'limited',
  'corp',
  'corporation',
  'co',
  'company',
  'gmbh',
  'ag',
  'sa',
  'plc',
  'kk',
  'pte',
  'bv',
  'oy',
  'ab',
  'lp',
  'llp',
]);

/**
 * A company name reduced to what identifies it, so a work-history entry matches the LF company it names:
 * case, accents, punctuation, `&` vs `and`, a leading "The" and trailing legal-form words are ignored
 * ("The Linux Foundation" = "Linux Foundation"; "Acme Motors, Inc." = "acme motors"). Empty for a blank name.
 */
export function normalizeCompanyName(name: string | null | undefined): string {
  const words = (name ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  if (words[0] === 'the') words.shift();
  while (words.length > 1 && COMPANY_NAME_SUFFIXES.has(words[words.length - 1])) words.pop();
  return words.join(' ');
}

/** The caller's single answer, held per caller: the company they are granted, or why there is none. */
type EmployeeViewOutcome = { chosen: OrgLensEmployeeViewGrant } | { denial: OrgEmployeeViewDenial };

/**
 * The Linux.com forwarding alias is an address LFX hands to any user (`add_alias`), and consumer ISP mailboxes are personal,
 * so neither proves employment. Covers the production alias domain, whatever this stage configures, and the consumer list.
 */
function isForwardingAliasDomain(domain: string): boolean {
  const registrable = registrableDomain(domain);
  if (registrable && ORG_LENS_EMPLOYEE_VIEW_CONSUMER_MAIL_DOMAINS.has(registrable)) return true;
  const configured = (process.env['LINUX_FORWARD_DOMAIN'] || '').trim().toLowerCase();
  const normalized = domain.toLowerCase();
  return ['linux.com', configured].filter(Boolean).some((alias) => normalized === alias || normalized.endsWith(`.${alias}`));
}

/**
 * Epic #5845 — decides whether a caller may open the all employee view of a company.
 *
 * To see a company's all employee view, a user must have BOTH:
 *   1. a VALIDATED email on one of the company's domains (member-service `primary_domain` or one of its registered
 *      `domain_aliases`, the Salesforce domain list; a personal mailbox domain never counts), the company being an active LF member;
 *   2. that company as a PRESENT employer in their individual work history (the list on the profile's Work history tab): an entry
 *      with no end date whose employer name matches the company's name (see {@link normalizeCompanyName}).
 *
 * When more than one company meets both, the one whose present entry has the MOST RECENT START DATE is granted and the others are
 * cut off, so an all employee view user reaches exactly one company. (Admins who hold a grant never reach this.)
 *
 * Only the work-history entry's employer NAME, END DATE and START DATE are used: no CDP organization id or mapping, no CDP engagement
 * data, and the read never creates a CDP member. Planned, not in this release: (a) when the individual profile has a concept of a
 * PRIMARY employer (written through to CDP), it becomes a third requirement; (b) once an email validation has a freshness concept, the
 * view can expand to several companies.
 *
 * The company is found from the validated email (query service `b2b_org` tagged `is_member:true`, matched on those domains), then
 * confirmed against the work history; the URL never names it.
 *
 * "Could not check" is different from "checked and no": a work-history, query-service, token or email-lookup failure REJECTS (the
 * gate answers 503 `ROLE_GRANTS_UNAVAILABLE`), so an outage never reads as "you are not an employee". Only a clean negative resolves
 * `eligible: false`.
 *
 * The outcome is held for {@link ORG_LENS_EMPLOYEE_VIEW_CACHE_TTL_MS} per CALLER (not per requested company), in a cache shared by
 * every instance, so the role-grants, selector, read-gate and slug-resolver calls of one page share a single lookup; a rejected
 * lookup is never kept. The choice is recomputed from the current work history and emails on each lookup, so changing an employer or
 * a validated email changes the answer at the next check.
 */
export class OrgEmployeeViewService {
  /** Shared by every instance: the read gate, identity controller, navigation service and slug resolver each construct their own service, and one page's calls must share a single lookup. */
  private static readonly cache = new Map<string, { expiresAt: number; outcome: Promise<EmployeeViewOutcome> }>();

  private readonly workHistory: CdpService;
  private readonly emailVerification: EmailVerificationService;
  private readonly proxy: MicroserviceProxyService;
  private readonly accessCheck: AccessCheckService;
  private readonly roleGrants: OrgRoleGrantsService;

  public constructor(
    deps: {
      workHistory?: CdpService;
      emailVerification?: EmailVerificationService;
      proxy?: MicroserviceProxyService;
      accessCheck?: AccessCheckService;
      roleGrants?: OrgRoleGrantsService;
    } = {}
  ) {
    this.workHistory = deps.workHistory ?? new CdpService();
    this.emailVerification = deps.emailVerification ?? new EmailVerificationService();
    this.proxy = deps.proxy ?? new MicroserviceProxyService();
    this.accessCheck = deps.accessCheck ?? new AccessCheckService();
    this.roleGrants = deps.roleGrants ?? new OrgRoleGrantsService();
  }

  /** Drops every held outcome (tests). */
  public static clearCache(): void {
    OrgEmployeeViewService.cache.clear();
  }

  /**
   * The caller's verdict for `orgUid`, or for the one company they are pinned to when `orgUid` is null (the role-grants and
   * selector callers, who do not know it yet). Rejects when it cannot be established.
   */
  public async resolve(req: Request, orgUid: string | null): Promise<OrgEmployeeViewVerdict> {
    const username = getEffectiveUsername(req);
    if (!username) {
      return { eligible: false, reason: 'no-employer' };
    }

    // The verdict depends on the session's verified email as well as the username (the strict email proof reads it), so an older
    // session with a different email must never share, or evict, the entry of a current one.
    const key = `${username}\u0000${getEffectiveEmail(req) ?? ''}`;
    const now = Date.now();
    const hit = OrgEmployeeViewService.cache.get(key);
    let outcome: Promise<EmployeeViewOutcome>;
    if (hit && hit.expiresAt > now) {
      outcome = hit.outcome;
    } else {
      outcome = this.compute(req, username);
      OrgEmployeeViewService.cache.set(key, { expiresAt: now + ORG_LENS_EMPLOYEE_VIEW_CACHE_TTL_MS, outcome });
      if (OrgEmployeeViewService.cache.size > ORG_LENS_EMPLOYEE_VIEW_CACHE_MAX_ENTRIES) {
        this.evict(now);
      }
      outcome.catch(() => {
        if (OrgEmployeeViewService.cache.get(key)?.outcome === outcome) OrgEmployeeViewService.cache.delete(key);
      });
    }

    const result = await outcome;
    if ('denial' in result) {
      logger.debug(req, OPERATION, 'Caller is not in the employee view', { reason: result.denial });
      return { eligible: false, reason: result.denial };
    }
    // One company at a time: a request for any other company the caller also qualifies for is cut off.
    return orgUid && result.chosen.orgUid !== orgUid ? { eligible: false, reason: 'other-company' } : { eligible: true, org: result.chosen };
  }

  /**
   * The company the caller reaches ONLY as an employee, for the surfaces that publish the mode to the client (role-grants,
   * the selector row, the address resolver). Like {@link resolve} with no company, plus one more fact: a caller who also holds
   * `b2b_org#auditor` on that company (an authorizer-only reader such as a key contact absent from the roster) is resolved
   * `full` by the read gate, so they are NOT employee-only and get `holds-full-access` here — otherwise the client would give
   * an existing full-view reader the reduced mode. The authorizer is asked strictly: a failure rejects, never reads as "no".
   */
  public async resolveReduced(req: Request): Promise<OrgEmployeeViewVerdict> {
    // One rule for who enters the employee view: no Org Lens grant and not staff. Staff and grant holders skip the lookup entirely.
    const username = getEffectiveUsername(req);
    if (username) {
      const roster = await this.roleGrants.getAccessAwareOrgs(req, username);
      const answered = !roster.upstreamFailed && !roster.degraded && roster.staffCheck !== 'failed';
      if (!answered) {
        throw new MicroserviceError('Unable to verify your company access right now', 503, 'ROLE_GRANTS_UNAVAILABLE', {
          operation: 'resolve_employee_view_reduced',
          service: 'LFX_V2_SERVICE',
        });
      }
      if (!claOnlyEntryApplies(roster.isStaff, roster.resolved.size, answered)) {
        return { eligible: false, reason: 'has-grants' };
      }
    }
    const verdict = await this.resolve(req, null);
    if (!verdict.eligible) {
      return verdict;
    }
    const holdsAuditor = await this.accessCheck.checkSingleAccessStrict(req, { resource: 'b2b_org', id: verdict.org.orgUid, access: 'auditor' });
    return holdsAuditor ? { eligible: false, reason: 'holds-full-access', org: verdict.org } : verdict;
  }

  /**
   * The `employeeView` field for `GET /api/orgs/me/role-grants`, or nothing. Asked only when the flag is on and the caller
   * demonstrably holds no grant on a clean roster and is not staff (the same entry rule as the CLA-only and affiliation
   * lookups), so a caller who holds anything costs no extra upstream call. There is deliberately no affiliation pre-filter:
   * that verdict names one employer, and the strict lookup considers every present employer. Never throws and never blocks
   * past the affiliation budget: a failed or slow lookup answers `employeeViewLookup: 'failed'`, so the client shows the retryable outage state, not "not an employee".
   */
  public async getRoleGrantEmployeeView(
    req: Request,
    grants: RoleGrantsResponse
  ): Promise<Pick<RoleGrantsResponse, 'employeeView' | 'fullAccessOrgUid' | 'employeeViewLookup'>> {
    if (!isOrgLensEmployeeViewEnabled(req)) {
      return {};
    }
    const grantedOrgCount = grants.writers.length + grants.auditors.length + grants.cascadingWriters.length + grants.cascadingAuditors.length;
    const rosterAnswered = (grants.lookupOutcome ?? 'ok') === 'ok' && grants.staffCheck !== 'failed';
    if (!claOnlyEntryApplies(grants.isStaff, grantedOrgCount, rosterAnswered)) {
      return {};
    }

    let timer: NodeJS.Timeout | undefined;
    try {
      const verdict = await Promise.race([
        this.resolveReduced(req),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new MicroserviceError(`Employee-view lookup exceeded ${ORG_AFFILIATION_LOOKUP_TIMEOUT_MS}ms budget`, 504, 'EMPLOYEE_VIEW_LOOKUP_TIMEOUT', {
                  operation: 'get_role_grant_employee_view',
                  service: 'LFX_V2_SERVICE',
                })
              ),
            ORG_AFFILIATION_LOOKUP_TIMEOUT_MS
          );
        }),
      ]);
      if (verdict.eligible) return { employeeView: verdict.org };
      // An authorizer-only reader who also qualifies is full, and the client needs to be told: it cannot see authorizer entitlements.
      return verdict.reason === 'holds-full-access' && verdict.org ? { fullAccessOrgUid: verdict.org.orgUid } : {};
    } catch (error) {
      logger.warning(req, OPERATION, 'Employee-view lookup failed; reporting the lookup as failed', { err: error });
      return { employeeViewLookup: 'failed' };
    } finally {
      clearTimeout(timer);
    }
  }

  private evict(now: number): void {
    for (const [key, entry] of OrgEmployeeViewService.cache) {
      if (entry.expiresAt <= now) OrgEmployeeViewService.cache.delete(key);
    }
    // Still over the bound: drop the oldest insertions.
    for (const key of OrgEmployeeViewService.cache.keys()) {
      if (OrgEmployeeViewService.cache.size <= ORG_LENS_EMPLOYEE_VIEW_CACHE_MAX_ENTRIES) break;
      OrgEmployeeViewService.cache.delete(key);
    }
  }

  private async compute(req: Request, username: string): Promise<EmployeeViewOutcome> {
    const experiences = await this.workHistory.getWorkExperiencesForKnownUser(req, username);
    // Only present employment (no end date): a past job never admits someone who has left the company.
    const startedAtByName = new Map<string, number>();
    for (const entry of experiences) {
      const name = normalizeCompanyName(entry.organization);
      if (entry.endDate || !name) continue;
      const startedAt = Date.parse(`1 ${entry.startDate ?? ''}`) || Date.parse(entry.startDate ?? '') || 0;
      startedAtByName.set(name, Math.max(startedAtByName.get(name) ?? 0, startedAt));
    }
    if (startedAtByName.size === 0) return { denial: 'no-employer' };

    const emails = await this.getVerifiedEmails(req);
    const companies = await this.findEmailCompanies(req, emails);
    if (companies.length === 0) return { denial: 'no-verified-company-email' };

    // A company qualifies when a present entry names it. The companies are already in a stable order (name, then uid), and the sort
    // is stable, so a tie on start date resolves to the first.
    const qualifying = companies.flatMap((org) => {
      const startedAt = startedAtByName.get(normalizeCompanyName(org.orgName));
      return startedAt === undefined ? [] : [{ org, startedAt }];
    });
    if (qualifying.length === 0) return { denial: 'employer-mismatch' };

    // One company at a time: the present employer with the most recent start date; every other qualifying company is cut off.
    return { chosen: [...qualifying].sort((a, b) => b.startedAt - a.startedAt)[0].org };
  }

  private async findEmailCompanies(req: Request, emails: string[]): Promise<OrgLensEmployeeViewGrant[]> {
    // Personal mailbox providers never prove employment; a public suffix yields no candidate at all.
    const candidates = [
      ...new Set(
        emails.flatMap((email) => {
          const domain = emailDomain(email);
          return domain && !isPersonalEmailDomain(domain) && !isForwardingAliasDomain(domain) ? candidateMemberDomains(domain) : [];
        })
      ),
    ];
    if (candidates.length === 0) {
      logger.debug(req, OPERATION, 'Caller has no verified company email', {});
      return [];
    }
    return this.findMemberCompanies(req, candidates);
  }

  /**
   * Active-member companies whose `primary_domain` or `domain_aliases` exactly equal one of `domains`, in a stable order (name, then uid).
   *
   * Read with the BFF's own machine token, not the caller's: this caller was just refused `b2b_org#auditor`, which the
   * query service applies per row, so their own token would see no company at all. The token is scoped to this one
   * lookup, runs only for the effective user's own verified addresses, and nothing of a record beyond its id, name, slug
   * and domains is read or returned. Every returned record's domains are re-checked, since the query service matches
   * exactly and case-sensitively. Complete or nothing: a failed or truncated page rejects (a retriable 503 at the gate)
   * rather than passing a partial set off as every match.
   */
  private async findMemberCompanies(req: Request, domains: string[]): Promise<OrgLensEmployeeViewGrant[]> {
    // Minted OUTSIDE the lookup: a token failure must reject, never read as "no company matches" and be cached as a denial.
    const bearerToken = await generateM2MToken(req);
    // Asked in batches so no candidate domain is ever dropped: truncating would turn a user with many addresses into a cached false denial.
    const docs: B2bOrgIndexedDoc[] = [];
    for (let start = 0; start < domains.length; start += ORG_LENS_EMPLOYEE_VIEW_MAX_CANDIDATE_DOMAINS) {
      const filtersOr = domains
        .slice(start, start + ORG_LENS_EMPLOYEE_VIEW_MAX_CANDIDATE_DOMAINS)
        .flatMap((domain) => [`primary_domain:${domain}`, `domain_aliases:${domain}`]);
      docs.push(
        ...(await fetchAllQueryResources<B2bOrgIndexedDoc>(
          req,
          (pageToken) =>
            this.proxy
              .proxyRequest<QueryServiceResponse<B2bOrgIndexedDoc>>(
                req,
                'LFX_V2_SERVICE',
                '/query/resources',
                'GET',
                { type: 'b2b_org', tags_all: ['is_member:true'], filters_or: filtersOr, page_size: 50, ...(pageToken && { page_token: pageToken }) },
                undefined,
                undefined,
                { bearerToken }
              )
              // The canonical account id lives on the query-service wrapper (`resource.id`, `b2b_org:<sfid>`), which flattening drops.
              .then((page) => {
                // A confirmed empty page is `resources: []`. A missing or null array is a malformed answer, not "no company": reject it so it
                // surfaces as the retriable 503 instead of a cached denial or an incomplete company set.
                if (!Array.isArray(page?.resources)) {
                  throw new MicroserviceError('Member-company lookup returned an unreadable response', 502, 'EMPLOYEE_VIEW_LOOKUP_INVALID_RESPONSE', {
                    operation: OPERATION,
                    service: 'LFX_V2_SERVICE',
                  });
                }
                return page;
              })
              .then((page) => ({
                ...page,
                resources: page.resources.map((resource) => ({
                  ...resource,
                  data: { ...resource.data, uid: bareUid(resource.id) || resource.data?.uid },
                })),
              })),
          { failOnPartial: true }
        ))
      );
    }

    if (docs.length === 0) {
      // A clean empty answer is indistinguishable from a machine client that cannot read `b2b_org`: log it so a systemic failure is visible.
      logger.warning(req, OPERATION, 'Member-company lookup returned no rows for the caller’s verified domains', { domain_count: domains.length });
    }

    const wanted = new Set(domains);
    const companies = new Map<string, OrgLensEmployeeViewGrant>();
    for (const doc of docs) {
      if (!doc.uid || doc.is_member === false) continue;
      const own = [doc.primary_domain, ...(doc.domain_aliases ?? [])].map((value) => normalizeDomain(value));
      if (!own.some((domain) => domain && wanted.has(domain))) continue;
      companies.set(doc.uid, { orgUid: doc.uid, orgName: doc.name ?? '', orgSlug: doc.slug?.trim().toLowerCase() || null });
    }
    return [...companies.values()].sort((a, b) => a.orgName.localeCompare(b.orgName) || a.orgUid.localeCompare(b.orgUid));
  }

  /** Verified addresses only, read strictly so a failed lookup is an outage rather than the single session email. */
  private getVerifiedEmails(req: Request): Promise<string[]> {
    return resolveVerifiedUserEmails(req, this.emailVerification, { strict: true });
  }
}

/** The bare id of a query-service resource id (`b2b_org:<sfid>` -> `<sfid>`); '' when absent. */
function bareUid(resourceId: string | undefined | null): string {
  if (!resourceId) return '';
  const colon = resourceId.indexOf(':');
  return colon === -1 ? resourceId : resourceId.substring(colon + 1);
}

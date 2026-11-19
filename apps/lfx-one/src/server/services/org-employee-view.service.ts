// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  ORG_AFFILIATION_LOOKUP_TIMEOUT_MS,
  ORG_LENS_EMPLOYEE_VIEW_CACHE_MAX_ENTRIES,
  ORG_LENS_EMPLOYEE_VIEW_CACHE_TTL_MS,
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
// Deep import, never the `utils` barrel (see org-affiliation.service.ts).
import { candidateMemberDomains, emailDomain, isPersonalEmailDomain, normalizeDomain } from '@lfx-one/shared/utils/email-domain.utils';
import type { Request } from 'express';

import { fetchAllQueryResources } from '../helpers/query-service.helper';
import { isServerFeatureEnabled, ServerFeatureFlag } from '../helpers/server-feature-flag.helper';
import { resolveVerifiedUserEmails } from '../helpers/user-emails.helper';
import { getEffectiveUsername } from '../utils/auth-helper';
import { generateM2MToken } from '../utils/m2m-token.util';
import { AccessCheckService } from './access-check.service';
import { EmailVerificationService } from './email-verification.service';
import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';
import { claOnlyEntryApplies } from './org-cla-only-orgs.service';

const OPERATION = 'resolve_org_lens_employee_view';

/**
 * Epic #5845 — decides whether a caller may open the all employee view of a company.
 *
 * The one proof is a VERIFIED email address on a member company's domain (member-service `primary_domain` or one of its
 * `domain_aliases`, the Salesforce `Domain_Alias__c` list). CDP identity and work history play no part: the caller's
 * verified addresses are mapped to the active-member companies that registered those domains, and a request for
 * `orgUid` is eligible only when `orgUid` is one of them. The company is whichever one the email names, never one the URL
 * asserts. Personal mailbox domains (`gmail.com`, ...) and public suffixes never match, and a subdomain address
 * (`eng.acme.com`) matches a company that registered the parent (`acme.com`) but never a public suffix.
 *
 * "Could not check" is different from "checked and no": an email-lookup or query-service failure REJECTS (the gate
 * answers 503 `ROLE_GRANTS_UNAVAILABLE`), so an outage never reads as "you are not an employee". Only a clean negative
 * resolves `eligible: false`.
 *
 * Verdicts are held for {@link ORG_LENS_EMPLOYEE_VIEW_CACHE_TTL_MS} per (caller, company) so a lens page's parallel
 * requests share one lookup; a rejected lookup is never kept.
 */
export class OrgEmployeeViewService {
  private readonly emailVerification: EmailVerificationService;
  private readonly proxy: MicroserviceProxyService;
  private readonly accessCheck: AccessCheckService;
  private readonly cache = new Map<string, { expiresAt: number; companies: Promise<OrgLensEmployeeViewGrant[]> }>();

  public constructor(
    deps: {
      emailVerification?: EmailVerificationService;
      proxy?: MicroserviceProxyService;
      accessCheck?: AccessCheckService;
    } = {}
  ) {
    this.emailVerification = deps.emailVerification ?? new EmailVerificationService();
    this.proxy = deps.proxy ?? new MicroserviceProxyService();
    this.accessCheck = deps.accessCheck ?? new AccessCheckService();
  }

  /**
   * The caller's verdict for `orgUid`, or for the first company their verified email names when `orgUid` is null
   * (the role-grants and selector callers, who do not know it yet). Rejects when it cannot be established.
   */
  public async resolve(req: Request, orgUid: string | null): Promise<OrgEmployeeViewVerdict> {
    return this.verdictFor(await this.companiesFor(req), orgUid ? (company) => company.orgUid === orgUid : undefined);
  }

  /**
   * The company the caller reaches ONLY as an employee, for the surfaces that publish the mode to the client (role-grants,
   * the selector row, the address resolver). Like {@link resolve}, plus one more fact: a caller who also holds
   * `b2b_org#auditor` on that company (an authorizer-only reader such as a key contact absent from the roster) is resolved
   * `full` by the read gate, so they are NOT employee-only and get `holds-full-access` here — otherwise the client would give
   * an existing full-view reader the reduced mode. The authorizer is asked strictly: a failure rejects, never reads as "no".
   *
   * A caller whose emails name several member companies gets the first in a stable order, unless `prefer` picks one: the
   * address resolver passes the company being addressed, so every matching company opens by its own address.
   */
  public async resolveReduced(req: Request, prefer?: (company: OrgLensEmployeeViewGrant) => boolean): Promise<OrgEmployeeViewVerdict> {
    const verdict = await this.verdictFor(await this.companiesFor(req), prefer);
    if (!verdict.eligible) {
      return verdict;
    }
    const holdsAuditor = await this.accessCheck.checkSingleAccessStrict(req, { resource: 'b2b_org', id: verdict.org.orgUid, access: 'auditor' });
    return holdsAuditor ? { eligible: false, reason: 'holds-full-access', org: verdict.org } : verdict;
  }

  /** The caller's verified-email companies, held per caller so a page's parallel requests share one lookup. Rejects when it cannot be established. */
  private async companiesFor(req: Request): Promise<OrgLensEmployeeViewGrant[]> {
    const username = getEffectiveUsername(req);
    if (!username) {
      return [];
    }

    const now = Date.now();
    const hit = this.cache.get(username);
    if (hit && hit.expiresAt > now) {
      return hit.companies;
    }

    const companies = this.findCompanies(req);
    this.cache.set(username, { expiresAt: now + ORG_LENS_EMPLOYEE_VIEW_CACHE_TTL_MS, companies });
    if (this.cache.size > ORG_LENS_EMPLOYEE_VIEW_CACHE_MAX_ENTRIES) {
      this.evict(now);
    }
    companies.catch(() => {
      if (this.cache.get(username)?.companies === companies) this.cache.delete(username);
    });
    return companies;
  }

  /** The verdict for the company `pick` selects (the first when it is absent). */
  private verdictFor(companies: OrgLensEmployeeViewGrant[], pick?: (company: OrgLensEmployeeViewGrant) => boolean): OrgEmployeeViewVerdict {
    const deny = (reason: OrgEmployeeViewDenial): OrgEmployeeViewVerdict => ({ eligible: false, reason });
    if (companies.length === 0) return deny('no-verified-company-email');
    const match = pick ? companies.find(pick) : companies[0];
    // A request for a specific company must be one the caller's own verified email names.
    return match ? { eligible: true, org: match } : deny('other-company');
  }

  /**
   * The `employeeView` field for `GET /api/orgs/me/role-grants`, or nothing. Asked only when the flag is on and the caller
   * demonstrably holds no grant on a clean roster and is not staff (the same entry rule as the CLA-only and affiliation
   * lookups), so a caller who holds anything costs no extra upstream call. Never throws and never blocks past the
   * affiliation budget: a failed or slow lookup answers nothing, which the client reads as today's empty state.
   */
  public async getRoleGrantEmployeeView(req: Request, grants: RoleGrantsResponse): Promise<Pick<RoleGrantsResponse, 'employeeView' | 'fullAccessOrgUid'>> {
    if (!isServerFeatureEnabled(ServerFeatureFlag.OrgLensEmployeeView)) {
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
            () => reject(new Error(`Employee-view lookup exceeded ${ORG_AFFILIATION_LOOKUP_TIMEOUT_MS}ms budget`)),
            ORG_AFFILIATION_LOOKUP_TIMEOUT_MS
          );
        }),
      ]);
      if (verdict.eligible) return { employeeView: verdict.org };
      // An authorizer-only reader who also qualifies is full, and the client needs to be told: it cannot see authorizer entitlements.
      return verdict.reason === 'holds-full-access' && verdict.org ? { fullAccessOrgUid: verdict.org.orgUid } : {};
    } catch (error) {
      logger.warning(req, OPERATION, 'Employee-view lookup failed; reporting no employee view', { err: error });
      return {};
    } finally {
      clearTimeout(timer);
    }
  }

  private evict(now: number): void {
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt <= now) this.cache.delete(key);
    }
    // Still over the bound: drop the oldest insertions.
    for (const key of this.cache.keys()) {
      if (this.cache.size <= ORG_LENS_EMPLOYEE_VIEW_CACHE_MAX_ENTRIES) break;
      this.cache.delete(key);
    }
  }

  private async findCompanies(req: Request): Promise<OrgLensEmployeeViewGrant[]> {
    const emails = await this.getVerifiedEmails(req);
    // Personal mailbox providers never prove employment; a public suffix yields no candidate at all.
    const candidates = [
      ...new Set(
        emails.flatMap((email) => {
          const domain = emailDomain(email);
          return domain && !isPersonalEmailDomain(domain) ? candidateMemberDomains(domain) : [];
        })
      ),
    ].slice(0, ORG_LENS_EMPLOYEE_VIEW_MAX_CANDIDATE_DOMAINS);
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
    const filtersOr = domains.flatMap((domain) => [`primary_domain:${domain}`, `domain_aliases:${domain}`]);
    const docs = await fetchAllQueryResources<B2bOrgIndexedDoc>(
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
          .then((page) => ({
            ...page,
            resources: (page?.resources ?? []).map((resource) => ({
              ...resource,
              data: { ...resource.data, uid: bareUid(resource.id) || resource.data?.uid },
            })),
          })),
      { failOnPartial: true }
    );

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

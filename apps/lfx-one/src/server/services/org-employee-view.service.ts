// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { createHash } from 'node:crypto';

import {
  ORG_AFFILIATION_LOOKUP_TIMEOUT_MS,
  ORG_LENS_EMPLOYEE_VIEW_CACHE_MAX_ENTRIES,
  ORG_LENS_EMPLOYEE_VIEW_CACHE_TTL_MS,
  ORG_LENS_EMPLOYEE_VIEW_MAX_EMPLOYERS,
  VALKEY_CACHE,
} from '@lfx-one/shared/constants';
import type {
  MemberServiceB2bOrgResponse,
  OrgEmployeeViewDenial,
  OrgEmployeeViewVerdict,
  OrgLensEmployeeViewGrant,
  RoleGrantsResponse,
} from '@lfx-one/shared/interfaces';
// Deep imports, never the `utils` barrel (see org-affiliation.service.ts).
import { candidateMemberDomains, emailDomain, isPersonalEmailDomain, normalizeDomain } from '@lfx-one/shared/utils/email-domain.utils';
import type { Request } from 'express';

import { MicroserviceError } from '../errors';
import { isServerFeatureEnabled, ServerFeatureFlag } from '../helpers/server-feature-flag.helper';
import { resolveVerifiedUserEmails } from '../helpers/user-emails.helper';
import { getEffectiveUsername } from '../utils/auth-helper';
import { generateM2MToken } from '../utils/m2m-token.util';
import { AccessCheckService } from './access-check.service';
import { CdpService } from './cdp.service';
import { EmailVerificationService } from './email-verification.service';
import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';
import { claOnlyEntryApplies } from './org-cla-only-orgs.service';
import { OrgEmployeeViewEngagementService } from './org-employee-view-engagement.service';
import { OrganizationService } from './organization.service';
import { withPerUserCache } from './valkey.service';

const OPERATION = 'resolve_org_lens_employee_view';

/** How far each denial got before failing; the furthest one is the reason reported when no employer qualifies. */
const DENIAL_RANK: Record<string, number> = { 'employer-unresolvable': 1, 'not-member': 2, 'company-domains-unknown': 3, 'no-verified-company-email': 4 };

/** One present employer that passed every check: an active LF member with a verified email on its domain. */
interface QualifyingEmployer {
  org: OrgLensEmployeeViewGrant;
  cdevOrgId: string;
  /** Most recent work-history start date (ms); 0 when it cannot be parsed. */
  startedAt: number;
}

/**
 * Epic #5845 — decides whether a caller may open the all employee view of a company.
 *
 * To see a company's all employee view, a user must:
 *   1. list that company as a PRESENT employer in their work history (CDP: no end date, with a crowd.dev organization id),
 *      and the company's LF account is an active LF member (`ORG_LENS_ACCOUNT_CONTEXT.IS_MEMBER`);
 *   2. hold a VERIFIED email on one of that company's domains (member-service `primary_domain` or one of its registered
 *      `domain_aliases`, the Salesforce domain list; never the host of its `website`; a personal mailbox domain never counts).
 *
 * An all employee view user reaches ONE company at a time. When several present employers qualify, the one with the most
 * recent engagement (code activity today) is chosen, falling back to the most recent work-history start date, and the others
 * are cut off. The choice is made once and pinned per (user, fingerprint of present employers + verified emails): it is
 * recomputed only when an employer or a verified email changes, never on a schedule or on new activity. (Admins who hold a
 * grant never reach this and may see many companies.)
 *
 * "Could not check" is different from "checked and no": a CDP, warehouse, member-service or email-lookup failure REJECTS
 * (the gate answers 503 `ROLE_GRANTS_UNAVAILABLE`), so an outage never reads as "you are not an employee". Only a clean
 * negative resolves `eligible: false`. The membership lookup is account-grain and may miss a company's second mapped
 * crowd.dev org; that miss is a denial here (fail closed). The engagement lookup alone is fail-soft, because the start-date
 * fallback is a defined rule.
 *
 * Verdicts are held for {@link ORG_LENS_EMPLOYEE_VIEW_CACHE_TTL_MS} per (caller, company) so a lens page's parallel
 * requests share one lookup; a rejected lookup is never kept.
 */
export class OrgEmployeeViewService {
  private readonly cdp: CdpService;
  private readonly organizations: OrganizationService;
  private readonly emailVerification: EmailVerificationService;
  private readonly proxy: MicroserviceProxyService;
  private readonly accessCheck: AccessCheckService;
  private readonly engagement: OrgEmployeeViewEngagementService;
  private readonly cache = new Map<string, { expiresAt: number; verdict: Promise<OrgEmployeeViewVerdict> }>();

  public constructor(
    deps: {
      cdp?: CdpService;
      organizations?: OrganizationService;
      emailVerification?: EmailVerificationService;
      proxy?: MicroserviceProxyService;
      accessCheck?: AccessCheckService;
      engagement?: OrgEmployeeViewEngagementService;
    } = {}
  ) {
    this.cdp = deps.cdp ?? new CdpService();
    this.organizations = deps.organizations ?? new OrganizationService();
    this.emailVerification = deps.emailVerification ?? new EmailVerificationService();
    this.proxy = deps.proxy ?? new MicroserviceProxyService();
    this.accessCheck = deps.accessCheck ?? new AccessCheckService();
    this.engagement = deps.engagement ?? new OrgEmployeeViewEngagementService();
  }

  /**
   * The caller's verdict for `orgUid`, or for the one company they are pinned to when `orgUid` is null
   * (the role-grants and selector callers, who do not know it yet). Rejects when it cannot be established.
   */
  public async resolve(req: Request, orgUid: string | null): Promise<OrgEmployeeViewVerdict> {
    const username = getEffectiveUsername(req);
    if (!username) {
      return { eligible: false, reason: 'no-employer' };
    }

    const key = `${username}\u0000${orgUid ?? ''}`;
    const now = Date.now();
    const hit = this.cache.get(key);
    if (hit && hit.expiresAt > now) {
      return hit.verdict;
    }

    const verdict = this.compute(req, username, orgUid);
    this.cache.set(key, { expiresAt: now + ORG_LENS_EMPLOYEE_VIEW_CACHE_TTL_MS, verdict });
    if (this.cache.size > ORG_LENS_EMPLOYEE_VIEW_CACHE_MAX_ENTRIES) {
      this.evict(now);
    }
    verdict.catch(() => {
      if (this.cache.get(key)?.verdict === verdict) this.cache.delete(key);
    });
    return verdict;
  }

  /**
   * The company the caller reaches ONLY as an employee, for the surfaces that publish the mode to the client (role-grants,
   * the selector row, the address resolver). Like {@link resolve} with no company, plus one more fact: a caller who also holds
   * `b2b_org#auditor` on that company (an authorizer-only reader such as a key contact absent from the roster) is resolved
   * `full` by the read gate, so they are NOT employee-only and get `holds-full-access` here — otherwise the client would give
   * an existing full-view reader the reduced mode. The authorizer is asked strictly: a failure rejects, never reads as "no".
   */
  public async resolveReduced(req: Request): Promise<OrgEmployeeViewVerdict> {
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
   * past the affiliation budget: a failed or slow lookup answers nothing, which the client reads as today's empty state.
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

  private async compute(req: Request, username: string, requestedOrgUid: string | null): Promise<OrgEmployeeViewVerdict> {
    const deny = (reason: OrgEmployeeViewDenial): OrgEmployeeViewVerdict => {
      logger.debug(req, OPERATION, 'Caller is not in the employee view', { reason });
      return { eligible: false, reason };
    };

    const experiences = await this.cdp.getWorkExperiencesForKnownUser(req, username);
    // Only present employment (no end date): a past job never admits someone who has left the company.
    const present = experiences.filter((entry) => !entry.endDate);
    if (present.length === 0) return deny('no-employer');

    const startedAtByOrg = new Map<string, number>();
    for (const entry of present) {
      if (!entry.organizationId) continue;
      const startedAt = Date.parse(`1 ${entry.startDate ?? ''}`) || Date.parse(entry.startDate ?? '') || 0;
      startedAtByOrg.set(entry.organizationId, Math.max(startedAtByOrg.get(entry.organizationId) ?? 0, startedAt));
    }
    if (startedAtByOrg.size === 0) return deny('employer-unresolvable');

    const emails = await this.getVerifiedEmails(req);
    const evaluated = await Promise.all(
      [...startedAtByOrg]
        .slice(0, ORG_LENS_EMPLOYEE_VIEW_MAX_EMPLOYERS)
        .map(([cdevOrgId, startedAt]) => this.evaluateEmployer(req, cdevOrgId, startedAt, emails))
    );
    // Two work-history entries can name the same LF account (e.g. a renamed company); count it once, by its latest start.
    const byAccount = new Map<string, QualifyingEmployer>();
    for (const entry of evaluated) {
      if (!('org' in entry)) continue;
      const kept = byAccount.get(entry.org.orgUid);
      if (!kept || entry.startedAt > kept.startedAt) byAccount.set(entry.org.orgUid, entry);
    }
    const qualifying = [...byAccount.values()];
    if (qualifying.length === 0) {
      const furthest = evaluated.map((entry) => (entry as { denial: OrgEmployeeViewDenial }).denial).sort((a, b) => DENIAL_RANK[b] - DENIAL_RANK[a])[0];
      return deny(furthest);
    }

    const chosen = await this.chooseEmployer(req, username, qualifying, this.fingerprint(startedAtByOrg, emails));
    // One company at a time: a request for any other company the caller also qualifies for is cut off.
    return requestedOrgUid && chosen.org.orgUid !== requestedOrgUid ? deny('other-company') : { eligible: true, org: chosen.org };
  }

  /** One present employer: its LF account, membership and a verified email on one of its domains, or the furthest denial it reached. */
  private async evaluateEmployer(
    req: Request,
    cdevOrgId: string,
    startedAt: number,
    emails: string[]
  ): Promise<QualifyingEmployer | { denial: OrgEmployeeViewDenial }> {
    const account = await this.organizations.getOrgLensAccountContextByCdevOrgId(cdevOrgId);
    if (!account) return { denial: 'employer-unresolvable' };
    if (account.isMember !== true) return { denial: 'not-member' };

    const company = await this.getCompanyRecord(req, account.accountId);
    // `primary_domain` plus the registered `domain_aliases` only: a website can name a third-party host, which would let
    // any verified address there qualify.
    const domains = new Set(
      [company?.primary_domain, ...(company?.domain_aliases ?? [])].map((value) => normalizeDomain(value)).filter((d): d is string => !!d)
    );
    if (domains.size === 0) return { denial: 'company-domains-unknown' };

    // A subdomain address (`eng.acme.com`) counts for a company that registered the parent; a personal mailbox never does.
    const hasCompanyEmail = emails.some((email) => {
      const domain = emailDomain(email);
      return !!domain && !isPersonalEmailDomain(domain) && candidateMemberDomains(domain).some((candidate) => domains.has(candidate));
    });
    if (!hasCompanyEmail) return { denial: 'no-verified-company-email' };

    return { org: { orgUid: account.accountId, orgName: account.accountName, orgSlug: company?.slug?.trim().toLowerCase() || null }, cdevOrgId, startedAt };
  }

  /** What identifies "the same situation": the present employers and the verified emails. A change of either recomputes the pinned choice. */
  private fingerprint(startedAtByOrg: Map<string, number>, emails: string[]): string {
    const employers = [...startedAtByOrg.keys()].sort().join(',');
    const addresses = emails
      .map((email) => email.trim().toLowerCase())
      .sort()
      .join(',');
    return createHash('sha256').update(`${employers}|${addresses}`).digest('hex').slice(0, 32);
  }

  /**
   * The single employer an all employee view user is pinned to. With one qualifying employer that is it. With several, the
   * most recent engagement wins, then the most recent start date; the choice is stored under the fingerprint so it is made
   * once per change of employer or verified email, not re-derived from activity on every load.
   */
  private async chooseEmployer(req: Request, username: string, qualifying: QualifyingEmployer[], fingerprint: string): Promise<QualifyingEmployer> {
    if (qualifying.length === 1) return qualifying[0];

    const stored = await withPerUserCache(
      VALKEY_CACHE.ORG_EMPLOYEE_VIEW_EMPLOYER_NAMESPACE,
      username,
      fingerprint,
      VALKEY_CACHE.ORG_EMPLOYEE_VIEW_EMPLOYER_TTL_SECONDS,
      async () => ({ orgUid: (await this.rank(req, username, qualifying)).org.orgUid }),
      (value) => !!value && typeof value === 'object' && typeof (value as { orgUid?: unknown }).orgUid === 'string'
    );
    // A pinned company that no longer qualifies (membership or domains changed without a fingerprint change) is re-chosen, not trusted.
    return qualifying.find((entry) => entry.org.orgUid === stored.orgUid) ?? (await this.rank(req, username, qualifying));
  }

  private async rank(req: Request, username: string, qualifying: QualifyingEmployer[]): Promise<QualifyingEmployer> {
    const activity = await this.engagement.getLastActivityByAccount(
      req,
      username,
      qualifying.map((entry) => entry.org.orgUid)
    );
    return [...qualifying].sort(
      (a, b) => (activity.get(b.org.orgUid) ?? 0) - (activity.get(a.org.orgUid) ?? 0) || b.startedAt - a.startedAt || a.org.orgUid.localeCompare(b.org.orgUid)
    )[0];
  }

  /**
   * The company's member-service record (`primary_domain`, `slug`), or null when it has none.
   *
   * Read with the BFF's own machine token, not the caller's: this runs only after the read gate refused the caller
   * `b2b_org#auditor`, and member-service requires that same permission for `GET /b2b_orgs/{uid}`, so the caller's token
   * could never fetch the domain it is being checked against. The token is scoped to this one upstream call, runs only
   * after the employer, account and membership checks have passed for the effective user, and nothing of the record
   * beyond the domain and slug is used or returned.
   */
  private async getCompanyRecord(req: Request, accountId: string): Promise<MemberServiceB2bOrgResponse | null> {
    // Minted OUTSIDE the try: the token endpoint's HTTP status survives in its MicroserviceError, so a 404 there must reject
    // (a retriable 503 at the gate), not read as "this company has no record" and be cached as a denial.
    const bearerToken = await generateM2MToken(req);
    try {
      return await this.proxy.proxyRequest<MemberServiceB2bOrgResponse>(
        req,
        'LFX_V2_SERVICE',
        `/b2b_orgs/${encodeURIComponent(accountId)}`,
        'GET',
        undefined,
        undefined,
        undefined,
        {
          bearerToken,
        }
      );
    } catch (error) {
      if (error instanceof MicroserviceError && error.statusCode === 404) return null;
      throw error;
    }
  }

  /** Verified addresses only, read strictly so a failed lookup is an outage rather than the single session email. */
  private getVerifiedEmails(req: Request): Promise<string[]> {
    return resolveVerifiedUserEmails(req, this.emailVerification, { strict: true });
  }
}

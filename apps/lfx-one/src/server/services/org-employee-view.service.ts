// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ORG_AFFILIATION_LOOKUP_TIMEOUT_MS, ORG_LENS_EMPLOYEE_VIEW_CACHE_MAX_ENTRIES, ORG_LENS_EMPLOYEE_VIEW_CACHE_TTL_MS } from '@lfx-one/shared/constants';
import type { MemberServiceB2bOrgResponse, OrgEmployeeViewDenial, OrgEmployeeViewVerdict, RoleGrantsResponse } from '@lfx-one/shared/interfaces';
// Deep import, never the `utils` barrel (see org-affiliation.service.ts).
import { currentEmployerFromWorkExperiences } from '@lfx-one/shared/utils/invitation.utils';
import type { Request } from 'express';

import { MicroserviceError } from '../errors';
import { isServerFeatureEnabled, ServerFeatureFlag } from '../helpers/server-feature-flag.helper';
import { resolveVerifiedUserEmails } from '../helpers/user-emails.helper';
import { getEffectiveUsername } from '../utils/auth-helper';
import { generateM2MToken } from '../utils/m2m-token.util';
import { CdpService } from './cdp.service';
import { EmailVerificationService } from './email-verification.service';
import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';
import { claOnlyEntryApplies } from './org-cla-only-orgs.service';
import { OrganizationService } from './organization.service';

const OPERATION = 'resolve_org_lens_employee_view';

/**
 * Lowercased bare hostname from a domain or URL (`https://www.Acme.com/careers` -> `acme.com`), or null when
 * the value does not look like a hostname. A leading `www.` is dropped.
 */
export function normalizeCompanyDomain(value: string | null | undefined): string | null {
  const raw = value?.trim().toLowerCase();
  if (!raw) return null;
  let host = raw;
  if (raw.includes('://')) {
    try {
      host = new URL(raw).hostname;
    } catch {
      return null;
    }
  } else {
    host = raw.split(/[/?#]/)[0];
  }
  host = host.replace(/^www\./, '').replace(/\.$/, '');
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host) ? host : null;
}

/**
 * Whether `email` sits on one of `domains`: the exact domain or a subdomain of it (`eng.acme.com` for `acme.com`).
 * The comparison is on a whole label boundary, so `notacme.com` and `acme.com.evil.example` never match.
 */
export function emailBelongsToCompanyDomain(email: string, domains: readonly string[]): boolean {
  const at = email.lastIndexOf('@');
  if (at < 1) return false;
  const host = email
    .slice(at + 1)
    .trim()
    .toLowerCase();
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

/**
 * Epic #5845 — decides whether a caller may open the all employee view of a company.
 *
 * All three must be proven, and anything unproven is a denial:
 *   1. the caller's CURRENT employer (CDP work history, no end date) resolves to a crowd.dev organization whose
 *      LF account is `orgUid` — the company is whichever one the affiliation names, never one the URL asserts;
 *   2. that account is an active LF member (`ORG_LENS_ACCOUNT_CONTEXT.IS_MEMBER`);
 *   3. the caller holds a VERIFIED email whose domain is one of the company's (member-service `primary_domain` or
 *      the host of its `website`).
 *
 * "Could not check" is different from "checked and no": a CDP, warehouse, member-service or email-lookup failure
 * REJECTS (the gate answers 503 `ROLE_GRANTS_UNAVAILABLE`), so an outage never reads as "you are not an employee".
 * Only a clean negative resolves `eligible: false`. The membership lookup is account-grain and may miss a
 * company's second mapped crowd.dev org; that miss is a denial here (fail closed), unlike the affiliation verdict
 * where it only picks wording.
 *
 * Verdicts are held for {@link ORG_LENS_EMPLOYEE_VIEW_CACHE_TTL_MS} per (caller, company) so a lens page's parallel
 * requests share one lookup; a rejected lookup is never kept.
 */
export class OrgEmployeeViewService {
  private readonly cdp: CdpService;
  private readonly organizations: OrganizationService;
  private readonly emailVerification: EmailVerificationService;
  private readonly proxy: MicroserviceProxyService;
  private readonly cache = new Map<string, { expiresAt: number; verdict: Promise<OrgEmployeeViewVerdict> }>();

  public constructor(
    deps: { cdp?: CdpService; organizations?: OrganizationService; emailVerification?: EmailVerificationService; proxy?: MicroserviceProxyService } = {}
  ) {
    this.cdp = deps.cdp ?? new CdpService();
    this.organizations = deps.organizations ?? new OrganizationService();
    this.emailVerification = deps.emailVerification ?? new EmailVerificationService();
    this.proxy = deps.proxy ?? new MicroserviceProxyService();
  }

  /**
   * The caller's verdict for `orgUid`, or for whichever company their affiliation names when `orgUid` is null
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
   * The `employeeView` field for `GET /api/orgs/me/role-grants`, or nothing. Asked only when the flag is on, the caller
   * demonstrably holds no grant on a clean roster and is not staff (the same entry rule as the CLA-only and affiliation
   * lookups), and the affiliation verdict already says their employer is an LF member, so a caller who cannot qualify
   * costs no extra upstream call. Never throws and never blocks past the affiliation budget: a failed or slow lookup
   * answers nothing, which the client reads as today's empty state.
   */
  public async getRoleGrantEmployeeView(
    req: Request,
    grants: RoleGrantsResponse,
    affiliation: RoleGrantsResponse['affiliation']
  ): Promise<Pick<RoleGrantsResponse, 'employeeView'>> {
    if (!isServerFeatureEnabled(ServerFeatureFlag.OrgLensEmployeeView)) {
      return {};
    }
    const grantedOrgCount = grants.writers.length + grants.auditors.length + grants.cascadingWriters.length + grants.cascadingAuditors.length;
    const rosterAnswered = (grants.lookupOutcome ?? 'ok') === 'ok' && grants.staffCheck !== 'failed';
    if (!claOnlyEntryApplies(grants.isStaff, grantedOrgCount, rosterAnswered) || affiliation?.lookup !== 'ok' || !affiliation.employerIsMember) {
      return {};
    }

    let timer: NodeJS.Timeout | undefined;
    try {
      const verdict = await Promise.race([
        this.resolve(req, null),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`Employee-view lookup exceeded ${ORG_AFFILIATION_LOOKUP_TIMEOUT_MS}ms budget`)),
            ORG_AFFILIATION_LOOKUP_TIMEOUT_MS
          );
        }),
      ]);
      return verdict.eligible ? { employeeView: verdict.org } : {};
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
    // Only ongoing employment: `currentEmployerFromWorkExperiences` falls back to the latest past job when every
    // entry has ended, which would admit someone who has left the company.
    const employer = currentEmployerFromWorkExperiences(experiences.filter((entry) => !entry.endDate));
    if (!employer) return deny('no-employer');
    if (!employer.id) return deny('employer-unresolvable');

    const account = await this.organizations.getOrgLensAccountContextByCdevOrgId(employer.id);
    if (!account) return deny('employer-unresolvable');
    if (requestedOrgUid && account.accountId !== requestedOrgUid) return deny('other-company');
    if (account.isMember !== true) return deny('not-member');

    const [company, emails] = await Promise.all([this.getCompanyRecord(req, account.accountId), this.getVerifiedEmails(req)]);
    // `primary_domain` only: a website can name a third-party host, which would let any verified address there qualify.
    const domain = normalizeCompanyDomain(company?.primary_domain);
    if (!domain) return deny('company-domains-unknown');
    if (!emails.some((email) => emailBelongsToCompanyDomain(email, [domain]))) return deny('no-verified-company-email');

    return { eligible: true, org: { orgUid: account.accountId, orgName: account.accountName, orgSlug: company?.slug?.trim().toLowerCase() || null } };
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
    try {
      const bearerToken = await generateM2MToken(req);
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

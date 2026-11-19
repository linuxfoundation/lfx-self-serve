// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { createHash } from 'node:crypto';

import {
  ORG_AFFILIATION_LOOKUP_TIMEOUT_MS,
  ORG_LENS_EMPLOYEE_VIEW_CACHE_MAX_ENTRIES,
  ORG_LENS_EMPLOYEE_VIEW_CACHE_TTL_MS,
  ORG_LENS_EMPLOYEE_VIEW_MAX_CANDIDATE_DOMAINS,
  VALKEY_CACHE,
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
import { candidateMemberDomains, emailDomain, isPersonalEmailDomain, normalizeDomain } from '@lfx-one/shared/utils/email-domain.utils';
import type { Request } from 'express';

import { MicroserviceError } from '../errors';
import { fetchAllQueryResources } from '../helpers/query-service.helper';
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
import { buildPerUserOrgKey, valkeyService } from './valkey.service';

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

/** One company that passed every check: an active LF member, with a verified email on its domain and a present work-history entry naming it. */
interface QualifyingEmployer {
  org: OrgLensEmployeeViewGrant;
  /** Most recent start date (ms) among the entries naming it; 0 when it cannot be parsed. */
  startedAt: number;
}

/** The caller's single answer, held per caller: the company they are pinned to, or why there is none. */
type EmployeeViewOutcome = { chosen: QualifyingEmployer } | { denial: OrgEmployeeViewDenial };

/**
 * Epic #5845 — decides whether a caller may open the all employee view of a company.
 *
 * To see a company's all employee view, a user must:
 *   1. list the company as a PRESENT employer in their work history: an entry with no end date whose employer name matches the
 *      company's name (see {@link normalizeCompanyName}). Nothing from crowd.dev is required: no crowd.dev organization id and no
 *      crowd.dev-to-account mapping. The work history is read through the same call the profile's Work history tab uses;
 *   2. hold a VERIFIED email on one of that company's domains (member-service `primary_domain` or one of its registered
 *      `domain_aliases`, the Salesforce domain list; a personal mailbox domain never counts), the company being an active LF member.
 *
 * The company is found from the verified email (query service `b2b_org` tagged `is_member:true`, matched on those domains),
 * then confirmed against the present work-history entries; the URL never names it.
 *
 * An all employee view user reaches ONE company at a time. When several qualify, the one with the most recent engagement (code
 * activity today) is chosen, falling back to the most recent work-history start date, and the others are cut off. The choice is
 * made once and pinned per (user, fingerprint of present employers + verified emails): it is recomputed only when an employer or a
 * verified email changes, never on a schedule or on new activity. (Admins who hold a grant never reach this.)
 *
 * "Could not check" is different from "checked and no": a work-history, query-service, token or email-lookup failure REJECTS (the
 * gate answers 503 `ROLE_GRANTS_UNAVAILABLE`), so an outage never reads as "you are not an employee". Only a clean negative
 * resolves `eligible: false`. The engagement lookup alone is fail-soft, because the start-date fallback is a defined rule.
 *
 * The outcome is held for {@link ORG_LENS_EMPLOYEE_VIEW_CACHE_TTL_MS} per CALLER (not per requested company), so the role-grants,
 * selector and read-gate calls of one page share a single lookup; a rejected lookup is never kept.
 */
export class OrgEmployeeViewService {
  private readonly cdp: CdpService;
  private readonly emailVerification: EmailVerificationService;
  private readonly proxy: MicroserviceProxyService;
  private readonly accessCheck: AccessCheckService;
  private readonly engagement: OrgEmployeeViewEngagementService;
  private readonly cache = new Map<string, { expiresAt: number; outcome: Promise<EmployeeViewOutcome> }>();

  public constructor(
    deps: {
      cdp?: CdpService;
      emailVerification?: EmailVerificationService;
      proxy?: MicroserviceProxyService;
      accessCheck?: AccessCheckService;
      engagement?: OrgEmployeeViewEngagementService;
    } = {}
  ) {
    this.cdp = deps.cdp ?? new CdpService();
    this.emailVerification = deps.emailVerification ?? new EmailVerificationService();
    this.proxy = deps.proxy ?? new MicroserviceProxyService();
    this.accessCheck = deps.accessCheck ?? new AccessCheckService();
    this.engagement = deps.engagement ?? new OrgEmployeeViewEngagementService();
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

    const now = Date.now();
    const hit = this.cache.get(username);
    let outcome: Promise<EmployeeViewOutcome>;
    if (hit && hit.expiresAt > now) {
      outcome = hit.outcome;
    } else {
      outcome = this.compute(req, username);
      this.cache.set(username, { expiresAt: now + ORG_LENS_EMPLOYEE_VIEW_CACHE_TTL_MS, outcome });
      if (this.cache.size > ORG_LENS_EMPLOYEE_VIEW_CACHE_MAX_ENTRIES) {
        this.evict(now);
      }
      outcome.catch(() => {
        if (this.cache.get(username)?.outcome === outcome) this.cache.delete(username);
      });
    }

    const result = await outcome;
    if ('denial' in result) {
      logger.debug(req, OPERATION, 'Caller is not in the employee view', { reason: result.denial });
      return { eligible: false, reason: result.denial };
    }
    // One company at a time: a request for any other company the caller also qualifies for is cut off.
    return orgUid && result.chosen.org.orgUid !== orgUid ? { eligible: false, reason: 'other-company' } : { eligible: true, org: result.chosen.org };
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

  private async compute(req: Request, username: string): Promise<EmployeeViewOutcome> {
    const experiences = await this.cdp.getWorkExperiencesForKnownUser(req, username);
    // Only present employment (no end date): a past job never admits someone who has left the company.
    const present = experiences.filter((entry) => !entry.endDate && normalizeCompanyName(entry.organization));
    if (present.length === 0) return { denial: 'no-employer' };

    const emails = await this.getVerifiedEmails(req);
    const companies = await this.findEmailCompanies(req, emails);
    if (companies.length === 0) return { denial: 'no-verified-company-email' };

    // A company qualifies when a present entry names it. Two entries naming the same company count once, by the latest start.
    const startedAtByName = new Map<string, number>();
    for (const entry of present) {
      const name = normalizeCompanyName(entry.organization);
      const startedAt = Date.parse(`1 ${entry.startDate ?? ''}`) || Date.parse(entry.startDate ?? '') || 0;
      startedAtByName.set(name, Math.max(startedAtByName.get(name) ?? 0, startedAt));
    }
    const qualifying: QualifyingEmployer[] = companies.flatMap((org) => {
      const startedAt = startedAtByName.get(normalizeCompanyName(org.orgName));
      return startedAt === undefined ? [] : [{ org, startedAt }];
    });
    if (qualifying.length === 0) return { denial: 'employer-mismatch' };

    return { chosen: await this.chooseEmployer(req, username, qualifying, this.fingerprint([...startedAtByName.keys()], emails)) };
  }

  private async findEmailCompanies(req: Request, emails: string[]): Promise<OrgLensEmployeeViewGrant[]> {
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

  /** What identifies "the same situation": the present employers and the verified emails. A change of either recomputes the pinned choice. */
  private fingerprint(employerNames: string[], emails: string[]): string {
    const employers = [...employerNames].sort().join(',');
    const addresses = emails
      .map((email) => email.trim().toLowerCase())
      .sort()
      .join(',');
    return createHash('sha256').update(`${employers}|${addresses}`).digest('hex').slice(0, 32);
  }

  /**
   * The single employer an all employee view user is pinned to. With one qualifying employer that is it. With several, the
   * most recent engagement wins, then the most recent start date, and the choice is STORED under the fingerprint: it is
   * made once per change of employer or verified email, never re-derived from activity on a later load.
   *
   * The stored pin is authoritative: it is read back as long as that company still qualifies, and each read refreshes its
   * 30-day lifetime. A read that FAULTS (timeout, connection error) is not a missing pin and is treated like a failed write. A pin that no longer qualifies is replaced, and the replacement is persisted. When the pin cannot be
   * read or stored (the cache is disabled, or a read or the write fails) the lookup REJECTS (a retriable 503) rather than answering with a
   * choice that the next request could contradict, which would let two companies be admitted in turn.
   */
  private async chooseEmployer(req: Request, username: string, qualifying: QualifyingEmployer[], fingerprint: string): Promise<QualifyingEmployer> {
    if (qualifying.length === 1) return qualifying[0];

    const key = buildPerUserOrgKey(VALKEY_CACHE.ORG_EMPLOYEE_VIEW_EMPLOYER_NAMESPACE, username, fingerprint);
    if (!key || !valkeyService.isEnabled()) throw this.pinUnavailable();

    const accept = (value: unknown): boolean => !!value && typeof value === 'object' && typeof (value as { orgUid?: unknown }).orgUid === 'string';
    // A read FAULT is not "no pin": re-ranking on a blip would overwrite the stored company with whichever one currently leads.
    const read = await valkeyService.getJsonStrict<{ orgUid: string }>(key, accept);
    if (read.status === 'fault') throw this.pinUnavailable();
    const kept = read.status === 'hit' ? qualifying.find((entry) => entry.org.orgUid === read.value.orgUid) : undefined;
    if (kept) {
      // Sliding lifetime, best effort: a failed refresh only leaves the remaining time as it was.
      void valkeyService.setJson(key, { orgUid: kept.org.orgUid }, VALKEY_CACHE.ORG_EMPLOYEE_VIEW_EMPLOYER_TTL_SECONDS);
      return kept;
    }

    const chosen = await this.rank(req, username, qualifying);
    if (!(await valkeyService.setJson(key, { orgUid: chosen.org.orgUid }, VALKEY_CACHE.ORG_EMPLOYEE_VIEW_EMPLOYER_TTL_SECONDS))) throw this.pinUnavailable();
    return chosen;
  }

  private pinUnavailable(): MicroserviceError {
    return new MicroserviceError('Unable to record the employer for the all employee view right now', 503, 'ROLE_GRANTS_UNAVAILABLE', {
      operation: OPERATION,
      service: 'org_employee_view_service',
    });
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

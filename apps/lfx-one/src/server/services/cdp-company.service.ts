// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  CDP_COMPANY_ERROR_CODES,
  CDP_COMPANY_ID_PATTERN,
  CDP_COMPANY_SECTION_KEYS,
  CDP_COMPANY_STAFF_SECTION_KEYS,
  NATS_CONFIG,
  ORG_ACCOUNT_ID_PATTERN,
  VALKEY_CACHE,
} from '@lfx-one/shared/constants';
import { orgUrlSegment } from '@lfx-one/shared/utils';

import type {
  AccessCheckRequest,
  B2bOrgIndexedDoc,
  CdpAudienceAnswer,
  CdpCompanyAddressableRow,
  CdpCompanyCachedProfile,
  CdpCompanyCachedProjectRow,
  CdpCompanyErrorCode,
  CdpCompanyEventsRow,
  CdpCompanyGroupsRow,
  CdpCompanyMeetingsRow,
  CdpCompanyPage,
  CdpCompanyPageState,
  CdpCompanyProfileCacheEntry,
  CdpCompanyProfileRow,
  CdpCompanyProjectsRow,
  CdpCompanyRedirectRow,
  CdpCompanyResponse,
  CdpCompanySection,
  CdpCompanySectionPayload,
  CdpCompanyServiceResult,
  CdpCompanyTrainingRow,
  CdpSectionKey,
  QueryServiceResponse,
} from '@lfx-one/shared/interfaces';
import type { Request } from 'express';
import type { Bind } from 'snowflake-sdk';

import { toIsoDate } from '../helpers/date-format.helper';
import { isServerFeatureEnabled, ServerFeatureFlag } from '../helpers/server-feature-flag.helper';
import { resolveLfxOnePlatinumSchema } from '../helpers/snowflake-schema.helper';
import { AccessCheckService } from './access-check.service';
import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';
import { ProjectService } from './project.service';
import { SnowflakeService } from './snowflake.service';
import { buildCdpCompanyCacheKey, buildCdpProjectUidCacheKey, valkeyService } from './valkey.service';

/**
 * CDP company pages and sections. Every method runs behind
 * `requireCdpAudience`, so each cache entry here is read and filled only for a caller in the audience.
 *
 * The cache holds unfiltered warehouse rows per CDP id (`cdp-company:v1:<id>:<section>`), shared across callers;
 * the per-caller `project#viewer` filter on Projects and the top project runs after the cache and is never stored.
 * Each read is resolved per request, never from search results. A missing table answers 503
 * `SECTION_COULD_NOT_LOAD`, so the app degrades until the warehouse tables are built in production.
 */
export class CdpCompanyService {
  private readonly snowflakeService = SnowflakeService.getInstance();
  private readonly accessCheck = new AccessCheckService();
  private readonly microserviceProxy = new MicroserviceProxyService();
  private readonly projectService = new ProjectService();

  /** `GET /api/companies/:cdpId`: the page, a redirect, or `NOT_FOUND`. */
  public async getPage(req: Request, cdpId: string): Promise<CdpCompanyServiceResult<CdpCompanyResponse>> {
    let entry: CdpCompanyProfileCacheEntry;
    try {
      entry = await this.resolve(req, cdpId);
    } catch (error) {
      return this.couldNotLoad(req, 'get_cdp_company', error);
    }

    if (entry.kind === 'unknown') {
      return notFound();
    }
    if (entry.kind === 'redirect') {
      return this.redirect(req, entry.targetKind, entry.targetId);
    }

    const { profile } = entry;
    const state = pageState(profile);
    const topProjectName = state === 'ok' ? await this.readableTopProjectName(req, profile) : undefined;
    const page: CdpCompanyPage = {
      state,
      company: {
        cdpId,
        name: profile.name,
        ...(profile.logoUrl ? { logoUrl: profile.logoUrl } : {}),
        ...(topProjectName ? { topProjectName } : {}),
        lastActiveMonth: profile.lastActiveMonth,
      },
      // A low-activity page serves no section (`getSection` answers 404 for each), so it lists none.
      sections: state === 'ok' ? sectionStates() : [],
    };
    return { ok: true, value: page, outcome: state === 'ok' ? 'ok' : 'low_activity' };
  }

  /**
   * `GET /api/companies/:cdpId/sections/:section`. A page that is not `ok` (low activity, redirect, unknown) answers
   * 404 for every section; an off section 403 `SECTION_OFF_BY_DESIGN`; Meetings and Groups 403
   * `SECTION_NO_ACCESS` to anyone the gate batch did not answer `lf-staff` for.
   */
  public async getSection(
    req: Request,
    audience: CdpAudienceAnswer,
    cdpId: string,
    section: CdpSectionKey
  ): Promise<CdpCompanyServiceResult<CdpCompanySectionPayload>> {
    let entry: CdpCompanyProfileCacheEntry;
    try {
      entry = await this.resolve(req, cdpId);
    } catch (error) {
      return this.couldNotLoad(req, 'get_cdp_company_section', error);
    }
    if (entry.kind !== 'profile' || pageState(entry.profile) !== 'ok') {
      return notFound();
    }

    if (isStaffSection(section)) {
      if (!isServerFeatureEnabled(ServerFeatureFlag.OrgLensCdpMeetingsGroups)) {
        return refused(403, CDP_COMPANY_ERROR_CODES.SECTION_OFF_BY_DESIGN, 'off_by_design');
      }
      if (!audience.lfStaff) {
        return refused(403, CDP_COMPANY_ERROR_CODES.SECTION_NO_ACCESS, 'no_access');
      }
    }

    try {
      return await this.readSection(req, cdpId, entry.profile, section);
    } catch (error) {
      return this.couldNotLoad(req, 'get_cdp_company_section', error);
    }
  }

  /**
   * Which of the given CDP ids are addressable CDP companies: one bound read of
   * `CDP_COMPANY_PROFILE`, at most one page of ids. The caller checks the CDP audience first; errors propagate.
   */
  public async filterAddressableCdpIds(cdpIds: readonly string[]): Promise<string[]> {
    if (cdpIds.length === 0) return [];
    const table = this.table('CDP_COMPANY_PROFILE');
    const placeholders = cdpIds.map(() => '?').join(', ');
    const result = await this.snowflakeService.execute<CdpCompanyAddressableRow>(
      `SELECT cdp_id FROM ${table} WHERE is_addressable AND cdp_id IN (${placeholders})`,
      [...cdpIds],
      { expectMissingObject: 'CDP_COMPANY_PROFILE' }
    );
    const addressable = new Set(result.rows.map((row) => row.CDP_ID?.trim().toLowerCase()).filter((id): id is string => !!id));
    return cdpIds.filter((id) => addressable.has(id));
  }

  private async readSection(
    req: Request,
    cdpId: string,
    profile: CdpCompanyCachedProfile,
    section: CdpSectionKey
  ): Promise<CdpCompanyServiceResult<CdpCompanySectionPayload>> {
    switch (section) {
      case 'dashboard': {
        const topProjectName = await this.readableTopProjectName(req, profile);
        return okSection({
          contributors730d: profile.contributors730d ?? 0,
          activities730d: profile.activities730d ?? 0,
          lastActiveMonth: profile.lastActiveMonth,
          ...(topProjectName ? { topProjectName } : {}),
        });
      }
      case 'profile': {
        const topProjectName = await this.readableTopProjectName(req, profile);
        return okSection({
          name: profile.name,
          ...(profile.logoUrl ? { logoUrl: profile.logoUrl } : {}),
          ...(topProjectName ? { topProjectName } : {}),
          lastActiveMonth: profile.lastActiveMonth,
        });
      }
      case 'projects':
        return this.readProjects(req, cdpId);
      case 'events': {
        const rows = await this.cachedRows<CdpCompanyEventsRow>(
          cdpId,
          'events',
          'CDP_COMPANY_EVENTS',
          'event_name, event_date, attendees',
          'ORDER BY event_date DESC NULLS LAST, event_name'
        );
        return okSection({
          rows: rows.map((row) => ({ eventName: row.EVENT_NAME?.trim() ?? '', eventDate: toIsoDate(row.EVENT_DATE), attendees: Number(row.ATTENDEES ?? 0) })),
        });
      }
      case 'training': {
        const [row] = await this.cachedRows<CdpCompanyTrainingRow>(cdpId, 'training', 'CDP_COMPANY_TRAINING', 'enrollments, certifications', 'LIMIT 1');
        return okSection({
          ...(row?.ENROLLMENTS != null ? { enrollments: Number(row.ENROLLMENTS) } : {}),
          ...(row?.CERTIFICATIONS != null ? { certifications: Number(row.CERTIFICATIONS) } : {}),
        });
      }
      case 'meetings': {
        const rows = await this.cachedRows<CdpCompanyMeetingsRow>(
          cdpId,
          'meetings',
          'CDP_COMPANY_MEETINGS',
          'project_name, meeting_type, attendance',
          'ORDER BY attendance DESC, project_name, meeting_type'
        );
        return okSection({
          rows: rows.map((row) => ({
            projectName: row.PROJECT_NAME?.trim() ?? '',
            meetingType: row.MEETING_TYPE?.trim() ?? '',
            attendance: Number(row.ATTENDANCE ?? 0),
          })),
        });
      }
      case 'groups': {
        const rows = await this.cachedRows<CdpCompanyGroupsRow>(
          cdpId,
          'groups',
          'CDP_COMPANY_GROUPS',
          'committee_name, project_name, active_seats',
          'ORDER BY active_seats DESC, committee_name, project_name'
        );
        return okSection({
          rows: rows.map((row) => ({
            committeeName: row.COMMITTEE_NAME?.trim() ?? '',
            projectName: row.PROJECT_NAME?.trim() ?? '',
            activeSeats: Number(row.ACTIVE_SEATS ?? 0),
          })),
        });
      }
      default:
        return notFound();
    }
  }

  /**
   * Projects rows for LF projects the caller passes `project#viewer` on, checked in one strict batch per request
   * after the shared cache. An authorizer failure answers 503 `SECTION_COULD_NOT_VERIFY`.
   */
  private async readProjects(req: Request, cdpId: string): Promise<CdpCompanyServiceResult<CdpCompanySectionPayload>> {
    const rows = await valkeyService.withCache<CdpCompanyCachedProjectRow[]>(
      buildCdpCompanyCacheKey(cdpId, 'projects'),
      VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
      async () => {
        const raw = await this.readTable<CdpCompanyProjectsRow>(
          'CDP_COMPANY_PROJECTS',
          'project_slug, project_name, contributors, activities',
          cdpId,
          'ORDER BY contributors DESC, activities DESC, project_name'
        );
        return raw.flatMap((row) =>
          row.PROJECT_SLUG
            ? [
                {
                  projectSlug: row.PROJECT_SLUG,
                  projectName: row.PROJECT_NAME?.trim() || row.PROJECT_SLUG,
                  contributors: Number(row.CONTRIBUTORS ?? 0),
                  activities: Number(row.ACTIVITIES ?? 0),
                },
              ]
            : []
        );
      },
      (value) => Array.isArray(value)
    );

    let viewable: Set<string>;
    try {
      viewable = await this.viewableProjectSlugs(req, [...new Set(rows.map((row) => row.projectSlug))]);
    } catch (error) {
      logger.warning(req, 'get_cdp_company_section', 'Project viewer check failed; CDP Projects cannot be verified', { err: error });
      return refused(503, CDP_COMPANY_ERROR_CODES.SECTION_COULD_NOT_VERIFY, 'could_not_verify');
    }

    return okSection({
      rows: rows.filter((row) => viewable.has(row.projectSlug)).map(({ projectName, contributors, activities }) => ({ projectName, contributors, activities })),
    });
  }

  /**
   * The top project's name when the caller passes `project#viewer` on it. Fails closed: a failed check
   * omits the top project rather than failing the page, so nothing is shown that was not verified.
   */
  private async readableTopProjectName(req: Request, profile: CdpCompanyCachedProfile): Promise<string | undefined> {
    if (!profile.topProjectSlug || !profile.topProjectName) return undefined;
    try {
      const viewable = await this.viewableProjectSlugs(req, [profile.topProjectSlug]);
      return viewable.has(profile.topProjectSlug) ? profile.topProjectName : undefined;
    } catch (error) {
      logger.warning(req, 'get_cdp_company', 'Top project viewer check failed; top project omitted', { err: error });
      return undefined;
    }
  }

  /**
   * Slugs → v2 uids (cached per slug; unknown slugs dropped), then one strict `project#viewer` batch. Throws on any lookup failure.
   * Resolved `NATS_CONFIG.LOOKUP_BATCH_CONCURRENCY` slugs at a time, so a company active in many projects never bursts one
   * NATS round trip per project at once.
   */
  private async viewableProjectSlugs(req: Request, slugs: readonly string[]): Promise<Set<string>> {
    if (slugs.length === 0) return new Set();
    const resolved: { slug: string; uid: string | null }[] = [];
    for (let start = 0; start < slugs.length; start += NATS_CONFIG.LOOKUP_BATCH_CONCURRENCY) {
      const batch = slugs.slice(start, start + NATS_CONFIG.LOOKUP_BATCH_CONCURRENCY);
      resolved.push(...(await Promise.all(batch.map(async (slug) => ({ slug, uid: await this.projectUid(req, slug) })))));
    }
    const known = resolved.filter((entry): entry is { slug: string; uid: string } => !!entry.uid);
    if (known.length === 0) return new Set();

    const access = await this.accessCheck.checkAccessStrict(
      req,
      known.map(({ uid }): AccessCheckRequest => ({ resource: 'project', id: uid, access: 'viewer' }))
    );
    return new Set(known.filter(({ uid }) => access.get(`${uid}#viewer`) === true).map(({ slug }) => slug));
  }

  /** A project slug's v2 uid, or null when no such project exists. Only found uids are cached; an outage throws. */
  private async projectUid(req: Request, slug: string): Promise<string | null> {
    const { uid } = await valkeyService.withCache(
      buildCdpProjectUidCacheKey(slug),
      VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
      async () => {
        const project = await this.projectService.getProjectIdBySlug(req, slug, { unavailableAsMissing: false });
        return { uid: project.exists && project.uid ? project.uid : null };
      },
      (value) => typeof value === 'object' && value !== null && 'uid' in value && typeof value.uid === 'string',
      (value) => value.uid !== null
    );
    return uid;
  }

  /**
   * The caller-independent answer for one CDP id: an addressable company's profile, else its redirect, else unknown.
   * Cached per id (warehouse rows only; a B2B target's readability is checked per caller, never cached).
   */
  private resolve(req: Request, cdpId: string): Promise<CdpCompanyProfileCacheEntry> {
    return valkeyService.withCache<CdpCompanyProfileCacheEntry>(
      buildCdpCompanyCacheKey(cdpId, 'profile'),
      VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
      async () => {
        const [row] = await this.readTable<CdpCompanyProfileRow>(
          'CDP_COMPANY_PROFILE',
          'name, logo_url, top_project_slug, top_project_name, last_active_month, is_searchable, is_addressable, has_activity_730d, contributors_730d, activities_730d',
          cdpId,
          'LIMIT 1'
        );
        if (row && row.IS_ADDRESSABLE === true) {
          return { kind: 'profile', profile: toCachedProfile(row) };
        }

        const redirects = await this.readTable<CdpCompanyRedirectRow>('CDP_COMPANY_REDIRECTS', 'target_kind, target_id', cdpId, 'LIMIT 2', 'old_cdp_id');
        const [redirect] = redirects;
        const kind = redirect?.TARGET_KIND?.trim().toLowerCase();
        const targetId = redirect?.TARGET_ID?.trim();
        // One target per old id; anything else is treated as no redirect.
        if (redirects.length === 1 && targetId && (kind === 'cdp' || kind === 'b2b')) {
          logger.debug(req, 'get_cdp_company', 'CDP id resolves to a redirect', { target_kind: kind });
          return { kind: 'redirect', targetKind: kind, targetId };
        }
        return { kind: 'unknown' };
      },
      isProfileCacheEntry,
      // An unknown id is never stored: otherwise any audience session could fill the cache with one entry per random id.
      (entry) => entry.kind !== 'unknown'
    );
  }

  /**
   * One step to the final target. A CDP target is answered as is (the warehouse guarantees it is
   * addressable); a B2B target is read from the Company Lens index with the caller's own token — never a service
   * token or a cache (ADR-0039) — and an unreadable or missing one is "No company at this address". A readable B2B
   * target is answered by its SFID, never its slug: slugs are not unique, and the path guard trusts a slug that matches
   * the current selection without resolving it, so a shared slug could open another company. The guard canonicalizes
   * the SFID address once it adopts the target.
   */
  private async redirect(req: Request, targetKind: 'cdp' | 'b2b', targetId: string): Promise<CdpCompanyServiceResult<CdpCompanyResponse>> {
    if (targetKind === 'cdp') {
      const target = targetId.toLowerCase();
      return CDP_COMPANY_ID_PATTERN.test(target) ? { ok: true, value: { redirect: { kind: 'cdp', target } }, outcome: 'redirect' } : notFound();
    }

    if (!ORG_ACCOUNT_ID_PATTERN.test(targetId)) return notFound();
    let doc: B2bOrgIndexedDoc | null = null;
    try {
      const response = await this.microserviceProxy.proxyRequest<QueryServiceResponse<B2bOrgIndexedDoc>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
        type: 'b2b_org',
        tags: [`b2b_org_uid:${targetId}`],
        // query-service's Goa parameter is `page_size`; `per_page` is silently ignored upstream.
        page_size: 1,
      });
      doc = response?.resources?.find((resource) => resource.id?.endsWith(`:${targetId}`) || resource.id === targetId)?.data ?? null;
    } catch (error) {
      return this.couldNotLoad(req, 'get_cdp_company', error);
    }

    const segment = doc ? orgUrlSegment({ uid: targetId }) : null;
    return segment ? { ok: true, value: { redirect: { kind: 'b2b', target: segment } }, outcome: 'redirect' } : notFound();
  }

  /** Cached unfiltered rows of one section table for one CDP id. */
  private cachedRows<T>(cdpId: string, subResource: string, table: string, columns: string, tail: string): Promise<T[]> {
    return valkeyService.withCache<T[]>(
      buildCdpCompanyCacheKey(cdpId, subResource),
      VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
      () => this.readTable<T>(table, columns, cdpId, tail),
      (value) => Array.isArray(value)
    );
  }

  /** One bound read of a served CDP table: only the contract's columns, keyed by the CDP id. */
  private async readTable<T>(table: string, columns: string, cdpId: string, tail: string, keyColumn = 'cdp_id'): Promise<T[]> {
    const sql = `SELECT ${columns} FROM ${this.table(table)} WHERE ${keyColumn} = ? ${tail}`;
    const binds: Bind[] = [cdpId];
    const result = await this.snowflakeService.execute<T>(sql, binds, { expectMissingObject: table });
    return result.rows;
  }

  private table(name: string): string {
    return `${resolveLfxOnePlatinumSchema()}.${name}`;
  }

  /** A warehouse or index read failed (a table not built yet included): 503 `SECTION_COULD_NOT_LOAD`. */
  private couldNotLoad<T>(req: Request, operation: string, error: unknown): CdpCompanyServiceResult<T> {
    logger.warning(req, operation, 'CDP company read failed', {
      err: error,
      missing_table: SnowflakeService.isMissingObjectError(error),
    });
    return refused(503, CDP_COMPANY_ERROR_CODES.SECTION_COULD_NOT_LOAD, 'could_not_load');
  }
}

/**
 * `ok` for a searchable company; otherwise the low-activity variant the warehouse decides: counted activity in the
 * last 730 days below the search rule is "not enough activity", none is "no activity". Never derived
 * from the last active month.
 */
function pageState(profile: CdpCompanyCachedProfile): CdpCompanyPageState {
  if (profile.isSearchable) return 'ok';
  return profile.hasActivity730d ? 'not-enough-activity' : 'no-activity';
}

/** Section states the server decides and the page carries: Meetings and Groups follow their flag. */
function sectionStates(): CdpCompanySection[] {
  const staffSectionsOn = isServerFeatureEnabled(ServerFeatureFlag.OrgLensCdpMeetingsGroups);
  return CDP_COMPANY_SECTION_KEYS.map((key) => ({
    key,
    // Meetings and Groups follow their flag; every other section is always on.
    state: !isStaffSection(key) || staffSectionsOn ? 'on' : 'off-by-design',
  }));
}

function isStaffSection(section: CdpSectionKey): boolean {
  return (CDP_COMPANY_STAFF_SECTION_KEYS as readonly CdpSectionKey[]).includes(section);
}

function toCachedProfile(row: CdpCompanyProfileRow): CdpCompanyCachedProfile {
  const isSearchable = row.IS_SEARCHABLE === true;
  return {
    name: row.NAME?.trim() ?? '',
    logoUrl: row.LOGO_URL || null,
    topProjectSlug: row.TOP_PROJECT_SLUG || null,
    topProjectName: row.TOP_PROJECT_NAME?.trim() || null,
    lastActiveMonth: toIsoDate(row.LAST_ACTIVE_MONTH)?.slice(0, 7) ?? null,
    isSearchable,
    hasActivity730d: row.HAS_ACTIVITY_730D === true,
    // Counts exist only for searchable companies, and are never served for any other.
    contributors730d: isSearchable && row.CONTRIBUTORS_730D != null ? Number(row.CONTRIBUTORS_730D) : null,
    activities730d: isSearchable && row.ACTIVITIES_730D != null ? Number(row.ACTIVITIES_730D) : null,
  };
}

function okSection(value: CdpCompanySectionPayload): CdpCompanyServiceResult<CdpCompanySectionPayload> {
  return { ok: true, value, outcome: 'ok' };
}

function notFound<T>(): CdpCompanyServiceResult<T> {
  return refused(404, CDP_COMPANY_ERROR_CODES.NOT_FOUND, 'not_found');
}

function refused<T>(status: 403 | 404 | 503, code: CdpCompanyErrorCode, outcome: CdpCompanyServiceResult<T>['outcome']): CdpCompanyServiceResult<T> {
  return { ok: false, status, code, outcome };
}

function isProfileCacheEntry(value: unknown): boolean {
  const entry = value as Partial<CdpCompanyProfileCacheEntry> | null;
  if (!entry || typeof entry !== 'object') return false;
  if (entry.kind === 'unknown') return true;
  if (entry.kind === 'redirect') {
    const redirect = entry as Extract<CdpCompanyProfileCacheEntry, { kind: 'redirect' }>;
    return (redirect.targetKind === 'cdp' || redirect.targetKind === 'b2b') && typeof redirect.targetId === 'string';
  }
  if (entry.kind === 'profile') {
    const profile = (entry as Extract<CdpCompanyProfileCacheEntry, { kind: 'profile' }>).profile;
    return !!profile && typeof profile.name === 'string' && typeof profile.isSearchable === 'boolean';
  }
  return false;
}

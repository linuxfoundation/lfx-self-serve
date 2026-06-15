// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { EMPTY_ORG_ALL_EMPLOYEES_RESPONSE } from '@lfx-one/shared/constants';
import { isBoardCategory } from '@lfx-one/shared/constants';
import type {
  CommitteeServiceOrgSeat,
  KeyContactEmployee,
  OrgAccessUser,
  OrgAllEmployeeRow,
  OrgAllEmployeeStats,
  OrgAllEmployeesResponse,
  OrgPersonSource,
} from '@lfx-one/shared/interfaces';
import { splitDisplayName } from '@lfx-one/shared/utils';
import { Request } from 'express';

import { getEffectiveUsername } from '../utils/auth-helper';
import { logger } from './logger.service';
import { OrgLensAccessService } from './org-lens-access.service';
import { OrgLensBoardCommitteeService } from './org-lens-board-committee.service';
import { OrgLensKeyContactsService } from './org-lens-key-contacts.service';
import { OrgLensPeopleService } from './org-lens-people.service';

/** TTL for the merged directory cache. The merge fans out to 4 upstreams (Snowflake + committee + query-service + member-service), so a short window collapses the burst of calls a tab + its pickers make on open without serving stale rosters. */
const DIRECTORY_CACHE_TTL_MS = 30_000;

/** Hard cap on cache entries so the singleton can't grow unbounded across every (org x caller) pair over the server's lifetime; oldest-first eviction mirrors OrgMembershipResolverService. */
const DIRECTORY_CACHE_MAX_ENTRIES = 2_000;

interface DirectoryCacheEntry {
  at: number;
  value: OrgAllEmployeesResponse;
}

/**
 * Unified people directory for the Org Lens People page (`?live` path).
 *
 * Merges the stored Snowflake roster (`ORG_PEOPLE_ALL`, the source of activity counts) with three
 * LIVE sources — committee/board seats, key contacts, and the org's writers/auditors — deduped by
 * lowercased email so a person who was added since the last dbt build still appears. The response
 * keeps the exact `OrgAllEmployeesResponse` shape; live-only people surface with zero activity
 * counts and a `sources` provenance array. Each source is fetched with `Promise.allSettled` so a
 * single upstream outage degrades the roster gracefully rather than failing the whole tab.
 */
export class OrgPeopleDirectoryService {
  private readonly peopleService: OrgLensPeopleService;
  private readonly boardCommitteeService: OrgLensBoardCommitteeService;
  private readonly keyContactsService: OrgLensKeyContactsService;
  private readonly accessService: OrgLensAccessService;

  // Per-org short-TTL cache for the merged result. In-memory + small, mirroring OrgMembershipResolverService.
  private readonly cache = new Map<string, DirectoryCacheEntry>();

  public constructor() {
    this.peopleService = new OrgLensPeopleService();
    this.boardCommitteeService = new OrgLensBoardCommitteeService();
    this.keyContactsService = new OrgLensKeyContactsService();
    this.accessService = new OrgLensAccessService();
  }

  /** Merged stored + live roster for the account. Cached for a short window keyed by account + caller. */
  public async getLive(req: Request, accountId: string): Promise<OrgAllEmployeesResponse> {
    // Key by caller too: the merge folds in request-scoped reads (committee seats via the caller's token,
    // FGA-filtered key contacts, the caller's access view), so a plain accountId key could replay one
    // caller's permission-filtered roster to a different caller within the TTL.
    const cacheKey = this.cacheKey(req, accountId);
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.at < DIRECTORY_CACHE_TTL_MS) {
      return cached.value;
    }

    // `fetchAllOrgSeats` is the full cross-foundation seat drain — heavier than the picker's bounded read —
    // because this roster also backs the All Employees tab, which needs the complete set. The short TTL above
    // plus the caller-side `shareReplay` collapse the burst so the drain runs at most once per org per window
    // (shared by the tab and every picker), not per keystroke.
    const [snowflake, seats, keyContacts, access] = await Promise.allSettled([
      this.peopleService.getAllEmployees(accountId),
      this.boardCommitteeService.fetchAllOrgSeats(req, accountId),
      this.keyContactsService.getEmployees(req, accountId),
      this.accessService.getAccessPrincipals(req, accountId),
    ]);

    const base = snowflake.status === 'fulfilled' ? snowflake.value : { ...EMPTY_ORG_ALL_EMPLOYEES_RESPONSE, accountId };
    if (snowflake.status === 'rejected') {
      logger.warning(req, 'get_org_people_directory', 'Snowflake roster failed; serving live sources only', {
        org_uid: accountId,
        err: snowflake.reason,
      });
    }

    const merged = this.merge(req, accountId, base, seats, keyContacts, access);
    if (!this.cache.has(cacheKey) && this.cache.size >= DIRECTORY_CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next();
      if (!oldest.done) this.cache.delete(oldest.value);
    }
    this.cache.set(cacheKey, { at: Date.now(), value: merged });
    return merged;
  }

  /** Cache key scoped to the org and the caller identity so permission-filtered reads aren't shared across callers. */
  private cacheKey(req: Request, accountId: string): string {
    return `${accountId}:${getEffectiveUsername(req) ?? 'anonymous'}`;
  }

  /** Seed the snowflake rows by lowercased email (no-email rows pass through), then fold each live source in. */
  private merge(
    req: Request,
    accountId: string,
    base: OrgAllEmployeesResponse,
    seats: PromiseSettledResult<CommitteeServiceOrgSeat[]>,
    keyContacts: PromiseSettledResult<KeyContactEmployee[]>,
    access: PromiseSettledResult<OrgAccessUser[]>
  ): OrgAllEmployeesResponse {
    const byEmail = new Map<string, OrgAllEmployeeRow>();
    const noEmailRows: OrgAllEmployeeRow[] = [];

    for (const row of base.rows) {
      const email = (row.email ?? '').trim().toLowerCase();
      if (email) {
        // Clone so we can mutate sources/enrichment without aliasing the snowflake service's array.
        byEmail.set(email, { ...row, sources: [...row.sources] });
      } else {
        noEmailRows.push(row);
      }
    }

    if (seats.status === 'fulfilled') {
      for (const seat of seats.value) {
        const email = (seat.email ?? '').trim().toLowerCase();
        if (!email) continue;
        const source: OrgPersonSource = isBoardCategory(seat.committee_category) ? 'board' : 'committee';
        const existing = byEmail.get(email);
        if (existing) {
          this.addSource(existing, source);
          this.fill(existing, {
            firstName: (seat.first_name ?? '').trim() || null,
            lastName: (seat.last_name ?? '').trim() || null,
            title: seat.job_title?.trim() || null,
          });
        } else {
          byEmail.set(email, this.rowFromSeat(seat, email, source));
        }
      }
    } else {
      this.logSourceFailure(req, accountId, 'committee seats', seats.reason);
    }

    if (keyContacts.status === 'fulfilled') {
      for (const emp of keyContacts.value) {
        const email = (emp.email ?? '').trim().toLowerCase();
        if (!email) continue;
        const existing = byEmail.get(email);
        if (existing) {
          this.addSource(existing, 'keyContact');
          this.fill(existing, { firstName: emp.firstName || null, lastName: emp.lastName || null, title: emp.jobTitle, avatarUrl: emp.avatarUrl ?? null });
        } else {
          byEmail.set(email, this.rowFromKeyContact(emp, email));
        }
      }
    } else {
      this.logSourceFailure(req, accountId, 'key contacts', keyContacts.reason);
    }

    if (access.status === 'fulfilled') {
      for (const user of access.value) {
        const email = (user.email ?? '').trim().toLowerCase();
        if (!email) continue;
        const existing = byEmail.get(email);
        if (existing) {
          this.addSource(existing, 'access');
          const [firstName, lastName] = splitDisplayName(user.name);
          this.fill(existing, { firstName, lastName, title: user.jobTitle, avatarUrl: user.avatarUrl });
        } else {
          byEmail.set(email, this.rowFromAccess(user, email));
        }
      }
    } else {
      this.logSourceFailure(req, accountId, 'access principals', access.reason);
    }

    const rows = [...byEmail.values(), ...noEmailRows].sort((a, b) => a.name.localeCompare(b.name));
    return {
      accountId,
      rows,
      stats: computeStats(rows),
      // Foundation options stay sourced from Snowflake (authoritative id↔name pairs). Live-only people
      // carry no engagedFoundationIds, so they are not foundation-filterable until the next dbt build.
      foundations: base.foundations,
    };
  }

  private addSource(row: OrgAllEmployeeRow, source: OrgPersonSource): void {
    if (!row.sources.includes(source)) {
      row.sources.push(source);
    }
  }

  /** Fill only the fields a stored row is missing — never overwrite richer Snowflake data with a live blank. */
  private fill(row: OrgAllEmployeeRow, patch: { firstName?: string | null; lastName?: string | null; title?: string | null; avatarUrl?: string | null }): void {
    if (!row.firstName && patch.firstName) row.firstName = patch.firstName;
    if (!row.lastName && patch.lastName) row.lastName = patch.lastName;
    if (!row.title && patch.title) row.title = patch.title;
    if (!row.avatarUrl && patch.avatarUrl) row.avatarUrl = patch.avatarUrl;
  }

  private rowFromSeat(seat: CommitteeServiceOrgSeat, email: string, source: OrgPersonSource): OrgAllEmployeeRow {
    const firstName = (seat.first_name ?? '').trim() || null;
    const lastName = (seat.last_name ?? '').trim() || null;
    return this.liveRow(email, firstName, lastName, seat.job_title?.trim() || null, null, source);
  }

  private rowFromKeyContact(emp: KeyContactEmployee, email: string): OrgAllEmployeeRow {
    return this.liveRow(email, emp.firstName || null, emp.lastName || null, emp.jobTitle, emp.avatarUrl ?? null, 'keyContact');
  }

  private rowFromAccess(user: OrgAccessUser, email: string): OrgAllEmployeeRow {
    const [firstName, lastName] = splitDisplayName(user.name);
    return this.liveRow(email, firstName, lastName, user.jobTitle, user.avatarUrl, 'access');
  }

  /** Build a live-only row (no stored activity). personKey is a pattern-safe token so a detail expand returns an empty (200) payload rather than a 400. */
  private liveRow(
    email: string,
    firstName: string | null,
    lastName: string | null,
    title: string | null,
    avatarUrl: string | null,
    source: OrgPersonSource
  ): OrgAllEmployeeRow {
    const name = [firstName, lastName].filter(Boolean).join(' ').trim() || email;
    return {
      personKey: `live-${Buffer.from(email).toString('base64url')}`,
      lfid: null,
      cdpMemberId: null,
      name,
      firstName,
      lastName,
      title,
      email,
      avatarUrl,
      sources: [source],
      seatsCount: 0,
      boardSeatsCount: 0,
      committeeSeatsCount: 0,
      commitsCount: 0,
      eventsCount: 0,
      coursesCount: 0,
      engagedFoundationIds: [],
    };
  }

  private logSourceFailure(req: Request, accountId: string, source: string, reason: unknown): void {
    logger.info(req, 'get_org_people_directory', `${source} source failed; omitting from merge`, {
      org_uid: accountId,
      err: reason,
    });
  }
}

/**
 * Recompute the 5 stat cards over the merged rows so the headline matches the visible table.
 * `activeInOss` counts only people with at least one engagement signal (governance / code / event /
 * training) — matching the stored model's Definition-2 meaning — so access-only rows merged in for the
 * roster don't inflate the "Employees Active in Open Source" headline. Governance counts a seat count OR
 * a live board/committee provenance (live-only seats carry zero seatsCount).
 */
function computeStats(rows: OrgAllEmployeeRow[]): OrgAllEmployeeStats {
  let activeInOss = 0;
  let inGovernance = 0;
  let codeContributors = 0;
  let eventAttendees = 0;
  let trainees = 0;
  for (const row of rows) {
    const inGov = row.seatsCount > 0 || row.sources.includes('board') || row.sources.includes('committee');
    const hasCode = row.commitsCount > 0;
    const hasEvents = row.eventsCount > 0;
    const hasTraining = row.coursesCount > 0;
    if (inGov) inGovernance++;
    if (hasCode) codeContributors++;
    if (hasEvents) eventAttendees++;
    if (hasTraining) trainees++;
    if (inGov || hasCode || hasEvents || hasTraining) activeInOss++;
  }
  return { activeInOss, inGovernance, codeContributors, eventAttendees, trainees };
}

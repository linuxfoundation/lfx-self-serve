// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { EMPTY_ORG_ALL_EMPLOYEES_RESPONSE, VALKEY_CACHE } from '@lfx-one/shared/constants';
import { isBoardCategory } from '@lfx-one/shared/constants';
import type {
  CommitteeServiceOrgSeat,
  KeyContactEmployee,
  OrgAccessUser,
  OrgAllEmployeeFoundationOption,
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
import { withPerUserCache } from './valkey.service';

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((el) => typeof el === 'string');
}

/**
 * Every row must match the wire shape: the cached value is replayed straight to the client, so a
 * corrupt element would otherwise crash on `sources` spreading or `name.localeCompare`.
 *
 * `lfUsername` and `emails` are required so an entry written by a pre-merge-key deployment is
 * rejected as a miss and recomputed, rather than replayed into a renderer that expects them.
 */
function isAllEmployeeRow(value: unknown): boolean {
  const r = value as Partial<OrgAllEmployeeRow>;
  return (
    isObject(value) &&
    typeof r.personKey === 'string' &&
    typeof r.name === 'string' &&
    (r.email === null || typeof r.email === 'string') &&
    (r.lfUsername === null || typeof r.lfUsername === 'string') &&
    isStringArray(r.emails) &&
    isStringArray(r.sources) &&
    isStringArray(r.engagedFoundationIds) &&
    typeof r.seatsCount === 'number' &&
    typeof r.boardSeatsCount === 'number' &&
    typeof r.committeeSeatsCount === 'number' &&
    typeof r.commitsCount === 'number' &&
    typeof r.eventsCount === 'number' &&
    typeof r.coursesCount === 'number'
  );
}

/**
 * Identity of a source record for merge purposes (DR-001).
 *
 * A person holds ONE LF username but MANY email addresses, so the address is not an identifier —
 * keying on it is what splits one human across several rows. Prefer the verified username; fall
 * back to the address only when no username is available (key contacts, pending invites, the ~24%
 * of seats platform-wide whose username has not been resolved upstream).
 *
 * The two kinds never match each other. That keeps the merge single-pass and order-independent (no
 * transitive closure), and it means a record without a verified identity behaves exactly as it does
 * today — no regression, and no guessing.
 *
 * NOT permitted as an input: the Snowflake email→member_id crosswalk. It is many-to-many and
 * carries false links (`dqualls@linuxfoundation.org` resolves to a different person's member
 * record), so using it would attribute one named individual's data to another.
 */
export function resolveMergeKey(record: { lfUsername?: string | null; email?: string | null }): string | null {
  const username = (record.lfUsername ?? '').trim().toLowerCase();
  if (username) return `identity:${username}`;
  const email = (record.email ?? '').trim().toLowerCase();
  return email ? `email:${email}` : null;
}

function isFoundationOption(value: unknown): boolean {
  const f = value as Partial<OrgAllEmployeeFoundationOption>;
  return isObject(value) && typeof f.foundationId === 'string' && typeof f.foundationName === 'string';
}

function isAllEmployeeStats(value: unknown): boolean {
  const s = value as Partial<OrgAllEmployeeStats>;
  return (
    isObject(value) &&
    typeof s.activeInOss === 'number' &&
    typeof s.inGovernance === 'number' &&
    typeof s.codeContributors === 'number' &&
    typeof s.eventAttendees === 'number' &&
    typeof s.trainees === 'number'
  );
}

/** Rejects a corrupt/legacy merged-roster entry (degrades to a miss) by validating every row, foundation, and stat field against the wire contract. */
function isAllEmployeesResponse(value: unknown): boolean {
  const v = value as Partial<OrgAllEmployeesResponse>;
  return (
    isObject(value) &&
    typeof v.accountId === 'string' &&
    Array.isArray(v.rows) &&
    v.rows.every(isAllEmployeeRow) &&
    Array.isArray(v.foundations) &&
    v.foundations.every(isFoundationOption) &&
    isAllEmployeeStats(v.stats)
  );
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

  public constructor() {
    this.peopleService = new OrgLensPeopleService();
    this.boardCommitteeService = new OrgLensBoardCommitteeService();
    this.keyContactsService = new OrgLensKeyContactsService();
    this.accessService = new OrgLensAccessService();
  }

  /** Merged stored + live roster, served through the per-caller shared cache: the merge folds in request-scoped permission-filtered reads (committee seats, FGA-filtered key contacts, the caller's access view), so keying by caller + org stops one caller's roster from being replayed to another within the TTL. */
  public async getLive(req: Request, accountId: string): Promise<OrgAllEmployeesResponse> {
    const username = getEffectiveUsername(req) ?? '';
    return withPerUserCache(
      VALKEY_CACHE.ORG_PEOPLE_DIRECTORY_NAMESPACE,
      username,
      accountId,
      VALKEY_CACHE.ORG_LENS_PERUSER_TTL_SECONDS,
      () => this.computeLive(req, accountId),
      isAllEmployeesResponse
    );
  }

  private async computeLive(req: Request, accountId: string): Promise<OrgAllEmployeesResponse> {
    // `fetchAllOrgSeats` is the full cross-foundation seat drain — heavier than the picker's bounded read —
    // because this roster also backs the All Employees tab, which needs the complete set. Each source is
    // fetched with `Promise.allSettled` so a single upstream outage degrades the roster gracefully.
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

    return this.merge(req, accountId, base, seats, keyContacts, access);
  }

  /** Seed the snowflake rows by merge key (unkeyable rows pass through), then fold each live source in. */
  private merge(
    req: Request,
    accountId: string,
    base: OrgAllEmployeesResponse,
    seats: PromiseSettledResult<CommitteeServiceOrgSeat[]>,
    keyContacts: PromiseSettledResult<KeyContactEmployee[]>,
    access: PromiseSettledResult<OrgAccessUser[]>
  ): OrgAllEmployeesResponse {
    const byKey = new Map<string, OrgAllEmployeeRow>();
    const unkeyedRows: OrgAllEmployeeRow[] = [];

    for (const row of base.rows) {
      const key = resolveMergeKey(row);
      if (key) {
        // Clone so we can mutate sources/enrichment without aliasing the snowflake service's array.
        byKey.set(key, { ...row, sources: [...row.sources], emails: [...row.emails], mergedFrom: [key] });
      } else {
        unkeyedRows.push(row);
      }
    }

    if (seats.status === 'fulfilled') {
      for (const seat of seats.value) {
        const email = (seat.email ?? '').trim().toLowerCase();
        const key = resolveMergeKey({ lfUsername: seat.username, email });
        if (!key) continue;
        const source: OrgPersonSource = isBoardCategory(seat.committee_category) ? 'board' : 'committee';
        const existing = byKey.get(key);
        if (existing) {
          this.addSource(existing, source);
          this.addEmail(existing, email);
          this.fill(existing, {
            firstName: (seat.first_name ?? '').trim() || null,
            lastName: (seat.last_name ?? '').trim() || null,
            title: seat.job_title?.trim() || null,
          });
          // Count live seats only for live-only rows; Snowflake rows already carry authoritative seat counts, so
          // incrementing here would double-count the same seat (DR-002 — verified: a seat held under a secondary
          // address is already inside the stored count, because the roster's governance join resolves it by LFID).
          if (!existing.sources.includes('snowflake')) this.addSeat(existing, source);
        } else {
          byKey.set(key, this.rowFromSeat(seat, email, source, key));
        }
      }
    } else {
      this.logSourceFailure(req, accountId, 'committee seats', seats.reason);
    }

    if (keyContacts.status === 'fulfilled') {
      for (const emp of keyContacts.value) {
        const email = (emp.email ?? '').trim().toLowerCase();
        // Key contacts carry no verified identity, so they always match at the email rung.
        const key = resolveMergeKey({ email });
        if (!key) continue;
        const existing = byKey.get(key);
        if (existing) {
          this.addSource(existing, 'keyContact');
          this.addEmail(existing, email);
          this.fill(existing, { firstName: emp.firstName || null, lastName: emp.lastName || null, title: emp.jobTitle, avatarUrl: emp.avatarUrl ?? null });
        } else {
          byKey.set(key, this.rowFromKeyContact(emp, email, key));
        }
      }
    } else {
      this.logSourceFailure(req, accountId, 'key contacts', keyContacts.reason);
    }

    if (access.status === 'fulfilled') {
      for (const user of access.value) {
        const email = (user.email ?? '').trim().toLowerCase();
        // A pending invite has no username and so cannot merge into a verified person — correct, not a
        // limitation: until the invite is accepted there is no confirmed identity behind the address.
        const key = resolveMergeKey({ lfUsername: user.username, email });
        if (!key) continue;
        const existing = byKey.get(key);
        if (existing) {
          this.addSource(existing, 'access');
          this.addEmail(existing, email);
          const [firstName, lastName] = splitDisplayName(user.name);
          this.fill(existing, { firstName, lastName, title: user.jobTitle, avatarUrl: user.avatarUrl });
        } else {
          byKey.set(key, this.rowFromAccess(user, email, key));
        }
      }
    } else {
      this.logSourceFailure(req, accountId, 'access principals', access.reason);
    }

    const rows = [...byKey.values(), ...unkeyedRows].sort((a, b) => a.name.localeCompare(b.name));
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

  /** Record a contributing address. A merged person legitimately holds several; `email` stays the preferred display one. */
  private addEmail(row: OrgAllEmployeeRow, email: string): void {
    if (email && !row.emails.includes(email)) {
      row.emails.push(email);
    }
    if (!row.email) {
      row.email = email || null;
    }
  }

  /** Increment seat counters for a live board/committee seat so the Seats column and governance filter stay consistent with the stat cards. */
  private addSeat(row: OrgAllEmployeeRow, source: OrgPersonSource): void {
    row.seatsCount += 1;
    if (source === 'board') {
      row.boardSeatsCount += 1;
    } else if (source === 'committee') {
      row.committeeSeatsCount += 1;
    }
  }

  /** Fill only the fields a stored row is missing — never overwrite richer Snowflake data with a live blank. */
  private fill(row: OrgAllEmployeeRow, patch: { firstName?: string | null; lastName?: string | null; title?: string | null; avatarUrl?: string | null }): void {
    if (!row.firstName && patch.firstName) row.firstName = patch.firstName;
    if (!row.lastName && patch.lastName) row.lastName = patch.lastName;
    if (!row.title && patch.title) row.title = patch.title;
    if (!row.avatarUrl && patch.avatarUrl) row.avatarUrl = patch.avatarUrl;
  }

  private rowFromSeat(seat: CommitteeServiceOrgSeat, email: string, source: OrgPersonSource, key: string): OrgAllEmployeeRow {
    const firstName = (seat.first_name ?? '').trim() || null;
    const lastName = (seat.last_name ?? '').trim() || null;
    const row = this.liveRow(email, firstName, lastName, seat.job_title?.trim() || null, null, source, key, seat.username ?? null);
    // The seat that created this live-only row counts as one held seat; further seats fold in via addSeat on the existing branch.
    this.addSeat(row, source);
    return row;
  }

  private rowFromKeyContact(emp: KeyContactEmployee, email: string, key: string): OrgAllEmployeeRow {
    return this.liveRow(email, emp.firstName || null, emp.lastName || null, emp.jobTitle, emp.avatarUrl ?? null, 'keyContact', key, null);
  }

  private rowFromAccess(user: OrgAccessUser, email: string, key: string): OrgAllEmployeeRow {
    const [firstName, lastName] = splitDisplayName(user.name);
    return this.liveRow(email, firstName, lastName, user.jobTitle, user.avatarUrl, 'access', key, user.username);
  }

  /**
   * Build a live-only row (no stored activity). personKey is a pattern-safe token so a detail expand
   * returns an empty (200) payload rather than a 400. It is derived from the merge key rather than
   * the address, so a record identified only by username still gets a distinct token — deriving it
   * from an absent address would collide every such row onto the same key.
   */
  private liveRow(
    email: string,
    firstName: string | null,
    lastName: string | null,
    title: string | null,
    avatarUrl: string | null,
    source: OrgPersonSource,
    key: string,
    lfUsername: string | null
  ): OrgAllEmployeeRow {
    const username = (lfUsername ?? '').trim().toLowerCase() || null;
    const name = [firstName, lastName].filter(Boolean).join(' ').trim() || email || username || '';
    return {
      personKey: `live-${Buffer.from(key).toString('base64url')}`,
      lfid: null,
      lfUsername: username,
      cdpMemberId: null,
      name,
      firstName,
      lastName,
      title,
      email,
      emails: email ? [email] : [],
      mergedFrom: [key],
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
 * a live board/committee provenance — the provenance fallback also catches any seat that arrived without a
 * resolvable count.
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

// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DEFAULT_ORG_COMMIT_FILTERS, ORG_PEOPLE_DIRECTORY_CACHE_ROW_KEYS, VALKEY_CACHE } from '@lfx-one/shared/constants';
import { isBoardCategory } from '@lfx-one/shared/constants';
import type {
  ColumnarTable,
  CommitteeServiceOrgSeat,
  CompactOrgPeopleDirectoryEntry,
  KeyContactEmployee,
  OrgAccessBadgeState,
  OrgAccessUser,
  OrgAllEmployeeCountedRow,
  OrgAllEmployeeFoundationOption,
  OrgAllEmployeeRowInternal,
  OrgAllEmployeesCountedResponse,
  OrgAllEmployeesInternalResponse,
  OrgAllEmployeesResponse,
  OrgCommitFilters,
  OrgLensTimeRange,
  OrgPersonSource,
  OrgProjectScope,
} from '@lfx-one/shared/interfaces';
import { fromColumnar, hasExactColumns, isColumnarAbsent, isColumnarTable, splitDisplayName, toColumnar } from '@lfx-one/shared/utils';
import { createHmac } from 'crypto';
import { Request } from 'express';

import { orgPeopleDirectoryNamespace } from '../helpers/org-people-directory-cache.helper';
import { getEffectiveUsername } from '../utils/auth-helper';
import { coalescePerUserOrgFetch } from '../utils/single-flight';
import { logger } from './logger.service';
import { OrgLensAccessService } from './org-lens-access.service';
import { OrgLensBoardCommitteeService } from './org-lens-board-committee.service';
import { OrgLensKeyContactsService } from './org-lens-key-contacts.service';
import { OrgLensPeopleService } from './org-lens-people.service';
import { toStoredRow, toWireResponse } from './org-people-wire.mapper';
import { withPerUserCache } from './valkey.service';

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((el) => typeof el === 'string');
}

/**
 * A stored column holds a real string when it is a string that is not the compact encoder's
 * absence marker. This is what stops "the field was absent" from passing as "the field is a
 * string" — the check the pre-compaction guard got for free when `JSON.stringify` dropped an
 * undefined-valued key.
 */
function isStoredString(value: unknown): boolean {
  return typeof value === 'string' && !isColumnarAbsent(value);
}

/**
 * One stored cell of a cached directory row, checked for exactly the fields the pre-compaction wire
 * guard asserted: the cached value is replayed straight to the client, so a corrupt element would
 * otherwise crash on `sources` spreading or `name.localeCompare`.
 *
 * Switched on the row's own key union, so a misspelled case fails to compile instead of silently
 * leaving that column unchecked.
 */
function isValidDirectoryCell(key: keyof OrgAllEmployeeCountedRow, value: unknown): boolean {
  switch (key) {
    case 'personKey':
    case 'name':
      return isStoredString(value);
    case 'email':
    case 'lfUsername':
      return value === null || isStoredString(value);
    case 'sources':
    case 'engagedFoundationIds':
    case 'keyContactRoles':
      return isStringArray(value);
    case 'seatsCount':
    case 'boardSeatsCount':
    case 'committeeSeatsCount':
    case 'commitsCount':
    case 'mergedCommitsCount':
    case 'codeActivitiesCount':
    case 'eventsCount':
    case 'coursesCount':
      return typeof value === 'number';
    case 'isFormer':
      return value === true || isColumnarAbsent(value);
    default:
      return true;
  }
}

/**
 * Validates the stored rows positionally, without rebuilding the row objects the decoder is about
 * to build anyway.
 *
 * The exact, ordered column list is itself part of the contract: it is what asserts the merge-only
 * fields (`emails`, `mergedFrom`) are absent — the pre-compaction guard had to test for each of
 * them by name — and it rejects an entry written against a different column set outright.
 */
function isDirectoryRowTable(table: ColumnarTable): boolean {
  return (
    hasExactColumns(table, ORG_PEOPLE_DIRECTORY_CACHE_ROW_KEYS) &&
    table.r.every((row) => ORG_PEOPLE_DIRECTORY_CACHE_ROW_KEYS.every((key, index) => isValidDirectoryCell(key, row[index])))
  );
}

/**
 * Identity of a source record for merge purposes.
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

let warnedMissingPersonKeySigningSecret = false;

/** Signing key for live-only `personKey` HMACs — the app session secret, same default as `mktg-session-token.util.ts` and the auth config. */
function personKeySigningSecret(): string {
  const secret = process.env['PCC_AUTH0_SECRET'];
  if (secret) return secret;
  if (!warnedMissingPersonKeySigningSecret) {
    warnedMissingPersonKeySigningSecret = true;
    logger.warning(
      undefined,
      'person_key_signing_secret',
      'PCC_AUTH0_SECRET is unset — personKey HMAC is falling back to a public, in-repo default key, which defeats its purpose of resisting dictionary attacks on the logged token'
    );
  }
  return 'sufficiently-long-string';
}

/** The badge a principal renders as: their role once accepted, `invited` while the invite is outstanding. */
function badgeOf(user: OrgAccessUser): OrgAccessBadgeState {
  return user.isPending ? 'invited' : user.role;
}

function isFoundationOption(value: unknown): boolean {
  const f = value as Partial<OrgAllEmployeeFoundationOption>;
  return isObject(value) && typeof f.foundationId === 'string' && typeof f.foundationName === 'string';
}

/**
 * Rejects a corrupt or pre-compaction merged-roster entry (degrades to a miss) — a `v2` value, with
 * its `rows` array of wire objects, has no columnar `r` and fails here rather than decoding into
 * rows of undefined.
 */
function isCompactDirectoryEntry(value: unknown): boolean {
  if (!isObject(value)) return false;
  const entry = value as Partial<CompactOrgPeopleDirectoryEntry>;
  return (
    typeof entry.accountId === 'string' &&
    isColumnarTable(entry.r) &&
    isDirectoryRowTable(entry.r) &&
    Array.isArray(entry.foundations) &&
    entry.foundations.every(isFoundationOption)
  );
}

/** Projects the merged roster onto the stored cache shape (GH-1906): `rows` columnar, `foundations` verbatim (small, fixed-size). */
function toCompactDirectory(response: OrgAllEmployeesCountedResponse): CompactOrgPeopleDirectoryEntry {
  return {
    accountId: response.accountId,
    r: toColumnar(response.rows, ORG_PEOPLE_DIRECTORY_CACHE_ROW_KEYS),
    foundations: response.foundations,
  };
}

/** Rebuilds the exact counted roster stored by {@link toCompactDirectory}. */
function fromCompactDirectory(entry: CompactOrgPeopleDirectoryEntry): OrgAllEmployeesCountedResponse {
  return { accountId: entry.accountId, rows: fromColumnar<OrgAllEmployeeCountedRow>(entry.r), foundations: entry.foundations };
}

/**
 * Unified people directory for the Org Lens People page (`?live` path).
 *
 * Merges the stored Snowflake roster — one time range of `ORG_PEOPLE_ALL_RANGES`, or the unranged
 * `ORG_PEOPLE_ALL` roster the reassign pickers read; the source of activity counts — with three LIVE
 * sources — committee/board seats, key contacts, and the org's writers/auditors — so a person who was
 * added since the last dbt build still appears. Records match on their verified LF username
 * (`resolveMergeKey`); the lowercased email is the key only for a record without one, such as a pending
 * invite or an unresolved seat, and key contacts always match on email. The two kinds of key never
 * match each other, except that a live identity-less row is folded into the one identity row that owns
 * its address (`absorbIdentitylessRows`). The live sources are current state and are not windowed. The
 * response keeps the exact `OrgAllEmployeesResponse` shape; live-only people surface with zero activity
 * counts and a `sources` provenance array. Each source is fetched with `Promise.allSettled` so a single
 * upstream outage degrades the roster gracefully rather than failing the whole tab.
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

  /**
   * Merged stored + live roster for one time range and its commit filters (`null` range: the unranged
   * roster), served through the per-caller shared cache: the merge folds in request-scoped
   * permission-filtered reads (committee seats, FGA-filtered key contacts, the caller's access view), so
   * keying by caller + org stops one caller's roster from being replayed to another within the TTL. Only
   * the range and project scope change who is listed, so each (range, project scope) — and the unranged
   * roster — has its own namespace, holding every code count; the commit scope and metric pick the count
   * and the tiles are counted after the read. The commit filters do not apply to the unranged roster, so it
   * is always computed and projected with the defaults: its one shared entry holds the full current roster
   * the reassign pickers read, whatever filters an unranged caller sent.
   *
   * The whole read-through is coalesced in-process (GH-1906): the merge fans out to four upstreams
   * and on a large org takes longer than the 30-second entry it produces is allowed to live, so N
   * concurrent tabs would otherwise each run all four. Coalescing around `withPerUserCache` — not
   * just its fetcher — means one burst does one cache read, one merge, one serialization and one
   * write, rather than every joined caller re-serializing and re-writing a multi-MB value on the
   * connection the session store shares. For monitoring: an oversize warning now counts a burst,
   * not a caller, so fewer warnings alone does not mean the value started to fit.
   *
   * Joined callers share the COMPACT envelope. Each gets freshly built row objects, but `foundations`
   * and each row's array fields (`sources`, `engagedFoundationIds`) are shared by reference between
   * them, since they come from one parsed entry. That is safe only because the response is read-only
   * downstream — it is serialized to the client or searched by `OrgLensPeopleService`, never mutated.
   * A consumer that needs to mutate it must copy first.
   *
   * A roster computed while the former-employee read failed is served but not cached: its access-only
   * principals went unclassified, so they are served without address or title, and storing it would
   * list the former ones as current for the whole TTL.
   */
  public async getLive(req: Request, accountId: string, range: OrgLensTimeRange | null, requestedFilters: OrgCommitFilters): Promise<OrgAllEmployeesResponse> {
    const filters = range ? requestedFilters : DEFAULT_ORG_COMMIT_FILTERS;
    const username = getEffectiveUsername(req) ?? '';
    const namespace = orgPeopleDirectoryNamespace(range, filters.projectScope);
    // Same effective principal (impersonation honoured) + org the cache key is built from, and
    // fail-closed on the same terms: an unsafe/blank username is never coalesced, because one
    // bucket per blank principal would hand the first caller's permission-filtered roster to every
    // other caller that arrived without a resolvable identity.
    const entry = await coalescePerUserOrgFetch(namespace, username, accountId, (isCurrent) => {
      let formerResolved = true;
      return withPerUserCache<CompactOrgPeopleDirectoryEntry>(
        namespace,
        username,
        accountId,
        VALKEY_CACHE.ORG_LENS_PERUSER_TTL_SECONDS,
        async () => {
          const live = await this.computeLive(req, accountId, range, filters.projectScope);
          formerResolved = live.formerResolved;
          return toCompactDirectory(live.directory);
        },
        isCompactDirectoryEntry,
        () => formerResolved && isCurrent()
      );
    });
    return toWireResponse(fromCompactDirectory(entry), filters);
  }

  private async computeLive(
    req: Request,
    accountId: string,
    range: OrgLensTimeRange | null,
    projectScope: OrgProjectScope
  ): Promise<{ directory: OrgAllEmployeesCountedResponse; formerResolved: boolean }> {
    // `fetchAllOrgSeats` is the full cross-foundation seat drain — heavier than the picker's bounded read —
    // because this roster also backs the All Employees tab, which needs the complete set. Each source is
    // fetched with `Promise.allSettled` so a single upstream outage degrades the roster gracefully.
    // Board/committee seats are LF engagement, so `non_lf` reads none, and there the live sources only enrich
    // stored rows: no row exists only because of a live seat, key contact or access.
    const lfEngagement = projectScope !== 'non_lf';
    // Whether someone left is not a property of the view: the range's former rows need code in that range and scope,
    // so a former employee whose code is older or outside the scope would read as current. The account's former
    // employees with credited code, in any range and scope, decide instead, read as usernames only: the full all-time
    // former roster outgrows its cache on the largest accounts. The warehouse lists only people with code as former,
    // so someone who left without credited code and still holds Org Lens access stays listed as current (a known gap).
    // The unranged picker roster is classified the same way, so the assignment pickers do not offer them.
    const [snowflake, seats, keyContacts, access, former] = await Promise.allSettled([
      this.peopleService.getAllEmployeesInternal(accountId, range, projectScope),
      lfEngagement ? this.boardCommitteeService.fetchAllOrgSeats(req, accountId) : Promise.resolve([]),
      this.keyContactsService.getEmployees(req, accountId),
      this.accessService.getAccessPrincipals(req, accountId),
      lfEngagement ? this.peopleService.getFormerUsernames(accountId) : Promise.resolve([]),
    ]);

    const base: OrgAllEmployeesInternalResponse = snowflake.status === 'fulfilled' ? snowflake.value : { accountId, rows: [], foundations: [] };
    if (snowflake.status === 'rejected') {
      logger.warning(req, 'get_org_people_directory', 'Snowflake roster failed; serving live sources only', {
        org_uid: accountId,
        err: snowflake.reason,
      });
    }

    const formerUsernames = former.status === 'fulfilled' ? new Set<string>(former.value) : null;
    if (former.status === 'rejected') {
      // Served rather than without access-only rows: hiding every access-only principal would drop current
      // people who are not in the stored roster yet. Unclassified, each is served the way a former one would
      // be — no address or title — and `getLive` keeps the roster out of the cache.
      logger.warning(req, 'get_org_people_directory', 'Former employees read failed; serving access-only rows without address or title, uncached', {
        org_uid: accountId,
        err: former.reason,
      });
    }

    const directory = this.merge(req, accountId, base, seats, keyContacts, access, lfEngagement, formerUsernames);
    return { directory, formerResolved: formerUsernames !== null };
  }

  /**
   * Seed the snowflake rows by merge key (unkeyable rows pass through), then fold each live source in; `addLiveOnlyRows` false only enriches stored rows.
   * `formerUsernames` are the account's former employees, whose access-only live rows are tagged former; `null` when
   * they could not be read, and then no access-only row is tagged but none carries an address or title.
   */
  private merge(
    req: Request,
    accountId: string,
    base: OrgAllEmployeesInternalResponse,
    seats: PromiseSettledResult<CommitteeServiceOrgSeat[]>,
    keyContacts: PromiseSettledResult<KeyContactEmployee[]>,
    access: PromiseSettledResult<OrgAccessUser[]>,
    addLiveOnlyRows: boolean,
    formerUsernames: ReadonlySet<string> | null
  ): OrgAllEmployeesCountedResponse {
    const byKey = new Map<string, OrgAllEmployeeRowInternal>();
    const unkeyedRows: OrgAllEmployeeRowInternal[] = [];

    for (const row of base.rows) {
      const key = resolveMergeKey(row);
      if (key) {
        // Clone so we can mutate sources/enrichment without aliasing the snowflake service's array.
        byKey.set(key, { ...row, sources: [...row.sources], emails: [...row.emails] });
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
          // incrementing here would double-count the same seat. Verified: a seat held under a person's secondary
          // address is already inside the stored count, because the roster's governance join resolves it by LFID.
          if (!existing.sources.includes('snowflake')) this.addSeat(existing, source);
        } else {
          byKey.set(key, this.rowFromSeat(seat, email, source, key));
        }
      }
    } else {
      this.logSourceFailure(req, accountId, 'committee seats', seats.reason);
    }

    // Key contacts that matched no row, held for the deferred pass below. Enriching them here would read
    // an ownership map that the access pass and the orphan fold have not contributed their addresses to yet.
    const unmatchedKeyContacts: { emp: KeyContactEmployee; email: string }[] = [];
    if (keyContacts.status === 'fulfilled') {
      for (const emp of keyContacts.value) {
        const email = (emp.email ?? '').trim().toLowerCase();
        // Merged by email even when the document carries a username: the username is safe to carry as a
        // lookup key on its own row but unsafe to join on.
        const key = resolveMergeKey({ email });
        if (!key) continue;
        const existing = byKey.get(key);
        if (existing) {
          this.addSource(existing, 'keyContact');
          this.addEmail(existing, email);
          this.fill(existing, { firstName: emp.firstName || null, lastName: emp.lastName || null, title: emp.jobTitle, avatarUrl: emp.avatarUrl ?? null });
          this.addKeyContactRoles(existing, emp.roles);
          // No username backfill onto an email-merged row: the username is member-service's resolution of
          // this address, and resolving identity from an address is prohibited.
        } else if (addLiveOnlyRows) {
          byKey.set(key, this.rowFromKeyContact(emp, email, key));
        } else {
          unmatchedKeyContacts.push({ emp, email });
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
          existing.accessBadge = badgeOf(user);
          const [firstName, lastName] = splitDisplayName(user.name);
          this.fill(existing, { firstName, lastName, title: user.jobTitle, avatarUrl: user.avatarUrl });
        } else if (addLiveOnlyRows) {
          byKey.set(key, this.rowFromAccess(user, email, key));
        }
      }
    } else {
      this.logSourceFailure(req, accountId, 'access principals', access.reason);
    }

    this.absorbIdentitylessRows(byKey);
    this.enrichStoredOwnersFromKeyContacts(byKey, unmatchedKeyContacts);
    if (formerUsernames) {
      this.tagFormerAccessPrincipals(byKey, formerUsernames);
    } else {
      this.redactAccessOnlyPrincipals(byKey);
    }

    const merged = [...byKey.values(), ...unkeyedRows].sort((a, b) => a.name.localeCompare(b.name));
    return {
      accountId,
      rows: merged.map(toStoredRow),
      // Foundation options stay sourced from Snowflake (authoritative id↔name pairs). Live-only people
      // carry no engagedFoundationIds, so they are not foundation-filterable until the next dbt build.
      foundations: base.foundations,
    };
  }

  /**
   * Fold each address-keyed row into the identity-keyed row that already owns that address.
   *
   * Sources differ in whether they report an identity: the stored roster nearly always does, live
   * committee seats often do not. When both describe the same person at the same address, the
   * identity rung claims one and the address rung claims the other, and they never meet — the two
   * kinds of key are deliberately disjoint so a single pass stays order-independent.
   *
   * Left alone that splits a person who was previously whole, since before identity matching existed
   * both rows keyed on the shared address and merged. This pass restores that, and only that: an
   * address-keyed row is absorbed strictly when exactly one identity row lists the same address. It
   * introduces no matching the previous behaviour did not already perform, and it cannot pull two
   * identities together: only address-keyed rows are candidates, and a candidate is folded without
   * its username (a key-contact-only row carries one while still keyed on its address).
   *
   * Three kinds of orphan are deliberately left standing: a pending invitation (unverified), a stored
   * row (it owns data this fold does not carry), and any row whose address two identities both claim.
   */
  /**
   * Carry a key contact's roles onto the stored employee who owns its address.
   *
   * Only reached in a scope that enriches stored rows without adding live-only ones: there is no
   * live-only row for `absorbIdentitylessRows` to fold, so without this an employee keyed by LF identity
   * loses their pills while an email-keyed one keeps theirs.
   *
   * Deliberately last. The access pass and the orphan fold both call `addEmail`, so an ownership map
   * built before them is wrong in two directions: an address only an access principal contributed is
   * claimed by nobody and its roles vanish, and an address that a second identity claims later is handed
   * to the first — putting one person's key-contact role on another, which is the worse of the two.
   * Reading the final map means both cases resolve the way the full-roster path already resolves them.
   */
  private enrichStoredOwnersFromKeyContacts(
    byKey: Map<string, OrgAllEmployeeRowInternal>,
    unmatched: readonly { emp: KeyContactEmployee; email: string }[]
  ): void {
    if (unmatched.length === 0) return;
    const identityOwners = OrgPeopleDirectoryService.identityOwnersByEmail(byKey);
    for (const { emp, email } of unmatched) {
      const owner = identityOwners.get(email);
      if (!owner) continue;
      this.addSource(owner, 'keyContact');
      this.addEmail(owner, email);
      this.fill(owner, { firstName: emp.firstName || null, lastName: emp.lastName || null, title: emp.jobTitle, avatarUrl: emp.avatarUrl ?? null });
      this.addKeyContactRoles(owner, emp.roles);
    }
  }

  /**
   * Address -> the single identity row listing it.
   *
   * An address claimed by more than one identity has no correct owner, so it gets none: picking the
   * first would attribute by upstream ordering, which is not a property worth depending on. Shared by
   * the orphan fold and by the key-contact enrichment, so the two cannot disagree about who owns an
   * address.
   */
  private static identityOwnersByEmail(byKey: Map<string, OrgAllEmployeeRowInternal>): Map<string, OrgAllEmployeeRowInternal> {
    const claims = new Map<string, OrgAllEmployeeRowInternal[]>();
    for (const [key, row] of byKey) {
      if (!key.startsWith('identity:')) continue;
      for (const email of row.emails) {
        claims.set(email, [...(claims.get(email) ?? []), row]);
      }
    }
    const ownerByEmail = new Map<string, OrgAllEmployeeRowInternal>();
    for (const [email, owners] of claims) {
      if (owners.length === 1) ownerByEmail.set(email, owners[0]);
    }
    return ownerByEmail;
  }

  private absorbIdentitylessRows(byKey: Map<string, OrgAllEmployeeRowInternal>): void {
    const ownerByEmail = OrgPeopleDirectoryService.identityOwnersByEmail(byKey);

    for (const [key, orphan] of byKey) {
      if (!key.startsWith('email:')) continue;
      // A pending invitation is the one identity-less row that must stay standalone: nothing has yet
      // confirmed the invitee is the person who already holds that address, and an accepted principal
      // always carries a username, so `invited` is exactly the unverified case.
      if (orphan.accessBadge === 'invited') continue;
      // A stored orphan is left alone. It owns activity counts, engaged foundations and a real
      // personKey that this fold does not carry across, and summing them into the owner would
      // double-count the engagement the stored plane already attributes elsewhere. Absorbing it would
      // trade a duplicate row for silently missing data, which is the worse defect.
      if (orphan.sources.includes('snowflake')) continue;
      const owner = ownerByEmail.get(key.slice('email:'.length));
      if (!owner) continue;

      // Counters are taken before the orphan's sources land on the owner: `addSource` would otherwise
      // mark the owner as stored and skip the branch that reads them.
      if (!owner.sources.includes('snowflake')) {
        owner.seatsCount += orphan.seatsCount;
        owner.boardSeatsCount += orphan.boardSeatsCount;
        owner.committeeSeatsCount += orphan.committeeSeatsCount;
      }
      for (const source of orphan.sources) this.addSource(owner, source);
      for (const email of orphan.emails) this.addEmail(owner, email);
      this.addKeyContactRoles(owner, orphan.keyContactRoles);
      this.fill(owner, { firstName: orphan.firstName, lastName: orphan.lastName, title: orphan.title, avatarUrl: orphan.avatarUrl });
      // Reachable only for an accepted principal whose settings record carries no username: it keys on
      // the address like any orphan, but `isPending` is false so its badge is a real role rather than
      // `invited`. Not observed today — every accepted principal currently has one — but member-service
      // merely declines to emit an FGA tuple for that combination, it does not prevent the record.
      if (!owner.accessBadge && orphan.accessBadge) owner.accessBadge = orphan.accessBadge;
      byKey.delete(key);
    }
  }

  /**
   * Org Lens access alone does not make a former employee current again — only a live seat or key-contact
   * role does — so a live row held up by access alone, whose username is one of the account's former
   * employees, is tagged `isFormer` and the current view does not list it. It stays in the directory so the
   * former row shown under "All" and "Former employees" can take its access badge. A stored current row is
   * never tagged, and a pending invite has no username to match.
   *
   * A tagged row is shaped like the former roster's own rows ({@link redactPrincipal}).
   */
  private tagFormerAccessPrincipals(byKey: Map<string, OrgAllEmployeeRowInternal>, formerUsernames: ReadonlySet<string>): void {
    if (formerUsernames.size === 0) return;
    for (const row of byKey.values()) {
      if (row.lfUsername && row.sources.every((source) => source === 'access') && formerUsernames.has(row.lfUsername)) {
        row.isFormer = true;
        this.redactPrincipal(row, row.lfUsername);
      }
    }
  }

  /**
   * With the former employees unknown, every access-only row that could have been tagged — one with a username — is
   * served as a tagged one would be, untagged: fail closed on the data rather than on the listing. A pending invite has
   * no username to match, so it is served as it always is.
   */
  private redactAccessOnlyPrincipals(byKey: Map<string, OrgAllEmployeeRowInternal>): void {
    for (const row of byKey.values()) {
      if (row.lfUsername && row.sources.every((source) => source === 'access')) this.redactPrincipal(row, row.lfUsername);
    }
  }

  /**
   * No address is sent, and none stands in for a blank name, so a name taken from the address falls back to the LF
   * username. The title goes too: it is the access record's, which may describe a role they held here.
   */
  private redactPrincipal(row: OrgAllEmployeeRowInternal, lfUsername: string): void {
    if (row.name === row.email || row.emails.includes(row.name.toLowerCase())) row.name = lfUsername;
    row.email = null;
    row.emails = [];
    row.title = null;
  }

  private addSource(row: OrgAllEmployeeRowInternal, source: OrgPersonSource): void {
    if (!row.sources.includes(source)) {
      row.sources.push(source);
    }
  }

  /** Union the person's key-contact roles, kept sorted so the Key Contact column renders in a stable order across refetches. */
  private addKeyContactRoles(row: OrgAllEmployeeRowInternal, roles: readonly string[] | undefined): void {
    // Tolerates an absent array, not just an empty one: this is an upstream service's shape, and the
    // field is newer than some of its callers.
    if (!roles?.length) return;
    row.keyContactRoles = [...new Set([...row.keyContactRoles, ...roles])].sort((a, b) => a.localeCompare(b));
  }

  /** Record a contributing address. A merged person legitimately holds several; `email` stays the preferred display one. */
  private addEmail(row: OrgAllEmployeeRowInternal, email: string): void {
    if (email && !row.emails.includes(email)) {
      row.emails.push(email);
    }
    if (!row.email) {
      row.email = email || null;
    }
  }

  /** Increment seat counters for a live board/committee seat so the Seats column and governance filter stay consistent with the stat cards. */
  private addSeat(row: OrgAllEmployeeRowInternal, source: OrgPersonSource): void {
    row.seatsCount += 1;
    if (source === 'board') {
      row.boardSeatsCount += 1;
    } else if (source === 'committee') {
      row.committeeSeatsCount += 1;
    }
  }

  /** Fill only the fields a stored row is missing — never overwrite richer Snowflake data with a live blank. */
  private fill(
    row: OrgAllEmployeeRowInternal,
    patch: { firstName?: string | null; lastName?: string | null; title?: string | null; avatarUrl?: string | null }
  ): void {
    if (!row.firstName && patch.firstName) row.firstName = patch.firstName;
    if (!row.lastName && patch.lastName) row.lastName = patch.lastName;
    if (!row.title && patch.title) row.title = patch.title;
    if (!row.avatarUrl && patch.avatarUrl) row.avatarUrl = patch.avatarUrl;
  }

  private rowFromSeat(seat: CommitteeServiceOrgSeat, email: string, source: OrgPersonSource, key: string): OrgAllEmployeeRowInternal {
    const firstName = (seat.first_name ?? '').trim() || null;
    const lastName = (seat.last_name ?? '').trim() || null;
    const row = this.liveRow(email, firstName, lastName, seat.job_title?.trim() || null, null, source, key, seat.username ?? null);
    // The seat that created this live-only row counts as one held seat; further seats fold in via addSeat on the existing branch.
    this.addSeat(row, source);
    return row;
  }

  private rowFromKeyContact(emp: KeyContactEmployee, email: string, key: string): OrgAllEmployeeRowInternal {
    const row = this.liveRow(
      email,
      emp.firstName || null,
      emp.lastName || null,
      emp.jobTitle,
      emp.avatarUrl ?? null,
      'keyContact',
      key,
      emp.lfUsername ?? null
    );
    this.addKeyContactRoles(row, emp.roles);
    return row;
  }

  private rowFromAccess(user: OrgAccessUser, email: string, key: string): OrgAllEmployeeRowInternal {
    const [firstName, lastName] = splitDisplayName(user.name);
    const row = this.liveRow(email, firstName, lastName, user.jobTitle, user.avatarUrl, 'access', key, user.username);
    row.accessBadge = badgeOf(user);
    return row;
  }

  /**
   * Build a live-only row (no stored activity). personKey is a pattern-safe token so a detail expand
   * returns an empty (200) payload rather than a 400. It is an HMAC-SHA256 of the merge key — not a
   * reversible encoding, and not an unkeyed hash either — since the merge key can be `email:<address>`.
   * Email addresses are low-entropy, so an unkeyed hash (or plain base64url) would let anyone who reads
   * the logged token dictionary-attack candidate addresses and recover the member's identity; keying with
   * the app session secret (same pattern as `mktg-session-token.util.ts`) closes that off. It's still
   * derived from the merge key (not the address alone) so a record identified only by username gets a
   * distinct token — deriving it from an absent address would collide every such row onto the same key.
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
  ): OrgAllEmployeeRowInternal {
    const username = (lfUsername ?? '').trim().toLowerCase() || null;
    const name = [firstName, lastName].filter(Boolean).join(' ').trim() || email || username || '';
    return {
      personKey: `live-${createHmac('sha256', personKeySigningSecret()).update(key).digest('base64url').slice(0, 32)}`,
      lfid: null,
      lfUsername: username,
      cdpMemberId: null,
      name,
      firstName,
      lastName,
      title,
      email,
      emails: email ? [email] : [],
      avatarUrl,
      sources: [source],
      seatsCount: 0,
      boardSeatsCount: 0,
      committeeSeatsCount: 0,
      keyContactRoles: [],
      commitsCount: 0,
      mergedCommitsCount: 0,
      codeActivitiesCount: 0,
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

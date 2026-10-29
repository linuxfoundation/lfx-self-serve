// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { DEFAULT_ORG_COMMIT_FILTERS, DEFAULT_ORG_TEAM_MEMBERS } from '@lfx-one/shared/constants';
import type {
  KeyContactEmployee,
  OrgAllEmployeeRow,
  OrgAllEmployeesResponse,
  OrgCommitFilters,
  OrgLensTimeRange,
  OrgTeamMembersFilter,
} from '@lfx-one/shared/interfaces';
import { orgCommitFiltersKey } from '@lfx-one/shared/utils';
import { map, Observable, of, shareReplay, tap } from 'rxjs';

/**
 * Root-singleton cache for the unified live people directory (`/lens/people/all?live[&range=&projectScope=&commitScope=&metric=&teamMembers=]`).
 *
 * The All Employees tab reads one directory per time range, commit filters and team members pick; the "Assign to
 * Email" pickers in the Board/Committee/Key-Contacts modals read the unranged roster (no `range` sent, and the
 * filters do not apply). Concurrent callers are deduped via `shareReplay`; resolved responses are
 * memoized for a short TTL (or until `invalidate`, e.g. on retry), keyed by
 * `${orgUid}:${range}:${projectScope}:${commitScope}:${metric}:${teamMembers}`, or `${orgUid}:roster` for the unranged roster.
 */
// Client-side TTL so a long-lived SPA session re-hits the merged endpoint and picks up newly added live
// people, rather than replaying the first response forever (which would bypass the server's short TTL).
const DIRECTORY_CACHE_TTL_MS = 60_000;

@Injectable({ providedIn: 'root' })
export class OrgPeopleDirectoryStateService {
  private readonly http = inject(HttpClient);

  private readonly byKey = new Map<string, { value: OrgAllEmployeesResponse; expiresAt: number }>();
  private readonly inFlight = new Map<string, Observable<OrgAllEmployeesResponse>>();
  // Per org, bumped by `invalidate`. A request remembers the generation it started under and only writes its
  // response into `byKey` if that is still current, so a request already in flight when the cache was
  // invalidated (e.g. started before a seat reassign) can't put the pre-invalidate roster back for the TTL.
  private readonly generation = new Map<string, number>();

  /** Cached merged directory for the org, time range, commit filters and team members pick (no range: the unranged roster); fetches once and replays until the TTL lapses. */
  public getDirectory(
    orgUid: string,
    range?: OrgLensTimeRange,
    filters: OrgCommitFilters = DEFAULT_ORG_COMMIT_FILTERS,
    teamMembers: OrgTeamMembersFilter = DEFAULT_ORG_TEAM_MEMBERS
  ): Observable<OrgAllEmployeesResponse> {
    const key = range ? `${orgUid}:${range}:${orgCommitFiltersKey(filters)}:${teamMembers}` : `${orgUid}:roster`;
    this.pruneExpired(Date.now());
    const cached = this.byKey.get(key);
    if (cached) return of(cached.value);

    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const startedGeneration = this.generation.get(orgUid) ?? 0;
    const request$: Observable<OrgAllEmployeesResponse> = this.http
      .get<OrgAllEmployeesResponse>(`/api/orgs/${encodeURIComponent(orgUid)}/lens/people/all`, {
        params: range ? { live: 'true', range, ...filters, teamMembers } : { live: 'true' },
      })
      .pipe(
        tap({
          next: (res) => {
            if ((this.generation.get(orgUid) ?? 0) !== startedGeneration) return;
            this.byKey.set(key, { value: res, expiresAt: Date.now() + DIRECTORY_CACHE_TTL_MS });
          },
          finalize: () => {
            if (this.inFlight.get(key) === request$) this.inFlight.delete(key);
          },
        }),
        shareReplay({ bufferSize: 1, refCount: false })
      );
    this.inFlight.set(key, request$);
    return request$;
  }

  /**
   * Picker projection: current people with an email, mapped to the shared employee-picker shape. Reads the unranged roster,
   * so the picker does not depend on the All Employees range. A row the server tagged former (Org Lens access held by
   * someone who left) is never offered for assignment.
   */
  public getEmployees(orgUid: string): Observable<KeyContactEmployee[]> {
    return this.getDirectory(orgUid).pipe(
      map((res) =>
        res.rows
          .filter((row): row is OrgAllEmployeeRow & { email: string } => !!row.email && !row.isFormer)
          .map((row) => toEmployee(row))
          .sort((a, b) => a.fullName.localeCompare(b.fullName))
      )
    );
  }

  /** Drop the cached directory for an org — the unranged roster and every range and filter combination — so the next `getDirectory` refetches (the tab's retry CTA, and after a seat reassign). A request still in flight keeps serving its own subscribers but no longer fills the cache. */
  public invalidate(orgUid: string): void {
    this.generation.set(orgUid, (this.generation.get(orgUid) ?? 0) + 1);
    const prefix = `${orgUid}:`;
    for (const cache of [this.byKey, this.inFlight]) {
      for (const key of [...cache.keys()]) {
        if (key.startsWith(prefix)) cache.delete(key);
      }
    }
  }

  /**
   * Drop every expired roster, not only the one requested: each range and filter combination is its own multi-megabyte
   * entry, so a session that moves between them would otherwise keep them all. In-flight requests are separate and
   * remove themselves when they settle.
   */
  private pruneExpired(now: number): void {
    for (const [key, entry] of this.byKey) {
      if (entry.expiresAt <= now) this.byKey.delete(key);
    }
  }
}

/** Project a unified row onto the picker's KeyContactEmployee shape. */
function toEmployee(row: OrgAllEmployeeRow & { email: string }): KeyContactEmployee {
  const firstName = row.firstName ?? '';
  const lastName = row.lastName ?? '';
  // Prefer the joined first/last (filled from live sources) over `row.name`, which can be an email
  // placeholder for Snowflake rows that lack a real name; fall back to the name, then the email.
  const fullName = `${firstName} ${lastName}`.trim() || row.name || row.email;
  return {
    email: row.email,
    firstName,
    lastName,
    fullName,
    jobTitle: row.title,
    initials: deriveInitials(firstName, lastName, fullName),
    avatarUrl: row.avatarUrl,
    lfUsername: row.lfUsername,
  };
}

/** Initials from first+last, falling back to the display name's leading characters. */
function deriveInitials(firstName: string, lastName: string, fullName: string): string {
  const fromNames = `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
  if (fromNames.trim()) return fromNames;
  return fullName
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 2)
    .toUpperCase();
}

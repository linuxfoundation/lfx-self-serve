// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { KeyContactEmployee, OrgAllEmployeeRow, OrgAllEmployeesResponse } from '@lfx-one/shared/interfaces';
import { map, Observable, of, shareReplay, tap } from 'rxjs';

/**
 * Root-singleton cache for the unified live people directory (`/lens/people/all?live`).
 *
 * One fetch per org is shared between the All Employees tab roster and the "Assign to Email"
 * pickers in the Board/Committee/Key-Contacts modals. Concurrent callers are deduped via
 * `shareReplay`; resolved responses are memoized for a short TTL (or until `invalidate`, e.g. on retry).
 */
// Client-side TTL so a long-lived SPA session re-hits the merged endpoint and picks up newly added live
// people, rather than replaying the first response forever (which would bypass the server's short TTL).
const DIRECTORY_CACHE_TTL_MS = 60_000;

@Injectable({ providedIn: 'root' })
export class OrgPeopleDirectoryStateService {
  private readonly http = inject(HttpClient);

  private readonly byOrg = new Map<string, { value: OrgAllEmployeesResponse; expiresAt: number }>();
  private readonly inFlight = new Map<string, Observable<OrgAllEmployeesResponse>>();
  // Bumped by `invalidate`. A request remembers the generation it started under and only writes its
  // response into `byOrg` if that is still current, so a request already in flight when the cache was
  // invalidated (e.g. started before a seat reassign) can't put the pre-invalidate roster back for the TTL.
  private readonly generation = new Map<string, number>();

  /** Cached merged directory for the org; fetches once and replays until the TTL lapses. */
  public getDirectory(orgUid: string): Observable<OrgAllEmployeesResponse> {
    const cached = this.byOrg.get(orgUid);
    if (cached && cached.expiresAt > Date.now()) return of(cached.value);
    if (cached) this.byOrg.delete(orgUid);

    const existing = this.inFlight.get(orgUid);
    if (existing) return existing;

    const startedGeneration = this.generation.get(orgUid) ?? 0;
    const request$: Observable<OrgAllEmployeesResponse> = this.http
      .get<OrgAllEmployeesResponse>(`/api/orgs/${encodeURIComponent(orgUid)}/lens/people/all`, { params: { live: 'true' } })
      .pipe(
        tap({
          next: (res) => {
            if ((this.generation.get(orgUid) ?? 0) !== startedGeneration) return;
            this.byOrg.set(orgUid, { value: res, expiresAt: Date.now() + DIRECTORY_CACHE_TTL_MS });
          },
          finalize: () => {
            if (this.inFlight.get(orgUid) === request$) this.inFlight.delete(orgUid);
          },
        }),
        shareReplay({ bufferSize: 1, refCount: false })
      );
    this.inFlight.set(orgUid, request$);
    return request$;
  }

  /** Picker projection: people with an email, mapped to the shared employee-picker shape. */
  public getEmployees(orgUid: string): Observable<KeyContactEmployee[]> {
    return this.getDirectory(orgUid).pipe(
      map((res) =>
        res.rows
          .filter((row): row is OrgAllEmployeeRow & { email: string } => !!row.email)
          .map((row) => toEmployee(row))
          .sort((a, b) => a.fullName.localeCompare(b.fullName))
      )
    );
  }

  /** Drop the cached directory for an org so the next `getDirectory` refetches (the tab's retry CTA, and after a seat reassign). A request still in flight keeps serving its own subscribers but no longer fills the cache. */
  public invalidate(orgUid: string): void {
    this.generation.set(orgUid, (this.generation.get(orgUid) ?? 0) + 1);
    this.byOrg.delete(orgUid);
    this.inFlight.delete(orgUid);
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

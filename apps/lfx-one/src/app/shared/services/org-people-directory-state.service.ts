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
 * `shareReplay`; resolved responses are memoized until `invalidate` is called (e.g. on retry).
 */
@Injectable({ providedIn: 'root' })
export class OrgPeopleDirectoryStateService {
  private readonly http = inject(HttpClient);

  private readonly byOrg = new Map<string, OrgAllEmployeesResponse>();
  private readonly inFlight = new Map<string, Observable<OrgAllEmployeesResponse>>();

  /** Cached merged directory for the org; fetches once and replays. */
  public getDirectory(orgUid: string): Observable<OrgAllEmployeesResponse> {
    const cached = this.byOrg.get(orgUid);
    if (cached) return of(cached);

    const existing = this.inFlight.get(orgUid);
    if (existing) return existing;

    const request$ = this.http.get<OrgAllEmployeesResponse>(`/api/orgs/${encodeURIComponent(orgUid)}/lens/people/all`, { params: { live: 'true' } }).pipe(
      tap({
        next: (res) => this.byOrg.set(orgUid, res),
        finalize: () => this.inFlight.delete(orgUid),
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

  /** Drop the cached directory for an org so the next `getDirectory` refetches (used by the tab's retry CTA). */
  public invalidate(orgUid: string): void {
    this.byOrg.delete(orgUid);
    this.inFlight.delete(orgUid);
  }
}

/** Project a unified row onto the picker's KeyContactEmployee shape. */
function toEmployee(row: OrgAllEmployeeRow & { email: string }): KeyContactEmployee {
  const firstName = row.firstName ?? '';
  const lastName = row.lastName ?? '';
  const fullName = row.name || `${firstName} ${lastName}`.trim() || row.email;
  return {
    email: row.email,
    firstName,
    lastName,
    fullName,
    jobTitle: row.title,
    initials: deriveInitials(firstName, lastName, fullName),
    avatarUrl: row.avatarUrl,
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

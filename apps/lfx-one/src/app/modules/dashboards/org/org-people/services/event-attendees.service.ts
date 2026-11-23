// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { OrgEventAttendeesResponse, OrgEventsFilters } from '@lfx-one/shared/interfaces';
import { Observable } from 'rxjs';

/** HTTP client for the Org Lens → People → Event Attendees tab GET. One bundled fetch per (range, Count); the server applies range and ended-only, search, foundation, event, sort, pagination and expansion are client-side. */
@Injectable({ providedIn: 'root' })
export class EventAttendeesService {
  private readonly http = inject(HttpClient);

  public getEventAttendees(orgUid: string, filters: Pick<OrgEventsFilters, 'range' | 'participation'>): Observable<OrgEventAttendeesResponse> {
    const params = new HttpParams().set('range', filters.range).set('participation', filters.participation);
    return this.http.get<OrgEventAttendeesResponse>(`/api/orgs/${encodeURIComponent(orgUid)}/lens/people/event-attendees`, { params });
  }
}

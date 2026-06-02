// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { OrgEventAttendeesResponse } from '@lfx-one/shared/interfaces';
import { Observable } from 'rxjs';

/** HTTP client for the Org Lens → People → Event Attendees tab GET. Single bundled fetch — filter, sort, pagination, and expansion are all client-side. */
@Injectable({ providedIn: 'root' })
export class EventAttendeesService {
  private readonly http = inject(HttpClient);

  public getEventAttendees(orgUid: string): Observable<OrgEventAttendeesResponse> {
    return this.http.get<OrgEventAttendeesResponse>(`/api/orgs/${encodeURIComponent(orgUid)}/lens/people/event-attendees`);
  }
}

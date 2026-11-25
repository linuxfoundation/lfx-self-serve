// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { ShareKitResponse } from '@lfx-one/shared/interfaces';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class PublicShareKitService {
  private readonly http = inject(HttpClient);

  // Public content for one event, plus this visitor's `memberOffer` when the kit has one: 404 for an unknown slug
  // (or while the share kit flag is off), 500 when its content file failed validation.
  public getShareKit(eventSlug: string): Observable<ShareKitResponse> {
    return this.http.get<ShareKitResponse>(`/public/api/events/${encodeURIComponent(eventSlug)}/share-kit`);
  }
}

// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { ShareKitContent } from '@lfx-one/shared/interfaces';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class PublicShareKitService {
  private readonly http = inject(HttpClient);

  // Public content for one event: 404 for an unknown slug, 500 when its content file failed validation.
  public getShareKit(eventSlug: string): Observable<ShareKitContent> {
    return this.http.get<ShareKitContent>(`/public/api/events/${encodeURIComponent(eventSlug)}/share-kit`);
  }
}

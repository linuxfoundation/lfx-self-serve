// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { PublicProfile } from '@lfx-one/shared/interfaces';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class PublicProfileService {
  private readonly http = inject(HttpClient);

  // Proxies the S3 public-profile artifact: 404 when missing, 200 `{ isPublic: false }` when private.
  public getPublicProfile(username: string): Observable<PublicProfile> {
    return this.http.get<PublicProfile>(`/public/api/profile/${encodeURIComponent(username)}`);
  }
}

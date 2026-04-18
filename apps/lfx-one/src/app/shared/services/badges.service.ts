// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Badge } from '@lfx-one/shared/interfaces';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class BadgesService {
  private readonly http = inject(HttpClient);

  public getBadges(): Observable<Badge[]> {
    return this.http.get<Badge[]>('/api/badges');
  }
}

// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { OrgTrainingStats } from '@lfx-one/shared/interfaces';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class OrgLensTrainingService {
  private readonly http = inject(HttpClient);

  public getTrainingStats(orgUid: string): Observable<OrgTrainingStats> {
    return this.http.get<OrgTrainingStats>(`/api/orgs/${encodeURIComponent(orgUid)}/lens/training/stats`);
  }
}

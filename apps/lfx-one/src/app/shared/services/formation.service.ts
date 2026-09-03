// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { FormationActivity, FormationChecklistResponse, FormationItem, FormationSubStage, FormationsQueueResponse } from '@lfx-one/shared/interfaces';
import { Observable, take } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class FormationService {
  private readonly http = inject(HttpClient);

  public getProjectFormation(projectSlug: string): Observable<FormationChecklistResponse> {
    return this.http.get<FormationChecklistResponse>(`/api/projects/${encodeURIComponent(projectSlug)}/formation`);
  }

  public getFormationItem(itemUid: string): Observable<{ item: FormationItem; history: FormationActivity[] }> {
    return this.http.get<{ item: FormationItem; history: FormationActivity[] }>(`/api/formation-items/${encodeURIComponent(itemUid)}`);
  }

  public completeFormationItem(itemUid: string, notes?: string): Observable<FormationItem> {
    return this.http.patch<FormationItem>(`/api/formation-items/${encodeURIComponent(itemUid)}/complete`, { notes }).pipe(take(1));
  }

  public skipFormationItem(itemUid: string, reason: string): Observable<FormationItem> {
    return this.http.patch<FormationItem>(`/api/formation-items/${encodeURIComponent(itemUid)}/skip`, { reason }).pipe(take(1));
  }

  public requestFormationItem(itemUid: string): Observable<FormationItem> {
    return this.http.patch<FormationItem>(`/api/formation-items/${encodeURIComponent(itemUid)}/request`, {}).pipe(take(1));
  }

  public updateFormationItem(itemUid: string, patch: { notes?: string; owner_username?: string; due_date?: string | null }): Observable<FormationItem> {
    return this.http.patch<FormationItem>(`/api/formation-items/${encodeURIComponent(itemUid)}`, patch).pipe(take(1));
  }

  public getFormationsQueue(subStage?: FormationSubStage, search?: string): Observable<FormationsQueueResponse> {
    let params = new HttpParams();
    if (subStage) params = params.set('sub_stage', subStage);
    if (search) params = params.set('search', search);
    return this.http.get<FormationsQueueResponse>('/api/formations', { params });
  }
}

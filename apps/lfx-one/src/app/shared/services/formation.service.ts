// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  FormationActivity,
  FormationChecklistResponse,
  FormationItem,
  FormationItemStatus,
  FormationSubStage,
  FormationsQueueResponse,
  MyFormationWorkResponse,
} from '@lfx-one/shared/interfaces';
import { Observable, take } from 'rxjs';

/** Builds the `/api/formations/:projectUid/items/:itemKey` base path shared by every item route (GH-2267 Phase 2). */
function itemPath(projectUid: string, itemKey: string): string {
  return `/api/formations/${encodeURIComponent(projectUid)}/items/${encodeURIComponent(itemKey)}`;
}

@Injectable({ providedIn: 'root' })
export class FormationService {
  private readonly http = inject(HttpClient);

  public getProjectFormation(projectSlug: string): Observable<FormationChecklistResponse> {
    return this.http.get<FormationChecklistResponse>(`/api/projects/${encodeURIComponent(projectSlug)}/formation`);
  }

  public getFormationItem(projectUid: string, itemKey: string): Observable<{ item: FormationItem; history: FormationActivity[] }> {
    return this.http.get<{ item: FormationItem; history: FormationActivity[] }>(itemPath(projectUid, itemKey));
  }

  public completeFormationItem(projectUid: string, itemKey: string, notes?: string): Observable<FormationItem> {
    return this.http.patch<FormationItem>(`${itemPath(projectUid, itemKey)}/complete`, { notes }).pipe(take(1));
  }

  public skipFormationItem(projectUid: string, itemKey: string, reason: string): Observable<FormationItem> {
    return this.http.patch<FormationItem>(`${itemPath(projectUid, itemKey)}/skip`, { reason }).pipe(take(1));
  }

  public requestFormationItem(projectUid: string, itemKey: string): Observable<FormationItem> {
    return this.http.patch<FormationItem>(`${itemPath(projectUid, itemKey)}/request`, {}).pipe(take(1));
  }

  /** The three "plain" status transitions (not_started / in_progress / blocked) — completion and skip keep their own dedicated endpoints. */
  public updateFormationItemStatus(projectUid: string, itemKey: string, status: FormationItemStatus, note?: string): Observable<FormationItem> {
    return this.http.patch<FormationItem>(`${itemPath(projectUid, itemKey)}/status`, { status, note }).pipe(take(1));
  }

  public updateFormationItem(
    projectUid: string,
    itemKey: string,
    patch: { notes?: string; owner_username?: string; due_date?: string | null }
  ): Observable<FormationItem> {
    return this.http.patch<FormationItem>(itemPath(projectUid, itemKey), patch).pipe(take(1));
  }

  /** New in GH-2267 Phase 2 — mirrors upstream's `accept` action; see `formationService.acceptFormationItem` (server) for the gating detail. */
  public acceptFormationItem(projectUid: string, itemKey: string, note?: string): Observable<FormationItem> {
    return this.http.post<FormationItem>(`${itemPath(projectUid, itemKey)}/accept`, { note }).pipe(take(1));
  }

  /** New in GH-2267 Phase 2 — `note` is required upstream (minLength 1); the BFF/service enforce it, this method just forwards it. */
  public rejectFormationItem(projectUid: string, itemKey: string, note: string): Observable<FormationItem> {
    return this.http.post<FormationItem>(`${itemPath(projectUid, itemKey)}/reject`, { note }).pipe(take(1));
  }

  /** New in GH-2267 Phase 2 — reverses a done/skipped/awaiting-acceptance item back to in_progress. */
  public reopenFormationItem(projectUid: string, itemKey: string, note?: string): Observable<FormationItem> {
    return this.http.post<FormationItem>(`${itemPath(projectUid, itemKey)}/reopen`, { note }).pipe(take(1));
  }

  public getFormationsQueue(subStage?: FormationSubStage, search?: string): Observable<FormationsQueueResponse> {
    let params = new HttpParams();
    if (subStage) params = params.set('sub_stage', subStage);
    if (search) params = params.set('search', search);
    return this.http.get<FormationsQueueResponse>('/api/formations', { params });
  }

  /** GH-1956 Me lens — formations with at least one checklist item assigned to the caller. */
  public getMyFormationWork(): Observable<MyFormationWorkResponse> {
    return this.http.get<MyFormationWorkResponse>('/api/user/formation-work');
  }
}

// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  FormationChecklistResponse,
  FormationItemDetail,
  FormationItemStatus,
  FormationItemWriteResult,
  FormationPeopleResponse,
  FormationSubStage,
  FormationsQueueResponse,
  MyFormationWorkResponse,
} from '@lfx-one/shared/interfaces';
import { createUnavailableFormationPeopleResponse } from '@lfx-one/shared/constants';
import { BehaviorSubject, catchError, Observable, of, shareReplay, switchMap, take, tap } from 'rxjs';

/** Builds the `/api/formations/:projectUid/items/:itemKey` base path shared by every item route (GH-2267 Phase 2). */
function itemPath(projectUid: string, itemKey: string): string {
  return `/api/formations/${encodeURIComponent(projectUid)}/items/${encodeURIComponent(itemKey)}`;
}

@Injectable({ providedIn: 'root' })
export class FormationService {
  private readonly http = inject(HttpClient);

  // Bumping this re-runs the `switchMap` below and pushes the fresh response to every live
  // `getMyFormationWork()` subscriber — not just new ones. A `BehaviorSubject` (vs. nulling the
  // cached observable) is required for that: it never completes, so `shareReplay`'s `refCount`
  // reset is gated on `!hasCompleted` per RxJS's `share` operator and a live subscription simply
  // keeps receiving the next emission instead of being stuck on an already-completed HTTP source.
  private readonly refreshMyFormationWork$ = new BehaviorSubject<void>(undefined);
  private readonly myFormationWork$: Observable<MyFormationWorkResponse> = this.refreshMyFormationWork$.pipe(
    switchMap(() =>
      this.http.get<MyFormationWorkResponse>('/api/user/formation-work').pipe(
        // Fallback lives here, inside the switchMap, not in a consumer-level `catchError` — a
        // fallback out there would convert to a completing observable and permanently detach that
        // subscriber from later `invalidateMyFormationWork()` emissions. Emitting the fallback from
        // the shared stream itself keeps it alive indefinitely.
        catchError((error: unknown) => {
          console.error('[FormationService] Failed to load my-formation-work', error);
          return of<MyFormationWorkResponse>({ formations: [], items: [], state: 'unavailable' });
        })
      )
    ),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  public getProjectFormation(projectSlug: string): Observable<FormationChecklistResponse> {
    return this.http.get<FormationChecklistResponse>(`/api/projects/${encodeURIComponent(projectSlug)}/formation`);
  }

  /**
   * `GET /api/projects/:slug/formation/people` — the checklist sidebar's people card (#2724).
   * Degrades to the `unavailable` shape on any HTTP failure (repo GET convention), which the card
   * renders as its unavailable state — the same shape the BFF itself returns when the caller
   * cleared the checklist read but upstream refused the settings read. Deliberately uncached: the
   * card re-fetches after an invite, and both checklist hosts mount it once per checklist load.
   */
  public getFormationPeople(projectSlug: string): Observable<FormationPeopleResponse> {
    return this.http.get<FormationPeopleResponse>(`/api/projects/${encodeURIComponent(projectSlug)}/formation/people`).pipe(
      catchError((error: unknown) => {
        console.error('[FormationService] Failed to load formation people', error);
        return of(createUnavailableFormationPeopleResponse());
      })
    );
  }

  /**
   * Auditor-gated twin of {@link getProjectFormation} for the foundation formations drill-down
   * (LFXV2-3386): identical response from the same BFF controller, but `requireAuditor`-gated
   * server-side so the queue's root-auditor contract holds during SSR too — the drill-down route's
   * client guard alone can't stop a non-auditor's first server render (#2690 review).
   */
  public getQueueFormationChecklist(projectSlug: string): Observable<FormationChecklistResponse> {
    return this.http.get<FormationChecklistResponse>(`/api/formations/${encodeURIComponent(projectSlug)}/checklist`);
  }

  public getFormationItem(projectUid: string, itemKey: string): Observable<FormationItemDetail> {
    return this.http.get<FormationItemDetail>(itemPath(projectUid, itemKey));
  }

  /**
   * `PATCH /api/formations/:projectUid/items/:itemKey` — note/evidence_link (GH-2576 Phase 2).
   * `ifMatch` is the item's current `version` as a bare-digit string (`String(item.version)`); the
   * response's `etag` is that same version's successor, ready to use as the next call's `ifMatch`
   * without a re-fetch.
   */
  public updateFormationItem(
    projectUid: string,
    itemKey: string,
    ifMatch: string,
    patch: { note?: string; evidence_link?: string }
  ): Observable<FormationItemWriteResult> {
    return this.writeItem(itemPath(projectUid, itemKey), 'PATCH', ifMatch, patch);
  }

  /** `POST /api/formations/:projectUid/items/:itemKey/assignment` — assignee/due_date (GH-2576 Phase 2, new route). Empty string clears either field. */
  public updateFormationItemAssignment(
    projectUid: string,
    itemKey: string,
    ifMatch: string,
    patch: { assignee?: string; due_date?: string }
  ): Observable<FormationItemWriteResult> {
    return this.writeItem(`${itemPath(projectUid, itemKey)}/assignment`, 'POST', ifMatch, patch);
  }

  /**
   * `POST /api/formations/:projectUid/items/:itemKey/status` — status/reason/sub_items (GH-2576
   * Phase 2). `reason` is required by upstream only for specific targets
   * (blocked/skipped/back-to-not_started) — this method doesn't pre-validate that, it just forwards.
   */
  public updateFormationItemStatus(
    projectUid: string,
    itemKey: string,
    ifMatch: string,
    patch: { status?: FormationItemStatus; reason?: string; sub_items?: unknown }
  ): Observable<FormationItemWriteResult> {
    return this.writeItem(`${itemPath(projectUid, itemKey)}/status`, 'POST', ifMatch, patch);
  }

  public getFormationsQueue(subStage?: FormationSubStage, search?: string, foundationUid?: string): Observable<FormationsQueueResponse> {
    let params = new HttpParams();
    if (subStage) params = params.set('sub_stage', subStage);
    if (search) params = params.set('search', search);
    if (foundationUid) params = params.set('foundation_uid', foundationUid);
    return this.http.get<FormationsQueueResponse>('/api/formations', { params });
  }

  /**
   * GH-1956 Me lens — formations with at least one checklist item assigned to the caller. Consumed
   * by the My Formations page (`my-formations.component.ts`, #2753) and by the multi-persona
   * dashboard's "In formation" tile; `shareReplay({ refCount: true })` collapses concurrent
   * subscribers into one HTTP request per navigation, and tears the subscription down (re-fetching
   * on the next subscribe) once the last consumer unsubscribes. The source is
   * `refreshMyFormationWork$`, not the bare `HttpClient` call, so `invalidateMyFormationWork()`
   * (wired into every write method above, the item drawer's completion/skip paths, and the page's
   * Retry) re-runs the fetch and pushes the new response straight to whichever page/tile is already
   * on screen — no re-navigation needed.
   */
  public getMyFormationWork(): Observable<MyFormationWorkResponse> {
    return this.myFormationWork$;
  }

  /** Re-fetches `getMyFormationWork()` and republishes it to every live subscriber. Called automatically by the write methods above. */
  public invalidateMyFormationWork(): void {
    this.refreshMyFormationWork$.next();
  }

  /**
   * Shared transport for the three write routes above — sends `If-Match`, reads the response body's
   * `{item, etag}` (the BFF mirrors the etag into both the body and the `ETag` response header; the
   * body is what every caller here actually needs). Every call invalidates the cached "My formations"
   * work stream, same as every mutation did pre-GH-2576.
   */
  private writeItem(url: string, method: 'PATCH' | 'POST', ifMatch: string, body: Record<string, unknown>): Observable<FormationItemWriteResult> {
    const options = { headers: { 'If-Match': ifMatch } };
    const request$ =
      method === 'PATCH' ? this.http.patch<FormationItemWriteResult>(url, body, options) : this.http.post<FormationItemWriteResult>(url, body, options);
    return request$.pipe(
      tap(() => this.invalidateMyFormationWork()),
      take(1)
    );
  }
}

// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable, signal, WritableSignal } from '@angular/core';
import {
  Committee,
  CommitteeDocument,
  CommitteeDocumentType,
  CommitteeJoinApplication,
  CommitteeMember,
  CommitteeUser,
  CreateCommitteeDocumentRequest,
  CreateCommitteeJoinApplicationRequest,
  CreateCommitteeMemberRequest,
  MyCommittee,
  QueryServiceCountResponse,
} from '@lfx-one/shared/interfaces';
import { catchError, map, Observable, of, take, tap, throwError } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class CommitteeService {
  public committee: WritableSignal<Committee | null> = signal(null);

  private readonly http = inject(HttpClient);

  public getCommittees(params?: HttpParams): Observable<Committee[]> {
    return this.http.get<Committee[]>('/api/committees', { params }).pipe(catchError(() => of([])));
  }

  public getCommitteesByProject(uid: string): Observable<Committee[]> {
    const params = new HttpParams().set('tags', `project_uid:${uid}`);

    return this.getCommittees(params);
  }

  public getCommitteesCountByProject(uid: string): Observable<number> {
    const params = new HttpParams().set('tags', `project_uid:${uid}`);
    return this.http
      .get<QueryServiceCountResponse>('/api/committees/count', { params })
      .pipe(catchError(() => of({ count: 0 })))
      .pipe(map((response) => response.count));
  }

  public getCommittee(id: string): Observable<Committee> {
    return this.http.get<Committee>(`/api/committees/${id}`).pipe(
      catchError((error) => {
        return throwError(() => error);
      }),
      tap((committee) => this.committee.set(committee ?? null))
    );
  }

  public deleteCommittee(id: string): Observable<void> {
    return this.http.delete<void>(`/api/committees/${id}`).pipe(take(1));
  }

  public createCommittee(committee: Partial<Committee>): Observable<Committee> {
    return this.http.post<Committee>('/api/committees', committee).pipe(take(1));
  }

  public updateCommittee(id: string, committee: Partial<Committee>): Observable<Committee> {
    return this.http.put<Committee>(`/api/committees/${id}`, committee).pipe(take(1));
  }

  /** Updates the writers and auditors permission lists for a committee. */
  public updateCommitteePermissions(committeeId: string, writers: CommitteeUser[], auditors: CommitteeUser[]): Observable<Committee> {
    return this.http.put<Committee>(`/api/committees/${committeeId}`, { writers, auditors }).pipe(take(1));
  }

  /** Fetches a committee by ID without updating shared service state. */
  public fetchCommittee(id: string): Observable<Committee> {
    return this.http.get<Committee>(`/api/committees/${id}`).pipe(take(1));
  }

  // ── Sub-groups (children) ─────────────────────────────────────────────────

  /** Fetches child committees (sub-groups) of a parent committee */
  public getChildCommittees(parentUid: string): Observable<Committee[]> {
    return this.http.get<Committee[]>(`/api/committees/${parentUid}/children`).pipe(catchError(() => of([])));
  }

  // Committee Members methods
  public getCommitteeMembers(committeeId: string, params?: HttpParams): Observable<CommitteeMember[]> {
    return this.http.get<CommitteeMember[]>(`/api/committees/${committeeId}/members`, { params });
  }

  public getCommitteeMember(committeeId: string, memberId: string): Observable<CommitteeMember | null> {
    return this.http.get<CommitteeMember>(`/api/committees/${committeeId}/members/${memberId}`);
  }

  public createCommitteeMember(committeeId: string, memberData: CreateCommitteeMemberRequest): Observable<CommitteeMember> {
    return this.http.post<CommitteeMember>(`/api/committees/${committeeId}/members`, memberData).pipe(take(1));
  }

  public updateCommitteeMember(committeeId: string, memberId: string, memberData: Partial<CreateCommitteeMemberRequest>): Observable<CommitteeMember> {
    return this.http.put<CommitteeMember>(`/api/committees/${committeeId}/members/${memberId}`, memberData).pipe(take(1));
  }

  public deleteCommitteeMember(committeeId: string, memberId: string): Observable<void> {
    return this.http.delete<void>(`/api/committees/${committeeId}/members/${memberId}`).pipe(take(1));
  }

  // ── Join / Leave Methods ──────────────────────────────────────────────────

  /** Self-join an open group */
  public joinCommittee(committeeId: string): Observable<CommitteeMember> {
    return this.http.post<CommitteeMember>(`/api/committees/${committeeId}/join`, {}).pipe(take(1));
  }

  /** Leave a group */
  public leaveCommittee(committeeId: string): Observable<void> {
    return this.http.delete<void>(`/api/committees/${committeeId}/leave`).pipe(take(1));
  }

  /** Submit a join application for a group with join_mode 'application' or 'invite_only' */
  public submitApplication(committeeId: string, message?: string): Observable<CommitteeJoinApplication> {
    const body: CreateCommitteeJoinApplicationRequest = { message: message || '' };
    return this.http.post<CommitteeJoinApplication>(`/api/committees/${committeeId}/applications`, body).pipe(take(1));
  }

  // ── Committee Documents ─────────────────────────────────────────────────

  public getCommitteeDocuments(committeeId: string): Observable<CommitteeDocument[]> {
    return this.http.get<CommitteeDocument[]>(`/api/committees/${committeeId}/documents`).pipe(catchError(() => of([])));
  }

  public createCommitteeDocument(committeeId: string, data: CreateCommitteeDocumentRequest): Observable<CommitteeDocument> {
    return this.http.post<CommitteeDocument>(`/api/committees/${committeeId}/documents`, data).pipe(take(1));
  }

  public deleteCommitteeDocument(committeeId: string, documentId: string, documentType: CommitteeDocumentType): Observable<void> {
    const params = new HttpParams().set('type', documentType);
    return this.http.delete<void>(`/api/committees/${committeeId}/documents/${documentId}`, { params }).pipe(take(1));
  }

  // ── My Committees ─────────────────────────────────────────────────────────

  /**
   * Get committees for the current user, optionally scoped to a project or foundation.
   *
   * - `projectUid` scopes to memberships under a single project.
   * - `foundationUid` scopes to memberships under a foundation (and its sub-projects).
   *
   * Pass neither to fetch the full cross-project set (used by cross-project pages).
   * If both are provided, `projectUid` takes precedence and `foundationUid` is ignored.
   */
  public getMyCommittees(projectUid?: string, foundationUid?: string): Observable<MyCommittee[]> {
    let params = new HttpParams();
    if (projectUid) {
      params = params.set('project_uid', projectUid);
    } else if (foundationUid) {
      params = params.set('foundation_uid', foundationUid);
    }
    return this.http.get<MyCommittee[]>('/api/committees/my-committees', { params }).pipe(
      catchError((error) => {
        console.error('Failed to load my committees:', error);
        return of([]);
      })
    );
  }
}

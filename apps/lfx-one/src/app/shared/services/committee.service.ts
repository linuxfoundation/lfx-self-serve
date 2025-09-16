// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable, signal, WritableSignal } from '@angular/core';
import { Committee, CommitteeMember, CreateCommitteeMemberRequest } from '@lfx-one/shared/interfaces';
import { catchError, Observable, of, take, tap, throwError } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class CommitteeService {
  public committee: WritableSignal<Committee | null> = signal(null);

  private readonly http = inject(HttpClient);

  public getCommittees(params?: HttpParams): Observable<Committee[]> {
    return this.http.get<Committee[]>('/api/committees', { params }).pipe(
      catchError((error) => {
        console.error('Failed to load committees:', error);
        return of([]);
      })
    );
  }

  public getCommitteesByProject(projectId: string): Observable<Committee[]> {
    const params = new HttpParams().set('tags', `project_uid:${projectId}`);

    return this.getCommittees(params);
  }

  public getRecentCommitteesByProject(projectId: string): Observable<Committee[]> {
    return this.getCommitteesByProject(projectId);
  }

  public getCommittee(id: string): Observable<Committee> {
    return this.http.get<Committee>(`/api/committees/${id}`).pipe(
      catchError((error) => {
        console.error(`Failed to load committee ${id}:`, error);
        return throwError(() => new Error(`Failed to load committee ${id}`));
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

  public updateCommitteeMember(committeeId: string, memberId: string, memberData: CreateCommitteeMemberRequest): Observable<CommitteeMember> {
    return this.http.put<CommitteeMember>(`/api/committees/${committeeId}/members/${memberId}`, memberData).pipe(take(1));
  }

  public deleteCommitteeMember(committeeId: string, memberId: string): Observable<void> {
    return this.http.delete<void>(`/api/committees/${committeeId}/members/${memberId}`).pipe(take(1));
  }
}

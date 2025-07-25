// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable, signal, WritableSignal } from '@angular/core';
import { CreateMeetingRequest, Meeting, MeetingParticipant } from '@lfx-pcc/shared/interfaces';
import { catchError, Observable, of, tap } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class MeetingService {
  public meeting: WritableSignal<Meeting | null> = signal(null);

  private readonly http = inject(HttpClient);

  public getMeetings(params?: HttpParams): Observable<Meeting[]> {
    return this.http.get<Meeting[]>('/api/meetings', { params }).pipe(
      catchError((error) => {
        console.error('Failed to load meetings:', error);
        return of([]);
      })
    );
  }

  public getMeetingsByProject(projectId: string, limit?: number, orderBy?: string): Observable<Meeting[]> {
    let params = new HttpParams().set('project_id', `eq.${projectId}`);

    if (limit) {
      params = params.set('limit', limit.toString());
    }

    if (orderBy) {
      params = params.set('order', orderBy);
    }

    return this.getMeetings(params);
  }

  public getRecentMeetingsByProject(projectId: string, limit: number = 3): Observable<Meeting[]> {
    return this.getMeetingsByProject(projectId, limit, 'created_at.desc');
  }

  public getUpcomingMeetingsByProject(projectId: string, limit: number = 3): Observable<Meeting[]> {
    const now = new Date().toISOString();
    let params = new HttpParams().set('project_id', `eq.${projectId}`).set('start_time', `gte.${now}`).set('order', 'start_time.asc');

    if (limit) {
      params = params.set('limit', limit.toString());
    }

    return this.getMeetings(params);
  }

  public getPastMeetingsByProject(projectId: string, limit: number = 3): Observable<Meeting[]> {
    const now = new Date().toISOString();
    let params = new HttpParams().set('project_id', `eq.${projectId}`).set('start_time', `lt.${now}`).set('order', 'start_time.desc');

    if (limit) {
      params = params.set('limit', limit.toString());
    }

    return this.getMeetings(params);
  }

  public getMeeting(id: string): Observable<Meeting> {
    return this.http.get<Meeting>(`/api/meetings/${id}`).pipe(
      catchError((error) => {
        console.error(`Failed to load meeting ${id}:`, error);
        return of(error);
      }),
      tap((meeting) => this.meeting.set(meeting))
    );
  }

  public getMeetingParticipants(meetingId: string): Observable<MeetingParticipant[]> {
    return this.http.get<MeetingParticipant[]>(`/api/meetings/${meetingId}/participants`).pipe(
      catchError((error) => {
        console.error(`Failed to load participants for meeting ${meetingId}:`, error);
        return of([]);
      })
    );
  }

  public createMeeting(meeting: CreateMeetingRequest): Observable<Meeting> {
    return this.http.post<Meeting>('/api/meetings', meeting).pipe(
      catchError((error) => {
        console.error('Failed to create meeting:', error);
        throw error;
      })
    );
  }

  public updateMeeting(id: string, meeting: Partial<CreateMeetingRequest>): Observable<Meeting> {
    return this.http.put<Meeting>(`/api/meetings/${id}`, meeting).pipe(
      catchError((error) => {
        console.error(`Failed to update meeting ${id}:`, error);
        throw error;
      })
    );
  }
}

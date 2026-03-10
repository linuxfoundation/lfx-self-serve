// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { inject, Injectable, signal, WritableSignal } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { LINKEDIN_PROFILE_PATTERN } from '@lfx-one/shared/constants';
import {
  AttachmentDownloadUrlResponse,
  BatchRegistrantOperationResponse,
  CreateMeetingAttachmentRequest,
  CreateMeetingRegistrantRequest,
  CreateMeetingRequest,
  CreateMeetingRsvpRequest,
  GenerateAgendaRequest,
  GenerateAgendaResponse,
  Meeting,
  MeetingAttachment,
  MeetingJoinURL,
  MeetingRegistrant,
  MeetingRegistrantWithState,
  MeetingRsvp,
  PaginatedResponse,
  PastMeeting,
  PastMeetingAttachment,
  PastMeetingParticipant,
  PastMeetingRecording,
  PastMeetingSummary,
  PresignAttachmentRequest,
  PresignAttachmentResponse,
  Project,
  QueryServiceCountResponse,
  UpdateMeetingAttachmentRequest,
  UpdateMeetingRegistrantRequest,
  UpdateMeetingRequest,
  UpdatePastMeetingSummaryRequest,
} from '@lfx-one/shared/interfaces';
import { catchError, map, Observable, of, take, tap, throwError } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class MeetingService {
  public meeting: WritableSignal<Meeting | null> = signal(null);

  private readonly http = inject(HttpClient);

  public getMeetings(params?: HttpParams): Observable<PaginatedResponse<Meeting>> {
    return this.http.get<PaginatedResponse<Meeting>>('/api/meetings', { params }).pipe(
      catchError((error) => {
        console.error('Failed to load meetings:', error);
        return of({ data: [] as Meeting[], page_token: undefined });
      })
    );
  }

  public getPastMeetings(params?: HttpParams): Observable<PaginatedResponse<PastMeeting>> {
    return this.http.get<PaginatedResponse<PastMeeting>>('/api/past-meetings', { params }).pipe(
      catchError((error) => {
        console.error('Failed to load past meetings:', error);
        return of({ data: [] as PastMeeting[], page_token: undefined });
      })
    );
  }

  public getMeetingsByProject(uid: string, limit?: number, orderBy?: string): Observable<Meeting[]> {
    let params = new HttpParams().set('tags', `project_uid:${uid}`);

    if (limit) {
      params = params.set('limit', limit.toString());
    }

    if (orderBy) {
      params = params.set('order', orderBy);
    }

    return this.getMeetings(params).pipe(map((response) => response.data));
  }

  public getMeetingsCountByProject(uid: string): Observable<number> {
    const params = new HttpParams().set('tags', `project_uid:${uid}`);
    return this.http
      .get<QueryServiceCountResponse>('/api/meetings/count', { params })
      .pipe(
        catchError((error) => {
          console.error('Failed to load meetings count:', error);
          return of({ count: 0 });
        })
      )
      .pipe(
        // Extract just the count number from the response
        map((response) => response.count)
      );
  }

  public getRecentMeetingsByProject(uid: string, limit: number = 3): Observable<Meeting[]> {
    return this.getMeetingsByProject(uid, limit, 'updated_at.desc');
  }

  public getUpcomingMeetingsByProject(uid: string, limit: number = 3): Observable<Meeting[]> {
    let params = new HttpParams().set('tags', `project_uid:${uid}`);

    // TODO: Add filter for upcoming meetings
    if (limit) {
      params = params.set('limit', limit.toString());
    }

    return this.getMeetings(params).pipe(map((response) => response.data));
  }

  public getPastMeetingsByProject(uid: string, limit: number = 3): Observable<PastMeeting[]> {
    let params = new HttpParams().set('tags', `project_uid:${uid}`);

    if (limit) {
      params = params.set('limit', limit.toString());
    }

    // TODO: Add sort parameter once API supports sorting by scheduled_start_time
    // When implemented, add: params = params.set('sort', 'scheduled_start_time_desc');
    // This will enable backend sorting instead of client-side sorting in the component

    return this.getPastMeetings(params).pipe(map((response) => response.data));
  }

  public getMeetingsByProjectPaginated(
    uid: string,
    limit?: number,
    orderBy?: string,
    pageToken?: string,
    searchName?: string,
    filters?: string[]
  ): Observable<PaginatedResponse<Meeting>> {
    let params = new HttpParams().set('tags', `project_uid:${uid}`);
    if (limit) {
      params = params.set('limit', limit.toString());
    }
    if (orderBy) {
      params = params.set('order', orderBy);
    }
    if (pageToken) {
      params = params.set('page_token', pageToken);
    }
    if (searchName) {
      params = params.set('name', searchName);
    }
    if (filters?.length) {
      for (const filter of filters) {
        params = params.append('filters', filter);
      }
    }
    return this.getMeetings(params);
  }

  public getPastMeetingsByProjectPaginated(
    uid: string,
    limit?: number,
    pageToken?: string,
    searchName?: string,
    filters?: string[]
  ): Observable<PaginatedResponse<PastMeeting>> {
    let params = new HttpParams().set('tags', `project_uid:${uid}`);
    if (limit) {
      params = params.set('limit', limit.toString());
    }
    if (pageToken) {
      params = params.set('page_token', pageToken);
    }
    if (searchName) {
      params = params.set('name', searchName);
    }
    if (filters?.length) {
      for (const filter of filters) {
        params = params.append('filters', filter);
      }
    }
    return this.getPastMeetings(params);
  }

  public getMeeting(id: string): Observable<Meeting> {
    return this.http.get<Meeting>(`/api/meetings/${id}`).pipe(
      catchError((error) => {
        console.error(`Failed to load meeting ${id}:`, error);
        return throwError(() => error);
      }),
      tap((meeting) => this.meeting.set(meeting))
    );
  }

  public getPublicMeeting(id: string, password: string | null): Observable<{ meeting: Meeting; project: Project }> {
    let params = new HttpParams();
    if (password) {
      params = params.set('password', password);
    }

    return this.http.get<{ meeting: Meeting; project: Project }>(`/public/api/meetings/${id}`, { params }).pipe(
      catchError((error) => {
        console.error(`Failed to load public meeting ${id}:`, error);
        return throwError(() => error);
      })
    );
  }

  public getPublicMeetingJoinUrl(
    id: string,
    password: string | null,
    body?: { email?: string; name?: string; organization?: string }
  ): Observable<MeetingJoinURL> {
    let params = new HttpParams();

    if (password) {
      params = params.set('password', password);
    }

    return this.http.post<MeetingJoinURL>(`/public/api/meetings/${id}/join-url`, body, { params }).pipe(
      catchError((error) => {
        console.error(`Failed to load public meeting join url ${id}:`, error);
        return throwError(() => error);
      })
    );
  }

  public createMeeting(meeting: CreateMeetingRequest): Observable<Meeting> {
    return this.http.post<Meeting>('/api/meetings', meeting).pipe(
      take(1),
      catchError((error) => {
        console.error('Failed to create meeting:', error);
        return throwError(() => error);
      })
    );
  }

  public updateMeeting(id: string, meeting: UpdateMeetingRequest, editType?: 'single' | 'future'): Observable<void> {
    let params = new HttpParams();
    if (editType) {
      params = params.set('editType', editType);
    }
    return this.http.put<void>(`/api/meetings/${id}`, meeting, { params }).pipe(
      take(1),
      catchError((error) => {
        console.error(`Failed to update meeting ${id}:`, error);
        return throwError(() => error);
      })
    );
  }

  public deleteMeeting(id: string, deleteType?: 'single' | 'series' | 'future'): Observable<void> {
    let params = new HttpParams();
    if (deleteType) {
      params = params.set('deleteType', deleteType);
    }
    return this.http.delete<void>(`/api/meetings/${id}`, { params }).pipe(
      take(1),
      catchError((error) => {
        console.error(`Failed to delete meeting ${id}:`, error);
        return throwError(() => error);
      })
    );
  }

  public cancelOccurrence(meetingId: string, occurrenceId: string): Observable<void> {
    return this.http.delete<void>(`/api/meetings/${meetingId}/occurrences/${occurrenceId}`).pipe(take(1));
  }

  // ─── Meeting Attachment Methods ───────────────────────────────────────────

  public getMeetingAttachments(meetingId: string): Observable<MeetingAttachment[]> {
    return this.http.get<MeetingAttachment[]>(`/api/meetings/${meetingId}/attachments`).pipe(
      take(1),
      catchError(() => of([]))
    );
  }

  public createMeetingAttachment(meetingId: string, attachmentData: CreateMeetingAttachmentRequest): Observable<MeetingAttachment> {
    return this.http.post<MeetingAttachment>(`/api/meetings/${meetingId}/attachments`, attachmentData).pipe(take(1));
  }

  public updateMeetingAttachment(meetingId: string, attachmentId: string, updateData: UpdateMeetingAttachmentRequest): Observable<void> {
    return this.http.put<void>(`/api/meetings/${meetingId}/attachments/${attachmentId}`, updateData).pipe(take(1));
  }

  public deleteMeetingAttachment(meetingId: string, attachmentId: string): Observable<void> {
    return this.http.delete<void>(`/api/meetings/${meetingId}/attachments/${attachmentId}`).pipe(take(1));
  }

  public presignMeetingAttachment(meetingId: string, presignData: PresignAttachmentRequest): Observable<PresignAttachmentResponse> {
    return this.http.post<PresignAttachmentResponse>(`/api/meetings/${meetingId}/attachments/presign`, presignData).pipe(take(1));
  }

  public getMeetingAttachmentDownloadUrl(meetingId: string, attachmentId: string): Observable<AttachmentDownloadUrlResponse> {
    return this.http.get<AttachmentDownloadUrlResponse>(`/api/meetings/${meetingId}/attachments/${attachmentId}/download`).pipe(take(1));
  }

  /**
   * Uploads a file to a meeting via the server, which handles presigning and
   * the S3 PUT internally. Avoids browser-side CORS requirements on S3.
   * File metadata is passed as query params; the raw binary is the request body.
   */
  public uploadMeetingFile(meetingId: string, file: File, presignData: PresignAttachmentRequest): Observable<PresignAttachmentResponse> {
    let params = new HttpParams().set('name', presignData.name).set('file_size', presignData.file_size.toString()).set('file_type', presignData.file_type);

    if (presignData.category) {
      params = params.set('category', presignData.category);
    }

    if (presignData.description) {
      params = params.set('description', presignData.description);
    }

    return this.http
      .post<PresignAttachmentResponse>(`/api/meetings/${meetingId}/attachments/upload`, file, {
        headers: new HttpHeaders({ 'Content-Type': file.type || 'application/octet-stream' }),
        params,
      })
      .pipe(take(1));
  }

  // ─── Past Meeting Attachment Methods (read-only — no upload UX yet) ───────

  public getPastMeetingAttachmentDownloadUrl(pastMeetingId: string, attachmentId: string): Observable<AttachmentDownloadUrlResponse> {
    return this.http.get<AttachmentDownloadUrlResponse>(`/api/past-meetings/${pastMeetingId}/attachments/${attachmentId}/download`).pipe(take(1));
  }

  public generateAgenda(request: GenerateAgendaRequest): Observable<GenerateAgendaResponse> {
    return this.http.post<GenerateAgendaResponse>('/api/meetings/generate-agenda', request).pipe(
      take(1),
      catchError((error) => {
        console.error('Failed to generate meeting agenda:', error);
        return throwError(() => error);
      })
    );
  }

  public getMeetingRegistrants(meetingUid: string, includeRsvp: boolean = false): Observable<MeetingRegistrant[]> {
    const params = new HttpParams().set('include_rsvp', includeRsvp.toString());
    return this.http.get<MeetingRegistrant[]>(`/api/meetings/${meetingUid}/registrants`, { params }).pipe(
      catchError((error) => {
        console.error(`Failed to load registrants for meeting ${meetingUid}:`, error);
        return of([]);
      })
    );
  }

  public getMyMeetingRegistrants(meetingUid: string, includeRsvp: boolean = false): Observable<MeetingRegistrant[]> {
    const params = new HttpParams().set('include_rsvp', includeRsvp.toString());
    return this.http.get<MeetingRegistrant[]>(`/api/meetings/${meetingUid}/my-meeting-registrants`, { params }).pipe(
      catchError((error) => {
        console.error(`Failed to load my registrants for meeting ${meetingUid}:`, error);
        return of([]);
      })
    );
  }

  public getPastMeetingParticipants(pastMeetingUid: string): Observable<PastMeetingParticipant[]> {
    return this.http.get<PastMeetingParticipant[]>(`/api/past-meetings/${pastMeetingUid}/participants`).pipe(
      catchError((error) => {
        console.error(`Failed to load participants for past meeting ${pastMeetingUid}:`, error);
        return of([]);
      })
    );
  }

  public getPastMeetingRecording(pastMeetingUid: string): Observable<PastMeetingRecording> {
    return this.http.get<PastMeetingRecording>(`/api/past-meetings/${pastMeetingUid}/recording`);
  }

  public getPastMeetingSummary(pastMeetingUid: string): Observable<PastMeetingSummary> {
    return this.http.get<PastMeetingSummary>(`/api/past-meetings/${pastMeetingUid}/summary`);
  }

  public getPastMeetingAttachments(pastMeetingUid: string): Observable<PastMeetingAttachment[]> {
    return this.http.get<PastMeetingAttachment[]>(`/api/past-meetings/${pastMeetingUid}/attachments`);
  }

  public updatePastMeetingSummary(pastMeetingUid: string, summaryUid: string, updateData: UpdatePastMeetingSummaryRequest): Observable<PastMeetingSummary> {
    return this.http.put<PastMeetingSummary>(`/api/past-meetings/${pastMeetingUid}/summary/${summaryUid}`, updateData);
  }

  public approvePastMeetingSummary(pastMeetingUid: string, summaryUid: string): Observable<PastMeetingSummary> {
    return this.updatePastMeetingSummary(pastMeetingUid, summaryUid, { approved: true });
  }

  public addMeetingRegistrants(
    meetingUid: string,
    registrantData: CreateMeetingRegistrantRequest[]
  ): Observable<BatchRegistrantOperationResponse<MeetingRegistrant>> {
    return this.http.post<BatchRegistrantOperationResponse<MeetingRegistrant>>(`/api/meetings/${meetingUid}/registrants`, registrantData).pipe(
      take(1),
      catchError((error) => {
        console.error(`Failed to add registrants to meeting ${meetingUid}:`, error);
        return throwError(() => error);
      })
    );
  }

  public updateMeetingRegistrants(
    meetingUid: string,
    updateData: { uid: string; changes: UpdateMeetingRegistrantRequest }[]
  ): Observable<BatchRegistrantOperationResponse<MeetingRegistrant>> {
    return this.http.put<BatchRegistrantOperationResponse<MeetingRegistrant>>(`/api/meetings/${meetingUid}/registrants`, updateData).pipe(
      take(1),
      catchError((error) => {
        console.error(`Failed to update registrants in meeting ${meetingUid}:`, error);
        return throwError(() => error);
      })
    );
  }

  public deleteMeetingRegistrants(meetingUid: string, registrantUids: string[]): Observable<BatchRegistrantOperationResponse<string>> {
    return this.http.delete<BatchRegistrantOperationResponse<string>>(`/api/meetings/${meetingUid}/registrants`, { body: registrantUids }).pipe(
      take(1),
      catchError((error) => {
        console.error(`Failed to delete registrants from meeting ${meetingUid}:`, error);
        return throwError(() => error);
      })
    );
  }

  /**
   * Strips metadata from MeetingRegistrantWithState to create CreateMeetingRegistrantRequest
   */
  public stripMetadata(meetingUid: string, registrant: MeetingRegistrantWithState): CreateMeetingRegistrantRequest {
    return {
      meeting_id: meetingUid,
      email: registrant.email,
      first_name: registrant.first_name,
      last_name: registrant.last_name,
      host: registrant.host || false,
      job_title: registrant.job_title || null,
      org_name: registrant.org_name || null,
    };
  }

  /**
   * Gets changed fields from MeetingRegistrantWithState to create UpdateMeetingRegistrantRequest
   */
  public getChangedFields(registrant: MeetingRegistrantWithState): UpdateMeetingRegistrantRequest {
    return {
      meeting_id: registrant.meeting_id,
      email: registrant.email,
      first_name: registrant.first_name,
      last_name: registrant.last_name,
      host: registrant.host || false,
      job_title: registrant.job_title || null,
      org_name: registrant.org_name || null,
      occurrence_id: registrant.occurrence_id || null,
      avatar_url: registrant.avatar_url || null,
      username: registrant.username || null,
      linkedin_profile: registrant.linkedin_profile || null,
    };
  }

  /**
   * Creates a form group for registrant data entry
   */
  public createRegistrantFormGroup(includeAddMore: boolean = false): FormGroup {
    const controls: any = {
      first_name: new FormControl('', [Validators.required, Validators.minLength(2)]),
      last_name: new FormControl('', [Validators.required, Validators.minLength(2)]),
      email: new FormControl('', [Validators.required, Validators.email]),
      job_title: new FormControl(''),
      org_name: new FormControl(''),
      host: new FormControl(false),
      linkedin_profile: new FormControl('', [Validators.pattern(LINKEDIN_PROFILE_PATTERN)]),
    };

    // Add the add_more_registrants control only if requested (for modal)
    if (includeAddMore) {
      controls.add_more_registrants = new FormControl(false);
    }

    return new FormGroup(controls);
  }

  public resendMeetingInvitation(meetingUid: string, registrantId: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`/api/meetings/${meetingUid}/registrants/${registrantId}/resend`, {}).pipe(
      take(1),
      catchError((error) => {
        console.error('Failed to resend meeting invitation:', error);
        return throwError(() => error);
      })
    );
  }

  public createMeetingRsvp(meetingUid: string, request: CreateMeetingRsvpRequest): Observable<MeetingRsvp> {
    return this.http.post<MeetingRsvp>(`/api/meetings/${meetingUid}/rsvp`, request).pipe(
      take(1),
      catchError((error) => {
        console.error(`Failed to create RSVP for meeting ${meetingUid}:`, error);
        return throwError(() => error);
      })
    );
  }

  public getMeetingRsvps(meetingUid: string): Observable<MeetingRsvp[]> {
    return this.http.get<MeetingRsvp[]>(`/api/meetings/${meetingUid}/rsvp`).pipe(
      catchError((error) => {
        console.error(`Failed to get RSVPs for meeting ${meetingUid}:`, error);
        return of([]);
      })
    );
  }

  public getMeetingRsvpByUsername(meetingUid: string, occurrenceId?: string): Observable<MeetingRsvp | null> {
    const options = occurrenceId ? { params: { occurrenceId } } : {};
    return this.http.get<MeetingRsvp | null>(`/api/meetings/${meetingUid}/rsvp/me`, options).pipe(
      catchError((error) => {
        console.error(`Failed to get RSVP for meeting ${meetingUid}:`, error);
        return of(null);
      })
    );
  }

  public registerForPublicMeeting(registrantData: CreateMeetingRegistrantRequest): Observable<MeetingRegistrant> {
    return this.http.post<MeetingRegistrant>('/public/api/meetings/register', registrantData).pipe(
      take(1),
      catchError((error) => {
        console.error(`Failed to register for public meeting ${registrantData.meeting_id}:`, error);
        return throwError(() => error);
      })
    );
  }
}

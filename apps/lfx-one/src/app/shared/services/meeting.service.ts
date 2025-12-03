// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable, signal, WritableSignal } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import {
  BatchRegistrantOperationResponse,
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
  PastMeeting,
  PastMeetingAttachment,
  PastMeetingParticipant,
  PastMeetingRecording,
  PastMeetingSummary,
  Project,
  QueryServiceCountResponse,
  UpdateMeetingRegistrantRequest,
  UpdateMeetingRequest,
  UpdatePastMeetingSummaryRequest,
} from '@lfx-one/shared/interfaces';
import { catchError, defer, map, Observable, of, switchMap, take, tap, throwError } from 'rxjs';

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

  public getPastMeetings(params?: HttpParams): Observable<PastMeeting[]> {
    return this.http.get<PastMeeting[]>('/api/past-meetings', { params }).pipe(
      catchError((error) => {
        console.error('Failed to load past meetings:', error);
        return of([]);
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

    return this.getMeetings(params);
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

    return this.getMeetings(params);
  }

  public getPastMeetingsByProject(uid: string, limit: number = 3): Observable<PastMeeting[]> {
    let params = new HttpParams().set('tags', `project_uid:${uid}`);

    if (limit) {
      params = params.set('limit', limit.toString());
    }

    // TODO: Add sort parameter once API supports sorting by scheduled_start_time
    // When implemented, add: params = params.set('sort', 'scheduled_start_time_desc');
    // This will enable backend sorting instead of client-side sorting in the component

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

  public updateMeeting(id: string, meeting: UpdateMeetingRequest, editType?: 'single' | 'future'): Observable<Meeting> {
    let params = new HttpParams();
    if (editType) {
      params = params.set('editType', editType);
    }
    return this.http.put<Meeting>(`/api/meetings/${id}`, meeting, { params }).pipe(
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

  public getMeetingAttachments(meetingId: string): Observable<MeetingAttachment[]> {
    return this.http.get<MeetingAttachment[]>(`/api/meetings/${meetingId}/attachments`).pipe(
      catchError((error) => {
        console.error(`Failed to load attachments for meeting ${meetingId}:`, error);
        return of([]);
      })
    );
  }

  public uploadAttachment(meetingId: string, file: File): Observable<{ message: string; attachment: MeetingAttachment }> {
    return new Observable((observer) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64Data = (reader.result as string).split(',')[1];

        const uploadData = {
          fileName: file.name,
          fileData: base64Data,
          mimeType: file.type,
          fileSize: file.size,
        };

        this.http
          .post<{ message: string; attachment: MeetingAttachment }>(`/api/meetings/${meetingId}/attachments/upload`, uploadData)
          .pipe(
            take(1),
            catchError((error) => {
              console.error(`Failed to upload attachment to meeting ${meetingId}:`, error);
              return throwError(() => error);
            })
          )
          .subscribe(observer);
      };

      reader.onerror = () => {
        observer.error(new Error('Failed to read file'));
      };

      reader.readAsDataURL(file);
    });
  }

  public createFileAttachment(meetingId: string, file: File): Observable<MeetingAttachment> {
    return defer(() => this.readFileAsBase64(file)).pipe(
      switchMap((base64Data: string) => {
        // Build attachment data for file upload to LFX V2 API
        const attachmentData = {
          type: 'file',
          name: file.name,
          file: base64Data,
          file_content_type: file.type,
        };

        return this.http.post<MeetingAttachment>(`/api/meetings/${meetingId}/attachments`, attachmentData);
      }),
      take(1),
      catchError((error) => {
        console.error(`Failed to create file attachment for meeting ${meetingId}:`, error);
        return throwError(() => error);
      })
    );
  }

  public createAttachmentFromUrl(meetingId: string, name: string, url: string): Observable<MeetingAttachment> {
    // Build attachment data based on the API schema
    // For link-type attachments: type, name, link (and optionally description)
    // For file-type attachments: type, name, file, file_name, file_content_type
    const attachmentData: any = {
      type: 'link',
      name: name,
      link: url,
    };

    return this.http.post<MeetingAttachment>(`/api/meetings/${meetingId}/attachments`, attachmentData).pipe(
      take(1),
      catchError((error) => {
        console.error(`Failed to create attachment for meeting ${meetingId}:`, error);
        return throwError(() => error);
      })
    );
  }

  public deleteAttachment(meetingId: string, attachmentId: string): Observable<void> {
    return this.http.delete<void>(`/api/meetings/${meetingId}/attachments/${attachmentId}`).pipe(
      take(1),
      catchError((error) => {
        console.error(`Failed to delete attachment ${attachmentId} from meeting ${meetingId}:`, error);
        return throwError(() => error);
      })
    );
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

  public getPastMeetingParticipants(pastMeetingUid: string): Observable<PastMeetingParticipant[]> {
    return this.http.get<PastMeetingParticipant[]>(`/api/past-meetings/${pastMeetingUid}/participants`).pipe(
      catchError((error) => {
        console.error(`Failed to load participants for past meeting ${pastMeetingUid}:`, error);
        return of([]);
      })
    );
  }

  public getPastMeetingRecording(pastMeetingUid: string, v1: boolean = false): Observable<PastMeetingRecording> {
    let params = new HttpParams();
    if (v1) {
      params = params.set('v1', 'true');
    }
    return this.http.get<PastMeetingRecording>(`/api/past-meetings/${pastMeetingUid}/recording`, { params });
  }

  public getPastMeetingSummary(pastMeetingUid: string, v1: boolean = false): Observable<PastMeetingSummary> {
    let params = new HttpParams();
    if (v1) {
      params = params.set('v1', 'true');
    }
    return this.http.get<PastMeetingSummary>(`/api/past-meetings/${pastMeetingUid}/summary`, { params });
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
      meeting_uid: meetingUid,
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
      meeting_uid: registrant.meeting_uid,
      email: registrant.email,
      first_name: registrant.first_name,
      last_name: registrant.last_name,
      host: registrant.host || false,
      job_title: registrant.job_title || null,
      org_name: registrant.org_name || null,
      occurrence_id: registrant.occurrence_id || null,
      avatar_url: registrant.avatar_url || null,
      username: registrant.username || null,
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

  private readFileAsBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const base64Data = result.split(',')[1];
        resolve(base64Data);
      };
      reader.onerror = () => {
        reject(new Error('Failed to read file'));
      };
      reader.readAsDataURL(file);
    });
  }

  // Meeting-specific utility functions for registrant data handling
}

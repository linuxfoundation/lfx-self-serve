// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable, signal, WritableSignal } from '@angular/core';
import {
  CreateMeetingRequest,
  GenerateAgendaRequest,
  GenerateAgendaResponse,
  Meeting,
  MeetingAttachment,
  MeetingParticipant,
  UpdateMeetingRequest,
  UploadFileResponse,
} from '@lfx-pcc/shared/interfaces';
import { catchError, defer, Observable, of, switchMap, take, tap, throwError } from 'rxjs';

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
    // TODO: Replace tags with parent when API supports it
    let params = new HttpParams().set('tags', `${projectId}`);

    if (limit) {
      params = params.set('limit', limit.toString());
    }

    if (orderBy) {
      params = params.set('order', orderBy);
    }

    return this.getMeetings(params);
  }

  public getRecentMeetingsByProject(projectId: string, limit: number = 3): Observable<Meeting[]> {
    return this.getMeetingsByProject(projectId, limit, 'updated_at.desc');
  }

  public getUpcomingMeetingsByProject(projectId: string, limit: number = 3): Observable<Meeting[]> {
    const now = new Date().toISOString();
    // TODO: Replace tags with parent when API supports it
    // TODO: Replace start_time_gte with start_time_gte when API supports it
    let params = new HttpParams().set('tags', `${projectId}`).set('start_time_gte', now).set('order', 'start_time.asc');

    if (limit) {
      params = params.set('limit', limit.toString());
    }

    return this.getMeetings(params);
  }

  public getPastMeetingsByProject(projectId: string, limit: number = 3): Observable<Meeting[]> {
    const now = new Date().toISOString();
    // TODO: Create new past meetings endpoint when new indexer is added
    // TODO: Replace tags with parent when API supports it
    let params = new HttpParams().set('tags', `${projectId}`).set('start_time_lt', now).set('order', 'start_time.desc');

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
      take(1),
      catchError((error) => {
        console.error('Failed to create meeting:', error);
        throw error;
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
        throw error;
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
        throw error;
      })
    );
  }

  public addMeetingParticipant(meetingId: string, participant: Partial<MeetingParticipant>): Observable<MeetingParticipant> {
    return this.http.post<MeetingParticipant>(`/api/meetings/${meetingId}/participants`, participant).pipe(
      take(1),
      catchError((error) => {
        console.error(`Failed to add participant to meeting ${meetingId}:`, error);
        throw error;
      })
    );
  }

  public updateMeetingParticipant(meetingId: string, participantId: string, participant: Partial<MeetingParticipant>): Observable<MeetingParticipant> {
    return this.http.put<MeetingParticipant>(`/api/meetings/${meetingId}/participants/${participantId}`, participant).pipe(
      take(1),
      catchError((error) => {
        console.error(`Failed to update participant ${participantId} in meeting ${meetingId}:`, error);
        throw error;
      })
    );
  }

  public deleteMeetingParticipant(meetingId: string, participantId: string): Observable<void> {
    return this.http.delete<void>(`/api/meetings/${meetingId}/participants/${participantId}`).pipe(
      take(1),
      catchError((error) => {
        console.error(`Failed to delete participant ${participantId} from meeting ${meetingId}:`, error);
        throw error;
      })
    );
  }

  public getMeetingAttachments(meetingId: string): Observable<MeetingAttachment[]> {
    return this.http.get<MeetingAttachment[]>(`/api/meetings/${meetingId}/attachments`).pipe(
      catchError((error) => {
        console.error(`Failed to load attachments for meeting ${meetingId}:`, error);
        return of([]);
      })
    );
  }

  public uploadFileToStorage(file: File): Observable<UploadFileResponse> {
    return defer(() => this.readFileAsBase64(file)).pipe(
      switchMap((base64Data: string) => {
        // Generate a temporary path for the file
        const timestamp = Date.now();
        const sanitizedFilename = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
        const tempPath = `temp/${timestamp}_${sanitizedFilename}`;

        const uploadData = {
          fileName: file.name,
          fileData: base64Data,
          mimeType: file.type,
          fileSize: file.size,
          filePath: tempPath,
        };

        return this.http.post<UploadFileResponse>('/api/meetings/storage/upload', uploadData);
      }),
      catchError((error) => {
        console.error(`Failed to upload file ${file.name}:`, error);
        return throwError(() => error);
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
              throw error;
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

  public createAttachmentFromUrl(meetingId: string, fileName: string, fileUrl: string, fileSize: number, mimeType: string): Observable<MeetingAttachment> {
    const attachmentData = {
      meeting_id: meetingId,
      file_name: fileName,
      file_url: fileUrl,
      file_size: fileSize,
      mime_type: mimeType,
    };

    return this.http.post<MeetingAttachment>(`/api/meetings/${meetingId}/attachments`, attachmentData).pipe(
      take(1),
      catchError((error) => {
        console.error(`Failed to create attachment for meeting ${meetingId}:`, error);
        throw error;
      })
    );
  }

  public deleteAttachment(meetingId: string, attachmentId: string): Observable<void> {
    return this.http.delete<void>(`/api/meetings/${meetingId}/attachments/${attachmentId}`).pipe(
      take(1),
      catchError((error) => {
        console.error(`Failed to delete attachment ${attachmentId} from meeting ${meetingId}:`, error);
        throw error;
      })
    );
  }

  public generateAgenda(request: GenerateAgendaRequest): Observable<GenerateAgendaResponse> {
    return this.http.post<GenerateAgendaResponse>('/api/meetings/generate-agenda', request).pipe(
      take(1),
      catchError((error) => {
        console.error('Failed to generate meeting agenda:', error);
        throw error;
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
}

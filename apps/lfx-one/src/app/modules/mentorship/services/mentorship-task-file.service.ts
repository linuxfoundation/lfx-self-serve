// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable, PLATFORM_ID } from '@angular/core';
import { serverAuthoredMessage } from '@app/shared/utils/http-error.utils';
import {
  MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE,
  MENTORSHIP_MENTEE_TASK_FILE_ERROR_FALLBACK,
  MENTORSHIP_MENTEE_TASK_FILE_ERROR_MESSAGES,
  MENTORSHIP_MENTEE_TASK_FILE_EXTENSIONS,
  MENTORSHIP_MENTEE_TASK_FILE_MAX_BYTES,
  MENTORSHIP_MENTEE_TASK_FILE_PAST_DUE_MESSAGE,
  MENTORSHIP_MENTEE_TASK_FILE_REMOVE_ERROR_SUMMARY,
  MENTORSHIP_MENTEE_TASK_FILE_REMOVE_SUCCESS_DETAIL,
  MENTORSHIP_MENTEE_TASK_FILE_REMOVE_SUCCESS_SUMMARY,
  MENTORSHIP_MENTEE_TASK_FILE_STALE_STATUSES,
  MENTORSHIP_MENTEE_TASK_FILE_TOO_LARGE_MESSAGE,
  MENTORSHIP_MENTEE_TASK_FILE_TYPE_MESSAGE,
  MENTORSHIP_MENTEE_TASK_FILE_UPLOAD_ERROR_SUMMARY,
  MENTORSHIP_MENTEE_TASK_FILE_UPLOAD_SUCCESS_DETAIL,
  MENTORSHIP_MENTEE_TASK_FILE_UPLOAD_SUCCESS_SUMMARY,
  MENTORSHIP_MENTEE_TASK_PAST_DUE_ERROR_CODE,
  MENTORSHIP_MENTEE_TASK_STATUS_TOAST_LIFE,
  MENTORSHIP_TASK_FILE_DOWNLOAD_ERROR_FALLBACK,
  MENTORSHIP_TASK_FILE_DOWNLOAD_ERROR_MESSAGES,
  MENTORSHIP_TASK_FILE_DOWNLOAD_ERROR_SUMMARY,
  MENTORSHIP_TASK_FILE_DOWNLOAD_FALLBACK_NAME,
  MENTORSHIP_TASK_FILE_DOWNLOAD_TOAST_LIFE,
} from '@lfx-one/shared/constants';
import { downloadFromUrl, parseContentDispositionFilename } from '@lfx-one/shared/utils';
import { MentorshipService } from '@services/mentorship.service';
import { MentorshipMenteeService } from '@services/mentorship-mentee.service';
import { MessageService } from 'primeng/api';
import { catchError, map, Observable, of } from 'rxjs';

/**
 * Task submission files for the mentorship pages: the mentee uploads, replaces and removes a task's file, and the mentee
 * and the task's reviewers download it. Kept out of the rows so they hold no `HttpClient` or `MessageService`.
 *
 * `upload` and `remove` never error: they emit `true` once the change is saved and `false` when it is not, after showing
 * why. A success leaves the refresh to `MentorshipMenteeService`, which drops the cached applications; a failure that
 * means the row is out of date (`MENTORSHIP_MENTEE_TASK_FILE_STALE_STATUSES`) re-reads them too. Callers must not cancel
 * the returned observable when their view goes away, for the same reason as `MenteeTaskStatusService`.
 */
@Injectable({ providedIn: 'root' })
export class MentorshipTaskFileService {
  private readonly menteeService = inject(MentorshipMenteeService);
  private readonly mentorshipService = inject(MentorshipService);
  private readonly messageService = inject(MessageService);
  private readonly platformId = inject(PLATFORM_ID);

  /** Checks the file's size and extension first, so a file upstream would refuse is never sent. */
  public upload(taskId: string, file: File): Observable<boolean> {
    const invalid = this.validateFile(file);
    if (invalid) {
      this.toastError(MENTORSHIP_MENTEE_TASK_FILE_UPLOAD_ERROR_SUMMARY, invalid);
      return of(false);
    }
    return this.menteeService.uploadMenteeTaskFile(taskId, file).pipe(
      map(() => {
        this.toastSuccess(MENTORSHIP_MENTEE_TASK_FILE_UPLOAD_SUCCESS_SUMMARY, MENTORSHIP_MENTEE_TASK_FILE_UPLOAD_SUCCESS_DETAIL);
        return true;
      }),
      catchError((err: HttpErrorResponse) => {
        console.error('[MentorshipTaskFileService] upload failed', { status: err.status });
        this.showChangeError(MENTORSHIP_MENTEE_TASK_FILE_UPLOAD_ERROR_SUMMARY, err);
        return of(false);
      })
    );
  }

  public remove(taskId: string): Observable<boolean> {
    return this.menteeService.deleteMenteeTaskFile(taskId).pipe(
      map(() => {
        this.toastSuccess(MENTORSHIP_MENTEE_TASK_FILE_REMOVE_SUCCESS_SUMMARY, MENTORSHIP_MENTEE_TASK_FILE_REMOVE_SUCCESS_DETAIL);
        return true;
      }),
      catchError((err: HttpErrorResponse) => {
        console.error('[MentorshipTaskFileService] remove failed', { status: err.status });
        this.showChangeError(MENTORSHIP_MENTEE_TASK_FILE_REMOVE_ERROR_SUMMARY, err);
        return of(false);
      })
    );
  }

  /** Saves the task's file under the name the server sends. Browser only; a failure is toasted. */
  public download(taskId: string): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.mentorshipService.downloadTaskFile(taskId).subscribe({
      next: (response) => {
        const blob = response.body;
        if (!blob) return;
        const fileName = parseContentDispositionFilename(response.headers.get('Content-Disposition')) ?? MENTORSHIP_TASK_FILE_DOWNLOAD_FALLBACK_NAME;
        const url = URL.createObjectURL(blob);
        downloadFromUrl(url, fileName);
        // Deferred: some browsers start the download asynchronously, and revoking at once can invalidate the URL first.
        setTimeout(() => URL.revokeObjectURL(url), 0);
      },
      error: (err: HttpErrorResponse) => {
        this.messageService.add({
          severity: 'error',
          summary: MENTORSHIP_TASK_FILE_DOWNLOAD_ERROR_SUMMARY,
          detail: MENTORSHIP_TASK_FILE_DOWNLOAD_ERROR_MESSAGES[err.status] ?? MENTORSHIP_TASK_FILE_DOWNLOAD_ERROR_FALLBACK,
          life: MENTORSHIP_TASK_FILE_DOWNLOAD_TOAST_LIFE,
        });
      },
    });
  }

  private validateFile(file: File): string | null {
    const dot = file.name.lastIndexOf('.');
    const extension = dot === -1 ? '' : file.name.slice(dot).toLowerCase();
    if (!MENTORSHIP_MENTEE_TASK_FILE_EXTENSIONS.includes(extension)) return MENTORSHIP_MENTEE_TASK_FILE_TYPE_MESSAGE;
    if (file.size > MENTORSHIP_MENTEE_TASK_FILE_MAX_BYTES) return MENTORSHIP_MENTEE_TASK_FILE_TOO_LARGE_MESSAGE;
    if (file.size === 0) return MENTORSHIP_MENTEE_TASK_FILE_ERROR_MESSAGES[400];
    return null;
  }

  private showChangeError(summary: string, err: HttpErrorResponse): void {
    const code = (err.error as { code?: string } | null | undefined)?.code;
    let detail = MENTORSHIP_MENTEE_TASK_FILE_ERROR_MESSAGES[err.status] ?? MENTORSHIP_MENTEE_TASK_FILE_ERROR_FALLBACK;

    if (err.status === 403 && code === MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE) {
      detail = serverAuthoredMessage(err, MENTORSHIP_MENTEE_TASK_FILE_ERROR_FALLBACK);
    } else if (err.status === 400 && code === MENTORSHIP_MENTEE_TASK_PAST_DUE_ERROR_CODE) {
      detail = MENTORSHIP_MENTEE_TASK_FILE_PAST_DUE_MESSAGE;
      this.menteeService.clearMenteeCaches();
    } else if (MENTORSHIP_MENTEE_TASK_FILE_STALE_STATUSES.includes(err.status)) {
      this.menteeService.clearMenteeCaches();
    }

    this.toastError(summary, detail);
  }

  private toastSuccess(summary: string, detail: string): void {
    this.messageService.add({ severity: 'success', summary, detail, life: MENTORSHIP_MENTEE_TASK_STATUS_TOAST_LIFE });
  }

  private toastError(summary: string, detail: string): void {
    this.messageService.add({ severity: 'error', summary, detail, life: MENTORSHIP_MENTEE_TASK_STATUS_TOAST_LIFE });
  }
}

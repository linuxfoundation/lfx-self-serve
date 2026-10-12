// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable, PLATFORM_ID } from '@angular/core';
import {
  MENTORSHIP_ADMIN_MENTEES_EXPORT_EMPTY_MESSAGES,
  MENTORSHIP_ADMIN_MENTEES_EXPORT_EMPTY_SUMMARY,
  MENTORSHIP_ADMIN_MENTEES_EXPORT_ERROR_MESSAGE,
  MENTORSHIP_ADMIN_MENTEES_EXPORT_ERROR_SUMMARY,
  MENTORSHIP_ADMIN_MENTEES_EXPORT_FALLBACK_NAME,
  MENTORSHIP_ADMIN_MENTEES_EXPORT_FORBIDDEN_MESSAGE,
  MENTORSHIP_ADMIN_MENTEES_EXPORT_TOAST_LIFE,
  MENTORSHIP_ADMIN_MENTEES_EXPORT_TRUNCATED_HEADER,
  MENTORSHIP_ADMIN_MENTEES_EXPORT_TRUNCATED_SUMMARY,
  MENTORSHIP_ADMIN_MENTEES_EXPORT_TRUNCATED_TEMPLATE,
} from '@lfx-one/shared/constants';
import { MentorshipAdminMenteeStatusFilter, MentorshipAdminMenteeTab } from '@lfx-one/shared/interfaces';
import { downloadFromUrl, parseContentDispositionFilename } from '@lfx-one/shared/utils';
import { MentorshipAdminService } from '@services/mentorship-admin.service';
import { MessageService } from 'primeng/api';
import { catchError, map, Observable, of } from 'rxjs';

/**
 * Download by Status on Current and Past Mentees: saves the BFF's CSV of the tab's mentees with one status, or all of
 * them, under the name the server sends.
 *
 * `download` never errors: it emits once the request settles, after saving the file or showing why there is none (no
 * mentee matches, or the read failed). A file the BFF cut short at its page cap is still saved, with a warning that it
 * holds only the first rows. Off the browser it emits at once and reads nothing.
 */
@Injectable({ providedIn: 'root' })
export class MentorshipMenteesExportService {
  private readonly adminService = inject(MentorshipAdminService);
  private readonly messageService = inject(MessageService);
  private readonly platformId = inject(PLATFORM_ID);

  public download(programId: string, tab: MentorshipAdminMenteeTab, status: MentorshipAdminMenteeStatusFilter | null): Observable<void> {
    if (!isPlatformBrowser(this.platformId)) return of(undefined);

    return this.adminService.exportProgramMentees(programId, tab, status).pipe(
      map((response) => {
        const blob = response.body;
        if (response.status === 204 || !blob || blob.size === 0) {
          this.toast('info', MENTORSHIP_ADMIN_MENTEES_EXPORT_EMPTY_SUMMARY, MENTORSHIP_ADMIN_MENTEES_EXPORT_EMPTY_MESSAGES[tab]);
          return;
        }
        const fileName = parseContentDispositionFilename(response.headers.get('Content-Disposition')) ?? MENTORSHIP_ADMIN_MENTEES_EXPORT_FALLBACK_NAME;
        const url = URL.createObjectURL(blob);
        downloadFromUrl(url, fileName);
        // Deferred: some browsers start the download asynchronously, and revoking at once can invalidate the URL first.
        setTimeout(() => URL.revokeObjectURL(url), 0);
        const truncatedAt = response.headers.get(MENTORSHIP_ADMIN_MENTEES_EXPORT_TRUNCATED_HEADER);
        if (truncatedAt) {
          const rows = Number(truncatedAt);
          const count = Number.isFinite(rows) ? rows.toLocaleString('en-US') : truncatedAt;
          this.toast('warn', MENTORSHIP_ADMIN_MENTEES_EXPORT_TRUNCATED_SUMMARY, MENTORSHIP_ADMIN_MENTEES_EXPORT_TRUNCATED_TEMPLATE.replace('{count}', count));
        }
      }),
      catchError((err: HttpErrorResponse) => {
        const detail = err.status === 403 ? MENTORSHIP_ADMIN_MENTEES_EXPORT_FORBIDDEN_MESSAGE : MENTORSHIP_ADMIN_MENTEES_EXPORT_ERROR_MESSAGE;
        this.toast('error', MENTORSHIP_ADMIN_MENTEES_EXPORT_ERROR_SUMMARY, detail);
        return of(undefined);
      })
    );
  }

  private toast(severity: 'info' | 'warn' | 'error', summary: string, detail: string): void {
    this.messageService.add({ severity, summary, detail, life: MENTORSHIP_ADMIN_MENTEES_EXPORT_TOAST_LIFE });
  }
}

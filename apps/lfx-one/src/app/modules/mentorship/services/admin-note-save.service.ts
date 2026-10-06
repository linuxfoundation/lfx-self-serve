// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { serverAuthoredMessage } from '@app/shared/utils/http-error.utils';
import {
  MENTORSHIP_ADMIN_NOTE_CLEAR_SUCCESS_SUMMARY,
  MENTORSHIP_ADMIN_NOTE_SAVE_ERROR_FALLBACK,
  MENTORSHIP_ADMIN_NOTE_SAVE_ERROR_MESSAGES,
  MENTORSHIP_ADMIN_NOTE_SAVE_ERROR_SUMMARY,
  MENTORSHIP_ADMIN_NOTE_SAVE_SUCCESS_SUMMARY,
  MENTORSHIP_ADMIN_NOTE_TOAST_LIFE,
  MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE,
} from '@lfx-one/shared/constants';
import { MentorshipAdminSavedNote, MentorshipAdminVersionedNote } from '@lfx-one/shared/interfaces';
import { MentorshipAdminService } from '@services/mentorship-admin.service';
import { MessageService } from 'primeng/api';
import { catchError, defer, finalize, map, Observable, of, Subject } from 'rxjs';

/**
 * Saves an admin's reviewer note on an application and toasts the outcome, for the admin program detail.
 * The caller handles no error: `save` emits `true` once the note is saved and `false` when it was not,
 * after showing why. A 403 (no longer an admin of the program) and a 404 (the application is gone) get
 * their own copy; the impersonation guard's 403 shows the server's message.
 *
 * Which notes are saving, and each note saved, live here rather than in the tab: switching tabs destroys
 * the Current Mentees tab, so a save can outlive the tab that started it and settle in a new one. Each
 * saved note is kept with a version, so a page read that started before a save can lay it over its answer.
 */
@Injectable({ providedIn: 'root' })
export class AdminNoteSaveService {
  private readonly adminService = inject(MentorshipAdminService);
  private readonly messageService = inject(MessageService);

  private readonly savingIds = new Set<string>();
  private readonly savedNotes = new Subject<MentorshipAdminSavedNote>();
  /** The last note saved for each application, with the version it was saved at. */
  private readonly latestSaved = new Map<string, MentorshipAdminVersionedNote>();
  private savedVersion = 0;

  /** Each note once saved, for the tab on screen to write into its row, whichever tab started the save. */
  public readonly saved$: Observable<MentorshipAdminSavedNote> = this.savedNotes.asObservable();

  /** Whether the application's note is being saved; its dialog stays shut meanwhile, so it never opens on a stale note. */
  public isSaving(applicationId: string): boolean {
    return this.savingIds.has(applicationId);
  }

  /** The version of the last save; a page read takes it as it starts and hands it to `notesSavedSince` once answered. */
  public currentVersion(): number {
    return this.savedVersion;
  }

  /**
   * The notes saved after `version`, by application id. A page read that started before such a save may answer with
   * the note from before it, so these notes win over what the read returned.
   */
  public notesSavedSince(version: number): ReadonlyMap<string, string> {
    const notes = new Map<string, string>();
    this.latestSaved.forEach((saved, applicationId) => {
      if (saved.version > version) notes.set(applicationId, saved.note);
    });
    return notes;
  }

  /** Saves the note, already trimmed; an empty note clears it. */
  public save(applicationId: string, note: string): Observable<boolean> {
    return defer(() => {
      this.savingIds.add(applicationId);
      return this.adminService.updateApplicationNote(applicationId, note);
    }).pipe(
      map(() => {
        this.messageService.add({
          severity: 'success',
          summary: note ? MENTORSHIP_ADMIN_NOTE_SAVE_SUCCESS_SUMMARY : MENTORSHIP_ADMIN_NOTE_CLEAR_SUCCESS_SUMMARY,
          life: MENTORSHIP_ADMIN_NOTE_TOAST_LIFE,
        });
        this.savedVersion += 1;
        this.latestSaved.set(applicationId, { note, version: this.savedVersion });
        this.savedNotes.next({ applicationId, note });
        return true;
      }),
      catchError((err: HttpErrorResponse) => {
        this.showSaveError(err);
        return of(false);
      }),
      finalize(() => this.savingIds.delete(applicationId))
    );
  }

  private showSaveError(err: HttpErrorResponse): void {
    const code = (err.error as { code?: string } | null | undefined)?.code;
    let detail = MENTORSHIP_ADMIN_NOTE_SAVE_ERROR_MESSAGES[err.status] ?? MENTORSHIP_ADMIN_NOTE_SAVE_ERROR_FALLBACK;
    if (err.status === 403 && code === MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE) {
      detail = serverAuthoredMessage(err, MENTORSHIP_ADMIN_NOTE_SAVE_ERROR_FALLBACK);
    }

    this.messageService.add({ severity: 'error', summary: MENTORSHIP_ADMIN_NOTE_SAVE_ERROR_SUMMARY, detail, life: MENTORSHIP_ADMIN_NOTE_TOAST_LIFE });
  }
}

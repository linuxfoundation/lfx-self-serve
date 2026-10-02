// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import {
  MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE,
  MENTORSHIP_MENTOR_NOTE_CLEAR_SUCCESS_SUMMARY,
  MENTORSHIP_MENTOR_NOTE_SAVE_ERROR_FALLBACK,
  MENTORSHIP_MENTOR_NOTE_SAVE_ERROR_MESSAGES,
  MENTORSHIP_MENTOR_NOTE_SAVE_ERROR_SUMMARY,
  MENTORSHIP_MENTOR_NOTE_SAVE_SUCCESS_SUMMARY,
} from '@lfx-one/shared/constants';
import { MentorshipMentorService } from '@services/mentorship-mentor.service';
import { MessageService } from 'primeng/api';
import { firstValueFrom, Observable, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MentorNoteSaveService } from './mentor-note-save.service';

describe('MentorNoteSaveService', () => {
  const APPLICATION_ID = '5d1c8e2f-3a4b-4c6d-8e9f-0a1b2c3d4e5f';

  let service: MentorNoteSaveService;
  let add: ReturnType<typeof vi.fn>;
  let updateApplicationNote: ReturnType<typeof vi.fn<(applicationId: string, note: string) => Observable<void>>>;

  const httpError = (status: number, error: unknown = null) => new HttpErrorResponse({ status, error });

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    add = vi.fn();
    updateApplicationNote = vi.fn(() => of(undefined));

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: MessageService, useValue: { add } },
        { provide: MentorshipMentorService, useValue: { updateApplicationNote } },
      ],
    });

    service = TestBed.inject(MentorNoteSaveService);
  });

  it('saves the note, toasts success and emits true', async () => {
    await expect(firstValueFrom(service.save(APPLICATION_ID, 'Strong screening call.'))).resolves.toBe(true);

    expect(updateApplicationNote).toHaveBeenCalledWith(APPLICATION_ID, 'Strong screening call.');
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success', summary: MENTORSHIP_MENTOR_NOTE_SAVE_SUCCESS_SUMMARY }));
  });

  it('toasts a cleared note as cleared', async () => {
    await expect(firstValueFrom(service.save(APPLICATION_ID, ''))).resolves.toBe(true);

    expect(updateApplicationNote).toHaveBeenCalledWith(APPLICATION_ID, '');
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success', summary: MENTORSHIP_MENTOR_NOTE_CLEAR_SUCCESS_SUMMARY }));
  });

  it.each([403, 404])('shows the %i copy and emits false', async (status) => {
    updateApplicationNote.mockReturnValueOnce(throwError(() => httpError(status, { error: 'upstream text' })));

    await expect(firstValueFrom(service.save(APPLICATION_ID, 'Note'))).resolves.toBe(false);

    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'error',
        summary: MENTORSHIP_MENTOR_NOTE_SAVE_ERROR_SUMMARY,
        detail: MENTORSHIP_MENTOR_NOTE_SAVE_ERROR_MESSAGES[status],
      })
    );
  });

  it("shows the server's message for the impersonation guard's 403", async () => {
    updateApplicationNote.mockReturnValueOnce(
      throwError(() => httpError(403, { error: 'Read-only while impersonating.', code: MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE }))
    );

    await expect(firstValueFrom(service.save(APPLICATION_ID, 'Note'))).resolves.toBe(false);

    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: 'Read-only while impersonating.' }));
  });

  it('shows the fallback for any other failure', async () => {
    updateApplicationNote.mockReturnValueOnce(throwError(() => httpError(503)));

    await expect(firstValueFrom(service.save(APPLICATION_ID, 'Note'))).resolves.toBe(false);

    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: MENTORSHIP_MENTOR_NOTE_SAVE_ERROR_FALLBACK }));
  });
});

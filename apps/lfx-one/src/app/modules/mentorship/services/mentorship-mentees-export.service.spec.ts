// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse, HttpHeaders, HttpResponse } from '@angular/common/http';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
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
} from '@lfx-one/shared/constants';
import { MentorshipAdminMenteeStatusFilter, MentorshipAdminMenteeTab } from '@lfx-one/shared/interfaces';
import { MentorshipAdminService } from '@services/mentorship-admin.service';
import { MessageService } from 'primeng/api';
import { Observable, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MentorshipMenteesExportService } from './mentorship-mentees-export.service';

describe('MentorshipMenteesExportService', () => {
  const PROGRAM_ID = '7a9b1c3d-5e6f-4a8b-9c0d-1e2f3a4b5c6d';

  let service: MentorshipMenteesExportService;
  let add: ReturnType<typeof vi.fn>;
  let exportProgramMentees: ReturnType<
    typeof vi.fn<(id: string, tab: MentorshipAdminMenteeTab, status: MentorshipAdminMenteeStatusFilter | null) => Observable<HttpResponse<Blob>>>
  >;
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;
  let savedAs: string[];
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  const responseWith = (body: Blob | null, options: { status?: number; disposition?: string; truncatedAt?: string } = {}) => {
    let headers = new HttpHeaders();
    if (options.disposition) headers = headers.set('Content-Disposition', options.disposition);
    if (options.truncatedAt) headers = headers.set(MENTORSHIP_ADMIN_MENTEES_EXPORT_TRUNCATED_HEADER, options.truncatedAt);
    return new HttpResponse<Blob>({ body, status: options.status ?? 200, headers });
  };

  const configure = (platformId: 'browser' | 'server' = 'browser') => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        MentorshipMenteesExportService,
        { provide: PLATFORM_ID, useValue: platformId },
        { provide: MessageService, useValue: { add } },
        { provide: MentorshipAdminService, useValue: { exportProgramMentees } },
      ],
    });
    service = TestBed.inject(MentorshipMenteesExportService);
  };

  /** Subscribes and reports whether the observable emitted and completed, as the tab relies on both. */
  const run = (status: MentorshipAdminMenteeStatusFilter | null, tab: MentorshipAdminMenteeTab = 'current') => {
    const seen = { emitted: 0, completed: false, errored: false };
    service.download(PROGRAM_ID, tab, status).subscribe({
      next: () => seen.emitted++,
      complete: () => (seen.completed = true),
      error: () => (seen.errored = true),
    });
    return seen;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    add = vi.fn();
    exportProgramMentees = vi.fn();
    createObjectURL = vi.fn(() => 'blob:http://example.com/mentees-1');
    revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;
    savedAs = [];
    // Captures the name `downloadFromUrl` puts on the anchor without letting jsdom navigate.
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      savedAs.push(this.download);
    });
    configure();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  it('saves the CSV under the name from Content-Disposition, revokes the URL afterwards, and completes', () => {
    const blob = new Blob(['Name\r\nAda'], { type: 'text/csv' });
    exportProgramMentees.mockReturnValueOnce(of(responseWith(blob, { disposition: 'attachment; filename="current-mentees-accepted.csv"' })));

    const seen = run('accepted');

    expect(exportProgramMentees).toHaveBeenCalledWith(PROGRAM_ID, 'current', 'accepted');
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(savedAs).toEqual(['current-mentees-accepted.csv']);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:http://example.com/mentees-1');
    expect(add).not.toHaveBeenCalled();
    expect(seen).toEqual({ emitted: 1, completed: true, errored: false });
  });

  it('still saves a cut-short file, then warns that it holds only the first rows', () => {
    const blob = new Blob(['Name\r\nAda'], { type: 'text/csv' });
    exportProgramMentees.mockReturnValueOnce(of(responseWith(blob, { disposition: 'attachment; filename="past-mentees-all.csv"', truncatedAt: '2500' })));

    const seen = run(null, 'past');

    expect(savedAs).toEqual(['past-mentees-all.csv']);
    expect(add).toHaveBeenCalledWith({
      severity: 'warn',
      summary: MENTORSHIP_ADMIN_MENTEES_EXPORT_TRUNCATED_SUMMARY,
      detail: 'The file holds only the first 2,500 mentees: this program has more than one download can include.',
      life: MENTORSHIP_ADMIN_MENTEES_EXPORT_TOAST_LIFE,
    });
    expect(seen).toEqual({ emitted: 1, completed: true, errored: false });
  });

  it('passes null through for All and falls back to the default name when none is sent', () => {
    exportProgramMentees.mockReturnValueOnce(of(responseWith(new Blob(['Name\r\nAda']))));

    run(null, 'past');

    expect(exportProgramMentees).toHaveBeenCalledWith(PROGRAM_ID, 'past', null);
    expect(savedAs).toEqual([MENTORSHIP_ADMIN_MENTEES_EXPORT_FALLBACK_NAME]);
  });

  it.each(['current', 'past'] as const)('saves nothing on a 204 and says no %s mentee has the status', (tab) => {
    exportProgramMentees.mockReturnValueOnce(of(responseWith(null, { status: 204 })));

    const seen = run('graduated', tab);

    expect(createObjectURL).not.toHaveBeenCalled();
    expect(savedAs).toEqual([]);
    expect(add).toHaveBeenCalledWith({
      severity: 'info',
      summary: MENTORSHIP_ADMIN_MENTEES_EXPORT_EMPTY_SUMMARY,
      detail: MENTORSHIP_ADMIN_MENTEES_EXPORT_EMPTY_MESSAGES[tab],
      life: MENTORSHIP_ADMIN_MENTEES_EXPORT_TOAST_LIFE,
    });
    expect(seen).toEqual({ emitted: 1, completed: true, errored: false });
  });

  it.each([
    [403, MENTORSHIP_ADMIN_MENTEES_EXPORT_FORBIDDEN_MESSAGE],
    [500, MENTORSHIP_ADMIN_MENTEES_EXPORT_ERROR_MESSAGE],
    [0, MENTORSHIP_ADMIN_MENTEES_EXPORT_ERROR_MESSAGE],
  ])('toasts a %i and still completes without erroring', (status, detail) => {
    exportProgramMentees.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status })));

    const seen = run(null);

    expect(add).toHaveBeenCalledWith({
      severity: 'error',
      summary: MENTORSHIP_ADMIN_MENTEES_EXPORT_ERROR_SUMMARY,
      detail,
      life: MENTORSHIP_ADMIN_MENTEES_EXPORT_TOAST_LIFE,
    });
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(seen).toEqual({ emitted: 1, completed: true, errored: false });
  });

  it('reads nothing on the server', () => {
    configure('server');

    const seen = run('accepted');

    expect(exportProgramMentees).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
    expect(seen).toEqual({ emitted: 1, completed: true, errored: false });
  });
});

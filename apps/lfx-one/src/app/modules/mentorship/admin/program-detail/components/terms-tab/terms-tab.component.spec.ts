// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import {
  MENTORSHIP_ADMIN_TERM_WRITE_FAILED_MESSAGE,
  MENTORSHIP_ADMIN_TERM_WRITE_IN_FLIGHT_MESSAGE,
  MENTORSHIP_ADMIN_TERMS_MAX_PAGES,
} from '@lfx-one/shared/constants';
import { MentorshipAdminTermsQuery, MentorshipAdminTermsResponse, MentorshipProgramTermRow } from '@lfx-one/shared/interfaces';
import { MentorshipAdminService } from '@services/mentorship-admin.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { Observable, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TermsTabComponent } from './terms-tab.component';

describe('TermsTabComponent', () => {
  const term = (overrides: Partial<MentorshipProgramTermRow> = {}): MentorshipProgramTermRow => ({
    id: 'trm_1',
    name: 'Fall 2026',
    status: 'open',
    pending: 3,
    declined: 1,
    accepted: 2,
    graduated: 0,
    startDate: '2099-09-01',
    endDate: '2099-12-01',
    applicationStartDate: '2099-06-01',
    applicationEndDate: '2099-08-01',
    ...overrides,
  });

  const page = (): MentorshipAdminTermsResponse => ({
    data: [term(), term({ id: 'trm_2', name: 'Spring 2025', status: 'closed', startDate: '2025-03-01', endDate: '2025-06-01' })],
    total: 2,
  });

  let fixture: ComponentFixture<TermsTabComponent>;
  let createTerm: ReturnType<typeof vi.fn>;
  let updateTerm: ReturnType<typeof vi.fn>;
  let closeTerm: ReturnType<typeof vi.fn>;
  let reopenTerm: ReturnType<typeof vi.fn>;
  let deleteTerm: ReturnType<typeof vi.fn>;
  let getProgramTerms: ReturnType<typeof vi.fn<(programId: string, query: MentorshipAdminTermsQuery) => Observable<MentorshipAdminTermsResponse>>>;

  /** Runs the effects that start a read, then renders what it wrote. */
  const settle = (): void => {
    fixture.detectChanges();
    fixture.detectChanges();
  };

  beforeEach(() => {
    getProgramTerms = vi.fn().mockReturnValue(of(page()));
    createTerm = vi.fn().mockReturnValue(of(term()));
    updateTerm = vi.fn().mockReturnValue(of(term()));
    closeTerm = vi.fn().mockReturnValue(of(undefined));
    reopenTerm = vi.fn().mockReturnValue(of(undefined));
    deleteTerm = vi.fn().mockReturnValue(of(undefined));

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [TermsTabComponent],
      providers: [
        provideNoopAnimations(),
        MessageService,
        { provide: DialogService, useValue: { open: vi.fn() } },
        { provide: MentorshipAdminService, useValue: { getProgramTerms, createTerm, updateTerm, closeTerm, reopenTerm, deleteTerm } },
      ],
    });

    fixture = TestBed.createComponent(TermsTabComponent);
    fixture.componentRef.setInput('programId', 'prog_1');
    settle();
  });

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const rowText = (id: string): string => (element().querySelector(`[data-testid="mentorship-term-row-${id}"]`)?.textContent ?? '').replace(/\s+/g, ' ');

  it('reads a program whose terms fit one page in one read at the upstream maximum', () => {
    expect(getProgramTerms).toHaveBeenCalledTimes(1);
    expect(getProgramTerms).toHaveBeenCalledWith('prog_1', { offset: 0, limit: 50 });
  });

  it('follows the pages until total is read, and shows every term', () => {
    getProgramTerms.mockImplementation((_programId, query) =>
      of({ data: [term({ id: `trm_at_${query.offset}`, name: `Term ${query.offset}` })], total: 120 } satisfies MentorshipAdminTermsResponse)
    );
    fixture.componentInstance['onRetry']();
    settle();

    expect(getProgramTerms.mock.calls.slice(1).map(([, query]) => query)).toEqual([
      { offset: 0, limit: 50 },
      { offset: 50, limit: 50 },
      { offset: 100, limit: 50 },
    ]);
    expect(element().querySelector('[data-testid="mentorship-term-row-trm_at_100"]')).not.toBeNull();
  });

  it('stops after the page cap when total never runs out', () => {
    getProgramTerms.mockImplementation(() => of({ data: [term()], total: Number.MAX_SAFE_INTEGER } satisfies MentorshipAdminTermsResponse));
    fixture.componentInstance['onRetry']();
    settle();

    expect(getProgramTerms).toHaveBeenCalledTimes(1 + MENTORSHIP_ADMIN_TERMS_MAX_PAGES);
  });

  it('shows the inline error when a later page fails', () => {
    getProgramTerms.mockImplementation((_programId, query) =>
      query.offset ? throwError(() => new HttpErrorResponse({ status: 503 })) : of({ data: [term()], total: 60 } satisfies MentorshipAdminTermsResponse)
    );
    fixture.componentInstance['onRetry']();
    settle();

    expect(element().querySelector('[data-testid="mentorship-admin-terms-load-error"]')).not.toBeNull();
  });

  it('shows each term with its status and application counts', () => {
    expect(rowText('trm_1')).toContain('Fall 2026');
    expect(rowText('trm_1')).toContain('Open');
    expect(rowText('trm_2')).toContain('Spring 2025');
    expect(rowText('trm_2')).toContain('Closed');
  });

  it('shows the empty state when the program has no terms', () => {
    getProgramTerms.mockReturnValue(of({ data: [], total: 0 }));
    fixture.componentInstance['onRetry']();
    settle();

    expect(element().querySelector('[data-testid="mentorship-terms-empty"]')).not.toBeNull();
  });

  it('shows an inline error with Retry when the read fails, and reads again on Retry', () => {
    getProgramTerms.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    fixture.componentInstance['onRetry']();
    settle();

    expect(element().querySelector('[data-testid="mentorship-admin-terms-load-error"]')).not.toBeNull();
    expect(element().querySelector('table')).toBeNull();

    getProgramTerms.mockReturnValue(of(page()));
    element().querySelector<HTMLElement>('[data-testid="mentorship-admin-terms-retry"]')?.querySelector<HTMLButtonElement>('button')?.click();
    settle();

    expect(element().querySelector('[data-testid="mentorship-admin-terms-load-error"]')).toBeNull();
    expect(element().querySelector('[data-testid="mentorship-term-row-trm_1"]')).not.toBeNull();
  });

  it('allows a new term while fewer than the maximum are open', () => {
    expect(fixture.componentInstance['canAddTerm']()).toBe(true);
  });

  it('blocks a new term and shows no max-terms message while the read is in flight', () => {
    getProgramTerms.mockReturnValue(new Observable<MentorshipAdminTermsResponse>());
    fixture.componentInstance['onRetry']();
    settle();

    expect(fixture.componentInstance['canAddTerm']()).toBe(false);
    expect(fixture.componentInstance['atMaxOpenTerms']()).toBe(false);
  });

  it('blocks a new term and shows no max-terms message after a failed read', () => {
    getProgramTerms.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    fixture.componentInstance['onRetry']();
    settle();

    expect(fixture.componentInstance['canAddTerm']()).toBe(false);
    expect(fixture.componentInstance['atMaxOpenTerms']()).toBe(false);
  });

  describe('term writes', () => {
    const countsRefresh = vi.fn();
    let toasts: ReturnType<typeof vi.spyOn>;

    /** Confirms the dialog the action opens, as the user pressing the accept button would. */
    const confirmAction = (action: string, id: string): void => {
      const confirmation = fixture.debugElement.injector.get(ConfirmationService);
      vi.spyOn(confirmation, 'confirm').mockImplementation((options) => {
        options.accept?.();
        return confirmation;
      });
      fixture.componentInstance[action as 'onCloseTerm'](id);
      settle();
    };

    beforeEach(() => {
      getProgramTerms.mockReturnValue(of({ data: [term({ accepted: 0 })], total: 1 }));
      countsRefresh.mockClear();
      fixture.componentRef.setInput('countsRefresh', countsRefresh);
      fixture.componentInstance['onRetry']();
      toasts = vi.spyOn(TestBed.inject(MessageService), 'add');
      settle();
    });

    it('closes a term, toasts, refreshes the counts and reads the terms again', () => {
      getProgramTerms.mockClear();

      confirmAction('onCloseTerm', 'trm_1');

      expect(closeTerm).toHaveBeenCalledWith('prog_1', 'trm_1');
      expect(toasts).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success', detail: 'Term closed.' }));
      expect(countsRefresh).toHaveBeenCalledTimes(1);
      expect(getProgramTerms).toHaveBeenCalled();
    });

    it('re-opens a closed term that has not ended', () => {
      getProgramTerms.mockReturnValue(of({ data: [term({ id: 'trm_c', status: 'closed' })], total: 1 }));
      fixture.componentInstance['onRetry']();
      settle();

      confirmAction('onReopenTerm', 'trm_c');

      expect(reopenTerm).toHaveBeenCalledWith('prog_1', 'trm_c');
    });

    it('deletes a term that has no applications', () => {
      getProgramTerms.mockReturnValue(of({ data: [term({ id: 'trm_e', pending: 0, declined: 0, accepted: 0 })], total: 1 }));
      fixture.componentInstance['onRetry']();
      settle();

      confirmAction('onDeleteTerm', 'trm_e');

      expect(deleteTerm).toHaveBeenCalledWith('prog_1', 'trm_e');
    });

    it('does not offer a delete for a term that has applications', () => {
      confirmAction('onDeleteTerm', 'trm_1');

      expect(deleteTerm).not.toHaveBeenCalled();
    });

    it('shows the server reason, reads the terms again and refreshes the counts on a 409', () => {
      closeTerm.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 409, error: { message: 'Accepted applications remain.' } })));
      getProgramTerms.mockClear();

      confirmAction('onCloseTerm', 'trm_1');

      expect(toasts).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: 'Accepted applications remain.' }));
      expect(getProgramTerms).toHaveBeenCalled();
      expect(countsRefresh).toHaveBeenCalledTimes(1);
    });

    it('shows a generic message and does not refresh on a 500', () => {
      closeTerm.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500, error: { message: 'secret detail' } })));

      confirmAction('onCloseTerm', 'trm_1');

      expect(toasts).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: MENTORSHIP_ADMIN_TERM_WRITE_FAILED_MESSAGE }));
      expect(countsRefresh).not.toHaveBeenCalled();
    });

    it('sends a second write only after the first one ends', () => {
      let sent = 0;
      closeTerm.mockReturnValue(
        new Observable(() => {
          sent++;
        })
      );

      confirmAction('onCloseTerm', 'trm_1');
      confirmAction('onCloseTerm', 'trm_1');

      expect(sent).toBe(1);
      expect(toasts).toHaveBeenCalledWith(expect.objectContaining({ severity: 'info', detail: MENTORSHIP_ADMIN_TERM_WRITE_IN_FLIGHT_MESSAGE }));
    });
  });
});

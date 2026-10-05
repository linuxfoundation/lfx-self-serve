// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MENTORSHIP_MENTEE_STATUS_LABELS, MENTORSHIP_MENTEE_STATUSES } from '@lfx-one/shared/constants';
import { MentorshipAdminMenteesQuery, MentorshipAdminMenteesResponse, MentorshipAdminTermOption, MentorshipProgramApplicant } from '@lfx-one/shared/interfaces';
import { MentorshipAdminService } from '@services/mentorship-admin.service';
import { MessageService } from 'primeng/api';
import { Observable, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PastMenteesTabComponent } from './past-mentees-tab.component';

describe('PastMenteesTabComponent', () => {
  const mentee = (overrides: Partial<MentorshipProgramApplicant> = {}): MentorshipProgramApplicant => ({
    id: 'app_1',
    name: 'Ifeoma Adeyemi',
    email: 'ifeoma.adeyemi@example.com',
    status: 'graduated',
    termId: 'trm_Spring 2026',
    termName: 'Spring 2026',
    createdOn: '2026-01-10',
    updatedOn: '2026-05-02',
    ...overrides,
  });

  const term = (name: string, status: MentorshipAdminTermOption['status']): MentorshipAdminTermOption => ({ id: `trm_${name}`, name, status });

  const firstPage = (): MentorshipAdminMenteesResponse => ({
    data: [
      mentee(),
      mentee({ id: 'app_2', name: 'Diego Souza', status: 'declined' }),
      mentee({ id: 'app_3', name: 'Samir Okafor', status: 'withdrawn', termName: 'Winter 2025' }),
    ],
    total: 23,
  });

  let fixture: ComponentFixture<PastMenteesTabComponent>;
  let getProgramMentees: ReturnType<typeof vi.fn<(programId: string, query: MentorshipAdminMenteesQuery) => Observable<MentorshipAdminMenteesResponse>>>;

  /** Runs the effects that start a read, then renders what it wrote. */
  const settle = (): void => {
    fixture.detectChanges();
    fixture.detectChanges();
  };

  beforeEach(() => {
    getProgramMentees = vi.fn().mockReturnValue(of(firstPage()));

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [PastMenteesTabComponent],
      providers: [provideNoopAnimations(), MessageService, { provide: MentorshipAdminService, useValue: { getProgramMentees } }],
    });

    fixture = TestBed.createComponent(PastMenteesTabComponent);
    fixture.componentRef.setInput('programId', 'prog_1');
    fixture.componentRef.setInput('terms', [term('Fall 2026', 'open'), term('Spring 2026', 'closed'), term('Winter 2025', 'closed')]);
    settle();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const rowText = (id: string): string => (element().querySelector(`[data-testid="mentorship-past-mentee-row-${id}"]`)?.textContent ?? '').replace(/\s+/g, ' ');
  const lastQuery = (): MentorshipAdminMenteesQuery => getProgramMentees.mock.calls[getProgramMentees.mock.calls.length - 1][1];

  it('renders the three read-only columns and no actions or download', () => {
    const headers = Array.from(element().querySelectorAll('thead th')).map((th) => (th.textContent ?? '').trim());

    expect(headers).toEqual(['Mentee', 'Term', 'Status']);
    expect(element().querySelector('[data-testid="mentorship-past-mentees-download"]')).toBeNull();
    expect(element().querySelector('table')?.getAttribute('aria-label')).toBe('Past mentees');
  });

  it('reads the first page of the closed-term applications for the program', () => {
    expect(getProgramMentees).toHaveBeenCalledTimes(1);
    expect(getProgramMentees).toHaveBeenCalledWith('prog_1', {
      type: 'past',
      search: undefined,
      status: undefined,
      termId: undefined,
      offset: 0,
      limit: 10,
    });
    expect(fixture.componentInstance['rows']().length).toBe(3);
    expect(fixture.componentInstance['total']()).toBe(23);
  });

  it('shows each row with its term and wire status label', () => {
    expect(rowText('app_1')).toContain('Ifeoma Adeyemi');
    expect(rowText('app_1')).toContain('Spring 2026');
    expect(rowText('app_1')).toContain(MENTORSHIP_MENTEE_STATUS_LABELS.graduated);
    expect(rowText('app_2')).toContain(MENTORSHIP_MENTEE_STATUS_LABELS.declined);
    expect(rowText('app_3')).toContain('Winter 2025');
    expect(rowText('app_3')).toContain(MENTORSHIP_MENTEE_STATUS_LABELS.withdrawn);
  });

  it('offers every wire status in the status filter, and only the closed terms in the term filter', () => {
    const component = fixture.componentInstance;

    expect(component['statusOptions'].map((option) => option.label)).toEqual([
      'All statuses',
      ...MENTORSHIP_MENTEE_STATUSES.map((status) => MENTORSHIP_MENTEE_STATUS_LABELS[status]),
    ]);
    expect(component['termOptions']().map((option) => option.label)).toEqual(['All closed terms', 'Spring 2026', 'Winter 2025']);
  });

  it('sends the chosen status upstream and returns to the first page', () => {
    const component = fixture.componentInstance;
    component['onLazyLoad']({ first: 10 });
    settle();
    expect(lastQuery().offset).toBe(10);

    component['form'].controls.status.setValue('declined');
    settle();

    expect(lastQuery()).toMatchObject({ type: 'past', status: 'declined', offset: 0 });
  });

  it('sends the chosen term id upstream, and drops the filter when it is cleared', () => {
    const component = fixture.componentInstance;

    component['form'].controls.term.setValue('trm_Winter 2025');
    settle();
    expect(lastQuery()).toMatchObject({ termId: 'trm_Winter 2025', offset: 0 });

    component['form'].controls.term.setValue(null);
    settle();
    expect(lastQuery().termId).toBeUndefined();
  });

  it('waits for typing to pause before searching, sends it trimmed, and returns to the first page', () => {
    vi.useFakeTimers();
    const component = fixture.componentInstance;
    component['onLazyLoad']({ first: 10 });
    settle();
    getProgramMentees.mockClear();

    component['form'].controls.search.setValue('Di');
    component['form'].controls.search.setValue('  Diego ');
    vi.advanceTimersByTime(100);
    settle();
    expect(getProgramMentees).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300);
    settle();
    expect(getProgramMentees).toHaveBeenCalledTimes(1);
    expect(lastQuery()).toMatchObject({ search: 'Diego', offset: 0 });
  });

  it('reads the page the paginator asks for', () => {
    fixture.componentInstance['onLazyLoad']({ first: 20 });
    settle();

    expect(lastQuery().offset).toBe(20);
  });

  it('shows an inline error with Retry when the read fails, and reads the same page again on Retry', () => {
    getProgramMentees.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    fixture.componentInstance['onRetry']();
    settle();

    expect(element().querySelector('[data-testid="mentorship-admin-past-mentees-load-error"]')).not.toBeNull();
    expect(element().querySelector('table')).toBeNull();

    getProgramMentees.mockReturnValue(of(firstPage()));
    element().querySelector<HTMLElement>('[data-testid="mentorship-admin-past-mentees-retry"]')?.querySelector<HTMLButtonElement>('button')?.click();
    settle();

    expect(element().querySelector('[data-testid="mentorship-admin-past-mentees-load-error"]')).toBeNull();
    expect(fixture.componentInstance['rows']().length).toBe(3);
  });
});

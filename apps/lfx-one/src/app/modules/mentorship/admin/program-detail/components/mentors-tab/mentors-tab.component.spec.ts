// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MENTORSHIP_ADMIN_MENTOR_STATUS_LABELS, MENTORSHIP_ADMIN_MENTOR_STATUSES } from '@lfx-one/shared/constants';
import { MentorshipAdminMentorsQuery, MentorshipAdminMentorsResponse, MentorshipProgramMentor } from '@lfx-one/shared/interfaces';
import { MentorshipAdminService } from '@services/mentorship-admin.service';
import { MentorshipService } from '@services/mentorship.service';
import { MessageService } from 'primeng/api';
import { Observable, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MentorsTabComponent } from './mentors-tab.component';

describe('MentorsTabComponent', () => {
  const mentor = (overrides: Partial<MentorshipProgramMentor> = {}): MentorshipProgramMentor => ({
    id: 'mem_1',
    name: 'Ifeoma Adeyemi',
    email: 'ifeoma.adeyemi@example.com',
    status: 'active',
    invitedOn: '2026-03-04',
    profileCreated: true,
    ...overrides,
  });

  const firstPage = (): MentorshipAdminMentorsResponse => ({
    data: [mentor(), mentor({ id: 'mem_2', name: 'Diego Souza', email: 'diego.souza@example.com', status: 'invited', profileCreated: false })],
    total: 12,
  });

  let fixture: ComponentFixture<MentorsTabComponent>;
  let getProgramMentors: ReturnType<typeof vi.fn<(programId: string, query: MentorshipAdminMentorsQuery) => Observable<MentorshipAdminMentorsResponse>>>;

  /** Runs the effects that start a read, then renders what it wrote. */
  const settle = (): void => {
    fixture.detectChanges();
    fixture.detectChanges();
  };

  beforeEach(() => {
    getProgramMentors = vi.fn().mockReturnValue(of(firstPage()));

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MentorsTabComponent],
      providers: [
        provideNoopAnimations(),
        MessageService,
        { provide: MentorshipAdminService, useValue: { getProgramMentors } },
        {
          provide: MentorshipService,
          useValue: {
            getInvitableUsers: () =>
              of({
                data: [
                  { id: 'usr_1', name: 'Diego Souza', email: 'diego.souza@example.com' },
                  { id: 'usr_2', name: 'Priya Natarajan', email: 'priya.natarajan@example.com' },
                ],
              }),
          },
        },
      ],
    });

    fixture = TestBed.createComponent(MentorsTabComponent);
    fixture.componentRef.setInput('programId', 'prog_1');
    settle();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const rowText = (id: string): string => (element().querySelector(`[data-testid="mentorship-mentor-row-${id}"]`)?.textContent ?? '').replace(/\s+/g, ' ');
  const lastQuery = (): MentorshipAdminMentorsQuery => getProgramMentors.mock.calls[getProgramMentors.mock.calls.length - 1][1];

  it('renders the columns from the design', () => {
    const headers = Array.from(element().querySelectorAll('thead th')).map((th) => (th.textContent ?? '').trim());

    expect(headers).toEqual(['Mentor', 'Status', 'Invitation Date', 'Profile Created?', 'Actions']);
  });

  it('reads the first page of the program mentors', () => {
    expect(getProgramMentors).toHaveBeenCalledTimes(1);
    expect(getProgramMentors).toHaveBeenCalledWith('prog_1', { search: undefined, status: undefined, offset: 0, limit: 10 });
    expect(fixture.componentInstance['rows']().length).toBe(2);
    expect(fixture.componentInstance['total']()).toBe(12);
  });

  it('shows each mentor with its status, invitation date and profile flag', () => {
    expect(rowText('mem_1')).toContain('Ifeoma Adeyemi');
    expect(rowText('mem_1')).toContain(MENTORSHIP_ADMIN_MENTOR_STATUS_LABELS.active);
    expect(rowText('mem_1')).toContain('Yes');
    expect(rowText('mem_2')).toContain(MENTORSHIP_ADMIN_MENTOR_STATUS_LABELS.invited);
    expect(rowText('mem_2')).toContain('No');
  });

  it('offers every upstream status in the status filter', () => {
    expect(fixture.componentInstance['statusOptions'].map((option) => option.label)).toEqual([
      'All statuses',
      ...MENTORSHIP_ADMIN_MENTOR_STATUSES.map((status) => MENTORSHIP_ADMIN_MENTOR_STATUS_LABELS[status]),
    ]);
  });

  it('sends the chosen status upstream and returns to the first page', () => {
    const component = fixture.componentInstance;
    component['onLazyLoad']({ first: 10 });
    settle();
    expect(lastQuery().offset).toBe(10);

    component['form'].controls.status.setValue('declined');
    settle();

    expect(lastQuery()).toMatchObject({ status: 'declined', offset: 0 });
  });

  it('waits for typing to pause before searching, sends it trimmed, and returns to the first page', () => {
    vi.useFakeTimers();
    const component = fixture.componentInstance;
    component['onLazyLoad']({ first: 10 });
    settle();
    getProgramMentors.mockClear();

    component['form'].controls.search.setValue('Di');
    component['form'].controls.search.setValue('  Diego ');
    vi.advanceTimersByTime(100);
    settle();
    expect(getProgramMentors).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300);
    settle();
    expect(getProgramMentors).toHaveBeenCalledTimes(1);
    expect(lastQuery()).toMatchObject({ search: 'Diego', offset: 0 });
  });

  it('leaves anyone already shown out of the invite picker', () => {
    expect(fixture.componentInstance['inviteOptions']().map((option) => option.label)).toEqual(['Priya Natarajan']);
  });

  it('shows an inline error with Retry when the read fails, and reads the same page again on Retry', () => {
    getProgramMentors.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    fixture.componentInstance['onRetry']();
    settle();

    expect(element().querySelector('[data-testid="mentorship-admin-mentors-load-error"]')).not.toBeNull();
    expect(element().querySelector('table')).toBeNull();

    getProgramMentors.mockReturnValue(of(firstPage()));
    element().querySelector<HTMLElement>('[data-testid="mentorship-admin-mentors-retry"]')?.querySelector<HTMLButtonElement>('button')?.click();
    settle();

    expect(element().querySelector('[data-testid="mentorship-admin-mentors-load-error"]')).toBeNull();
    expect(fixture.componentInstance['rows']().length).toBe(2);
  });
});

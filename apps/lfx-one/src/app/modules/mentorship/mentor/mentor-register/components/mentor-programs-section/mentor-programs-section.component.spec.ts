// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import {
  MENTORSHIP_MENTOR_OPEN_PROGRAMS_SEARCH_DEBOUNCE_MS,
  MENTORSHIP_MENTOR_OPEN_PROGRAMS_SEARCH_MAX_LENGTH,
  MENTORSHIP_MENTOR_PICKER_ITEM_SIZE,
  MENTORSHIP_MENTOR_PICKER_LIST_PADDING,
  MENTORSHIP_MENTOR_PICKER_MAX_HEIGHT,
  MENTORSHIP_MENTOR_PROGRAMS_EMPTY_MESSAGE,
  MENTORSHIP_MENTOR_PROGRAMS_SEARCHING_MESSAGE,
  MENTORSHIP_MENTOR_REQUEST_STATUS_LABELS,
  MENTORSHIP_MENTOR_STATUS_LABELS,
  MENTORSHIP_MENTOR_STATUSES,
} from '@lfx-one/shared/constants';
import {
  MentorshipMentorOpenProgram,
  MentorshipMentorOpenProgramsQuery,
  MentorshipMentorOpenProgramsResponse,
  MentorshipMentorProgramRequest,
} from '@lfx-one/shared/interfaces';
import { MentorshipMentorService } from '@services/mentorship-mentor.service';
import { Observable, of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MentorProgramsSectionComponent } from './mentor-programs-section.component';

describe('MentorProgramsSectionComponent', () => {
  const program = (id: string, name: string): MentorshipMentorOpenProgram => ({ id, name });
  const PROGRAMS = [program('mp_kubernetes', 'Kubernetes Contributors'), program('mp_gridflow', 'GridFlow Ingestion')];
  const page = (data: MentorshipMentorOpenProgram[], total: number): Observable<MentorshipMentorOpenProgramsResponse> => of({ data, total });

  const request: MentorshipMentorProgramRequest = {
    id: 'req_1',
    programId: 'mp_kubernetes',
    programName: 'Kubernetes Contributors',
    status: 'accepted',
  };

  let fixture: ComponentFixture<MentorProgramsSectionComponent>;
  let getOpenPrograms: ReturnType<typeof vi.fn<(query: MentorshipMentorOpenProgramsQuery) => Observable<MentorshipMentorOpenProgramsResponse>>>;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const withdrawButton = (id: string): HTMLButtonElement | null =>
    element().querySelector<HTMLButtonElement>(`[data-testid="mentorship-mentor-withdraw-${id}"] button`);
  const option = (id: string) => fixture.componentInstance['programOptions']().find((item) => item.value === id);
  const optionIds = (): string[] => fixture.componentInstance['programOptions']().map((item) => item.value);

  /** Creates the section, which reads the first page on creation; queue that page's response first. */
  const createSection = (): void => {
    fixture = TestBed.createComponent(MentorProgramsSectionComponent);
    fixture.componentRef.setInput('requests', [request]);
    fixture.detectChanges();
  };

  /** Lists the default request as pending, the only status that can be withdrawn. */
  const showPending = (): void => {
    fixture.componentRef.setInput('requests', [{ ...request, status: 'pending' }]);
    fixture.detectChanges();
  };

  beforeEach(() => {
    getOpenPrograms = vi.fn(() => page(PROGRAMS, PROGRAMS.length));

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MentorProgramsSectionComponent],
      providers: [provideNoopAnimations(), { provide: MentorshipMentorService, useValue: { getOpenPrograms } }],
    });

    createSection();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads the first page with no search on creation', () => {
    expect(getOpenPrograms).toHaveBeenCalledTimes(1);
    expect(getOpenPrograms).toHaveBeenCalledWith({ search: '', offset: 0 });
    expect(optionIds()).toEqual(['mp_kubernetes', 'mp_gridflow']);
  });

  it.each(['pending', 'accepted', 'declined'] as const)(
    'lists a program with a %s request disabled, with the status as its note, since upstream would refuse another',
    (status) => {
      fixture.componentRef.setInput('requests', [{ ...request, status }]);
      fixture.detectChanges();

      expect(option('mp_kubernetes')).toEqual({
        label: 'Kubernetes Contributors',
        value: 'mp_kubernetes',
        disabled: true,
        note: MENTORSHIP_MENTOR_REQUEST_STATUS_LABELS[status],
      });
      expect(option('mp_gridflow')?.disabled).toBe(false);
    }
  );

  it('keeps a program pickable once its request is withdrawn, since asking again reopens it', () => {
    fixture.componentRef.setInput('requests', [{ ...request, status: 'withdrawn' }]);
    fixture.detectChanges();

    expect(option('mp_kubernetes')).toMatchObject({ disabled: false, note: null });
  });

  it('lists a program the mentor is invited to as disabled, since upstream would refuse a request', () => {
    fixture.componentRef.setInput('requests', []);
    fixture.componentRef.setInput('invitedProgramIds', ['mp_kubernetes']);
    fixture.detectChanges();

    expect(option('mp_kubernetes')).toMatchObject({ disabled: true, note: 'Invited' });
    expect(option('mp_gridflow')?.disabled).toBe(false);
  });

  it('disables the select while a request is being sent, and re-enables it after', () => {
    const control = fixture.componentInstance['pickerForm'].controls.programId;

    fixture.componentRef.setInput('requesting', true);
    fixture.detectChanges();
    expect(control.disabled).toBe(true);

    fixture.componentRef.setInput('requesting', false);
    fixture.detectChanges();
    expect(control.disabled).toBe(false);
  });

  it('disables the select while the requests are still loading, since it cannot yet tell which are requested', () => {
    const control = fixture.componentInstance['pickerForm'].controls.programId;

    fixture.componentRef.setInput('requestsLoading', true);
    fixture.detectChanges();
    expect(control.disabled).toBe(true);

    fixture.componentRef.setInput('requestsLoading', false);
    fixture.detectChanges();
    expect(control.disabled).toBe(false);
  });

  it('searches upstream once typing pauses, trimmed, from the first page', () => {
    vi.useFakeTimers();
    getOpenPrograms.mockReturnValueOnce(page([PROGRAMS[0]], 1));

    fixture.componentInstance['onFilter']({ filter: '  kube ' });
    vi.advanceTimersByTime(MENTORSHIP_MENTOR_OPEN_PROGRAMS_SEARCH_DEBOUNCE_MS - 1);
    expect(getOpenPrograms).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    expect(getOpenPrograms).toHaveBeenLastCalledWith({ search: 'kube', offset: 0 });
    expect(optionIds()).toEqual(['mp_kubernetes']);
  });

  it('cuts a long search to the length the BFF accepts, so a long paste narrows rather than fails', () => {
    vi.useFakeTimers();

    fixture.componentInstance['onFilter']({ filter: 'a'.repeat(MENTORSHIP_MENTOR_OPEN_PROGRAMS_SEARCH_MAX_LENGTH + 50) });
    vi.advanceTimersByTime(MENTORSHIP_MENTOR_OPEN_PROGRAMS_SEARCH_DEBOUNCE_MS);

    expect(getOpenPrograms).toHaveBeenLastCalledWith({ search: 'a'.repeat(MENTORSHIP_MENTOR_OPEN_PROGRAMS_SEARCH_MAX_LENGTH), offset: 0 });
  });

  it('reads the next page once the last loaded row is reached, and appends it', () => {
    getOpenPrograms.mockReturnValueOnce(page(PROGRAMS, 3));
    createSection();
    getOpenPrograms.mockClear();

    fixture.componentInstance['onLazyLoad']({ last: 0 });
    expect(getOpenPrograms).not.toHaveBeenCalled();

    getOpenPrograms.mockReturnValueOnce(page([program('mp_opentofu', 'OpenTofu Docs')], 3));
    fixture.componentInstance['onLazyLoad']({ last: 1 });

    expect(getOpenPrograms).toHaveBeenCalledWith({ search: '', offset: 2 });
    expect(optionIds()).toEqual(['mp_kubernetes', 'mp_gridflow', 'mp_opentofu']);

    // Every program is loaded now, so scrolling further reads nothing.
    fixture.componentInstance['onLazyLoad']({ last: 2 });
    expect(getOpenPrograms).toHaveBeenCalledTimes(1);
  });

  it('reads no further page while one is still in flight', () => {
    getOpenPrograms.mockReturnValueOnce(page(PROGRAMS, 10));
    createSection();
    getOpenPrograms.mockClear();
    getOpenPrograms.mockReturnValueOnce(new Subject<MentorshipMentorOpenProgramsResponse>());

    fixture.componentInstance['onLazyLoad']({ last: 1 });
    fixture.componentInstance['onLazyLoad']({ last: 1 });

    expect(getOpenPrograms).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance['programsState']().loadingMore).toBe(true);
  });

  it('shows a failed read with its own Retry rather than an empty list, and Retry reads the same page again', () => {
    getOpenPrograms.mockReturnValueOnce(throwError(() => new Error('boom')));
    createSection();

    expect(element().querySelector('[data-testid="mentorship-mentor-programs-failed"]')).not.toBeNull();

    element().querySelector<HTMLButtonElement>('[data-testid="mentorship-mentor-programs-retry"] button')?.click();
    fixture.detectChanges();

    expect(getOpenPrograms).toHaveBeenLastCalledWith({ search: '', offset: 0 });
    expect(element().querySelector('[data-testid="mentorship-mentor-programs-failed"]')).toBeNull();
    expect(optionIds()).toEqual(['mp_kubernetes', 'mp_gridflow']);
  });

  it('keeps the previous programs listed while a new search loads, then replaces them with its answer', () => {
    vi.useFakeTimers();
    const answer = new Subject<MentorshipMentorOpenProgramsResponse>();
    getOpenPrograms.mockReturnValueOnce(answer);

    fixture.componentInstance['onFilter']({ filter: 'grid' });
    vi.advanceTimersByTime(MENTORSHIP_MENTOR_OPEN_PROGRAMS_SEARCH_DEBOUNCE_MS);

    expect(fixture.componentInstance['programsState']().loading).toBe(true);
    expect(optionIds()).toEqual(['mp_kubernetes', 'mp_gridflow']);

    answer.next({ data: [PROGRAMS[1]], total: 1 });
    expect(optionIds()).toEqual(['mp_gridflow']);
  });

  it('says an empty list is searching, not that nothing matched, from the keystroke until the search answers', () => {
    vi.useFakeTimers();
    const answer = new Subject<MentorshipMentorOpenProgramsResponse>();
    getOpenPrograms.mockReturnValueOnce(answer);
    const emptyMessage = (): string => fixture.componentInstance['emptyMessage']();
    expect(emptyMessage()).toBe(MENTORSHIP_MENTOR_PROGRAMS_EMPTY_MESSAGE);

    fixture.componentInstance['onFilter']({ filter: 'opentofu' });
    expect(emptyMessage()).toBe(MENTORSHIP_MENTOR_PROGRAMS_SEARCHING_MESSAGE);

    vi.advanceTimersByTime(MENTORSHIP_MENTOR_OPEN_PROGRAMS_SEARCH_DEBOUNCE_MS);
    expect(emptyMessage()).toBe(MENTORSHIP_MENTOR_PROGRAMS_SEARCHING_MESSAGE);

    answer.next({ data: [], total: 0 });
    expect(emptyMessage()).toBe(MENTORSHIP_MENTOR_PROGRAMS_EMPTY_MESSAGE);
  });

  it('stops saying it is searching once the text returns to the current search, which reads nothing new', () => {
    vi.useFakeTimers();

    fixture.componentInstance['onFilter']({ filter: 'kube' });
    fixture.componentInstance['onFilter']({ filter: '  ' });
    vi.advanceTimersByTime(MENTORSHIP_MENTOR_OPEN_PROGRAMS_SEARCH_DEBOUNCE_MS);

    expect(fixture.componentInstance['emptyMessage']()).toBe(MENTORSHIP_MENTOR_PROGRAMS_EMPTY_MESSAGE);
    expect(getOpenPrograms).toHaveBeenCalledTimes(1);
  });

  it('empties the list when a new search fails, so Retry reads that search from its first page', () => {
    vi.useFakeTimers();
    getOpenPrograms.mockReturnValueOnce(throwError(() => new Error('boom')));

    fixture.componentInstance['onFilter']({ filter: 'grid' });
    vi.advanceTimersByTime(MENTORSHIP_MENTOR_OPEN_PROGRAMS_SEARCH_DEBOUNCE_MS);

    expect(fixture.componentInstance['programsState']().failed).toBe(true);
    expect(optionIds()).toEqual([]);

    getOpenPrograms.mockReturnValueOnce(page([PROGRAMS[1]], 1));
    fixture.componentInstance['onRetryPrograms']();

    expect(getOpenPrograms).toHaveBeenLastCalledWith({ search: 'grid', offset: 0 });
    expect(optionIds()).toEqual(['mp_gridflow']);
  });

  it('sizes the list to one row per program, or one row when empty, plus its padding, capped so a long list scrolls', () => {
    const scrollHeight = (): string => fixture.componentInstance['scrollHeight']();
    const height = (rows: number): string =>
      `min(${MENTORSHIP_MENTOR_PICKER_MAX_HEIGHT}px, calc(${rows * MENTORSHIP_MENTOR_PICKER_ITEM_SIZE}px + ${MENTORSHIP_MENTOR_PICKER_LIST_PADDING}))`;
    expect(scrollHeight()).toBe(height(2));

    getOpenPrograms.mockReturnValueOnce(page([], 0));
    createSection();
    expect(scrollHeight()).toBe(height(1));
  });

  it('emits the picked program and clears the select, so it never looks selected', () => {
    const added: MentorshipMentorOpenProgram[] = [];
    fixture.componentInstance.add.subscribe((program) => added.push(program));

    fixture.componentInstance['pickerForm'].controls.programId.setValue('mp_gridflow');
    fixture.detectChanges();

    expect(added.map((program) => program.id)).toEqual(['mp_gridflow']);
    expect(fixture.componentInstance['pickerForm'].controls.programId.value).toBeNull();
  });

  it('renders one row per request, with its status badge', () => {
    expect(element().querySelector('[data-testid="mentorship-mentor-request-row-req_1"]')).not.toBeNull();
    expect(element().querySelector('[data-testid="mentorship-mentor-request-status-req_1"]')?.textContent?.trim()).toBe('Accepted');
  });

  it('calls an undecided request Pending, not Invited as the admin tab does', () => {
    // Same wire status, opposite direction: the admin invited them, or they asked to join.
    fixture.componentRef.setInput('requests', [{ ...request, status: 'pending' }]);
    fixture.detectChanges();

    expect(element().querySelector('[data-testid="mentorship-mentor-request-status-req_1"]')?.textContent?.trim()).toBe('Pending');
    expect(MENTORSHIP_MENTOR_STATUS_LABELS.pending).toBe('Invited');
  });

  it('reuses the admin wording for every status it does not deliberately override', () => {
    for (const status of MENTORSHIP_MENTOR_STATUSES.filter((value) => value !== 'pending')) {
      expect(MENTORSHIP_MENTOR_REQUEST_STATUS_LABELS[status]).toBe(MENTORSHIP_MENTOR_STATUS_LABELS[status]);
    }
  });

  it.each(['accepted', 'declined', 'withdrawn', 'graduated'] as const)(
    'offers no Withdraw on a %s request, since only a pending one can be withdrawn',
    (status) => {
      fixture.componentRef.setInput('requests', [{ ...request, status }]);
      fixture.detectChanges();

      expect(element().querySelector('[data-testid="mentorship-mentor-request-row-req_1"]')).not.toBeNull();
      expect(withdrawButton('req_1')).toBeNull();
    }
  );

  it('names the program in the withdraw label, since every row has the same button text', () => {
    showPending();

    expect(withdrawButton('req_1')?.getAttribute('aria-label')).toBe('Withdraw request to join Kubernetes Contributors');
  });

  it('emits the request id on withdraw rather than removing the row itself', () => {
    showPending();
    const withdrawn: string[] = [];
    fixture.componentInstance.withdraw.subscribe((id) => withdrawn.push(id));

    withdrawButton('req_1')?.click();

    expect(withdrawn).toEqual(['req_1']);
    // The parent owns the list: it decides what a withdraw does and re-reads it.
    expect(element().querySelector('[data-testid="mentorship-mentor-request-row-req_1"]')).not.toBeNull();
  });

  it('marks the row being withdrawn as loading and disables every Withdraw meanwhile', () => {
    fixture.componentRef.setInput('requests', [
      { ...request, status: 'pending' },
      { id: 'req_2', programId: 'mp_gridflow', programName: 'GridFlow Ingestion', status: 'pending' },
    ]);
    fixture.componentRef.setInput('withdrawingId', 'req_1');
    fixture.detectChanges();

    expect(element().querySelector('[data-testid="mentorship-mentor-withdraw-req_1"]')?.getAttribute('data-loading')).toBe('true');
    expect(withdrawButton('req_1')?.disabled).toBe(true);
    expect(withdrawButton('req_2')?.disabled).toBe(true);
  });

  it('shows a failed read with Retry in place of the table, and disables the select, rather than an empty list', () => {
    const control = fixture.componentInstance['pickerForm'].controls.programId;
    let retries = 0;
    fixture.componentInstance.retry.subscribe(() => retries++);

    fixture.componentRef.setInput('requests', []);
    fixture.componentRef.setInput('requestsFailed', true);
    fixture.detectChanges();

    expect(element().querySelector('[data-testid="mentorship-mentor-requests-failed"]')).not.toBeNull();
    expect(element().querySelector('table')).toBeNull();
    expect(control.disabled).toBe(true);

    element().querySelector<HTMLButtonElement>('[data-testid="mentorship-mentor-requests-retry"] button')?.click();
    expect(retries).toBe(1);

    fixture.componentRef.setInput('requestsFailed', false);
    fixture.detectChanges();
    expect(element().querySelector('[data-testid="mentorship-mentor-requests-failed"]')).toBeNull();
    expect(control.disabled).toBe(false);
  });

  it('hides the request table entirely when nothing has been requested', () => {
    fixture.componentRef.setInput('requests', []);
    fixture.detectChanges();

    expect(element().querySelector('table')).toBeNull();
  });

  it('renders the card wrapper with border and padding when bordered is true (default)', () => {
    const wrapper = element().querySelector('[data-testid="mentorship-mentor-programs"]');
    expect(wrapper?.classList.contains('rounded-2xl')).toBe(true);
    expect(wrapper?.classList.contains('border')).toBe(true);
    expect(wrapper?.classList.contains('border-gray-200')).toBe(true);
    expect(wrapper?.classList.contains('bg-white')).toBe(true);
  });

  it('strips the card wrapper when bordered is false, used inside drawers', () => {
    fixture.componentRef.setInput('bordered', false);
    fixture.detectChanges();

    const wrapper = element().querySelector('[data-testid="mentorship-mentor-programs"]');
    expect(wrapper?.classList.contains('rounded-2xl')).toBe(false);
    expect(wrapper?.classList.contains('border')).toBe(false);
    expect(wrapper?.classList.contains('border-gray-200')).toBe(false);
    expect(wrapper?.classList.contains('bg-white')).toBe(false);
  });
});

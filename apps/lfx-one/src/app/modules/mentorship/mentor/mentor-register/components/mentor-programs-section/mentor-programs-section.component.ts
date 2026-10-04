// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { SelectComponent } from '@components/select/select.component';
import {
  MENTORSHIP_MENTOR_OPEN_PROGRAMS_SEARCH_DEBOUNCE_MS,
  MENTORSHIP_MENTOR_OPEN_PROGRAMS_SEARCH_MAX_LENGTH,
  MENTORSHIP_MENTOR_PICKER_EXCLUDED_STATUSES,
  MENTORSHIP_MENTOR_PICKER_INVITED_NOTE,
  MENTORSHIP_MENTOR_PICKER_ITEM_SIZE,
  MENTORSHIP_MENTOR_PICKER_LIST_PADDING,
  MENTORSHIP_MENTOR_PICKER_MAX_HEIGHT,
  MENTORSHIP_MENTOR_PICKER_SCROLLER_OPTIONS,
  MENTORSHIP_MENTOR_PICKER_UNAVAILABLE_NOTE,
  MENTORSHIP_MENTOR_PROGRAMS_EMPTY_MESSAGE,
  MENTORSHIP_MENTOR_PROGRAMS_HELPER,
  MENTORSHIP_MENTOR_PROGRAMS_INTRO,
  MENTORSHIP_MENTOR_PROGRAMS_LOAD_FAILED_MESSAGE,
  MENTORSHIP_MENTOR_PROGRAMS_SEARCHING_MESSAGE,
  MENTORSHIP_MENTOR_REQUEST_STATUS_LABELS,
  MENTORSHIP_MENTOR_REQUESTS_LOAD_FAILED_MESSAGE,
  MENTORSHIP_MENTOR_STATUS_BADGE_CLASSES,
} from '@lfx-one/shared/constants';
import {
  MentorshipMentorOpenProgram,
  MentorshipMentorOpenProgramsQuery,
  MentorshipMentorOpenProgramsResponse,
  MentorshipMentorOpenProgramsState,
  MentorshipMentorProgramOption,
  MentorshipMentorProgramRequest,
} from '@lfx-one/shared/interfaces';
import { truncateToUtf16Units } from '@lfx-one/shared/utils';
import { MentorshipMentorService } from '@services/mentorship-mentor.service';
import { OverlayOptions } from 'primeng/api';
import { catchError, debounceTime, distinctUntilChanged, map, of, startWith, Subject, switchMap, tap } from 'rxjs';

/**
 * Program picker and request list, shared by the Become a Mentor form and the mentor profile edit
 * drawer. The select acts as a one-shot action rather than a stored value: it hands the program up
 * and clears itself. A program with a pending, accepted or declined request
 * (`MENTORSHIP_MENTOR_PICKER_EXCLUDED_STATUSES`), or with an open invitation (`invitedProgramIds`),
 * stays listed but disabled, with its status as a note; so does one a request found gone (404), noted
 * as no longer available. A program whose request was withdrawn stays
 * pickable, since asking again reopens it. When the parent could not read the requests, the section
 * says so with a Retry and keeps the select disabled, because it cannot tell which programs are
 * already requested.
 *
 * The section reads the programs itself, a page at a time: typing in the select's filter searches
 * upstream by name once typing pauses, and scrolling to the end of the list reads the next page. A
 * failed page shows its own Retry, so it never looks like there are no programs. While a search
 * waits on its answer, the previous programs stay listed (the select narrows them as typed) and an
 * empty list says it is searching, since a slow read must not look like "no results". Closing the
 * select clears the search, so it always reopens on every program; the programs already read with
 * no search are kept, so that list comes back at once rather than read again.
 *
 * Applying is optional — a mentor may register a profile and come back for programs later — so
 * nothing here is required and the section surfaces no validation error. The parent owns the list
 * and decides what picking and withdrawing do: the form keeps picks until submit, the drawer sends
 * them right away. Only a pending request can be withdrawn, so only its row offers the button.
 */
@Component({
  selector: 'lfx-mentorship-mentor-programs-section',
  imports: [ButtonComponent, SelectComponent],
  templateUrl: './mentor-programs-section.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MentorProgramsSectionComponent {
  private readonly mentorService = inject(MentorshipMentorService);

  /** When false, the card wrapper (border + padding + rounded corners) is stripped — used inside drawers. */
  public readonly bordered = input(true);

  /** While true the parent is sending a request, so the select is disabled until it settles. */
  public readonly requesting = input(false);
  /** The request being withdrawn, or `null`. Its Withdraw button shows a loading state meanwhile. */
  public readonly withdrawingId = input<string | null>(null);

  public readonly requests = input.required<MentorshipMentorProgramRequest[]>();
  /** Programs the mentor is already invited to; upstream refuses a request for them. */
  public readonly invitedProgramIds = input<string[]>([]);
  /** True while the parent is still reading the requests: the select waits, since it cannot yet tell which programs are requested. */
  public readonly requestsLoading = input(false);
  /** True when the parent could not read the requests: shows the failure and its Retry instead of the list. */
  public readonly requestsFailed = input(false);
  public readonly add = output<MentorshipMentorOpenProgram>();
  public readonly withdraw = output<string>();
  public readonly retry = output<void>();

  protected readonly intro = MENTORSHIP_MENTOR_PROGRAMS_INTRO;
  protected readonly helper = MENTORSHIP_MENTOR_PROGRAMS_HELPER;
  protected readonly requestsFailedMessage = MENTORSHIP_MENTOR_REQUESTS_LOAD_FAILED_MESSAGE;
  protected readonly programsFailedMessage = MENTORSHIP_MENTOR_PROGRAMS_LOAD_FAILED_MESSAGE;
  protected readonly itemSize = MENTORSHIP_MENTOR_PICKER_ITEM_SIZE;
  protected readonly scrollerOptions = MENTORSHIP_MENTOR_PICKER_SCROLLER_OPTIONS;
  /** On close the select clears its filter box (`resetFilterOnHide`); this clears the search behind it. */
  protected readonly overlayOptions: OverlayOptions = { onBeforeHide: () => this.onFilter({ filter: '' }) };

  protected readonly pickerForm = new FormGroup({
    programId: new FormControl<string | null>(null),
  });

  /** What the picker has loaded for the current search. Starts loading, since the first page is read on creation. */
  protected readonly programsState = signal<MentorshipMentorOpenProgramsState>({ programs: [], total: 0, loading: true, loadingMore: false, failed: false });

  /** True from a keystroke that changes the search until its read starts, so the debounce never looks like "no results". */
  private readonly searchPending = signal(false);

  /** Filter text, trimmed and cut to the length the BFF accepts; searched once typing pauses. */
  private readonly filterInput$ = new Subject<string>();
  /** Each page to read. A new search replaces any page still in flight. */
  private readonly pageRequests$ = new Subject<Required<MentorshipMentorOpenProgramsQuery>>();
  /** The search the loaded pages belong to, so the next page and a Retry read the same one. */
  private search = '';
  /** Every program read so far with no search, so clearing a search lists them again without a read. */
  private unfilteredPrograms: MentorshipMentorOpenProgramsResponse | null = null;

  protected readonly programOptions = this.initProgramOptions();
  protected readonly emptyMessage = this.initEmptyMessage();
  protected readonly scrollHeight = this.initScrollHeight();
  protected readonly rows = this.initRows();
  protected readonly wrapperClass = this.initWrapperClass();
  private readonly pickerDisabled = this.initPickerDisabled();

  public constructor() {
    // Choosing is the whole interaction: hand the program up, then clear so the same
    // program can never look "selected" while its request is already listed below.
    this.pickerForm.controls.programId.valueChanges.pipe(takeUntilDestroyed()).subscribe((programId) => {
      if (!programId) return;
      const program = this.programsState().programs.find((item) => item.id === programId);
      this.pickerForm.controls.programId.setValue(null, { emitEvent: false });
      if (program) this.add.emit(program);
    });

    toObservable(this.pickerDisabled)
      .pipe(takeUntilDestroyed())
      .subscribe((disabled) => {
        const control = this.pickerForm.controls.programId;
        if (disabled) {
          control.disable({ emitEvent: false });
        } else {
          control.enable({ emitEvent: false });
        }
      });

    this.initProgramPages();
  }

  /**
   * The search is cut to the length the BFF accepts, so a long paste narrows rather than fails. The
   * cut keeps a surrogate pair whole: half an emoji would make `encodeURIComponent` throw.
   */
  protected onFilter(event: { filter?: string | null }): void {
    const search = truncateToUtf16Units((event.filter ?? '').trim(), MENTORSHIP_MENTOR_OPEN_PROGRAMS_SEARCH_MAX_LENGTH);
    this.searchPending.set(search !== this.search);
    this.filterInput$.next(search);
  }

  /** Reads the next page once the list is scrolled to its last loaded row, unless a page is in flight, failed, or none is left. */
  protected onLazyLoad(event?: { last?: number }): void {
    const state = this.programsState();
    if (state.loading || state.loadingMore || state.failed || state.programs.length >= state.total) return;
    if (event?.last !== undefined && event.last < state.programs.length - 1) return;
    this.pageRequests$.next({ search: this.search, offset: state.programs.length });
  }

  /** Re-reads the page that failed: the first page of the search, or the next one. */
  protected onRetryPrograms(): void {
    this.pageRequests$.next({ search: this.search, offset: this.programsState().programs.length });
  }

  /**
   * Every loaded program as an option. One the mentor cannot request again is disabled, with the reason
   * as its note; a program found gone outranks any other reason.
   */
  private initProgramOptions() {
    return computed((): MentorshipMentorProgramOption[] => {
      const notes = new Map<string, string>(this.invitedProgramIds().map((programId) => [programId, MENTORSHIP_MENTOR_PICKER_INVITED_NOTE]));
      for (const request of this.requests()) {
        if (MENTORSHIP_MENTOR_PICKER_EXCLUDED_STATUSES.includes(request.status)) {
          notes.set(request.programId, MENTORSHIP_MENTOR_REQUEST_STATUS_LABELS[request.status]);
        }
      }
      for (const programId of this.mentorService.unavailableProgramIds()) {
        notes.set(programId, MENTORSHIP_MENTOR_PICKER_UNAVAILABLE_NOTE);
      }
      return this.programsState().programs.map((program) => {
        const note = notes.get(program.id) ?? null;
        return { label: program.name, value: program.id, disabled: note !== null, note };
      });
    });
  }

  private initRows() {
    return computed(() =>
      this.requests().map((request) => ({
        ...request,
        statusLabel: MENTORSHIP_MENTOR_REQUEST_STATUS_LABELS[request.status],
        statusBadgeClass: MENTORSHIP_MENTOR_STATUS_BADGE_CLASSES[request.status],
        canWithdraw: request.status === 'pending',
      }))
    );
  }

  /** The select is off while a request is in flight, and while the requests are unknown: still loading, or after a failed read. */
  private initPickerDisabled() {
    return computed(() => this.requesting() || this.requestsLoading() || this.requestsFailed());
  }

  /** What an empty list says: searching while a search is pending or in flight, otherwise that nothing matched. */
  private initEmptyMessage() {
    return computed(() =>
      this.searchPending() || this.programsState().loading ? MENTORSHIP_MENTOR_PROGRAMS_SEARCHING_MESSAGE : MENTORSHIP_MENTOR_PROGRAMS_EMPTY_MESSAGE
    );
  }

  /** One row per program, or one for the empty message, plus the list's padding; capped so a long list scrolls. */
  private initScrollHeight() {
    return computed(() => {
      const rows = Math.max(1, this.programOptions().length) * this.itemSize;
      return `min(${MENTORSHIP_MENTOR_PICKER_MAX_HEIGHT}px, calc(${rows}px + ${MENTORSHIP_MENTOR_PICKER_LIST_PADDING}))`;
    });
  }

  private initWrapperClass() {
    return computed(() => (this.bordered() ? 'flex flex-col gap-6 rounded-2xl border border-gray-200 bg-white p-6 md:p-8' : 'flex flex-col gap-6'));
  }

  /**
   * Searches on the filter text once typing pauses, starting with no search, and reads each
   * requested page. A new search keeps the previous programs listed until its first page answers,
   * then replaces them; if that page fails, the list empties so Retry reads the search from the start.
   * The first page with no search comes from `unfilteredPrograms` once it has been read.
   */
  private initProgramPages(): void {
    // Subscribed first: the search stream below asks for the first page as soon as it subscribes.
    this.pageRequests$
      .pipe(
        tap(({ offset }) =>
          this.programsState.update((state) =>
            offset === 0 ? { ...state, loading: true, loadingMore: false, failed: false } : { ...state, loadingMore: true, failed: false }
          )
        ),
        switchMap((query) => {
          if (!query.search && query.offset === 0 && this.unfilteredPrograms) return of({ page: this.unfilteredPrograms, query });
          return this.mentorService.getOpenPrograms(query).pipe(
            map((page) => ({ page, query })),
            catchError(() => of({ page: null, query }))
          );
        }),
        takeUntilDestroyed()
      )
      .subscribe(({ page, query }) => {
        this.programsState.update((state) => {
          if (!page && query.offset === 0) return { programs: [], total: 0, loading: false, loadingMore: false, failed: true };
          if (!page) return { ...state, loading: false, loadingMore: false, failed: true };
          const programs = query.offset === 0 ? page.data : [...state.programs, ...page.data];
          return { programs, total: page.total, loading: false, loadingMore: false, failed: false };
        });
        if (page && !query.search) {
          const { programs, total } = this.programsState();
          this.unfilteredPrograms = { data: programs, total };
        }
      });

    this.filterInput$
      .pipe(debounceTime(MENTORSHIP_MENTOR_OPEN_PROGRAMS_SEARCH_DEBOUNCE_MS), startWith(''), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe((search) => {
        this.search = search;
        this.searchPending.set(false);
        this.pageRequests$.next({ search, offset: 0 });
      });
  }
}

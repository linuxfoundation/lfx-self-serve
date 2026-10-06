// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { TableComponent } from '@components/table/table.component';
import {
  MENTORSHIP_ADMIN_MENTEES_LOAD_ERROR_MESSAGE,
  MENTORSHIP_ADMIN_MENTEES_PAGE_SIZE,
  MENTORSHIP_ADMIN_MENTEES_SEARCH_DEBOUNCE_MS,
  MENTORSHIP_ALL_CLOSED_TERMS_OPTION_LABEL,
  MENTORSHIP_ALL_STATUSES_OPTION_LABEL,
  MENTORSHIP_MENTEE_STATUS_BADGE_CLASSES,
  MENTORSHIP_MENTEE_STATUS_LABELS,
  MENTORSHIP_MENTEE_STATUSES,
} from '@lfx-one/shared/constants';
import { FilterOption, MentorshipAdminTermOption, MentorshipMenteeStatus, MentorshipProgramApplicant } from '@lfx-one/shared/interfaces';
import { mentorshipPersonAvatarClass, mentorshipPersonInitials } from '@lfx-one/shared/utils';
import { MentorshipAdminService } from '@services/mentorship-admin.service';
import { TooltipModule } from 'primeng/tooltip';
import { catchError, debounceTime, distinctUntilChanged, map, of, switchMap, tap } from 'rxjs';

import { PersonCellComponent } from '../../../../components/person-cell/person-cell.component';

/**
 * Past Mentees tab — every application in one of the program's closed terms, whatever status it was left in, one
 * server page at a time. A closed term is read-only history, so unlike the Current Mentees table this one carries no
 * tasks, row actions or reviewer note. Search, status and term filters go upstream, and any change of them, or a
 * page change, reads that page again.
 */
@Component({
  selector: 'lfx-mentorship-past-mentees-tab',
  imports: [ReactiveFormsModule, ButtonComponent, InputTextComponent, PersonCellComponent, SelectComponent, TableComponent, TooltipModule],
  templateUrl: './past-mentees-tab.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PastMenteesTabComponent {
  private readonly mentorshipAdminService = inject(MentorshipAdminService);
  private readonly destroyRef = inject(DestroyRef);

  public readonly programId = input.required<string>();
  /** The program's terms; only the closed ones feed the term filter. */
  public readonly terms = input<MentorshipAdminTermOption[]>([]);

  protected readonly pageSize = MENTORSHIP_ADMIN_MENTEES_PAGE_SIZE;
  protected readonly loadErrorMessage = MENTORSHIP_ADMIN_MENTEES_LOAD_ERROR_MESSAGE;

  /**
   * Fixed rather than derived from the rows: every status a mentee can hold. A term closes on whatever status each
   * application was left in, so none is ruled out.
   */
  protected readonly statusOptions: FilterOption<MentorshipMenteeStatus | null>[] = [
    { label: MENTORSHIP_ALL_STATUSES_OPTION_LABEL, value: null },
    ...MENTORSHIP_MENTEE_STATUSES.map((status) => ({ label: MENTORSHIP_MENTEE_STATUS_LABELS[status], value: status })),
  ];

  protected readonly form = new FormGroup({
    search: new FormControl('', { nonNullable: true }),
    status: new FormControl<MentorshipMenteeStatus | null>(null),
    term: new FormControl<string | null>(null),
  });

  /** Offset of the page shown; the table's paginator reads it and a page change writes it. */
  protected readonly offset = signal(0);
  protected readonly total = signal(0);
  protected readonly loading = signal(true);
  protected readonly loadFailed = signal(false);
  private readonly applications = signal<MentorshipProgramApplicant[]>([]);

  private readonly search = signal('');
  private readonly status = signal<MentorshipMenteeStatus | null>(null);
  private readonly termId = signal<string | null>(null);
  private readonly reloadCount = signal(0);

  protected readonly termOptions = this.initTermOptions();
  protected readonly rows = this.initRows();

  public constructor() {
    this.initFilters();
    this.initPageReads();
  }

  protected onLazyLoad(event: { first?: number | null }): void {
    this.offset.set(event.first ?? 0);
  }

  protected onRetry(): void {
    this.reloadCount.update((count) => count + 1);
  }

  private initTermOptions() {
    return computed((): FilterOption<string | null>[] => [
      { label: MENTORSHIP_ALL_CLOSED_TERMS_OPTION_LABEL, value: null },
      ...this.terms()
        .filter((term) => term.status === 'closed')
        .map((term) => ({ label: term.name, value: term.id })),
    ]);
  }

  private initRows() {
    return computed(() => this.applications().map((person) => this.toRow(person)));
  }

  /** Search waits for typing to pause; the selects apply at once. Every change goes back to the first page. */
  private initFilters(): void {
    this.form.controls.search.valueChanges
      .pipe(debounceTime(MENTORSHIP_ADMIN_MENTEES_SEARCH_DEBOUNCE_MS), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((search) => {
        this.search.set(search.trim());
        this.offset.set(0);
      });
    this.form.controls.status.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((status) => {
      this.status.set(status);
      this.offset.set(0);
    });
    this.form.controls.term.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((termId) => {
      this.termId.set(termId);
      this.offset.set(0);
    });
  }

  /**
   * Reads the page whenever the program, a filter, the offset or the retry count changes; a read still in flight is
   * dropped. A failed read keeps nothing on screen but the error, so Retry reads the same page again.
   */
  private initPageReads(): void {
    const query = computed(() => ({
      programId: this.programId(),
      search: this.search(),
      status: this.status(),
      termId: this.termId(),
      offset: this.offset(),
      reload: this.reloadCount(),
    }));

    toObservable(query)
      .pipe(
        tap(() => {
          this.loading.set(true);
          this.loadFailed.set(false);
        }),
        switchMap(({ programId, search, status, termId, offset }) =>
          this.mentorshipAdminService
            .getProgramMentees(programId, {
              type: 'past',
              search: search || undefined,
              status: status ?? undefined,
              termId: termId ?? undefined,
              offset,
              limit: MENTORSHIP_ADMIN_MENTEES_PAGE_SIZE,
            })
            .pipe(
              map((page) => ({ page })),
              catchError(() => of({ page: null }))
            )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(({ page }) => {
        this.loading.set(false);
        if (!page) {
          this.applications.set([]);
          this.total.set(0);
          this.loadFailed.set(true);
          return;
        }
        this.applications.set(page.data);
        this.total.set(page.total);
      });
  }

  private toRow(person: MentorshipProgramApplicant) {
    return {
      ...person,
      initials: mentorshipPersonInitials(person.name),
      avatarStyleClass: mentorshipPersonAvatarClass(person.name),
      statusLabel: MENTORSHIP_MENTEE_STATUS_LABELS[person.status],
      statusBadgeClass: MENTORSHIP_MENTEE_STATUS_BADGE_CLASSES[person.status],
    };
  }
}

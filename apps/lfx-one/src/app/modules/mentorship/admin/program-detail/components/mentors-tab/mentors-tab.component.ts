// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { serverAuthoredMessage } from '@app/shared/utils/http-error.utils';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { TableComponent } from '@components/table/table.component';
import {
  MENTORSHIP_ADMIN_DECISION_FAILED_MESSAGE,
  MENTORSHIP_ADMIN_DECISION_IN_FLIGHT_MESSAGE,
  MENTORSHIP_ADMIN_MANAGEMENT_PAGE_SIZE,
  MENTORSHIP_ADMIN_MENTEES_SEARCH_DEBOUNCE_MS,
  MENTORSHIP_ADMIN_MENTOR_ACCOUNT_PENDING_LABEL,
  MENTORSHIP_ADMIN_MENTOR_ACTION_APPEARANCE,
  MENTORSHIP_ADMIN_MENTOR_ACTION_CONFIRM_MESSAGES,
  MENTORSHIP_ADMIN_MENTOR_ACTION_SUCCESS_MESSAGES,
  MENTORSHIP_ADMIN_MENTOR_ACTIONS_BY_STATUS,
  MENTORSHIP_ADMIN_MENTOR_CHANGED_MESSAGE,
  MENTORSHIP_ADMIN_MENTOR_INVITE_BUTTON_LABEL,
  MENTORSHIP_ADMIN_MENTOR_INVITE_DIALOG_HEADER,
  MENTORSHIP_ADMIN_MENTOR_STATUS_BADGE_CLASSES,
  MENTORSHIP_ADMIN_MENTOR_STATUS_LABELS,
  MENTORSHIP_ADMIN_MENTOR_STATUSES,
  MENTORSHIP_ADMIN_MENTORS_LOAD_ERROR_MESSAGE,
  MENTORSHIP_ALL_STATUSES_OPTION_LABEL,
  MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE,
} from '@lfx-one/shared/constants';
import {
  FilterOption,
  MentorshipAdminMentorAction,
  MentorshipAdminMentorStatus,
  MentorshipInviteMentorDialogData,
  MentorshipProgramMentor,
} from '@lfx-one/shared/interfaces';
import { formatIsoDateLabel, mentorshipPersonAvatarClass, mentorshipPersonInitials } from '@lfx-one/shared/utils';
import { MentorshipPublicUrlPipe } from '@pipes/mentorship-public-url.pipe';
import { MentorshipAdminService } from '@services/mentorship-admin.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogService } from 'primeng/dynamicdialog';
import { catchError, debounceTime, distinctUntilChanged, map, of, switchMap, take, tap } from 'rxjs';

import { InviteMentorDialogComponent } from '../invite-mentor-dialog/invite-mentor-dialog.component';

/**
 * Mentors tab — the program's mentors and their invitation status, one server page at a time. The toolbar pairs a
 * search and status filter (both go upstream) with an Invite mentor button, which opens the Invite a mentor dialog:
 * pick an LF user found by name, LF username or full email, or invite a full email no LF account uses by email. Rows expose
 * Approve / Decline / Revoke invite / Remove, gated by the mentor's status; each confirms, writes through the BFF, then
 * reloads the page and has the parent refresh the tab counts.
 */
@Component({
  selector: 'lfx-mentorship-mentors-tab',
  imports: [
    ReactiveFormsModule,
    ConfirmDialogModule,
    AvatarComponent,
    ButtonComponent,
    InputTextComponent,
    SelectComponent,
    TableComponent,
    MentorshipPublicUrlPipe,
  ],
  providers: [ConfirmationService],
  templateUrl: './mentors-tab.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MentorsTabComponent {
  private readonly mentorshipAdminService = inject(MentorshipAdminService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly messageService = inject(MessageService);
  private readonly dialogService = inject(DialogService);

  public readonly programId = input.required<string>();
  /**
   * True when the program is upstream `published`. Upstream only serves public mentee and mentor pages through a
   * published program, so names link only then.
   */
  public readonly programPublished = input(false);
  /**
   * Has the parent program page read its tab counts again. A callback rather than an output, as on Current Mentees:
   * a write that lands after a tab switch destroyed this tab must still refresh the parent's counts.
   */
  public readonly countsRefresh = input<() => void>(() => undefined);

  protected readonly pageSize = MENTORSHIP_ADMIN_MANAGEMENT_PAGE_SIZE;
  protected readonly loadErrorMessage = MENTORSHIP_ADMIN_MENTORS_LOAD_ERROR_MESSAGE;
  protected readonly inviteLabel = MENTORSHIP_ADMIN_MENTOR_INVITE_BUTTON_LABEL;
  protected readonly accountPendingLabel = MENTORSHIP_ADMIN_MENTOR_ACCOUNT_PENDING_LABEL;

  protected readonly statusOptions: FilterOption<MentorshipAdminMentorStatus | null>[] = [
    { label: MENTORSHIP_ALL_STATUSES_OPTION_LABEL, value: null },
    ...MENTORSHIP_ADMIN_MENTOR_STATUSES.map((status) => ({ label: MENTORSHIP_ADMIN_MENTOR_STATUS_LABELS[status], value: status })),
  ];

  protected readonly form = new FormGroup({
    search: new FormControl('', { nonNullable: true }),
    status: new FormControl<MentorshipAdminMentorStatus | null>(null),
  });

  /** Offset of the page shown; the table's paginator reads it and a page change writes it. */
  protected readonly offset = signal(0);
  protected readonly total = signal(0);
  protected readonly loading = signal(true);
  protected readonly loadFailed = signal(false);
  private readonly mentors = signal<MentorshipProgramMentor[]>([]);

  private readonly search = signal('');
  private readonly status = signal<MentorshipAdminMentorStatus | null>(null);
  private readonly reloadCount = signal(0);
  private readonly writeInFlight = signal(false);
  /** Set when the tab is destroyed, so a write that lands afterwards does not reload the gone table. */
  private destroyed = false;

  protected readonly rows = this.initRows();

  public constructor() {
    this.destroyRef.onDestroy(() => (this.destroyed = true));
    this.initFilters();
    this.initPageReads();
  }

  protected onLazyLoad(event: { first?: number | null }): void {
    this.offset.set(event.first ?? 0);
  }

  protected onRetry(): void {
    this.reloadCount.update((count) => count + 1);
  }

  /**
   * Opens the Invite a mentor dialog, which searches, picks and sends the invite itself. When the Mentors list changed,
   * it calls back so the page reloads and the parent refreshes the counts, even if the dialog was dismissed mid-send
   * (and, as for row actions, after a tab switch destroyed this tab, when only the counts refresh).
   */
  protected onOpenInvite(): void {
    const data: MentorshipInviteMentorDialogData = {
      programId: this.programId(),
      onListChanged: () => {
        this.countsRefresh()();
        this.reloadPage();
      },
    };
    // `open()` returns null while a dialog of the same component is still open, as a quick second click can do.
    this.dialogService.open(InviteMentorDialogComponent, {
      header: MENTORSHIP_ADMIN_MENTOR_INVITE_DIALOG_HEADER,
      width: '36rem',
      style: { maxWidth: '90vw' },
      modal: true,
      closable: true,
      dismissableMask: true,
      data,
    });
  }

  /** Always confirms; the write runs only on accept. */
  protected onMentorAction(mentor: MentorshipProgramMentor, action: MentorshipAdminMentorAction): void {
    this.confirmationService.confirm({
      header: action.label,
      message: MENTORSHIP_ADMIN_MENTOR_ACTION_CONFIRM_MESSAGES[action.key],
      icon: 'fa-light fa-triangle-exclamation',
      acceptLabel: action.label,
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: action.key === 'remove' ? 'p-button-sm p-button-danger' : 'p-button-sm',
      rejectButtonStyleClass: 'p-button-secondary p-button-sm p-button-outlined',
      accept: () => this.writeMentorStatus(mentor.id, action),
    });
  }

  private initRows() {
    return computed(() => this.mentors().map((person) => this.toRow(person)));
  }

  /** Search waits for typing to pause; the status applies at once. Every change goes back to the first page. */
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
      offset: this.offset(),
      reload: this.reloadCount(),
    }));

    toObservable(query)
      .pipe(
        tap(() => {
          this.loading.set(true);
          this.loadFailed.set(false);
        }),
        switchMap(({ programId, search, status, offset }) =>
          this.mentorshipAdminService
            .getProgramMentors(programId, {
              search: search || undefined,
              status: status ?? undefined,
              offset,
              limit: MENTORSHIP_ADMIN_MANAGEMENT_PAGE_SIZE,
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
          this.mentors.set([]);
          this.total.set(0);
          this.loadFailed.set(true);
          return;
        }
        this.mentors.set(page.data);
        this.total.set(page.total);
      });
  }

  private toRow(person: MentorshipProgramMentor) {
    return {
      ...person,
      initials: mentorshipPersonInitials(person.name),
      avatarStyleClass: mentorshipPersonAvatarClass(person.name),
      statusLabel: MENTORSHIP_ADMIN_MENTOR_STATUS_LABELS[person.status],
      statusBadgeClass: MENTORSHIP_ADMIN_MENTOR_STATUS_BADGE_CLASSES[person.status],
      invitationLabel: person.invitedOn ? formatIsoDateLabel(person.invitedOn) : '—',
      profileCreatedLabel: person.profileCreated ? 'Yes' : 'No',
      // Any mentor with a profile on a published program links, whatever the status.
      hasPublicPage: this.programPublished() && !!person.profileCreated,
      profileCreatedClass: person.profileCreated ? 'text-emerald-600' : 'text-red-600',
      actions: MENTORSHIP_ADMIN_MENTOR_ACTIONS_BY_STATUS[person.status].map((action) => ({
        ...action,
        ...MENTORSHIP_ADMIN_MENTOR_ACTION_APPEARANCE[action.key],
      })),
    };
  }

  /**
   * Sends one status change and is never cancelled by the tab going away (no `takeUntilDestroyed`): aborting it would
   * leave the change unknown and untoasted. A write that lands after the tab is gone still toasts and refreshes the
   * parent's counts, but skips the table reload.
   */
  private writeMentorStatus(memberId: string, action: MentorshipAdminMentorAction): void {
    if (this.writeInFlight()) {
      this.showToast('info', 'Please wait', MENTORSHIP_ADMIN_DECISION_IN_FLIGHT_MESSAGE, 3000);
      return;
    }
    this.writeInFlight.set(true);
    this.mentorshipAdminService
      .updateProgramMentor(this.programId(), memberId, { status: action.status })
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.writeInFlight.set(false);
          this.showToast('success', 'Success', MENTORSHIP_ADMIN_MENTOR_ACTION_SUCCESS_MESSAGES[action.key], 3000);
          this.countsRefresh()();
          this.reloadPage();
        },
        error: (err: unknown) => {
          this.writeInFlight.set(false);
          this.onWriteError(err);
        },
      });
  }

  /** A 409 means the mentor moved on, so the page reloads; an impersonation 403 shows the server's text. */
  private onWriteError(err: unknown): void {
    const status = err instanceof HttpErrorResponse ? err.status : 0;
    if (status === 409) {
      this.reloadPage();
      this.showToast('error', 'Error', MENTORSHIP_ADMIN_MENTOR_CHANGED_MESSAGE, 5000);
      return;
    }
    if (status === 403 && (err as HttpErrorResponse).error?.code === MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE) {
      this.showToast('error', 'Error', serverAuthoredMessage(err, MENTORSHIP_ADMIN_DECISION_FAILED_MESSAGE), 5000);
      return;
    }
    this.showToast('error', 'Error', MENTORSHIP_ADMIN_DECISION_FAILED_MESSAGE, 5000);
  }

  private reloadPage(): void {
    if (!this.destroyed) this.reloadCount.update((count) => count + 1);
  }

  private showToast(severity: 'success' | 'error' | 'info', summary: string, detail: string, life: number): void {
    this.messageService.add({ severity, summary, detail, life });
  }
}

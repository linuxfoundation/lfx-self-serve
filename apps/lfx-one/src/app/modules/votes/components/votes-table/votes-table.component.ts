// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DOCUMENT, formatDate, isPlatformBrowser } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, input, model, output, PLATFORM_ID, signal, Signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardTabsBarComponent } from '@components/card-tabs-bar/card-tabs-bar.component';
import { CardComponent } from '@components/card/card.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { MenuComponent } from '@components/menu/menu.component';
import { SelectComponent } from '@components/select/select.component';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import { PollStatus, VOTE_LABEL, VoteResponseStatus } from '@lfx-one/shared';
import { VoteRowParticipationState } from '@lfx-one/shared/enums';
import {
  FilterPillOption,
  GroupsIOMailingList,
  MyVotesQuickFilter,
  Vote,
  VoteFilterState,
  VoteMailingListReminderDialogData,
  VoteStatusCounts,
  VoteTableRow,
} from '@lfx-one/shared/interfaces';
import {
  buildMailtoHref,
  buildVoteMailingListReminder,
  computeVoteRowParticipation,
  getEntityCommands,
  getMailingListEmail,
  getUserTimezone,
  getVoteEndedEarlyDetailTooltip,
  isMailtoSafeEmail,
  isVoteEndedEarly,
  matchesMyVotesQuickFilter,
  toAbsoluteUrl,
  votePermalinkPath,
} from '@lfx-one/shared/utils';
import { DueDateLabelColorPipe } from '@pipes/due-date-label-color.pipe';
import { DueDateLabelPipe } from '@pipes/due-date-label.pipe';
import { LongTimezonePipe } from '@pipes/long-timezone.pipe';
import { PollStatusLabelPipe } from '@pipes/poll-status-label.pipe';
import { PollStatusSeverityPipe } from '@pipes/poll-status-severity.pipe';
import { VoteDeadlinePipe } from '@pipes/vote-deadline.pipe';
import { ClipboardShareService } from '@services/clipboard-share.service';
import { MailingListService } from '@services/mailing-list.service';
import { VoteService } from '@services/vote.service';
import { ConfirmationService, MenuItem, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogService } from 'primeng/dynamicdialog';
import { TooltipModule } from 'primeng/tooltip';
import { combineLatest, debounceTime, distinctUntilChanged, map, startWith, take } from 'rxjs';

import { VoteMailingListReminderDialogComponent } from '../vote-mailing-list-reminder-dialog/vote-mailing-list-reminder-dialog.component';
import { VoteReminderDialogComponent } from '../vote-reminder-dialog/vote-reminder-dialog.component';

@Component({
  selector: 'lfx-votes-table',
  imports: [
    CardComponent,
    CardTabsBarComponent,
    TableComponent,
    TagComponent,
    ButtonComponent,
    ReactiveFormsModule,
    InputTextComponent,
    MenuComponent,
    SelectComponent,
    PollStatusLabelPipe,
    PollStatusSeverityPipe,
    DueDateLabelPipe,
    DueDateLabelColorPipe,
    LongTimezonePipe,
    VoteDeadlinePipe,
    TooltipModule,
    ConfirmDialogModule,
    EmptyStateComponent,
  ],
  providers: [ConfirmationService],
  templateUrl: './votes-table.component.html',
})
export class VotesTableComponent {
  // === Injections ===
  private readonly router = inject(Router);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly messageService = inject(MessageService);
  private readonly voteService = inject(VoteService);
  private readonly clipboardShare = inject(ClipboardShareService);
  private readonly dialogService = inject(DialogService);
  private readonly mailingListService = inject(MailingListService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly document = inject(DOCUMENT);

  // === Constants ===
  protected readonly voteLabel = VOTE_LABEL;
  protected readonly PollStatus = PollStatus;
  protected readonly VoteResponseStatus = VoteResponseStatus;
  protected readonly VoteRowParticipationState = VoteRowParticipationState;

  // === Inputs ===
  public readonly votes = input.required<Vote[]>();
  public readonly hasPMOAccess = input<boolean>(false);
  public readonly loading = input<boolean>(false);
  // Partial personal feeds must not present missing rows as confirmed empty results.
  public readonly resultsComplete = input<boolean>(true);
  public readonly totalRecords = input<number>(0);
  public readonly paginationLoading = input<boolean>(false);
  public readonly rowsPerPage = input<number>(10);
  public readonly first = input<number>(0);
  public readonly lazy = input<boolean>(false);
  public readonly serverFiltersActive = input<boolean>(false);
  public readonly groupOptions = input<{ label: string; value: string | null }[]>([{ label: 'All Groups', value: null }]);
  public readonly foundationOptions = input<{ label: string; value: string | null }[]>([]);
  public readonly projectOptions = input<{ label: string; value: string | null }[]>([]);
  public readonly showFoundationFilter = input<boolean>(false);
  public readonly showProjectFilter = input<boolean>(false);
  // Draft tab is only meaningful in management contexts (project/committee lens); hide it in the Me lens.
  public readonly showDraftTab = input<boolean>(true);
  // Management contexts (project/foundation lens, committee tab) show "N of M responded" progress; the Me lens keeps the raw count.
  public readonly showParticipationProgress = input<boolean>(false);
  // Merged UNDER each row's own derived params — the committee tab passes its committee_uid here so a
  // row missing the field still admits committee writers; per-row values always win (dashboard spans projects).
  public readonly editQueryParamsFallback = input<Record<string, string>>({});
  public readonly quickFilter = input<MyVotesQuickFilter | null>(null);
  public readonly quickFilterNowMs = input<number>(0);
  public readonly scopeActive = input<boolean>(false);
  // Opt-in status-tab counts (#3687): when on, each tab label carries its count, and a null
  // `statusCounts` (loading or failed) renders as unavailable rather than as a confirmed zero.
  public readonly showStatusCounts = input<boolean>(false);
  public readonly statusCounts = input<VoteStatusCounts | null>(null);

  // === Outputs ===
  public readonly viewVote = output<string>();
  public readonly viewResults = output<string>();
  public readonly refresh = output<void>();
  public readonly pageChange = output<{ first: number; rows: number }>();
  public readonly filtersChange = output<VoteFilterState>();
  public readonly foundationFilterChange = output<string | null>();
  public readonly projectFilterChange = output<string | null>();
  public readonly statusTabSelected = output<string>();
  public readonly filtersReset = output<void>();

  // === Forms ===
  public searchForm = new FormGroup({
    search: new FormControl<string>(''),
    group: new FormControl<string | null>(null),
    foundationFilter: new FormControl<string | null>(null),
    projectFilter: new FormControl<string | null>(null),
  });

  public readonly statusTab = model<string>('all');

  // === Writable Signals ===
  protected readonly isDeleting = signal(false);
  /** Items for the shared row "More" (⋮) menu, rebuilt for the clicked row before it opens. */
  protected readonly rowActionMenuItems = signal<MenuItem[]>([]);
  protected readonly rowActionMenuVoteUid = signal<string | null>(null);
  protected readonly rowActionMenuOpen = signal(false);
  private readonly filterState = signal<VoteFilterState>({ search: '', status: null, group: null });

  // === Computed Signals ===
  protected readonly statusTabOptions: Signal<FilterPillOption[]> = this.initStatusTabOptions();
  protected readonly displayedVotes: Signal<VoteTableRow[]> = this.initDisplayedVotes();
  protected readonly isFiltered = computed(() => {
    if (this.lazy()) return this.serverFiltersActive();
    const f = this.filterState();
    return this.statusTab() !== 'all' || !!f.search.trim() || !!f.group || !!this.quickFilter() || this.scopeActive();
  });
  // Filters beyond the status tab. When any applies, an empty result can't claim the status itself has no votes.
  protected readonly hasAdditionalFilters = computed(() => {
    const f = this.filterState();
    return !!f.search || !!f.group || !!this.quickFilter() || this.scopeActive();
  });
  protected readonly emptyStateCopy: Signal<{ title: string; subtitle: string }> = this.initEmptyStateCopy();

  protected readonly rppOptions = computed<number[] | undefined>(() => {
    const count = this.lazy() ? this.totalRecords() : this.displayedVotes().length;
    return count > 10 ? [10, 25, 50] : undefined;
  });

  // Resolved once per browser session — SSR has no `Intl` zone to resolve, so
  // deadline text falls back to UTC there and is replaced on client hydration.
  protected readonly viewerTimezone: string = isPlatformBrowser(this.platformId) ? getUserTimezone() : 'UTC';

  // === Constructor ===
  public constructor() {
    this.initFormSubscriptions();
    effect(() => {
      if (!this.showDraftTab() && this.statusTab() === PollStatus.DISABLED) {
        untracked(() => this.statusTab.set('all'));
      }
    });
    // Only personal/client scope owns these options. Do not clear controls during a feed refresh.
    const availableGroups = computed(() => (this.lazy() || this.loading() ? null : this.groupOptions()));
    toObservable(availableGroups)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((options) => {
        if (!options) return;
        const group = this.searchForm.controls.group.value;
        if (group && !options.some((option) => option.value === group)) {
          this.searchForm.controls.group.setValue(null);
        }
      });
  }

  // === Protected Methods ===
  protected onViewVote(voteId: string): void {
    this.viewVote.emit(voteId);
  }

  protected onViewResults(voteId: string): void {
    this.viewResults.emit(voteId);
  }

  protected onStatusTabChange(tab: string): void {
    this.statusTabSelected.emit(tab);
    this.statusTab.set(tab);
  }

  protected onFoundationFilterChange(value: string | null): void {
    this.foundationFilterChange.emit(value);
    this.searchForm.get('projectFilter')?.setValue(null, { emitEvent: false });
    this.projectFilterChange.emit(null);
  }

  protected onPageChange(event: { first: number; rows: number }): void {
    this.pageChange.emit({ first: event.first, rows: event.rows });
  }

  protected onRowSelect(event: { data: VoteTableRow }): void {
    const vote = event.data;
    if (vote.status === PollStatus.ENDED) {
      this.viewResults.emit(vote.uid);
    } else {
      this.viewVote.emit(vote.uid);
    }
  }

  /** Opens the row "More" menu without selecting the row, which would open a drawer. */
  protected toggleRowActionMenu(event: Event, vote: VoteTableRow, menu: MenuComponent): void {
    event.stopPropagation();
    this.rowActionMenuVoteUid.set(vote.uid);
    const items: MenuItem[] = [{ label: 'Copy link', icon: 'fa-light fa-link', command: () => this.copyVoteLink(vote.uid) }];
    // Managers only, and only while the vote is open — upstream rejects reminders for any other status.
    if (vote.writer === true && vote.status === PollStatus.ACTIVE) {
      items.push({ label: 'Send reminder', icon: 'fa-light fa-envelope', command: () => this.openReminderDialog(vote) });
      items.push({
        label: 'Reminder mailing list',
        icon: 'fa-light fa-envelopes-bulk',
        tooltipOptions: { tooltipLabel: 'Opens your mail app to send a reminder email to the mailing list', tooltipPosition: 'left' },
        command: () => this.sendMailingListReminder(vote),
      });
    }
    if (this.hasPMOAccess()) {
      items.push({ label: 'Clone', icon: 'fa-light fa-copy', command: () => this.cloneVote(vote) });
    }
    this.rowActionMenuItems.set(items);
    menu.toggle(event);
  }

  /** Opens the reminder dialog for an active vote's eligible non-voters (#3769). */
  protected openReminderDialog(vote: VoteTableRow): void {
    this.dialogService.open(VoteReminderDialogComponent, {
      header: 'Send vote reminder',
      width: 'min(960px, 96vw)',
      modal: true,
      closable: true,
      draggable: false,
      data: { vote },
    });
  }

  /**
   * Opens a `mailto:` reminder draft to the vote's committee mailing list in the manager's own mail app (#3658),
   * asking which list only when the committee has several. Nothing is sent from LFX.
   */
  protected sendMailingListReminder(vote: VoteTableRow): void {
    // Committee-tab rows may omit the indexed uid; use the context already resolved for that row.
    const committeeUid = vote.committee_uid || vote.editQueryParams['committee_uid'];
    if (!committeeUid) {
      this.showNoMailingListToast();
      return;
    }

    this.mailingListService
      .getMailingListsByCommittee(committeeUid)
      .pipe(
        take(1),
        // Unsafe addresses never reach a mailto: link — a crafted group_name/domain could add recipients or headers.
        map((lists) => (lists ?? []).filter((list) => isMailtoSafeEmail(getMailingListEmail(list)))),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (lists) => {
          if (lists.length === 0) {
            this.showNoMailingListToast();
          } else if (lists.length === 1) {
            this.openMailingListReminderDraft(vote, lists[0]);
          } else {
            this.openMailingListPicker(vote, lists);
          }
        },
        error: () =>
          this.messageService.add({
            severity: 'error',
            summary: "Couldn't load mailing lists",
            detail: "Couldn't load this group's mailing lists. Please try again.",
          }),
      });
  }

  protected resetFilters(): void {
    this.searchForm.reset({ search: '', group: null, foundationFilter: null, projectFilter: null });
    this.statusTab.set('all');
    this.foundationFilterChange.emit(null);
    this.projectFilterChange.emit(null);
    this.filtersReset.emit();
  }

  protected onDeleteVote(vote: Vote): void {
    this.confirmationService.confirm({
      message: `Are you sure you want to delete the ${this.voteLabel.singular.toLowerCase()} "${vote.name}"? This action cannot be undone.`,
      header: `Delete ${this.voteLabel.singular}`,
      acceptLabel: 'Delete',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-danger p-button-sm',
      rejectButtonStyleClass: 'p-button-outlined p-button-sm',
      accept: () => {
        this.isDeleting.set(true);
        this.voteService
          .deleteVote(vote.uid)
          .pipe(take(1))
          .subscribe({
            next: () => {
              this.messageService.add({
                severity: 'success',
                summary: 'Success',
                detail: `${this.voteLabel.singular} deleted successfully`,
              });
              this.isDeleting.set(false);
              this.refresh.emit();
            },
            error: (error) => {
              this.messageService.add({
                severity: 'error',
                summary: 'Error',
                detail: `Failed to delete ${this.voteLabel.singular.toLowerCase()}: ${error.message || 'Unknown error'}`,
              });
              this.isDeleting.set(false);
            },
          });
      },
    });
  }

  // === Private Initializers ===
  private initStatusTabOptions(): Signal<FilterPillOption[]> {
    return computed(() => {
      const base: FilterPillOption[] = [
        { id: 'all', label: 'All' },
        { id: PollStatus.ACTIVE, label: 'Active' },
      ];
      if (this.showDraftTab()) {
        base.push({ id: PollStatus.DISABLED, label: 'Draft' });
      }
      base.push({ id: PollStatus.ENDED, label: 'Ended' });
      if (!this.showStatusCounts()) return base;

      const counts = this.statusCounts();
      return base.map((option) => {
        if (!counts) return { ...option, label: `${option.label} (–)`, ariaLabel: `${option.label}, count unavailable` };
        return { ...option, label: `${option.label} (${counts[option.id as keyof VoteStatusCounts]})` };
      });
    });
  }

  private initFormSubscriptions(): void {
    combineLatest([
      this.searchForm.valueChanges.pipe(
        startWith(this.searchForm.value),
        debounceTime(300),
        distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b))
      ),
      toObservable(this.statusTab),
    ])
      .pipe(
        // Trim the effective search (the control keeps the typed text) so whitespace-only input neither hides rows nor counts as a filter.
        map(([formValue, statusTab]) => ({
          search: (formValue.search ?? '').trim(),
          status: statusTab !== 'all' ? (statusTab as PollStatus) : null,
          group: formValue.group ?? null,
        })),
        // Padding-only search edits now map to the same filters; don't re-emit them and reset the parent's pagination.
        distinctUntilChanged((a, b) => a.search === b.search && a.status === b.status && a.group === b.group),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((filters) => {
        this.filterState.set(filters);
        this.filtersChange.emit(filters);
      });
  }

  private initEmptyStateCopy(): Signal<{ title: string; subtitle: string }> {
    return computed(() => {
      if (!this.resultsComplete()) {
        return { title: 'Some votes could not be loaded', subtitle: 'Your vote list is incomplete. Retry to check for votes in this view.' };
      }
      if (!this.hasAdditionalFilters()) {
        switch (this.statusTab()) {
          case PollStatus.ACTIVE:
            return { title: 'No active votes', subtitle: 'There are no votes open for voting in this view. Select All to see votes with other statuses.' };
          case PollStatus.DISABLED:
            return { title: 'No draft votes', subtitle: 'Votes saved as drafts will appear here before they are opened for voting.' };
          case PollStatus.ENDED:
            return { title: 'No ended votes yet', subtitle: 'Votes will appear here after voting ends.' };
        }
      }
      return { title: 'No votes match your filters', subtitle: 'Try changing your search or filters, or reset filters to see all votes.' };
    });
  }

  private initDisplayedVotes(): Signal<VoteTableRow[]> {
    return computed(() => {
      const allVotes = this.votes();

      // For lazy (server-side paginated) mode, the server handles all filtering via filtersChange
      if (this.lazy()) {
        return allVotes.map((vote) => this.toVoteTableRow(vote));
      }

      // For client-side mode (Me lens), apply all filters locally
      const filters = this.filterState();
      let filtered = allVotes;

      const tab = this.statusTab();
      if (tab !== 'all') {
        filtered = filtered.filter((v) => (v.status as string).toLowerCase() === tab);
      }

      if (filters.search) {
        const term = filters.search.toLowerCase();
        filtered = filtered.filter((v) => v.name.toLowerCase().includes(term));
      }

      if (filters.group) {
        filtered = filtered.filter((v) => v.committee_name === filters.group);
      }

      const quickFilter = this.quickFilter();
      if (quickFilter) {
        const nowMs = this.quickFilterNowMs();
        filtered = filtered.filter((vote) => matchesMyVotesQuickFilter(vote, quickFilter, nowMs));
      }

      return filtered.map((vote) => this.toVoteTableRow(vote));
    });
  }

  /** Copies the vote's lens-independent permalink; access is checked when the link is opened, so anyone who sees the row may share it. */
  private copyVoteLink(uid: string): void {
    this.clipboardShare.copyLink(toAbsoluteUrl(votePermalinkPath(uid), isPlatformBrowser(this.platformId)), 'Vote link copied to clipboard.');
  }

  /** Opens the create form prefilled from this vote, carrying the row's own project/committee context (dashboard rows can span projects).
   *  Tier-prefixes the route from the source vote's own is_foundation (not getEntityCommands — that builder takes an id/leaf shaped for
   *  edit/details routes, and create has neither) so vote-manage's entity-context sync lands the clone in the source's own project. */
  private cloneVote(vote: VoteTableRow): void {
    let tierSegment: 'foundation' | 'project' | null = null;
    if (vote.is_foundation === true) tierSegment = 'foundation';
    else if (vote.is_foundation === false) tierSegment = 'project';
    const commands = tierSegment ? ['/', tierSegment, 'votes', 'create'] : ['/votes', 'create'];
    this.router.navigate(commands, { queryParams: { ...vote.editQueryParams, clone: vote.uid } });
  }

  /** Several lists: the picker closes with the chosen list, or with nothing on Cancel. */
  private openMailingListPicker(vote: VoteTableRow, lists: GroupsIOMailingList[]): void {
    this.dialogService
      .open(VoteMailingListReminderDialogComponent, {
        header: 'Reminder mailing list',
        width: 'min(480px, 96vw)',
        modal: true,
        closable: true,
        draggable: false,
        data: { vote, lists } satisfies VoteMailingListReminderDialogData,
      })
      ?.onClose.pipe(take(1))
      .subscribe((list?: GroupsIOMailingList) => {
        if (list) {
          this.openMailingListReminderDraft(vote, list);
        }
      });
  }

  private openMailingListReminderDraft(vote: VoteTableRow, list: GroupsIOMailingList): void {
    const isBrowser = isPlatformBrowser(this.platformId);
    const draft = buildVoteMailingListReminder(vote, toAbsoluteUrl(votePermalinkPath(vote.uid), isBrowser));
    const href = buildMailtoHref(getMailingListEmail(list), draft);
    if (!href) {
      this.messageService.add({
        severity: 'error',
        summary: "Couldn't open email",
        detail: 'This reminder is too long to open in your email app.',
      });
      return;
    }
    if (isBrowser) {
      this.document.location.href = href;
    }
  }

  private showNoMailingListToast(): void {
    this.messageService.add({
      severity: 'info',
      summary: 'No mailing list',
      detail: 'This group has no mailing list. Use Copy link or Send reminder instead.',
    });
  }

  private toVoteTableRow(vote: Vote): VoteTableRow {
    let endedEarlyTooltip: string | null = null;

    if (isVoteEndedEarly(vote)) {
      const formattedEarlyClose = formatDate(vote.early_end_time!, 'MMM d, y', 'en-US');
      endedEarlyTooltip = getVoteEndedEarlyDetailTooltip(formattedEarlyClose);
    }

    // Canonical edit URL derives from the VOTE's own project tier (is_foundation), not the viewer's
    // active lens; falls back to the flat path (lensRedirectGuard) when the tier is unenriched.
    const editCommands = getEntityCommands('votes', vote.uid, vote.is_foundation, 'edit') ?? ['/votes', vote.uid, 'edit'];

    // Per-row query params: rows can span projects (dashboard), so no table-level record can
    // express them — derive `project`/`committee_uid` from each row itself, over the fallback.
    const editQueryParams: Record<string, string> = { ...this.editQueryParamsFallback() };
    if (vote.project_slug) editQueryParams['project'] = vote.project_slug;
    if (vote.committee_uid) editQueryParams['committee_uid'] = vote.committee_uid;

    return {
      ...vote,
      endedEarlyTooltip,
      participation: computeVoteRowParticipation(vote),
      editCommands,
      editQueryParams,
    };
  }
}

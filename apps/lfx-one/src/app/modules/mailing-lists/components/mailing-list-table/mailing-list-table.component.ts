// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, output, Signal } from '@angular/core';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule, FormGroup } from '@angular/forms';
import { switchMap, startWith } from 'rxjs';
import { RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import {
  COMMITTEE_LABEL,
  MAILING_LIST_DELIVERY_MODE_LABELS,
  MAILING_LIST_JOIN_REFRESH_DELAY_MS,
  MAILING_LIST_LABEL,
  MAILING_LIST_MAX_VISIBLE_GROUPS,
} from '@lfx-one/shared';
import { MailingListAudienceAccess, MailingListMemberDeliveryMode, MailingListMemberModStatus, MailingListMemberType } from '@lfx-one/shared/enums';
import { FilterOption, GroupsIOMailingList, MailingListTableRowVm, MyMailingList } from '@lfx-one/shared/interfaces';
import { getMailingListCommands, getMailingListGroupsIoUrl, getMailingListLinkQueryParams } from '@lfx-one/shared/utils';
import { GroupEmailPipe } from '@pipes/group-email.pipe';
import { MailingListTypeLabelPipe } from '@pipes/mailing-list-type-label.pipe';
import { RemainingGroupsTooltipPipe } from '@pipes/remaining-groups-tooltip.pipe';
import { SliceLinkedGroupsPipe } from '@pipes/slice-linked-groups.pipe';
import { StripHtmlPipe } from '@pipes/strip-html.pipe';
import { MailingListService } from '@services/mailing-list.service';
import { PersonaService } from '@services/persona.service';
import { UserService } from '@services/user.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { TooltipModule } from 'primeng/tooltip';

@Component({
  selector: 'lfx-mailing-list-table',
  imports: [
    ReactiveFormsModule,
    CardComponent,
    ButtonComponent,
    TableComponent,
    TagComponent,
    InputTextComponent,
    SelectComponent,
    TooltipModule,
    RouterLink,
    GroupEmailPipe,
    MailingListTypeLabelPipe,
    RemainingGroupsTooltipPipe,
    SliceLinkedGroupsPipe,
    StripHtmlPipe,
    EmptyStateComponent,
    ConfirmDialogModule,
  ],
  templateUrl: './mailing-list-table.component.html',
  styleUrl: './mailing-list-table.component.scss',
})
export class MailingListTableComponent {
  // Injected services
  private readonly personaService = inject(PersonaService);
  private readonly mailingListService = inject(MailingListService);
  private readonly userService = inject(UserService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly messageService = inject(MessageService);

  // Inputs
  public mailingLists = input.required<GroupsIOMailingList[]>();
  public isMaintainer = input<boolean>(false);
  public isMeLens = input<boolean>(false);
  public myMailingListUids = input<Set<string>>(new Set());
  public mailingListLabel = input<string>(MAILING_LIST_LABEL.singular);
  public searchForm = input.required<FormGroup>();
  public committeeFilterOptions = input.required<FilterOption[]>();
  public statusFilterOptions = input.required<FilterOption[]>();
  public foundationOptions = input<{ label: string; value: string | null }[]>([]);
  public projectOptions = input<{ label: string; value: string | null }[]>([]);
  public showFoundationFilter = input<boolean>(false);
  public showProjectFilter = input<boolean>(false);
  public loading = input<boolean>(false);
  public membershipError = input<boolean>(false);

  // Constants
  protected readonly maxVisibleGroups = MAILING_LIST_MAX_VISIBLE_GROUPS;
  protected readonly mailingListLabelPlural = MAILING_LIST_LABEL.plural;
  protected readonly committeeLabel = COMMITTEE_LABEL;
  protected readonly audienceAccess = MailingListAudienceAccess;
  protected readonly deliveryModeLabels = MAILING_LIST_DELIVERY_MODE_LABELS;

  // Outputs
  public readonly refresh = output<void>();
  public readonly rowClick = output<MailingListTableRowVm>();
  public readonly foundationFilterChange = output<string | null>();
  public readonly projectFilterChange = output<string | null>();

  // State
  public isBoardMember: Signal<boolean> = computed(() => this.personaService.currentPersona() === 'board-member');

  private readonly formValue = toSignal(toObservable(this.searchForm).pipe(switchMap((form) => form.valueChanges.pipe(startWith(form.value)))), {
    initialValue: {} as Record<string, unknown>,
  });

  protected readonly isFiltered = computed(() => {
    const v = this.formValue();
    return !!v['search'] || !!v['committee'] || !!v['status'] || !!v['foundationFilter'] || !!v['projectFilter'];
  });

  protected readonly rppOptions = computed<number[] | undefined>(() => (this.mailingLists().length > 10 ? [10, 25, 50] : undefined));

  /** Rows decorated with canonical view-link state (GH-1567) — pre-computed once per input change (angular-reactive-data §3.5). */
  protected readonly tableRows: Signal<MailingListTableRowVm[]> = this.initTableRows();

  // Event Handlers
  protected onRowSelect(event: { data: MailingListTableRowVm }): void {
    this.rowClick.emit(event.data);
  }

  protected resetFilters(): void {
    this.searchForm().patchValue({ search: '', committee: null, status: null, foundationFilter: null, projectFilter: null });
    this.foundationFilterChange.emit(null);
    this.projectFilterChange.emit(null);
  }

  protected onLeave(event: Event, row: MailingListTableRowVm): void {
    event.stopPropagation();

    if (!row.my_member_uid) {
      return;
    }

    const listName = row.title || row.group_name;
    const memberUid = row.my_member_uid;
    const caveat = row.committees?.length
      ? ` Note: this list syncs from the ${row.committees[0].name} committee — leaving may not persist if your committee role changes.`
      : '';

    this.confirmationService.confirm({
      message: `Are you sure you want to leave ${listName}? You will no longer receive emails from this list.${caveat}`,
      header: 'Leave Mailing List',
      acceptLabel: 'Leave',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-sm p-button-danger',
      rejectButtonStyleClass: 'p-button-sm p-button-secondary',
      accept: () => {
        this.mailingListService.deleteMember(row.uid, memberUid).subscribe({
          // deleteMember already polls the query-service index until the member record is gone
          // (see pollUntilResourceRemoved server-side), so the index is consistent by the time
          // this resolves — safe to refresh immediately.
          next: () => {
            this.messageService.add({ severity: 'success', summary: 'Left mailing list', detail: `You have left ${listName}.` });
            this.refresh.emit();
          },
          error: (err) => {
            console.error('Failed to leave mailing list', err);
            this.messageService.add({ severity: 'error', summary: 'Error', detail: `Failed to leave ${listName}. Please try again.` });
          },
        });
      },
    });
  }

  protected onJoin(event: Event, row: MailingListTableRowVm): void {
    event.stopPropagation();

    const email = this.userService.user()?.email;
    if (!email) {
      this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Unable to determine your email address.' });
      return;
    }

    const listName = row.title || row.group_name;

    this.mailingListService
      .createMember(row.uid, {
        email,
        member_type: MailingListMemberType.DIRECT,
        delivery_mode: MailingListMemberDeliveryMode.NORMAL,
        mod_status: MailingListMemberModStatus.NONE,
      })
      .subscribe({
        next: () => {
          this.messageService.add({ severity: 'success', summary: 'Joined mailing list', detail: `You have joined ${listName}.` });
          // createMember intentionally skips index-poll wait on the hot path (LFXV2-2712), so an
          // immediate refetch can race the query-service index — give it a beat to catch up.
          setTimeout(() => this.refresh.emit(), MAILING_LIST_JOIN_REFRESH_DELAY_MS);
        },
        error: (err) => {
          console.error('Failed to join mailing list', err);
          this.messageService.add({ severity: 'error', summary: 'Error', detail: `Failed to join ${listName}. Please try again.` });
        },
      });
  }

  private initTableRows(): Signal<MailingListTableRowVm[]> {
    return computed(() => {
      const joinedUids = this.myMailingListUids();
      // While myMailingListUids is still loading — or failed to load — it may not reflect the
      // caller's actual memberships — don't show Join (which would incorrectly offer it for lists
      // they already belong to) until a successful fetch has settled.
      const stillLoading = this.loading();
      const membershipUnknown = this.membershipError();
      return this.mailingLists().map((mailingList) => {
        const myDeliveryMode = (mailingList as Partial<MyMailingList>).my_delivery_mode;
        return {
          ...mailingList,
          viewCommands: getMailingListCommands(mailingList),
          linkQueryParams: getMailingListLinkQueryParams(mailingList),
          groupsIoUrl: getMailingListGroupsIoUrl(mailingList),
          canJoin: !stillLoading && !membershipUnknown && mailingList.audience_access === MailingListAudienceAccess.PUBLIC && !joinedUids.has(mailingList.uid),
          mySubscriptionLabel: myDeliveryMode ? this.deliveryModeLabels[myDeliveryMode] : 'Subscribed',
        };
      });
    });
  }
}

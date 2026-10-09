// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, DecimalPipe, isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, input, output, PLATFORM_ID } from '@angular/core';
import { FormGroup } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import { Committee, COMMITTEE_LABEL } from '@lfx-one/shared';
import { CommitteeTableRowVm } from '@lfx-one/shared/interfaces';
import { JOIN_MODE_TOOLTIPS } from '@lfx-one/shared/constants';
import { getGroupCommands, resolveJoinModeSeverity, resolveRoleChip, resolveTypeDisplay } from '@lfx-one/shared/utils';
import { JoinModeLabelPipe } from '@app/shared/pipes/join-mode-label.pipe';
import { PlatformIconPipe } from '@app/shared/pipes/platform-icon.pipe';
import { PlatformLabelPipe } from '@app/shared/pipes/platform-label.pipe';
import { CommitteeService } from '@services/committee.service';
import { PersonaService } from '@services/persona.service';
import { committeeLeaveErrorMessage } from '@shared/utils/http-error.utils';

import { ConfirmationService, MessageService } from 'primeng/api';
import { TooltipModule } from 'primeng/tooltip';
import { CommitteeFilterBarComponent } from '../committee-filter-bar/committee-filter-bar.component';

@Component({
  selector: 'lfx-committee-table',
  imports: [
    DatePipe,
    DecimalPipe,
    RouterLink,
    CardComponent,
    ButtonComponent,
    TableComponent,
    TagComponent,
    CommitteeFilterBarComponent,
    TooltipModule,
    JoinModeLabelPipe,
    PlatformIconPipe,
    PlatformLabelPipe,
    EmptyStateComponent,
  ],
  templateUrl: './committee-table.component.html',
  styleUrl: './committee-table.component.scss',
})
export class CommitteeTableComponent {
  // Injected services
  private readonly personaService = inject(PersonaService);
  private readonly messageService = inject(MessageService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly committeeService = inject(CommitteeService);
  private readonly platformId = inject(PLATFORM_ID);

  // Inputs
  public committees = input.required<Committee[]>();
  public hasItems = input<boolean>(true);
  public canManageCommittee = input<boolean>(false);
  public myCommitteeUids = input<Set<string>>(new Set());
  public readonly committeeLabel = COMMITTEE_LABEL;
  public searchForm = input.required<FormGroup>();
  public votingStatusOptions = input.required<{ label: string; value: string | null }[]>();
  public joinModeOptions = input<{ label: string; value: string | null }[]>([]);
  public showJoinModeFilter = input<boolean>(false);
  public showFoundationFilter = input<boolean>(false);
  public showProjectFilter = input<boolean>(false);
  public foundationOptions = input<{ label: string; value: string | null }[]>([]);
  public projectOptions = input<{ label: string; value: string | null }[]>([]);
  /** When false, suppresses the built-in search/voting-status filter bar. Used by the All Groups foundation-grouped view, which renders one shared filter bar above N per-group `<lfx-committee-table>` instances instead of duplicating it per group. Defaults to true — every existing caller is unaffected. */
  public showFilterBar = input<boolean>(true);
  /** `data-testid` for the internal `<lfx-table>`. Defaults to the pre-existing fixed id — every caller that renders a single instance is unaffected. The foundation-grouped view renders one `<lfx-committee-table>` per group, so it must pass a per-group value to keep each table's testid unique (a fixed id would repeat once per group and turn `getByTestId` into a Playwright strict-mode violation). */
  public tableTestId = input<string>('committee-dashboard-table');
  /** True when this table is rendered inside the Me Lens (My Groups). Used to attach router navigation state so `CommitteeViewComponent` can detect the transition. */
  public isMeLens = input<boolean>(false);

  // Outputs
  public readonly refresh = output<void>();
  /** Emits the committee uid once the user has left it, so the parent can wait for the membership index to catch up before reloading. */
  public readonly left = output<string>();
  public readonly rowClick = output<Committee>();
  public readonly foundationFilterChange = output<string | null>();
  public readonly projectFilterChange = output<string | null>();
  public readonly resetRequested = output<void>();

  protected readonly isBoardMember = computed(() => this.personaService.currentPersona() === 'board-member');
  protected readonly rppOptions = computed<number[] | undefined>(() => (this.committees().length > 10 ? [10, 25, 50] : undefined));

  /**
   * Rows decorated with their canonical view/edit link state (GH-1566): `getGroupCommands`
   * prefixes the path with the row's OWN project tier (`is_foundation`) instead of the viewer's
   * transient active lens, and `?project=` rides along when the row carries a `project_slug`.
   * Rows without tier data keep the flat `/groups/:uid` fallback (the `??` inside the mapping),
   * which `lensRedirectGuard` handles as before. Pre-computed once per input change rather than
   * per change-detection cycle (angular-reactive-data §3.5).
   * `joinModeSeverity` and `joinModeTooltip` are also pre-computed here so the template stays
   * binding-only with no per-render method calls (frontend-checklist §63-65).
   */
  protected readonly tableRows = computed<CommitteeTableRowVm[]>(() =>
    this.committees().map((committee) => ({
      ...committee,
      viewCommands: getGroupCommands(committee) ?? ['/groups', committee.uid],
      editCommands: getGroupCommands(committee, 'edit') ?? ['/groups', committee.uid, 'edit'],
      linkQueryParams: committee.project_slug ? { project: committee.project_slug } : null,
      join_mode: committee.join_mode ?? 'invite_only',
      joinModeSeverity: resolveJoinModeSeverity(committee.join_mode ?? 'invite_only'),
      joinModeTooltip: JOIN_MODE_TOOLTIPS[committee.join_mode ?? 'invite_only'],
      typeDisplay: resolveTypeDisplay(committee),
      roleChip: resolveRoleChip(committee.my_role),
      isMember: this.myCommitteeUids().has(committee.uid),
    }))
  );

  /** Show the Role column only when the input data carries `my_role` (i.e. Me Lens — MyCommittee rows). */
  protected readonly hasRoleColumn = computed(() => this.tableRows().some((r) => r.my_role != null));

  protected onLeave(event: Event, committee: CommitteeTableRowVm): void {
    event.stopPropagation();

    this.confirmationService.confirm({
      message: `Are you sure you want to leave ${committee.name}? You will lose access to its meetings, votes and documents.`,
      header: `Leave ${this.committeeLabel.singular}`,
      acceptLabel: 'Leave',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-sm p-button-danger',
      rejectButtonStyleClass: 'p-button-sm p-button-secondary',
      accept: () => {
        this.committeeService.leaveCommittee(committee.uid).subscribe({
          next: () => {
            this.messageService.add({ severity: 'success', summary: 'Left', detail: `You have left "${committee.name}"` });
            this.left.emit(committee.uid);
          },
          error: (err: HttpErrorResponse) => {
            this.messageService.add({ severity: 'error', summary: 'Unable to Leave', detail: committeeLeaveErrorMessage(err, committee.name), life: 6000 });
          },
        });
      },
    });
  }

  protected onRowSelect(event: { data: CommitteeTableRowVm }): void {
    this.rowClick.emit(event.data);
  }

  protected resetFilters(): void {
    this.searchForm().patchValue({ search: '', votingStatus: null, joinModeFilter: null, foundationFilter: null, projectFilter: null });
    this.foundationFilterChange.emit(null);
    this.projectFilterChange.emit(null);
    this.resetRequested.emit();
  }

  protected async copyPublicGroupLink(committee: Committee): Promise<void> {
    if (!isPlatformBrowser(this.platformId) || !navigator.clipboard?.writeText) {
      this.messageService.add({ severity: 'error', summary: 'Copy not supported', detail: 'Clipboard access is unavailable in this browser.' });
      return;
    }
    const groupPath = committee.sso_group_name || committee.uid;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/groups/${groupPath}`);
      this.messageService.add({ severity: 'success', summary: 'Link copied', detail: 'Public group link copied to clipboard.' });
    } catch {
      this.messageService.add({ severity: 'error', summary: 'Copy failed', detail: 'Could not access clipboard.' });
    }
  }
}

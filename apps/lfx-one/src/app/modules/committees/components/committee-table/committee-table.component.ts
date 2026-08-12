// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, DecimalPipe, isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, input, output, PLATFORM_ID } from '@angular/core';
import { FormGroup } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import { Committee, COMMITTEE_LABEL } from '@lfx-one/shared';
import { PlatformIconPipe } from '@app/shared/pipes/platform-icon.pipe';
import { PlatformLabelPipe } from '@app/shared/pipes/platform-label.pipe';
import { PersonaService } from '@services/persona.service';

import { MessageService } from 'primeng/api';
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
  private readonly platformId = inject(PLATFORM_ID);

  // Inputs
  public committees = input.required<Committee[]>();
  public hasItems = input<boolean>(true);
  public canManageCommittee = input<boolean>(false);
  public myCommitteeUids = input<Set<string>>(new Set());
  public readonly committeeLabel = COMMITTEE_LABEL;
  public searchForm = input.required<FormGroup>();
  public votingStatusOptions = input.required<{ label: string; value: string | null }[]>();
  public showFoundationFilter = input<boolean>(false);
  public showProjectFilter = input<boolean>(false);
  public foundationOptions = input<{ label: string; value: string | null }[]>([]);
  public projectOptions = input<{ label: string; value: string | null }[]>([]);
  /** When false, suppresses the built-in search/voting-status filter bar. Used by the All Groups foundation-grouped view, which renders one shared filter bar above N per-group `<lfx-committee-table>` instances instead of duplicating it per group. Defaults to true — every existing caller is unaffected. */
  public showFilterBar = input<boolean>(true);
  /** `data-testid` for the internal `<lfx-table>`. Defaults to the pre-existing fixed id — every caller that renders a single instance is unaffected. The foundation-grouped view renders one `<lfx-committee-table>` per group, so it must pass a per-group value to keep each table's testid unique (a fixed id would repeat once per group and turn `getByTestId` into a Playwright strict-mode violation). */
  public tableTestId = input<string>('committee-dashboard-table');

  // Outputs
  public readonly refresh = output<void>();
  public readonly rowClick = output<Committee>();
  public readonly foundationFilterChange = output<string | null>();
  public readonly projectFilterChange = output<string | null>();
  public readonly resetRequested = output<void>();

  protected readonly isBoardMember = computed(() => this.personaService.currentPersona() === 'board-member');
  protected readonly rppOptions = computed<number[] | undefined>(() => (this.committees().length > 10 ? [10, 25, 50] : undefined));

  protected onRowSelect(event: { data: Committee }): void {
    this.rowClick.emit(event.data);
  }

  protected resetFilters(): void {
    this.searchForm().patchValue({ search: '', votingStatus: null, foundationFilter: null, projectFilter: null });
    this.foundationFilterChange.emit(null);
    this.projectFilterChange.emit(null);
    this.resetRequested.emit();
  }

  protected async copyPublicGroupLink(uid: string): Promise<void> {
    if (!isPlatformBrowser(this.platformId) || !navigator.clipboard?.writeText) {
      this.messageService.add({ severity: 'error', summary: 'Copy not supported', detail: 'Clipboard access is unavailable in this browser.' });
      return;
    }
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/groups/${uid}`);
      this.messageService.add({ severity: 'success', summary: 'Link copied', detail: 'Public group link copied to clipboard.' });
    } catch {
      this.messageService.add({ severity: 'error', summary: 'Copy failed', detail: 'Could not access clipboard.' });
    }
  }
}

// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TooltipModule } from 'primeng/tooltip';

import { GROUPS_DEFAULT_PAGE_SIZE, GROUPS_PAGE_SIZE_OPTIONS } from '@lfx-one/shared/constants';
import type { GroupsTabId, OrgGroup } from '@lfx-one/shared/interfaces';

import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';

@Component({
  selector: 'lfx-groups-table',
  imports: [TableComponent, TooltipModule, RouterLink, TagComponent],
  templateUrl: './groups-table.component.html',
})
export class GroupsTableComponent {
  // ─── Private injections ──────────────────────────────────────────────────────

  private readonly router = inject(Router);

  // ─── Inputs ──────────────────────────────────────────────────────────────────

  public readonly groups = input.required<readonly OrgGroup[]>();
  public readonly loading = input<boolean>(false);
  public readonly activeTab = input<GroupsTabId>('all');

  // ─── Outputs ─────────────────────────────────────────────────────────────────

  public readonly clearFilters = output<void>();

  // ─── Constants ───────────────────────────────────────────────────────────────

  protected readonly pageSizeOptions: number[] = [...GROUPS_PAGE_SIZE_OPTIONS];

  // ─── State ───────────────────────────────────────────────────────────────────

  protected readonly first = signal(0);
  protected readonly size = signal(GROUPS_DEFAULT_PAGE_SIZE);

  // ─── Computed ────────────────────────────────────────────────────────────────

  protected readonly tabFilteredGroups = computed(() => {
    const tab = this.activeTab();
    const all = this.groups();
    if (tab === 'board') return all.filter((g) => g.type === 'Board');
    if (tab === 'other') return all.filter((g) => g.type !== 'Board');
    return all;
  });

  protected readonly totalRecords = computed(() => this.tabFilteredGroups().length);

  constructor() {
    // Reset to first page whenever the data set or active tab changes.
    effect(() => {
      this.groups();
      this.activeTab();
      this.first.set(0);
    });
  }

  // ─── Public methods ───────────────────────────────────────────────────────────

  protected onPage(event: { first: number; rows: number }): void {
    this.first.set(event.first);
    this.size.set(event.rows);
  }

  protected onClearFilters(): void {
    this.clearFilters.emit();
  }

  protected formatDate(date: Date): string {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  protected navigateToGroup(groupId: string): void {
    void this.router.navigate(['/org/groups', groupId]);
  }

  protected onRowKeydown(event: KeyboardEvent, groupId: string): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.navigateToGroup(groupId);
    }
  }
}

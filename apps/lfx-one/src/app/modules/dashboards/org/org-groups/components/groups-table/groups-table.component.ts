// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, output, signal } from '@angular/core';
import { TooltipModule } from 'primeng/tooltip';

import { GROUPS_DEFAULT_PAGE_SIZE, GROUPS_PAGE_SIZE_OPTIONS } from '@lfx-one/shared/constants';
import type { GroupsSortDir, GroupsSortField, GroupsTabId, OrgGroup } from '@lfx-one/shared/interfaces';

import { TableComponent } from '@components/table/table.component';

@Component({
  selector: 'lfx-groups-table',
  imports: [TableComponent, TooltipModule],
  templateUrl: './groups-table.component.html',
})
export class GroupsTableComponent {
  // ─── Inputs ──────────────────────────────────────────────────────────────────

  public readonly groups = input.required<readonly OrgGroup[]>();
  public readonly loading = input<boolean>(false);
  public readonly activeTab = input<GroupsTabId>('all');

  // ─── Outputs ─────────────────────────────────────────────────────────────────

  public readonly clearFilters = output<void>();

  // ─── Constants ───────────────────────────────────────────────────────────────

  protected readonly pageSizeOptions: number[] = [...GROUPS_PAGE_SIZE_OPTIONS];

  // ─── State ───────────────────────────────────────────────────────────────────

  protected readonly sortField = signal<GroupsSortField>('name');
  protected readonly sortDir = signal<GroupsSortDir>('asc');
  protected readonly page = signal(0);
  protected readonly size = signal(GROUPS_DEFAULT_PAGE_SIZE);

  // ─── Computed ────────────────────────────────────────────────────────────────

  protected readonly tabFilteredGroups = computed(() => {
    const tab = this.activeTab();
    const all = this.groups();
    if (tab === 'board') return all.filter((g) => g.type === 'Board');
    if (tab === 'other') return all.filter((g) => g.type !== 'Board');
    return all;
  });

  protected readonly sortedGroups = computed(() => {
    const rows = [...this.tabFilteredGroups()];
    const field = this.sortField();
    const dir = this.sortDir();
    rows.sort((a, b) => {
      let cmp = 0;
      if (field === 'name') cmp = a.name.localeCompare(b.name);
      else if (field === 'type') cmp = a.type.localeCompare(b.type);
      else if (field === 'memberCount') cmp = a.memberCount - b.memberCount;
      else if (field === 'updatedAt') cmp = a.updatedAt.getTime() - b.updatedAt.getTime();
      return dir === 'asc' ? cmp : -cmp;
    });
    return rows;
  });

  protected readonly totalRecords = computed(() => this.sortedGroups().length);

  protected readonly first = computed(() => this.page() * this.size());

  protected readonly pageRows = computed(() => {
    const start = this.first();
    return this.sortedGroups().slice(start, start + this.size());
  });

  protected readonly sortIconMap = computed(() => {
    const field = this.sortField();
    const dir = this.sortDir();
    const dirIcon = dir === 'asc' ? 'fa-light fa-arrow-up-short-wide' : 'fa-light fa-arrow-down-wide-short';
    const active = (f: GroupsSortField) => (f === field ? dirIcon : 'fa-light fa-sort text-gray-300');
    return {
      name: active('name'),
      type: active('type'),
      memberCount: active('memberCount'),
      updatedAt: active('updatedAt'),
    };
  });

  // ─── Public methods ───────────────────────────────────────────────────────────

  protected onSort(field: GroupsSortField): void {
    if (this.sortField() === field) {
      this.sortDir.update((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      this.sortField.set(field);
      this.sortDir.set('asc');
    }
    this.page.set(0);
  }

  protected onPage(event: { first: number; rows: number }): void {
    this.page.set(Math.floor(event.first / event.rows));
    this.size.set(event.rows);
  }

  protected onClearFilters(): void {
    this.clearFilters.emit();
  }

  protected getRelativeDate(date: Date): string {
    const diffMs = Date.now() - date.getTime();
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (days === 0) return 'Today';
    if (days === 1) return '1 day ago';
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    if (months === 1) return '1 month ago';
    if (months < 12) return `${months}mo ago`;
    return `${Math.floor(months / 12)}y ago`;
  }

  protected getFullDate(date: Date): string {
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }
}

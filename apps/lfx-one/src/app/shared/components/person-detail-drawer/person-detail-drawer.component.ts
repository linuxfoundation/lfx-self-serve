// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, DecimalPipe, isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, PLATFORM_ID, type Signal } from '@angular/core';
import type { OrgAllEmployeeCommitteeMembership, PersonDrawerTab } from '@lfx-one/shared/interfaces';
import { PersonDetailDrawerService } from '@services/person-detail-drawer.service';
import { DrawerModule } from 'primeng/drawer';

/** Shared Org Lens person-detail drawer — opened via PersonDetailDrawerService (LFXV2-2195). */
@Component({
  selector: 'lfx-person-detail-drawer',
  imports: [DatePipe, DecimalPipe, DrawerModule],
  templateUrl: './person-detail-drawer.component.html',
})
export class PersonDetailDrawerComponent {
  private readonly platformId = inject(PLATFORM_ID);
  protected readonly drawer = inject(PersonDetailDrawerService);

  protected readonly tabs: readonly { id: PersonDrawerTab; label: string }[] = [
    { id: 'events', label: 'Events' },
    { id: 'training', label: 'Training' },
    { id: 'code', label: 'Code Contributions' },
    { id: 'governance', label: 'Governance' },
  ];

  protected readonly governanceSeats: Signal<OrgAllEmployeeCommitteeMembership[]> = computed(() => this.initGovernanceSeats());
  protected readonly codeTotals: Signal<{ commits: number; projects: number }> = computed(() => this.initCodeTotals());

  protected onVisibleChange(visible: boolean): void {
    if (!visible) {
      this.drawer.close();
    }
  }

  protected onTabKeydown(event: KeyboardEvent): void {
    const current = this.tabs.findIndex((t) => t.id === this.drawer.activeTab());
    let next = current;
    switch (event.key) {
      case 'ArrowRight':
        next = (current + 1) % this.tabs.length;
        break;
      case 'ArrowLeft':
        next = (current - 1 + this.tabs.length) % this.tabs.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = this.tabs.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    this.drawer.setTab(this.tabs[next].id);
    if (isPlatformBrowser(this.platformId)) {
      document.getElementById(`person-detail-drawer-tab-${this.tabs[next].id}`)?.focus();
    }
  }

  private initGovernanceSeats(): OrgAllEmployeeCommitteeMembership[] {
    const supplied = this.drawer.activeContext()?.governanceSeats;
    if (supplied) {
      return supplied;
    }
    const detail = this.drawer.detail();
    if (!detail) {
      return [];
    }
    return [...detail.boardSeats, ...detail.committeeSeats];
  }

  private initCodeTotals(): { commits: number; projects: number } {
    const detail = this.drawer.detail();
    if (!detail) {
      return { commits: 0, projects: 0 };
    }
    return {
      commits: detail.code.reduce((sum, row) => sum + row.totalCommits, 0),
      projects: detail.code.length,
    };
  }
}

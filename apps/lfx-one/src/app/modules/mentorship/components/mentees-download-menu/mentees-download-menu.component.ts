// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, input, signal, viewChild } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { MenuComponent } from '@components/menu/menu.component';
import {
  MENTORSHIP_ADMIN_MENTEE_STATUS_FILTER_LABELS,
  MENTORSHIP_ADMIN_MENTEE_STATUS_FILTERS,
  MENTORSHIP_ADMIN_MENTEES_EXPORT_ALL_LABEL,
} from '@lfx-one/shared/constants';
import { MentorshipAdminMenteeStatusFilter, MentorshipAdminMenteeTab } from '@lfx-one/shared/interfaces';
import { MenuItem } from 'primeng/api';
import { finalize, take } from 'rxjs';

import { MentorshipMenteesExportService } from '../../services/mentorship-mentees-export.service';

/**
 * Download By Status on an admin mentee tab: a button that opens a menu of All, then each status the tab filters on.
 * An entry saves the BFF's CSV of every mentee on the tab with that status, whatever the tab's search, filters or page,
 * and the button stays disabled until it settles. A download that lands after a tab switch is still saved.
 */
@Component({
  selector: 'lfx-mentorship-mentees-download-menu',
  imports: [ButtonComponent, MenuComponent],
  templateUrl: './mentees-download-menu.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MenteesDownloadMenuComponent {
  private readonly menteesExport = inject(MentorshipMenteesExportService);
  private readonly menu = viewChild<MenuComponent>('menu');

  public readonly programId = input.required<string>();
  public readonly tab = input.required<MentorshipAdminMenteeTab>();
  /** Test id of the button; each menu entry's is this plus `-` and the entry's id. */
  public readonly dataTest = input.required<string>();

  /** True while a download is in flight; the button stays disabled meanwhile. */
  protected readonly inFlight = signal(false);
  /** Whether the menu is open, for the trigger's `aria-expanded`. */
  protected readonly menuOpen = signal(false);
  protected readonly menuAriaLabel = computed(() => `Download ${this.tab()} mentees by status`);
  /** All, then each of the tab's statuses in its filter's order. */
  protected readonly menuItems = computed((): MenuItem[] => [
    { id: 'all', label: MENTORSHIP_ADMIN_MENTEES_EXPORT_ALL_LABEL, command: () => this.onDownload(null) },
    ...MENTORSHIP_ADMIN_MENTEE_STATUS_FILTERS[this.tab()].map((status) => ({
      id: status,
      label: MENTORSHIP_ADMIN_MENTEE_STATUS_FILTER_LABELS[status],
      command: () => this.onDownload(status),
    })),
  ]);

  protected onToggle(event: Event): void {
    this.menu()?.toggle(event);
  }

  /** Not tied to the component: a download that lands after it is gone is still saved. */
  private onDownload(status: MentorshipAdminMenteeStatusFilter | null): void {
    if (this.inFlight()) return;
    this.inFlight.set(true);
    this.menteesExport
      .download(this.programId(), this.tab(), status)
      .pipe(
        take(1),
        finalize(() => this.inFlight.set(false))
      )
      .subscribe();
  }
}

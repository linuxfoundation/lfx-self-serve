// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, input, output, PLATFORM_ID, signal, viewChild, viewChildren } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { MenuComponent } from '@components/menu/menu.component';
import { environment } from '@environments/environment';
import {
  MENTORSHIP_ADMIN_COUNT_UNAVAILABLE_LABEL,
  MENTORSHIP_PROGRAM_HIDE_CONFIRM,
  MENTORSHIP_PROGRAM_HIDE_DESCRIPTION,
  MENTORSHIP_PROGRAM_HIDEABLE_STATUSES,
  MENTORSHIP_PROGRAM_STATUS_BADGE_CLASSES,
  MENTORSHIP_PROGRAM_STATUS_LABELS,
  MENTORSHIP_PROGRAM_UNHIDE_CONFIRM,
  MENTORSHIP_PROGRAM_UNHIDE_DESCRIPTION,
} from '@lfx-one/shared/constants';
import {
  MentorshipAdminProgramTabCounts,
  MentorshipProgram,
  MentorshipProgramDetailTab,
  MentorshipProgramMenuItem,
  MentorshipProgramVisibilityAction,
} from '@lfx-one/shared/interfaces';
import { buildMentorshipProgramsUrl, getMentorshipProgramDetailTabs } from '@lfx-one/shared/utils';
import { ConfirmationService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';

/**
 * Admin program-detail header: title, season line, status, View Public Page, Edit Program, a `…` menu that hides a
 * published program or unhides a hidden one after a confirm, and underline tabs with count badges; a pending program
 * shows the Terms tab only. Visual spec matches the admin screenshot and the crowdfunding initiative header.
 */
@Component({
  selector: 'lfx-mentorship-program-detail-header',
  imports: [ButtonComponent, MenuComponent, ConfirmDialogModule],
  providers: [ConfirmationService],
  templateUrl: './program-detail-header.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProgramDetailHeaderComponent {
  private readonly tabBtns = viewChildren<ElementRef<HTMLButtonElement>>('tabBtn');
  private readonly moreMenu = viewChild<MenuComponent>('moreMenu');
  private readonly platformId = inject(PLATFORM_ID);
  private readonly confirmationService = inject(ConfirmationService);

  public readonly program = input.required<MentorshipProgram>();
  /** A count is `null` when its read failed; the badge then shows a dash. */
  public readonly tabCounts = input.required<MentorshipAdminProgramTabCounts>();
  public readonly activeTab = input.required<MentorshipProgramDetailTab>();
  public readonly tabChange = output<MentorshipProgramDetailTab>();
  /** True while a hide or unhide is saving; the `…` menu stays shut until it lands. */
  public readonly visibilityBusy = input(false);
  public readonly editClick = output<void>();
  /** Emitted once the admin confirms Hide or Unhide; the page writes it. */
  public readonly visibilityChange = output<MentorshipProgramVisibilityAction>();

  /** Whether the `…` menu is open, for the trigger's `aria-expanded`. */
  protected readonly moreMenuOpen = signal(false);

  protected readonly seasonLine = computed(() => this.program().projectName);

  protected readonly statusLabel = computed(() => MENTORSHIP_PROGRAM_STATUS_LABELS[this.program().status]);
  protected readonly statusBadgeClass = computed(() => MENTORSHIP_PROGRAM_STATUS_BADGE_CLASSES[this.program().status]);
  protected readonly publicPageUrl = computed(() => buildMentorshipProgramsUrl(environment.urls.mentorship, this.program().id));

  /** Hide for a published (open or completed) program, Unhide for a hidden one; a pending or rejected program has no menu. */
  protected readonly moreMenuItems = computed<MentorshipProgramMenuItem[]>(() => {
    const status = this.program().status;
    if (status === 'hidden') {
      return [
        {
          action: 'unhide',
          label: 'Unhide Program',
          icon: 'fa-light fa-eye',
          description: MENTORSHIP_PROGRAM_UNHIDE_DESCRIPTION,
          command: () => this.confirmUnhide(),
        },
      ];
    }
    if (MENTORSHIP_PROGRAM_HIDEABLE_STATUSES.includes(status)) {
      return [
        {
          action: 'hide',
          label: 'Hide Program',
          icon: 'fa-light fa-eye-slash',
          description: MENTORSHIP_PROGRAM_HIDE_DESCRIPTION,
          danger: true,
          command: () => this.confirmHide(),
        },
      ];
    }
    return [];
  });

  /** Each tab the program shows names the count it reads, since tab values are kebab-case and count keys camelCase. */
  protected readonly tabItems = computed(() => {
    const counts = this.tabCounts();
    return getMentorshipProgramDetailTabs(this.program().status).map((tab) => ({
      ...tab,
      count: counts[tab.countKey] ?? MENTORSHIP_ADMIN_COUNT_UNAVAILABLE_LABEL,
    }));
  });

  protected onTabClick(tab: MentorshipProgramDetailTab): void {
    this.tabChange.emit(tab);
  }

  protected onTabKeydown(event: KeyboardEvent): void {
    const tabs = this.tabItems().map((tab) => tab.value);
    const current = tabs.indexOf(this.activeTab());
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = (current + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (current - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    if (next === null) return;

    event.preventDefault();
    this.tabChange.emit(tabs[next]);
    if (isPlatformBrowser(this.platformId)) {
      const target = next;
      setTimeout(() => this.tabBtns()[target]?.nativeElement.focus());
    }
  }

  protected onEditClick(): void {
    this.editClick.emit();
  }

  protected onMoreClick(event: Event): void {
    this.moreMenu()?.toggle(event);
  }

  private confirmHide(): void {
    this.confirmationService.confirm({
      header: 'Hide Program',
      message: MENTORSHIP_PROGRAM_HIDE_CONFIRM,
      acceptLabel: 'Hide',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-danger p-button-sm',
      rejectButtonStyleClass: 'p-button-secondary p-button-sm p-button-outlined',
      accept: () => this.visibilityChange.emit('hide'),
    });
  }

  private confirmUnhide(): void {
    this.confirmationService.confirm({
      header: 'Unhide Program',
      message: MENTORSHIP_PROGRAM_UNHIDE_CONFIRM,
      acceptLabel: 'Unhide',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-sm',
      rejectButtonStyleClass: 'p-button-secondary p-button-sm p-button-outlined',
      accept: () => this.visibilityChange.emit('unhide'),
    });
  }
}

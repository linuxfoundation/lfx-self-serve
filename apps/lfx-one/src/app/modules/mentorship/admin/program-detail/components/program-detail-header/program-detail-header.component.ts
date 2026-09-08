// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, input, output, PLATFORM_ID, viewChildren } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { MENTORSHIP_PROGRAM_DETAIL_TABS, MENTORSHIP_PROGRAM_STATUS_BADGE_CLASSES, MENTORSHIP_PROGRAM_STATUS_LABELS } from '@lfx-one/shared/constants';
import { MentorshipProgram, MentorshipProgramDetailTab, MentorshipProgramTabCounts } from '@lfx-one/shared/interfaces';

/**
 * Admin program-detail header: title, season line, status, Edit Program, and
 * underline tabs with count badges. Visual spec matches the admin screenshot
 * and the crowdfunding underline-tab pattern.
 */
@Component({
  selector: 'lfx-mentorship-program-detail-header',
  imports: [ButtonComponent],
  templateUrl: './program-detail-header.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProgramDetailHeaderComponent {
  private readonly tabBtns = viewChildren<ElementRef<HTMLButtonElement>>('tabBtn');
  private readonly platformId = inject(PLATFORM_ID);

  public readonly program = input.required<MentorshipProgram>();
  public readonly tabCounts = input.required<MentorshipProgramTabCounts>();
  public readonly activeTab = input.required<MentorshipProgramDetailTab>();
  public readonly tabChange = output<MentorshipProgramDetailTab>();
  public readonly editClick = output<void>();

  protected readonly seasonLine = computed(() => {
    const program = this.program();
    return `${program.projectName} · ${program.term}`;
  });

  protected readonly statusLabel = computed(() => MENTORSHIP_PROGRAM_STATUS_LABELS[this.program().status]);
  protected readonly statusBadgeClass = computed(() => MENTORSHIP_PROGRAM_STATUS_BADGE_CLASSES[this.program().status]);

  protected readonly tabItems = computed(() => {
    const counts = this.tabCounts();
    return MENTORSHIP_PROGRAM_DETAIL_TABS.map((tab) => ({
      ...tab,
      count: counts[tab.value],
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
}

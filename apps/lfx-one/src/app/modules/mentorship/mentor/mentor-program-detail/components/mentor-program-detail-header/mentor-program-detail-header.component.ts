// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, ElementRef, inject, input, output, PLATFORM_ID, viewChildren } from '@angular/core';
import {
  MENTORSHIP_MENTOR_PROGRAM_DETAIL_TABS,
  MENTORSHIP_MENTOR_PROGRAM_TERM_STATUS_BADGE_CLASSES,
  MENTORSHIP_MENTOR_PROGRAM_TERM_STATUS_LABELS,
} from '@lfx-one/shared/constants';
import { MentorshipMentorProgram, MentorshipMentorProgramDetailTab, MentorshipMentorProgramTabCounts } from '@lfx-one/shared/interfaces';
import { formatMentorshipDateRange } from '@lfx-one/shared/utils';

@Component({
  selector: 'lfx-mentorship-mentor-program-detail-header',
  imports: [],
  templateUrl: './mentor-program-detail-header.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MentorProgramDetailHeaderComponent {
  public readonly program = input.required<MentorshipMentorProgram>();
  public readonly tabCounts = input.required<MentorshipMentorProgramTabCounts>();
  public readonly activeTab = input.required<MentorshipMentorProgramDetailTab>();
  public readonly tabChange = output<MentorshipMentorProgramDetailTab>();

  protected readonly seasonLine = computed(() => {
    const program = this.program();
    const dateRange = program.termStartDate && program.termEndDate ? formatMentorshipDateRange(program.termStartDate, program.termEndDate) : undefined;
    return dateRange ? `${program.projectName} · ${program.term} · ${dateRange}` : `${program.projectName} · ${program.term}`;
  });
  protected readonly statusLabel = computed(() => MENTORSHIP_MENTOR_PROGRAM_TERM_STATUS_LABELS[this.program().termStatus]);
  protected readonly statusBadgeClass = computed(() => MENTORSHIP_MENTOR_PROGRAM_TERM_STATUS_BADGE_CLASSES[this.program().termStatus]);

  protected readonly tabItems = computed(() => {
    const counts = this.tabCounts();
    return MENTORSHIP_MENTOR_PROGRAM_DETAIL_TABS.map((tab) => ({ ...tab, count: counts[tab.value] }));
  });

  private readonly tabBtns = viewChildren<ElementRef<HTMLButtonElement>>('tabBtn');
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);

  /**
   * Handle to the pending focus timer so we can cancel it if the component is
   * destroyed between the tab-change keystroke and the deferred `focus()` call.
   */
  private focusTimer: ReturnType<typeof setTimeout> | null = null;

  public constructor() {
    this.destroyRef.onDestroy(() => {
      if (this.focusTimer !== null) {
        clearTimeout(this.focusTimer);
        this.focusTimer = null;
      }
    });
  }

  protected onTabClick(tab: MentorshipMentorProgramDetailTab): void {
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
      // Deferred so the parent's `activeTab` input applies first — that flips the
      // target button's `tabindex="0"`, making it focusable. Handle is tracked so a
      // destroy between keystroke and callback cancels the pending focus (see the
      // constructor's `destroyRef.onDestroy`).
      const target = next;
      if (this.focusTimer !== null) clearTimeout(this.focusTimer);
      this.focusTimer = setTimeout(() => {
        this.focusTimer = null;
        this.tabBtns()[target]?.nativeElement.focus();
      });
    }
  }
}

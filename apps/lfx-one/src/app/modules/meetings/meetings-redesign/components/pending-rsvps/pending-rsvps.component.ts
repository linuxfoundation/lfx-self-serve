// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DOCUMENT, formatDate } from '@angular/common';
import { afterNextRender, ChangeDetectionStrategy, Component, computed, ElementRef, inject, Injector, input, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MEETING_VISIBILITY_BG_CLASSES } from '@lfx-one/shared/constants';
import { MeetingHomeRow, MeetingPendingRsvpItem, UiFocusable } from '@lfx-one/shared/interfaces';
import {
  getMeetingHomeRowLink,
  getMeetingHomeRowProject,
  getMeetingHomeRowType,
  getMeetingRecurrenceTooltip,
  getMeetingVisibilityBadges,
} from '@lfx-one/shared/utils';
import { UiAvatarComponent } from '@shared/uikit/avatar/avatar.component';
import { UiBadgeComponent } from '@shared/uikit/badge/badge.component';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiTooltipDirective } from '@shared/uikit/tooltip/tooltip.directive';
import { pairwise } from 'rxjs';

import { MeetingRsvpControlsComponent } from '../meeting-rsvp-controls/meeting-rsvp-controls.component';

/**
 * Pending RSVPs button of the meetings home header, with the number of dates to answer, and its popover listing them.
 * @description Each date answers through the list's RSVP controls; an answered date leaves the list. Hidden when nothing is pending.
 * When an answer empties the list the popover goes with the button, and focus moves to `fallbackFocus`.
 */
@Component({
  selector: 'lfx-pending-rsvps',
  imports: [MeetingRsvpControlsComponent, UiAvatarComponent, UiBadgeComponent, UiButtonComponent, UiTooltipDirective],
  templateUrl: './pending-rsvps.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
})
export class PendingRsvpsComponent {
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly timeFormat = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });

  /** Dates the viewer still has to answer, soonest first. */
  public readonly rows = input.required<MeetingHomeRow[]>();
  /** Takes focus when the last date is answered from the popover, since the button then hides. */
  public readonly fallbackFocus = input<UiFocusable | null>(null);

  protected readonly visibilityBg = MEETING_VISIBILITY_BG_CLASSES;
  protected readonly items: Signal<MeetingPendingRsvpItem[]> = computed(() => this.rows().map((row) => this.toItem(row)));
  protected readonly buttonLabel: Signal<string> = computed(() => `${this.rows().length} Pending RSVP${this.rows().length === 1 ? '' : 's'}`);

  public constructor() {
    this.initFocusRestore();
  }

  /** An answered date leaves the list with the focused button; focus goes to the date now in its place, or out of the popover once it is empty. */
  private initFocusRestore(): void {
    toObservable(this.rows)
      .pipe(pairwise(), takeUntilDestroyed())
      .subscribe(([previous, rows]) => {
        const index = previous.findIndex((row) => !rows.some((kept) => kept.key === row.key));
        if (index < 0 || !(this.panelElement() || this.host.contains(this.document.activeElement))) return;
        afterNextRender(() => this.restoreFocus(index), { injector: this.injector });
      });
  }

  private restoreFocus(index: number): void {
    const active = this.document.activeElement;
    if (active && active !== this.document.body) return;
    const titles = this.panelElement()?.querySelectorAll<HTMLElement>('[data-testid="meetings-home-pending-rsvps-row-title"]') ?? [];
    if (titles.length) titles[Math.min(index, titles.length - 1)].focus();
    else this.fallbackFocus()?.focus();
  }

  private panelElement(): HTMLElement | null {
    return this.document.querySelector<HTMLElement>('[data-testid="meetings-home-pending-rsvps-panel"]');
  }

  private toItem(row: MeetingHomeRow): MeetingPendingRsvpItem {
    return {
      row,
      project: getMeetingHomeRowProject(row.meeting),
      link: getMeetingHomeRowLink(row, 'upcoming'),
      visibilityBadges: getMeetingVisibilityBadges(row.meeting),
      when: `${formatDate(row.startTime, 'EEE, MMM d', 'en-US')} · ${this.timeFormat.format(new Date(row.startTime))}`,
      type: getMeetingHomeRowType(row.meeting),
      recurrenceTooltip: getMeetingRecurrenceTooltip(row.meeting, row.occurrence),
    };
  }
}

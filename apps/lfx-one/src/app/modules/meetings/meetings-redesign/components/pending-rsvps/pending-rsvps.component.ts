// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DOCUMENT } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  input,
  Signal,
  viewChild,
  viewChildren,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MEETING_VISIBILITY_BG_CLASSES } from '@lfx-one/shared/constants';
import { MeetingVisibilityKind } from '@lfx-one/shared/enums';
import { MeetingHomeRow, MeetingPendingRsvpItem, UiFocusable } from '@lfx-one/shared/interfaces';
import {
  formatMeetingDateTime,
  getMeetingHomeRowLink,
  getMeetingHomeRowProject,
  getMeetingHomeRowType,
  getMeetingRecurrenceTooltip,
  getMeetingVisibilityBadges,
} from '@lfx-one/shared/utils';
import { UiBadgeComponent } from '@shared/uikit/badge/badge.component';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiTooltipDirective } from '@shared/uikit/tooltip/tooltip.directive';
import { pairwise } from 'rxjs';

import { MeetingProjectLogoComponent } from '../meeting-project-logo/meeting-project-logo.component';
import { MeetingRsvpControlsComponent } from '../meeting-rsvp-controls/meeting-rsvp-controls.component';

/**
 * Pending RSVPs button of the meetings home header, with the number of dates to answer, and its popover listing them.
 * @description Each date answers through the list's RSVP controls; an answered date leaves the list. Hidden when nothing is pending.
 * When an answer empties the list the popover goes with the button, and focus moves to `fallbackFocus`.
 */
@Component({
  selector: 'lfx-pending-rsvps',
  imports: [MeetingProjectLogoComponent, MeetingRsvpControlsComponent, UiBadgeComponent, UiButtonComponent, UiTooltipDirective],
  templateUrl: './pending-rsvps.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
})
export class PendingRsvpsComponent {
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly panelList = viewChild<ElementRef<HTMLElement>>('panelList');
  private readonly rowElements = viewChildren<ElementRef<HTMLElement>>('rowElement');
  private readonly rowTitles = viewChildren<ElementRef<HTMLElement>>('rowTitle');

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

  /** An answered date leaves the list with the focused button; focus goes to the next date left, or out of the popover once it is empty. */
  private initFocusRestore(): void {
    toObservable(this.rows)
      .pipe(pairwise(), takeUntilDestroyed())
      .subscribe(([previous, rows]) => {
        const kept = new Set(rows.map((row) => row.key));
        const active = this.document.activeElement;
        if (previous.every((row) => kept.has(row.key)) || !(this.panelList() || this.host.contains(active))) return;
        // The answered date is the one holding focus, else the first one that left; the rendered rows still match `previous` here.
        const focused = this.rowElements().findIndex((row) => row.nativeElement.contains(active));
        const origin = focused >= 0 ? focused : previous.findIndex((row) => !kept.has(row.key));
        const next =
          previous.slice(origin + 1).find((row) => kept.has(row.key)) ??
          previous
            .slice(0, origin)
            .reverse()
            .find((row) => kept.has(row.key));
        const target = next ? rows.findIndex((row) => row.key === next.key) : -1;
        afterNextRender(() => this.restoreFocus(target), { injector: this.injector });
      });
  }

  private restoreFocus(target: number): void {
    const active = this.document.activeElement;
    const panel = this.panelList()?.nativeElement ?? null;
    // Focus left with the removed button: it is on nothing, or on the popover dialog around the list.
    if (active && active !== this.document.body && !active.contains(panel)) return;
    const title = this.rowTitles()[target]?.nativeElement;
    if (title) title.focus();
    else this.fallbackFocus()?.focus();
  }

  private toItem(row: MeetingHomeRow): MeetingPendingRsvpItem {
    return {
      row,
      project: getMeetingHomeRowProject(row.meeting),
      link: getMeetingHomeRowLink(row, 'upcoming'),
      // Public is the default, so only Private and Restricted get a badge.
      visibilityBadges: getMeetingVisibilityBadges(row.meeting).filter((badge) => badge.kind !== MeetingVisibilityKind.PUBLIC),
      when: formatMeetingDateTime(row.startTime),
      type: getMeetingHomeRowType(row.meeting),
      recurrenceTooltip: getMeetingRecurrenceTooltip(row.meeting, row.occurrence),
    };
  }
}

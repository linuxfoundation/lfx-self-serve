// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DialogRef } from '@angular/cdk/dialog';
import { DOCUMENT } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  Injector,
  input,
  linkedSignal,
  Signal,
  signal,
  TemplateRef,
  viewChild,
  viewChildren,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MeetingVisibilityKind } from '@lfx-one/shared/enums';
import { MeetingHomeRow, MeetingPendingRsvpItem, UiFocusable } from '@lfx-one/shared/interfaces';
import {
  formatMeetingWhen,
  getMeetingHomeRowLink,
  getMeetingHomeRowProject,
  getMeetingHomeRowType,
  getMeetingRecurrenceTooltip,
  getMeetingVisibilityBadges,
} from '@lfx-one/shared/utils';
import { UiBadgeComponent } from '@shared/uikit/badge/badge.component';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiDrawerComponent } from '@shared/uikit/drawer/drawer.component';
import { UiDrawerService } from '@shared/uikit/drawer/drawer.service';
import { UiTooltipDirective } from '@shared/uikit/tooltip/tooltip.directive';
import { Observable, pairwise, switchMap, take } from 'rxjs';

import { MeetingsHomeDetailsService } from '../../services/meetings-home-details.service';
import { MeetingsHomeResizeService } from '../../services/meetings-home-resize.service';

import { MeetingDateTileComponent } from '../meeting-date-tile/meeting-date-tile.component';
import { MeetingProjectLogoComponent } from '../meeting-project-logo/meeting-project-logo.component';
import { MeetingRsvpControlsComponent } from '../meeting-rsvp-controls/meeting-rsvp-controls.component';

/**
 * Pending RSVPs button of the meetings home header, with the number of dates to answer, and its drawer listing them.
 * @description Each date answers through the list's RSVP controls; an answered date leaves the list. Hidden when nothing is pending.
 * When the list empties the drawer closes with the button gone, and focus moves to `fallbackFocus`.
 */
@Component({
  selector: 'lfx-pending-rsvps',
  imports: [
    MeetingDateTileComponent,
    MeetingProjectLogoComponent,
    MeetingRsvpControlsComponent,
    UiBadgeComponent,
    UiButtonComponent,
    UiDrawerComponent,
    UiTooltipDirective,
  ],
  templateUrl: './pending-rsvps.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
})
export class PendingRsvpsComponent {
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly drawerService = inject(UiDrawerService);
  private readonly resize = inject(MeetingsHomeResizeService);
  private readonly details = inject(MeetingsHomeDetailsService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly drawerTemplate = viewChild.required<TemplateRef<unknown>>('drawer');
  private readonly panelList = viewChild<ElementRef<HTMLElement>>('panelList');
  private readonly rowElements = viewChildren<ElementRef<HTMLElement>>('rowElement');
  private readonly rowTitles = viewChildren<ElementRef<HTMLElement>>('rowTitle');
  private readonly projectNames = viewChildren<ElementRef<HTMLElement>>('projectName');

  /** Dates the viewer still has to answer, soonest first. */
  public readonly rows = input.required<MeetingHomeRow[]>();
  /** Takes focus when the last date is answered from the drawer, since the button then hides. */
  public readonly fallbackFocus = input<UiFocusable | null>(null);

  protected readonly drawerOpen = signal(false);
  /** Titles and project names cut off by the row width; only those get a tooltip with the full text. */
  protected readonly truncated = signal<ReadonlySet<HTMLElement>>(new Set());
  protected readonly items: Signal<MeetingPendingRsvpItem[]> = computed(() => this.rows().map((row) => this.toItem(row)));
  protected readonly buttonLabel: Signal<string> = computed(() => `${this.rows().length} Pending RSVP${this.rows().length === 1 ? '' : 's'}`);
  // Keeps the last count while the emptied drawer slides out.
  protected readonly subtitle: Signal<string> = linkedSignal<number, string>({
    source: () => this.rows().length,
    computation: (count, previous) => (count || !previous ? `${count} waiting for a response` : previous.value),
  });

  private drawerRef: DialogRef | null = null;

  public constructor() {
    this.initFocusRestore();
    this.initTruncation();
    this.destroyRef.onDestroy(() => this.drawerRef?.close());
  }

  protected openDrawer(): void {
    if (this.drawerRef) return;
    const ref = this.drawerService.open(this.drawerTemplate(), { width: 640, describedBy: true });
    this.drawerRef = ref;
    this.drawerOpen.set(true);
    ref.closed.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.drawerRef = null;
      this.drawerOpen.set(false);
    });
  }

  /** A plain click on a title swaps this drawer for the meeting's details; a modified click keeps the link's own behaviour. */
  protected openDetails(event: MouseEvent, row: MeetingHomeRow): void {
    const ref = this.drawerRef;
    if (!ref || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    // Opens once this drawer has slid out and handed focus back, so the details drawer returns focus to the Pending RSVPs button.
    ref.closed.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe(() => this.details.open(row, 'pending_rsvps'));
    ref.close();
  }

  /** An answered date leaves the list with the focused button; focus goes to the next date left, or out of the drawer once it is empty. */
  private initFocusRestore(): void {
    toObservable(this.rows)
      .pipe(pairwise(), takeUntilDestroyed())
      .subscribe(([previous, rows]) => {
        const kept = new Set(rows.map((row) => row.key));
        const active = this.document.activeElement;
        if (previous.every((row) => kept.has(row.key))) return;
        if (!rows.length && this.drawerRef) {
          this.closeEmptyDrawer(this.drawerRef);
          return;
        }
        if (!(this.panelList() || this.host.contains(active))) return;
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

  /** The opener is gone with the last date, so focus that the drawer hands back on close goes to `fallbackFocus` instead. */
  private closeEmptyDrawer(ref: DialogRef): void {
    ref.closed.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      const active = this.document.activeElement;
      // The opener may still be in the page if the dialog closes before the render that drops it.
      if (!active || active === this.document.body || this.host.contains(active)) this.fallbackFocus()?.focus();
    });
    ref.close();
  }

  private initTruncation(): void {
    toObservable(computed(() => [...this.rowTitles(), ...this.projectNames()].map((ref) => ref.nativeElement)))
      .pipe(
        switchMap(
          (elements) =>
            new Observable<ReadonlySet<HTMLElement>>((subscriber) =>
              this.resize.observe(elements, () => subscriber.next(new Set(elements.filter((element) => element.scrollWidth > element.clientWidth))))
            )
        ),
        takeUntilDestroyed()
      )
      .subscribe((truncated) => this.truncated.set(truncated));
  }

  private restoreFocus(target: number): void {
    const active = this.document.activeElement;
    const panel = this.panelList()?.nativeElement ?? null;
    // Focus left with the removed button: it is on nothing, or on the drawer around the list.
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
      when: formatMeetingWhen(row.startTime, row.durationMinutes),
      type: getMeetingHomeRowType(row.meeting),
      recurrenceTooltip: getMeetingRecurrenceTooltip(row.meeting, row.occurrence),
    };
  }
}

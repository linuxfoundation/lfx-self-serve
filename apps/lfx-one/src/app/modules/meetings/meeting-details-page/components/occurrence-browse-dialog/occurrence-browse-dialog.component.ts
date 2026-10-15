// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterNextRender, Component, computed, ElementRef, inject, Injector, Signal, signal } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import {
  MeetingOccurrenceBrowseDialogData,
  MeetingOccurrenceBrowseRow,
  MeetingOccurrenceBrowseTab,
  MeetingOccurrenceBrowseTabOption,
  MeetingOccurrenceStripItem,
} from '@lfx-one/shared/interfaces';
import { formatDisplayTimeInTimezone } from '@lfx-one/shared/utils';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

/**
 * The browse-all-occurrences dialog the occurrence strip opens from "Occurrence N of M" (E6-04, #3587,
 * FR-044, FR-047), the prototype's: the meeting's heading, Upcoming / Past tabs, and one row per
 * occurrence (date tile, full date, time) with "Viewing" on the page's own. Upcoming runs soonest
 * first, Past newest first; the tab the page's occurrence is in opens first.
 * @description It shows what the strip has loaded and asks the strip for more ("Load more", per side)
 * and to open a row, so one loader, with its run guards, serves both. A row opens as a chip does and
 * closes the dialog. A past row shows its end time only when the record has a scheduled end; otherwise
 * the start alone, never the series' duration as if it were fact. There is no attendance column until
 * E6-06 (#3589) supplies the figures. Cancelled occurrences are shown, struck through, and cannot be
 * opened. PrimeNG's dialog traps focus and closes on Escape; the strip hands focus back on close.
 *
 * The tabs are native ARIA tabs (`tablist` / `tab` / `tabpanel`, arrow keys between them): the LFX tab
 * and pill components are styled for other surfaces, and no wrapper takes this page's tokens.
 */
@Component({
  selector: 'lfx-meeting-occurrence-browse-dialog',
  imports: [ButtonComponent],
  templateUrl: './occurrence-browse-dialog.component.html',
})
export class MeetingOccurrenceBrowseDialogComponent {
  /** The heading's id: the caller names the dialog from it (`nameDynamicDialog`). */
  public static readonly headingId = 'occurrence-browse-title';

  private readonly ref = inject(DynamicDialogRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  protected readonly data: MeetingOccurrenceBrowseDialogData = inject(DynamicDialogConfig).data;

  protected readonly headingId = MeetingOccurrenceBrowseDialogComponent.headingId;
  protected readonly tabs: MeetingOccurrenceBrowseTabOption[] = [
    { id: 'upcoming', label: 'Upcoming' },
    { id: 'past', label: 'Past' },
  ];
  /** "Load more", as the prototype's text actions. */
  protected readonly loadMoreClass =
    '!h-auto !self-center !border-0 !bg-transparent !px-[10px] !py-[8px] !text-[13px] !font-semibold !text-[var(--md-accent-ink)] hover:!underline focus-visible:!shadow-[var(--md-shadow-focus)]';
  protected readonly closeButtonClass =
    '!h-[30px] !w-[30px] !min-w-0 !rounded-[var(--md-radius-md)] !border !border-[var(--md-border)] !bg-[var(--md-surface-card)] !p-0 !text-[var(--md-text-muted)] hover:!bg-[var(--md-surface-hover)] focus-visible:!shadow-[var(--md-shadow-focus)]';

  protected readonly tab = signal<MeetingOccurrenceBrowseTab>(this.initialTab());
  protected readonly loadingMore = signal(false);

  private readonly monthFormat = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: this.data.timezone });
  private readonly dayFormat = new Intl.DateTimeFormat('en-US', { day: 'numeric', timeZone: this.data.timezone });
  private readonly dateFormat = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: this.data.timezone,
  });

  protected readonly rows: Signal<MeetingOccurrenceBrowseRow[]> = this.initRows();
  /** "N occurrences", only once the whole series is known; then the cadence, when there is one. */
  protected readonly subtitle: Signal<string> = this.initSubtitle();
  protected readonly hasMore = computed(() => this.data.hasMore(this.tab()));
  /** The Past tab when the history could not be read: unknown, not empty. */
  protected readonly pastUnknown = computed(() => this.tab() === 'past' && this.data.pastIncomplete() && this.rows().length === 0);
  /** The Past tab with some rows but an unreadable rest of the history: said, so it does not read as all of it. */
  protected readonly pastPartial = computed(() => this.tab() === 'past' && this.data.pastIncomplete() && this.rows().length > 0);

  protected selectTab(tab: MeetingOccurrenceBrowseTab): void {
    this.tab.set(tab);
  }

  /** Left / Right move between the two tabs (and select them), Home / End to either end. */
  protected onTabKeydown(event: KeyboardEvent): void {
    const index = this.tabs.findIndex((tab) => tab.id === this.tab());
    const targets: Record<string, number> = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: this.tabs.length - 1 };
    const target = this.tabs[targets[event.key]];
    if (!target) {
      return;
    }
    event.preventDefault();
    this.tab.set(target.id);
    (event.currentTarget as HTMLElement).parentElement?.querySelector<HTMLElement>(`[data-tab="${target.id}"]`)?.focus();
  }

  protected open(row: MeetingOccurrenceBrowseRow): void {
    if (row.item.cancelled) {
      return;
    }
    this.data.open(row.item);
    this.ref.close();
  }

  /**
   * Reads the next page on the open tab. The button stays enabled (`aria-busy` while reading), so focus
   * stays on it; when the read adds rows, focus moves to the first new one, and if nothing more remains
   * (the button goes) to the last row, so it never falls out of the dialog to the page behind.
   */
  protected async loadMore(): Promise<void> {
    if (this.loadingMore()) {
      return;
    }
    const before = this.rows().length;
    this.loadingMore.set(true);
    try {
      await this.data.loadMore(this.tab());
    } finally {
      this.loadingMore.set(false);
    }
    const rows = this.rows();
    let target: MeetingOccurrenceBrowseRow | undefined;
    if (rows.length > before) {
      target = rows[before];
    } else if (!this.hasMore()) {
      target = rows[rows.length - 1];
    }
    if (target) {
      afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>(`[data-start-ms="${target.item.startMs}"]`)?.focus(), {
        injector: this.injector,
      });
    }
  }

  protected close(): void {
    this.ref.close();
  }

  /** The tab holding the page's occurrence; Upcoming when it is not among those loaded. */
  private initialTab(): MeetingOccurrenceBrowseTab {
    const selected = this.data.items().find((item) => item.startMs === this.data.selectedStartMs());
    return selected?.isPast ? 'past' : 'upcoming';
  }

  private initRows(): Signal<MeetingOccurrenceBrowseRow[]> {
    return computed(() => {
      const tab = this.tab();
      const selectedMs = this.data.selectedStartMs();
      const items = this.data.items().filter((item) => (tab === 'past' ? item.isPast : !item.isPast));
      const ordered = tab === 'past' ? [...items].reverse() : items;
      return ordered.map((item) => {
        const start = new Date(item.startMs);
        const selected = !item.cancelled && item.startMs === selectedMs;
        const startTime = formatDisplayTimeInTimezone(start, this.data.timezone);
        // An end only when it is the occurrence's own, never the series' duration standing in.
        const time = item.endKnown
          ? `${startTime} – ${formatDisplayTimeInTimezone(new Date(item.startMs + item.duration * 60_000), this.data.timezone)}`
          : startTime;
        return {
          item,
          month: this.monthFormat.format(start).toUpperCase(),
          day: this.dayFormat.format(start),
          date: this.dateFormat.format(start),
          time,
          selected,
          rowClass: this.rowClass(item, selected),
          bandClass: this.bandClass(item, selected),
        };
      });
    });
  }

  private initSubtitle(): Signal<string> {
    return computed(() => {
      const complete = !this.data.hasMore('past') && !this.data.hasMore('upcoming') && !this.data.pastIncomplete();
      const count = this.data.items().length;
      const parts = [complete ? `${count} ${count === 1 ? 'occurrence' : 'occurrences'}` : null, this.data.cadence].filter((part): part is string => !!part);
      return parts.join(' · ');
    });
  }

  /** The prototype's row: the page's own on the accent tint, others hovered, a cancelled one inert. */
  private rowClass(item: MeetingOccurrenceStripItem, selected: boolean): string {
    if (selected) {
      return 'bg-[var(--md-accent-bg)]';
    }
    return item.cancelled ? 'cursor-default' : 'hover:bg-[var(--md-surface-hover)]';
  }

  /** The date tile's month band: accent for the page's own, neutral for past, tinted for upcoming. */
  private bandClass(item: MeetingOccurrenceStripItem, selected: boolean): string {
    if (selected) {
      return 'bg-[var(--md-accent)] text-[var(--md-surface-card)]';
    }
    return item.isPast ? 'bg-[var(--md-border)] text-[var(--md-text-body)]' : 'bg-[var(--md-accent-bg)] text-[var(--md-accent-ink)]';
  }
}

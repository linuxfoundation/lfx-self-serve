// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterRenderEffect, Component, computed, ElementRef, input, output, Signal, viewChild } from '@angular/core';
import { TooltipModule } from 'primeng/tooltip';
import { FilterPillColor, FilterPillOption } from '@lfx-one/shared/interfaces';

/** @deprecated Use FilterPillOption from @lfx-one/shared/interfaces instead */
export type FilterOption = FilterPillOption;

@Component({
  selector: 'lfx-filter-pills',
  imports: [TooltipModule],
  templateUrl: './filter-pills.component.html',
  // An inline host cannot shrink in a flex row, so a track would spill out of its card instead of scrolling.
  host: {
    '[class.block]': "variant() === 'track'",
    '[class.min-w-0]': "variant() === 'track'",
    '[class.max-w-full]': "variant() === 'track'",
  },
})
export class FilterPillsComponent {
  public readonly options = input.required<FilterPillOption[]>();
  public readonly selectedFilter = input.required<string>();
  /**
   * `segmented` joins the options into one bordered control for mutually exclusive choices; `track` sets them in
   * a grey track with the selected option as a white chip.
   */
  public readonly variant = input<'pill' | 'segmented' | 'track'>('pill');
  /** Accessible name for the segmented or track group. */
  public readonly ariaLabel = input<string>('');
  public readonly filterChange = output<string>();

  private readonly track = viewChild<ElementRef<HTMLElement>>('track');

  /** Classes for each `pill` variant option, keyed by option id; an option's `color` replaces the default blue selected style. */
  protected readonly pillClasses: Signal<Record<string, string>> = this.initPillClasses();

  public constructor() {
    // A long track opens scrolled to the start, so bring a selected chip past its edge (e.g. one set by the URL)
    // into view. Only the track scrolls: scrollIntoView could also move the page.
    afterRenderEffect(() => {
      this.selectedFilter();
      this.options();
      const track = this.track()?.nativeElement;
      const chip = track?.querySelector<HTMLElement>('[aria-pressed="true"]');
      if (!track || !chip) return;

      const trackBox = track.getBoundingClientRect();
      const chipBox = chip.getBoundingClientRect();
      if (chipBox.left < trackBox.left) {
        track.scrollLeft -= trackBox.left - chipBox.left;
      } else if (chipBox.right > trackBox.right) {
        track.scrollLeft += chipBox.right - trackBox.right;
      }
    });
  }

  public handleFilterChange(filterId: string): void {
    this.filterChange.emit(filterId);
  }

  private initPillClasses(): Signal<Record<string, string>> {
    return computed(() => {
      const base = 'px-3 py-1 rounded-full text-sm transition-colors';
      const palette: Record<FilterPillColor | 'default', { selected: string; idle: string }> = {
        default: { selected: 'bg-blue-500 text-white', idle: 'bg-gray-100 text-gray-700 hover:bg-gray-200' },
        green: { selected: 'bg-emerald-600 text-white', idle: 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' },
        red: { selected: 'bg-red-600 text-white', idle: 'bg-red-50 text-red-700 hover:bg-red-100' },
        purple: { selected: 'bg-purple-600 text-white', idle: 'bg-purple-50 text-purple-700 hover:bg-purple-100' },
      };

      return Object.fromEntries(
        this.options().map((option) => {
          const colors = palette[option.color ?? 'default'];
          return [option.id, `${base} ${this.selectedFilter() === option.id ? colors.selected : colors.idle}`];
        })
      );
    });
  }
}

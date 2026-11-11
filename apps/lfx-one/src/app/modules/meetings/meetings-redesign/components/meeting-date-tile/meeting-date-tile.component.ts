// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, Signal } from '@angular/core';
import { MEETING_VISIBILITY_BG_CLASSES } from '@lfx-one/shared/constants';
import { MeetingVisibilityInfo } from '@lfx-one/shared/interfaces';
import { UiTooltipDirective } from '@shared/uikit/tooltip/tooltip.directive';

/**
 * Calendar tile of a meetings home date: month band over the day, with the visibility badges on its top-right corner.
 * @description The band is azure for upcoming dates and grey for past ones. Test ids start with `testIdPrefix`, e.g. `{prefix}-date-day`.
 */
@Component({
  selector: 'lfx-meeting-date-tile',
  imports: [DatePipe, UiTooltipDirective],
  templateUrl: './meeting-date-tile.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': 'tileClasses()',
    '[attr.data-testid]': 'testIdPrefix() + "-date"',
  },
})
export class MeetingDateTileComponent {
  /** Start of the date, as an ISO string. */
  public readonly date = input.required<string>();
  /** Prefix of the tile's test ids, such as `meetings-home-row`. */
  public readonly testIdPrefix = input.required<string>();
  /** Greys the month band for a date that has passed. */
  public readonly past = input<boolean>(false);
  /** Private and Restricted badges; Public needs none. */
  public readonly badges = input<MeetingVisibilityInfo[]>([]);
  /** 40×42 until its container is over 860px wide, then 46×48, as on the list rows; otherwise always 46×48. */
  public readonly responsive = input<boolean>(false);

  protected readonly visibilityBg = MEETING_VISIBILITY_BG_CLASSES;
  // Exact [Npx] design values: rem undershoots at the 14px root.
  protected readonly tileClasses: Signal<string> = computed(() =>
    this.responsive()
      ? 'relative flex h-[42px] w-[40px] flex-none flex-col rounded-[8px] border border-gray-200 bg-white @[861px]:h-[48px] @[861px]:w-[46px] @[861px]:rounded-[10px]'
      : 'relative flex h-[48px] w-[46px] flex-none flex-col rounded-[9px] border border-gray-200 bg-white'
  );
  protected readonly monthClasses: Signal<string> = this.initMonthClasses();
  protected readonly dayClasses: Signal<string> = computed(() => (this.responsive() ? 'text-[16px] @[861px]:text-[19px]' : 'text-[19px]'));

  private initMonthClasses(): Signal<string> {
    return computed(() => {
      const size = this.responsive() ? 'h-[13px] text-[8px] @[861px]:h-[14px] @[861px]:text-[8.5px]' : 'h-[14px] text-[8.5px]';
      if (this.past()) {
        return `${size} ${this.responsive() ? 'rounded-t-[7px] @[861px]:rounded-t-[9px]' : 'rounded-t-[8px]'} bg-gray-200 text-gray-900`;
      }
      return `${size} -mx-px -mt-px ${this.responsive() ? 'rounded-t-[8px] @[861px]:rounded-t-[10px]' : 'rounded-t-[9px]'} bg-blue-500 text-white`;
    });
  }
}

// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, signal, Signal, viewChild, WritableSignal } from '@angular/core';
import type { OrgMeetingsSpendSegment, OrgMeetingsSpendOtherItem, OrgSpendBarSegment } from '@lfx-one/shared/interfaces';
import { slugify } from '@lfx-one/shared/utils';
import { Popover, PopoverModule } from 'primeng/popover';

// Presentational ranked mini-bar list for "Where your people spend time" — each named item gets its
// own bar so adjacent segments never need to be visually distinguished; the trailing "others" bucket
// is muted and separated to avoid dominating the row. No shared wrapper exists for this pattern, so
// it stays local to org-meetings.
@Component({
  selector: 'lfx-org-spend-bar',
  imports: [PopoverModule],
  templateUrl: './org-spend-bar.component.html',
})
export class OrgSpendBarComponent {
  public readonly title = input.required<string>();
  public readonly icon = input.required<string>();
  public readonly segments = input.required<OrgMeetingsSpendSegment[]>();

  private readonly othersPopoverRef = viewChild<Popover>('othersPopover');

  protected readonly othersPopoverItems: WritableSignal<OrgMeetingsSpendOtherItem[]> = signal([]);

  protected readonly titleSlug: Signal<string> = computed(() => slugify(this.title()));

  protected readonly rows: Signal<OrgSpendBarSegment[]> = this.initRows();

  // `appendTo="body"` detaches the popover from the triggering row, so the pointer briefly leaves
  // the row while crossing to the popover — a same-tick `hide()` on the row's `mouseleave` would
  // close it before the pointer arrives. Deferring the hide by a tick lets a `mouseenter` on the
  // popover itself cancel it first. Also gives the "others" breakdown room to scroll instead of
  // being clipped by a fixed-height, pointer-events-none tooltip.
  private hideOthersPopoverTimeoutId: ReturnType<typeof setTimeout> | undefined;

  protected showOthersPopover(event: Event, items: OrgMeetingsSpendOtherItem[] | undefined): void {
    if (!items?.length) {
      return;
    }
    this.cancelHideOthersPopover();
    this.othersPopoverItems.set(items);
    this.othersPopoverRef()?.show(event);
  }

  protected scheduleHideOthersPopover(): void {
    this.cancelHideOthersPopover();
    this.hideOthersPopoverTimeoutId = setTimeout(() => this.othersPopoverRef()?.hide(), 100);
  }

  protected cancelHideOthersPopover(): void {
    clearTimeout(this.hideOthersPopoverTimeoutId);
  }

  protected hideOthersPopover(): void {
    this.othersPopoverRef()?.hide();
  }

  private initRows(): Signal<OrgSpendBarSegment[]> {
    return computed(() =>
      this.segments().map((segment) => ({
        ...segment,
        isOther: !!segment.others?.length,
      }))
    );
  }
}

// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, Signal } from '@angular/core';
import type { OrgMeetingsSpendSegment, OrgSpendBarSegment } from '@lfx-one/shared/interfaces';
import { slugify } from '@lfx-one/shared/utils';

// Presentational ranked mini-bar list for "Where your people spend time" — each named item gets its
// own bar so adjacent segments never need to be visually distinguished; the trailing "others" bucket
// is muted and separated to avoid dominating the row. No shared wrapper exists for this pattern, so
// it stays local to org-meetings.
@Component({
  selector: 'lfx-org-spend-bar',
  imports: [],
  templateUrl: './org-spend-bar.component.html',
})
export class OrgSpendBarComponent {
  public readonly title = input.required<string>();
  public readonly icon = input.required<string>();
  public readonly segments = input.required<OrgMeetingsSpendSegment[]>();

  protected readonly titleSlug: Signal<string> = computed(() => slugify(this.title()));

  protected readonly rows: Signal<OrgSpendBarSegment[]> = this.initRows();

  private initRows(): Signal<OrgSpendBarSegment[]> {
    return computed(() =>
      this.segments().map((segment) => ({
        ...segment,
        isOther: !!segment.others?.length,
      }))
    );
  }
}

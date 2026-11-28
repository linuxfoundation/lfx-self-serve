// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';
import { MKTG_REPORT_MISSING_FIX_PREFIX } from '@lfx-one/shared/constants';
import type { MktgReportInheritedGroup, MktgReportInheritedView } from '@lfx-one/shared/interfaces';

// The rows a revision inherited from the version it revises, for one card of
// a Sources and gaps tab: the sources read, the sources that could not be
// read, the missing assets or the warnings. Each row reads as the run's own
// row of that card does, with the version whose run produced it under it
// ("Read in version 1") in the tab's small grey line. Presentational: the
// view feeds it the inherited view (mktgReportInheritedView) and places it in
// the card after the run's own rows; it renders nothing when the group
// inherited no row, and the host is `contents`, so the list is the card's own
// child.
@Component({
  selector: 'lfx-mktg-report-inherited',
  templateUrl: './mktg-report-inherited.component.html',
  host: { class: 'contents' },
})
export class MktgReportInheritedComponent {
  /** The report's inherited rows, as the tab shows them. */
  public readonly view = input.required<MktgReportInheritedView>();
  /** The card this list stands in. */
  public readonly group = input.required<MktgReportInheritedGroup>();
  protected readonly fixPrefix = MKTG_REPORT_MISSING_FIX_PREFIX;
}

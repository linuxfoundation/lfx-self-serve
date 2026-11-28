// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';
import { MKTG_REPORT_FINDINGS_EMPTY_LINES, MKTG_REPORT_FINDINGS_TITLES, MKTG_REPORT_MISSING_FIX_PREFIX } from '@lfx-one/shared/constants';
import type { MktgReportFindingsView, MktgReportInheritedView } from '@lfx-one/shared/interfaces';

import { MktgReportInheritedComponent } from '../mktg-report-inherited/mktg-report-inherited.component';

// The Missing assets and Warnings cards of a Sources and gaps tab, for any
// agent whose report carries the v2 findings: the Brand Kit's titles, row
// shapes and empty lines (its Sources tab is the design of record), in the
// agent's own words, never rewritten. Presentational: the view feeds it the
// findings view (mktgReportFindingsView) and places it in its sources grid;
// the host is `contents`, so each card is a grid item of its own and Gaps and
// Notes keep their order after it. The rows a revision inherited follow the
// run's own in each card, marked with the version that produced them.
@Component({
  selector: 'lfx-mktg-report-findings',
  imports: [MktgReportInheritedComponent],
  templateUrl: './mktg-report-findings.component.html',
  host: { class: 'contents' },
})
export class MktgReportFindingsComponent {
  /** The report's findings as the tab shows them: the missing assets (label, reason, fix) and the warnings (text, source). */
  public readonly view = input.required<MktgReportFindingsView>();
  /** The rows the revision inherited (mktgReportInheritedView): its missing assets and warnings follow the run's own. */
  public readonly inherited = input.required<MktgReportInheritedView>();
  protected readonly titles = MKTG_REPORT_FINDINGS_TITLES;
  protected readonly emptyLines = MKTG_REPORT_FINDINGS_EMPTY_LINES;
  protected readonly fixPrefix = MKTG_REPORT_MISSING_FIX_PREFIX;
}

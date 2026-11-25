// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';
import { MKTG_REPORT_FINDINGS_EMPTY_LINES, MKTG_REPORT_FINDINGS_TITLES, MKTG_REPORT_MISSING_FIX_PREFIX } from '@lfx-one/shared/constants';
import type { MktgReportFindingsView } from '@lfx-one/shared/interfaces';

// The Missing assets and Warnings cards of a Sources and gaps tab, for any
// agent whose report carries the v2 findings: the Brand Kit's titles, row
// shapes and empty lines (its Sources tab is the design of record), in the
// agent's own words, never rewritten. Presentational: the view feeds it the
// findings view (mktgReportFindingsView) and places it in its sources grid;
// the host is `contents`, so each card is a grid item of its own and Gaps and
// Notes keep their order after it.
@Component({
  selector: 'lfx-mktg-report-findings',
  templateUrl: './mktg-report-findings.component.html',
  host: { class: 'contents' },
})
export class MktgReportFindingsComponent {
  /** The report's findings as the tab shows them: the missing assets (label, reason, fix) and the warnings (text, source). */
  public readonly view = input.required<MktgReportFindingsView>();
  protected readonly titles = MKTG_REPORT_FINDINGS_TITLES;
  protected readonly emptyLines = MKTG_REPORT_FINDINGS_EMPTY_LINES;
  protected readonly fixPrefix = MKTG_REPORT_MISSING_FIX_PREFIX;
}

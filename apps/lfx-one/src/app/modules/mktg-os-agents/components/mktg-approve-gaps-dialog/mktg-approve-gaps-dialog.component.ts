// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterNextRender, Component, ElementRef, inject, viewChild } from '@angular/core';
import {
  BRAND_KIT_APPROVE_CONFLICT_KEPT_PREFIX,
  BRAND_KIT_APPROVE_CONFLICTS_TITLE,
  BRAND_KIT_APPROVE_RULES_TITLE,
  MKTG_REPORT_FINDINGS_TITLES,
  MKTG_REPORT_GAPS_TITLE,
  MKTG_REPORT_MISSING_FIX_PREFIX,
} from '@lfx-one/shared/constants';
import type { MktgApproveGapsDialogData } from '@lfx-one/shared/interfaces';
import {
  brandKitApproveFindings,
  brandKitColorConflictViews,
  brandKitLfReferenceRuleLines,
  brandKitReportRules,
  mktgReportUnmirroredGaps,
} from '@lfx-one/shared/utils';
import { DynamicDialogConfig } from 'primeng/dynamicdialog';

// What the reviewer accepts by approving: the sources that could not be read
// and the open gaps, as before, and, for any agent whose report carries the
// v2 findings, the failed sources and missing assets in the Sources tab's
// words and shape, then the gaps no missing asset stands for; for a Brand
// Kit, also the colour conflicts the kit resolved and the chapters whose rules
// the LF reference supplied rather than the project. The buttons are the dialog's footer (MktgApproveGapsFooterComponent).
// The dialog's data is the report as every agent writes it, and whether the
// document is the Brand Kit's (the document type's word, not the report's
// shape); the v2 fields are read only where they are there, so a v1 report
// renders unchanged.
@Component({
  selector: 'lfx-mktg-approve-gaps-dialog',
  templateUrl: './mktg-approve-gaps-dialog.component.html',
})
export class MktgApproveGapsDialogComponent {
  private readonly config = inject(DynamicDialogConfig<MktgApproveGapsDialogData>);

  public readonly report = this.config.data?.report;
  /** Whether the document is the Brand Kit's, by its document type: its dialog lists no Gaps group. */
  public readonly brandKit = this.config.data?.brandKit ?? false;
  /** Any agent's v2 report: its failed sources and missing assets as the Sources tab words them; both empty for a v1 report. */
  public readonly findings = brandKitApproveFindings(this.report);
  /** Whether a v2 report has a failed source or a missing asset to show: then the top list is the two groups, else today's list. */
  public readonly showsFindings = this.findings.failed.length > 0 || this.findings.missing.length > 0;
  /** Under the two groups, another agent's gaps lines that no missing asset mirrors, as written; none for the kit or a v1 report. */
  public readonly gaps = this.showsFindings && !this.brandKit ? mktgReportUnmirroredGaps(this.report) : [];
  /** The colour conflicts, each value with its source in words and the kept one marked; empty for a v1 report. */
  public readonly colorConflicts = brandKitColorConflictViews(this.report);
  /** One line per chapter the LF reference supplied rules to; empty for a v1 report. */
  public readonly lfReferenceRules = brandKitLfReferenceRuleLines(brandKitReportRules(this.report));
  protected readonly conflictsTitle = BRAND_KIT_APPROVE_CONFLICTS_TITLE;
  protected readonly keptPrefix = BRAND_KIT_APPROVE_CONFLICT_KEPT_PREFIX;
  protected readonly rulesTitle = BRAND_KIT_APPROVE_RULES_TITLE;
  protected readonly groupTitles = MKTG_REPORT_FINDINGS_TITLES;
  protected readonly gapsTitle = MKTG_REPORT_GAPS_TITLE;
  protected readonly fixPrefix = MKTG_REPORT_MISSING_FIX_PREFIX;
  private readonly root = viewChild.required<ElementRef<HTMLDivElement>>('root');

  public constructor() {
    // The dialog opens read from its top: focus the content itself, not the first button at its foot,
    // which the browser would scroll a long list down to (the dialog's own focusOnShow is off).
    afterNextRender(() => this.root().nativeElement.focus({ preventScroll: true }));
  }
}

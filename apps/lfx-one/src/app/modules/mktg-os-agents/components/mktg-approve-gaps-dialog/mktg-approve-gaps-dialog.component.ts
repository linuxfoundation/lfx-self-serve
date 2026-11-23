// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterNextRender, Component, ElementRef, inject, viewChild } from '@angular/core';
import {
  BRAND_KIT_APPROVE_CONFLICT_KEPT_PREFIX,
  BRAND_KIT_APPROVE_CONFLICTS_TITLE,
  BRAND_KIT_APPROVE_RULES_TITLE,
  BRAND_KIT_MISSING_FIX_PREFIX,
  BRAND_KIT_SOURCES_GROUP_TITLES,
} from '@lfx-one/shared/constants';
import type { MktgAssetReport } from '@lfx-one/shared/interfaces';
import { brandKitApproveFindings, brandKitColorConflictViews, brandKitLfReferenceRuleLines, brandKitReportRules } from '@lfx-one/shared/utils';
import { DynamicDialogConfig } from 'primeng/dynamicdialog';

// What the reviewer accepts by approving: the sources that could not be read
// and the open gaps, as before, and, for a Brand Kit whose report carries
// them (v2), the failed sources and missing assets in the Sources tab's words
// and shape, the colour conflicts the kit resolved and the chapters whose
// rules the LF reference supplied rather than the project. The buttons are the
// dialog's footer (MktgApproveGapsFooterComponent). The report is the
// dialog's data as every agent writes it; the v2 fields are read only where
// they are there, so another agent's report renders unchanged.
@Component({
  selector: 'lfx-mktg-approve-gaps-dialog',
  templateUrl: './mktg-approve-gaps-dialog.component.html',
})
export class MktgApproveGapsDialogComponent {
  private readonly config = inject(DynamicDialogConfig<MktgAssetReport>);

  public readonly report = this.config.data;
  /** A v2 report's failed sources and missing assets as the Sources tab words them; both empty for a v1 report. */
  public readonly findings = brandKitApproveFindings(this.report);
  /** Whether a v2 report has a failed source or a missing asset to show: then the top list is the two groups, else today's list. */
  public readonly showsFindings = this.findings.failed.length > 0 || this.findings.missing.length > 0;
  /** The colour conflicts, each value with its source in words and the kept one marked; empty for a v1 report. */
  public readonly colorConflicts = brandKitColorConflictViews(this.report);
  /** One line per chapter the LF reference supplied rules to; empty for a v1 report. */
  public readonly lfReferenceRules = brandKitLfReferenceRuleLines(brandKitReportRules(this.report));
  protected readonly conflictsTitle = BRAND_KIT_APPROVE_CONFLICTS_TITLE;
  protected readonly keptPrefix = BRAND_KIT_APPROVE_CONFLICT_KEPT_PREFIX;
  protected readonly rulesTitle = BRAND_KIT_APPROVE_RULES_TITLE;
  protected readonly groupTitles = BRAND_KIT_SOURCES_GROUP_TITLES;
  protected readonly fixPrefix = BRAND_KIT_MISSING_FIX_PREFIX;
  private readonly root = viewChild.required<ElementRef<HTMLDivElement>>('root');

  public constructor() {
    // The dialog opens read from its top: focus the content itself, not the first button at its foot,
    // which the browser would scroll a long list down to (the dialog's own focusOnShow is off).
    afterNextRender(() => this.root().nativeElement.focus({ preventScroll: true }));
  }
}

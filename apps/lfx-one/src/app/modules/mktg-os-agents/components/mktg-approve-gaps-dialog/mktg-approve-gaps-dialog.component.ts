// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { BRAND_KIT_REPORT_V2_LABELS } from '@lfx-one/shared/constants';
import type { MktgAssetReport } from '@lfx-one/shared/interfaces';
import { brandKitColorConflictViews, brandKitLfReferenceRuleLines, brandKitReportRules } from '@lfx-one/shared/utils';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

// What the reviewer accepts by approving: the sources that could not be read
// and the open gaps, as before, and, for a Brand Kit whose report carries
// them (v2), the colour conflicts the kit resolved and the chapters whose
// rules the LF reference supplied rather than the project. The report is the
// dialog's data as every agent writes it; the v2 fields are read only where
// they are there, so another agent's report renders unchanged.
@Component({
  selector: 'lfx-mktg-approve-gaps-dialog',
  imports: [ButtonComponent],
  templateUrl: './mktg-approve-gaps-dialog.component.html',
})
export class MktgApproveGapsDialogComponent {
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig<MktgAssetReport>);

  public readonly report = this.config.data;
  /** The colour conflicts, each value with its source in words and the kept one marked; empty for a v1 report. */
  public readonly colorConflicts = brandKitColorConflictViews(this.report);
  /** One line per chapter the LF reference supplied rules to; empty for a v1 report. */
  public readonly lfReferenceRules = brandKitLfReferenceRuleLines(brandKitReportRules(this.report));
  protected readonly labels = BRAND_KIT_REPORT_V2_LABELS;

  protected close(approve: boolean): void {
    this.ref.close(approve);
  }
}
